/**
 * Automated deal scanner — runs entirely inside Convex (cron-driven, 24/7).
 *
 * Each tick sweeps one price band (rotating, so the whole market is covered ~hourly),
 * for BOTH clean-title and branded-title listings, then enriches each NEW/price-changed
 * VIN with Carbly (JD clean trade-in + KBB lending, mileage-adjusted) and keeps the ones
 * that pass the buy-box (user rule 2026-06-15):
 *
 *   filters : 2016+ (< 10 yrs), <= 110k miles, FSBO only
 *   qualify : price <= max(JD_clean_trade, KBB_lending) + $500   (clean title)
 *             ...same vs 70% of those books for salvage/rebuilt
 *   HOT     : way below BOTH books (>= $1,500 under each)
 *
 * Only qualifying listings are written, so the feed is purely real deals. No
 * sandbox / Daytona / local machine — it's all server-side HTTP.
 */
import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { fetchKslListings, brightDataConfigured, type KslSearchConfig } from "./lib/kslWebUnlocker";
import { carblyLookup, applyGapRule, carblyConfigured, BRANDED_FACTOR } from "./lib/carblyClient";
import { dedupeKeyFor } from "./lib/dedupe";

const MAX_ENRICH_PER_SWEEP = 24; // bound Carbly calls + action time per sweep
const CURRENT_YEAR = new Date().getFullYear();

// Buy-box filters: < 10 years old, <= 110k miles, FSBO.
const BASE_CONFIG: KslSearchConfig = {
  makes: [],
  models: [],
  zip: "84104",
  radiusMiles: 150,
  yearMin: CURRENT_YEAR - 10,
  mileageMax: 110000,
  sort: "NEWEST_TO_OLDEST",
};

const CLEAN_TITLE = "Clean Title";
const BRANDED_TITLE = "Salvage Title;Rebuilt/Reconstructed Title";

// KSL only returns ~30 listings per filter combo (pagination is client-side and
// can't be paged), so to capture EVERY eligible listing we slice on three
// dimensions — title × mileage × price — keeping each cell under the cap.
const MILEAGE_BANDS: [number, number][] = [
  [0, 50000], [50000, 75000], [75000, 95000], [95000, 110000],
];
const PRICE_BANDS: [number, number][] = [
  [500, 4000], [4000, 6000], [6000, 8000], [8000, 10000], [10000, 12000],
  [12000, 14500], [14500, 17500], [17500, 21000], [21000, 25000], [25000, 30000],
  [30000, 40000], [40000, 65000],
];
// Cartesian grid of (mileage band × price band) cells the cron rotates through.
const GRID: { mmin: number; mmax: number; pmin: number; pmax: number }[] = MILEAGE_BANDS.flatMap(
  ([mmin, mmax]) => PRICE_BANDS.map(([pmin, pmax]) => ({ mmin, mmax, pmin, pmax }))
);

function dealScoreFor(bestGap: number, price: number, hot: boolean): number {
  const pct = (bestGap / Math.max(price, 1)) * 100; // % under (or over, if negative) book
  const base = Math.min(100, Math.max(0, Math.round(50 + pct)));
  return hot ? Math.min(100, base + 15) : base;
}

interface SweepResult {
  scraped: number;
  enriched: number;
  qualified: number;
  hot: number;
  error?: string;
}

