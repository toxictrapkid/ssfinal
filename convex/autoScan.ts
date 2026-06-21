/**
 * Automated deal scanner — runs entirely inside Convex (cron-driven, 24/7).
 *
 * Pipeline: scrapeTick scrapes KSL (Bright Data Web Unlocker) into the scrape
 * queue every 2 min. Appraisal is handled by the Laser Appraiser browser bridge
 * (convex/laser.ts), which looks up each VIN in the operator's logged-in Laser
 * session and posts book values back via laser.appraise. enrichTick is the
 * in-Convex fallback drain (MarketCheck comps / depreciation curve) used only
 * when the bridge is off.
 *
 *   buy-box : 2016+ (< 10 yrs) to 110k miles; older profile 2010-2015 to 120k; FSBO only
 *   All server-side HTTP — no sandbox / local machine.
 */
import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { fetchKslListings, brightDataConfigured, type KslSearchConfig } from "./lib/kslWebUnlocker";
import { dedupeKeyFor } from "./lib/dedupe";

const ENRICH_BATCH = 15; // queue rows the enrich cron drains per tick
const CURRENT_YEAR = new Date().getFullYear();

const BASE_CONFIG: KslSearchConfig = {
  makes: [],
  models: [],
  zip: "84104",
  radiusMiles: 150,
  sort: "NEWEST_TO_OLDEST",
};

const CLEAN_TITLE = "Clean Title";
const BRANDED_TITLE = "Salvage Title;Rebuilt/Reconstructed Title";

// Two buy-box age profiles (user rules): newer cars to 110k, older cars to 120k.
const AGE_PROFILES: { yearMin: number; yearMax?: number; mileageBands: [number, number][] }[] = [
  { yearMin: CURRENT_YEAR - 10, mileageBands: [[0, 50000], [50000, 75000], [75000, 95000], [95000, 110000]] }, // 2016+, <=110k
  { yearMin: 2010, yearMax: 2015, mileageBands: [[0, 60000], [60000, 90000], [90000, 120000]] }, // 2010-2015, <=120k
];
const PRICE_BANDS: [number, number][] = [
  [500, 4000], [4000, 6000], [6000, 8000], [8000, 10000], [10000, 12000],
  [12000, 14500], [14500, 17500], [17500, 21000], [21000, 25000], [25000, 30000],
  [30000, 40000], [40000, 65000],
];
// Grid of (age profile × mileage band × price band) cells the cron rotates through.
const GRID: { yearMin: number; yearMax?: number; mmin: number; mmax: number; pmin: number; pmax: number }[] =
  AGE_PROFILES.flatMap((p) =>
    p.mileageBands.flatMap(([mmin, mmax]) =>
      PRICE_BANDS.map(([pmin, pmax]) => ({ yearMin: p.yearMin, yearMax: p.yearMax, mmin, mmax, pmin, pmax }))
    )
  );

/** Map a raw KSL listing to a scrape-queue row. */
function kslToQueueItem(l: any, titleType: "clean" | "branded") {
  return {
    dedupeKey: dedupeKeyFor({ vin: l.vin, year: l.year, make: l.make, model: l.model, mileage: l.mileage, zip: l.zip, source: "ksl", sourceListingId: l.sourceListingId }),
    source: "ksl",
    sourceListingId: l.sourceListingId,
    url: l.url,
    title: l.title,
    vin: l.vin as string,
    year: l.year ?? undefined,
    make: l.make ?? undefined,
    model: l.model ?? undefined,
    trim: l.trim ?? undefined,
    mileage: l.mileage ?? undefined,
    price: l.price,
    titleType,
    zip: l.zip ?? undefined,
    location: l.location ?? undefined,
    photoUrl: l.photoUrl ?? undefined,
    photos: l.photos ?? [],
    postedAt: l.postedAt ?? undefined,
  };
}

interface SweepResult {
  scraped: number;
  enriched: number;
  qualified: number;
  hot: number;
  error?: string;
}

/**
 * Scrape a config (clean + branded) straight into the scrape queue.
 * Laser Appraiser drains the queue and appraises externally.
 */
async function enqueueBand(
  ctx: { runMutation: any },
  base: KslSearchConfig
): Promise<{ inserted: number; repriced: number; seen: number; scraped: number }> {
  const out = { inserted: 0, repriced: 0, seen: 0, scraped: 0 };
  for (const [titleType, titleFilter] of [["clean", CLEAN_TITLE], ["branded", BRANDED_TITLE]] as const) {
    try {
      const listings = (await fetchKslListings({ ...base, titleType: titleFilter })).filter((l) => l.vin);
      out.scraped += listings.length;
      const items = listings.map((l) => kslToQueueItem(l, titleType));
      if (items.length) {
        const r = await ctx.runMutation(internal.scrapeQueue.enqueueScraped, { items });
        out.inserted += r.inserted;
        out.repriced += r.repriced;
        out.seen += r.seen;
      }
    } catch (e) {
      console.log("enqueueBand error", titleType, String(e).slice(0, 120));
    }
  }
  return out;
}

/** Sweep one grid cell (clean + branded) into the queue. */
async function scanBand(
  ctx: { runQuery: any; runMutation: any },
  priceMin: number,
  priceMax: number,
  mileageMin = 0,
  mileageMax = 120000,
  yearMin?: number,
  yearMax?: number
): Promise<SweepResult> {
  if (!brightDataConfigured()) return { scraped: 0, enriched: 0, qualified: 0, hot: 0, error: "BRIGHTDATA_API_TOKEN not set" };
  const cell: KslSearchConfig = {
    ...BASE_CONFIG, priceMin, priceMax, mileageMin, mileageMax,
    yearMin: yearMin ?? CURRENT_YEAR - 10, yearMax,
  };
  const q = await enqueueBand(ctx, cell);
  return { scraped: q.scraped, enriched: 0, qualified: 0, hot: 0 };
}

/**
 * Continuous scrape — runs every 2 min, stores every buy-box candidate in the
 * queue. Deep coverage via the rotating grid cell + a newest-first fast-lane so
 * brand-new posts hit the queue within ~2 min.
 */
export const scrapeTick = internalAction({
  args: {},
  handler: async (ctx) => {
    if (process.env.SCAN_ENABLED !== "true") return { paused: true };
    if (!brightDataConfigured()) return { error: "BRIGHTDATA_API_TOKEN not set" };
    const cell = GRID[Math.floor(Date.now() / 120000) % GRID.length];
    const base: KslSearchConfig = {
      ...BASE_CONFIG,
      priceMin: cell.pmin,
      priceMax: cell.pmax,
      mileageMin: cell.mmin,
      mileageMax: cell.mmax,
      yearMin: cell.yearMin,
      yearMax: cell.yearMax,
    };
    const queued = { inserted: 0, repriced: 0, seen: 0 };
    const enqueue = async (cfg: KslSearchConfig, titleType: "clean" | "branded", where: string) => {
      try {
        const listings = (await fetchKslListings(cfg)).filter((l) => l.vin);
        const items = listings.map((l) => kslToQueueItem(l, titleType));
        if (items.length) {
          const r = await ctx.runMutation(internal.scrapeQueue.enqueueScraped, { items });
          queued.inserted += r.inserted;
          queued.repriced += r.repriced;
          queued.seen += r.seen;
        }
      } catch (e) {
        console.log("scrapeTick error", where, titleType, String(e).slice(0, 120));
      }
    };
    // Deep coverage: the rotating grid cell (beats KSL's ~30-result cap over a full rotation).
    for (const [titleType, titleFilter] of [["clean", CLEAN_TITLE], ["branded", BRANDED_TITLE]] as const) {
      await enqueue({ ...base, titleType: titleFilter }, titleType, "grid");
    }
    // Fast-lane: catch BRAND-NEW posts immediately — newest-first across the whole
    // buy-box (no price/mileage band) for both age profiles × both titles, so a
    // freshly listed car hits the queue within ~2 min instead of a full rotation.
    if (process.env.FASTLANE !== "false") {
      for (const p of AGE_PROFILES) {
        const wide: KslSearchConfig = {
          ...BASE_CONFIG,
          yearMin: p.yearMin,
          yearMax: p.yearMax,
          priceMin: 500,
          priceMax: 65000,
          mileageMin: 0,
          mileageMax: p.yearMax ? 120000 : 110000,
          sort: "NEWEST_TO_OLDEST",
        };
        for (const [titleType, titleFilter] of [["clean", CLEAN_TITLE], ["branded", BRANDED_TITLE]] as const) {
          await enqueue({ ...wide, titleType: titleFilter }, titleType, "fastlane");
        }
      }
    }
    console.log(`scrapeTick grid[${cell.yearMin}${cell.yearMax ? "-" + cell.yearMax : "+"} $${cell.pmin}-${cell.pmax}/${cell.mmin}-${cell.mmax}mi] + fastlane:`, JSON.stringify(queued));
    return queued;
  },
});