async function scanOne(
  ctx: { runQuery: any; runMutation: any },
  cfg: KslSearchConfig,
  factor: number,
  titleStatus: string
): Promise<SweepResult> {
  const listings = (await fetchKslListings(cfg)).filter((l) => l.vin);
  const keyByListing = new Map<string, (typeof listings)[number]>();
  for (const l of listings) {
    const key = dedupeKeyFor({ vin: l.vin, year: l.year, make: l.make, model: l.model, mileage: l.mileage, zip: l.zip, source: "ksl", sourceListingId: l.sourceListingId });
    keyByListing.set(key, l);
  }
  const existing: Record<string, { price: number; checked: boolean }> = await ctx.runQuery(
    internal.listings.existingByDedupeKeys,
    { keys: Array.from(keyByListing.keys()) }
  );
  const toEnrich = Array.from(keyByListing.values())
    .filter((l) => {
      const key = dedupeKeyFor({ vin: l.vin, year: l.year, make: l.make, model: l.model, mileage: l.mileage, zip: l.zip, source: "ksl", sourceListingId: l.sourceListingId });
      const ex = existing[key];
      return !ex || !ex.checked || ex.price !== l.price;
    })
    .slice(0, MAX_ENRICH_PER_SWEEP);

  const deals: any[] = [];
  let enriched = 0;
  let hot = 0;
  for (const l of toEnrich) {
    const val = await carblyLookup(l.vin!, l.mileage);
    enriched++;
    if (val.jdCleanTrade == null && val.kbbLending == null) continue;
    const g = applyGapRule(l.price, val, { factor, branded: titleStatus === "branded" });
    if (!g.qualifies) continue;
    if (g.hot) hot++;
    deals.push({
      source: "ksl",
      sourceListingId: l.sourceListingId,
      url: l.url,
      title: l.title,
      year: l.year,
      make: l.make,
      model: l.model,
      trim: l.trim,
      vin: l.vin,
      mileage: l.mileage,
      price: l.price,
      titleStatus,
      location: l.location,
      zip: l.zip,
      photoUrl: l.photoUrl,
      photos: l.photos,
      postedAt: l.postedAt,
      jdCleanTrade: g.effJd,
      kbbLending: g.effKbb,
      jdGap: g.jdGap,
      kbbGap: g.kbbGap,
      estValue: g.estValue,
      estProfit: g.bestGap,
      dealScore: dealScoreFor(g.bestGap, l.price, g.hot),
      hot: g.hot,
    });
  }
  if (deals.length) await ctx.runMutation(internal.listings.dealUpsert, { deals });
  return { scraped: listings.length, enriched, qualified: deals.length, hot };
}

/** Sweep one grid cell: clean-title (full books) + branded-title (70% books). */
async function scanBand(
  ctx: { runQuery: any; runMutation: any },
  priceMin: number,
  priceMax: number,
  mileageMin = 0,
  mileageMax = 110000
): Promise<SweepResult> {
  if (!brightDataConfigured()) return { scraped: 0, enriched: 0, qualified: 0, hot: 0, error: "BRIGHTDATA_API_TOKEN not set" };
  if (!carblyConfigured()) return { scraped: 0, enriched: 0, qualified: 0, hot: 0, error: "Carbly env not set" };
  const cell = { ...BASE_CONFIG, priceMin, priceMax, mileageMin, mileageMax };
  const clean = await scanOne(ctx, { ...cell, titleType: CLEAN_TITLE }, 1.0, "clean");
  let branded: SweepResult = { scraped: 0, enriched: 0, qualified: 0, hot: 0 };
  try {
    branded = await scanOne(ctx, { ...cell, titleType: BRANDED_TITLE }, BRANDED_FACTOR, "branded");
  } catch (e) {
    branded.error = String(e).slice(0, 120);
  }
  return {
    scraped: clean.scraped + branded.scraped,
    enriched: clean.enriched + branded.enriched,
    qualified: clean.qualified + branded.qualified,
    hot: clean.hot + branded.hot,
    error: clean.error ?? branded.error,
  };
}

/** Cron entrypoint — sweep one rotating grid cell per tick (full market ≈ every ~1.5h). */
export const runScan = internalAction({
  args: {},
  handler: async (ctx) => {
    const cell = GRID[Math.floor(Date.now() / 120000) % GRID.length];
    const res = await scanBand(ctx, cell.pmin, cell.pmax, cell.mmin, cell.mmax);
    console.log(`autoScan $${cell.pmin}-${cell.pmax} / ${cell.mmin}-${cell.mmax}mi:`, JSON.stringify(res));
    return res;
  },
});

/** Manual trigger: sweep a specific price (and optional mileage) cell now — used to backfill. */
export const scanNow = action({
  args: {
    priceMin: v.number(),
    priceMax: v.number(),
    mileageMin: v.optional(v.number()),
    mileageMax: v.optional(v.number()),
  },
  handler: async (ctx, { priceMin, priceMax, mileageMin, mileageMax }) => {
    return await scanBand(ctx, priceMin, priceMax, mileageMin ?? 0, mileageMax ?? 110000);
  },
});