/**
 * Deferred enrichment cron — runs every 2 min.
 *  - If the Laser browser bridge owns appraisal (LASER_BRIDGE=true), this does
 *    nothing (the bridge posts book values to laser.appraise).
 *  - Otherwise it drains pending queue rows straight into the feed via
 *    upsertFromScrape, which schedules scoring (MarketCheck comps, else the
 *    depreciation-curve fallback). Fully self-contained — no external services.
 */
export const enrichTick = internalAction({
  args: {},
  handler: async (ctx): Promise<any> => {
    if (process.env.SCAN_ENABLED !== "true") return { paused: true };
    // The Laser browser bridge owns the queue when enabled.
    if (process.env.LASER_BRIDGE === "true") return { laserBridge: true };
    const pending: any[] = await ctx.runQuery(internal.scrapeQueue.pendingToEnrich, { limit: ENRICH_BATCH });
    if (!pending.length) return { pending: 0, promoted: 0 };
    const listings = pending.map((q: any) => ({
      source: q.source,
      sourceListingId: q.sourceListingId,
      url: q.url,
      title: q.title,
      price: q.price,
      mileage: q.mileage ?? null,
      year: q.year ?? null,
      make: q.make ?? null,
      model: q.model ?? null,
      trim: q.trim ?? null,
      vin: q.vin ?? null,
      titleStatus: q.titleType === "branded" ? "rebuilt" : "clean",
      sellerType: "private",
      location: q.location ?? null,
      photoUrl: q.photoUrl ?? null,
      photos: q.photos ?? [],
      description: null,
      zip: q.zip ?? null,
      postedAt: q.postedAt ?? null,
      distanceMiles: null,
    }));
    const res: any = await ctx.runMutation(internal.listings.upsertFromScrape, { listings });
    for (const q of pending) {
      await ctx.runMutation(internal.scrapeQueue.markEnriched, { dedupeKey: q.dedupeKey, price: q.price });
    }
    console.log("enrichTick(auto):", JSON.stringify({ promoted: pending.length, ...res }));
    return { promoted: pending.length, ...res };
  },
});

/** Manual trigger: sweep a specific price (and optional mileage) cell now. */
export const scanNow = action({
  args: {
    priceMin: v.number(),
    priceMax: v.number(),
    mileageMin: v.optional(v.number()),
    mileageMax: v.optional(v.number()),
    yearMin: v.optional(v.number()),
    yearMax: v.optional(v.number()),
  },
  handler: async (ctx, { priceMin, priceMax, mileageMin, mileageMax, yearMin, yearMax }) => {
    return await scanBand(ctx, priceMin, priceMax, mileageMin ?? 0, mileageMax ?? 120000, yearMin, yearMax);
  },
});
