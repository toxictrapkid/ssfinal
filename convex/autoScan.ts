/**
 * Automated deal scanner — runs entirely inside Convex (cron-driven, 24/7).
 *
 * APPRAISAL = Laser Appraiser (external), the main appraisal function. The scan
 * crons push every buy-box candidate straight into the scrape queue (NO Carbly);
 * Laser drains that queue, appraises each VIN (JD clean trade-in + KBB lending),
 * and posts the valued listings back via POST /ingest. The scoring pass
 * (convex/scoring.ts) then ranks them using MarketCheck comps.
 *
 * Carbly is LEGACY and OFF by default. The in-Convex Carbly enrichment runs only
 * when CARBLY_ENRICH="true"; otherwise the scan path NEVER logs into Carbly, so a
 * dead Carbly session can no longer abort scraping (the 2026-06-18 outage cause).
 *
 *   buy-box : 2016+ (< 10 yrs), <= 110k miles, FSBO only (older profile to 120k)
 *   No sandbox / Daytona / local machine — it's all server-side HTTP.
 */
import { internalAction, internalMutation, internalQuery, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { fetchKslListings, brightDataConfigured, type KslSearchConfig } from "./lib/kslWebUnlocker";
import { carblyLookup, applyGapRule, carblyConfigured, assignToFolder, carblyLogin, BRANDED_FACTOR, type CarblySession } from "./lib/carblyClient";
import { dedupeKeyFor } from "./lib/dedupe";

// Carbly's limit is one ACTIVE DEVICE at a time (not call volume), so normal
// throughput is fine — just don't run it while you're using Carbly yourself.
const MAX_ENRICH_PER_SWEEP = 20; // per-cell cap (cells are small after mileage×price slicing)
const CARBLY_DELAY_MS = 150; // light pacing between Carbly lookups
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

function dealScoreFor(bestGap: number, price: number, hot: boolean): number {
  const pct = (bestGap / Math.max(price, 1)) * 100; // % under (or over, if negative) book
  const base = Math.min(100, Math.max(0, Math.round(50 + pct)));
  return hot ? Math.min(100, base + 15) : base;
}

/** Map a raw KSL listing to a scrape-queue row (no Carbly). */
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
  /** Set when Carbly's daily add/rate limit was hit — the sweep stopped early to back off. */
  limited?: boolean;
  error?: string;
}

async function scanOne(
  ctx: { runQuery: any; runMutation: any },
  cfg: KslSearchConfig,
  factor: number,
  titleStatus: string,
  notify: boolean,
  session: CarblySession
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
  const disqualified: { key: string; price: number }[] = []; // existing deals that no longer fit
  let enriched = 0;
  let hot = 0;
  let limited = false;
  for (const l of toEnrich) {
    const key = dedupeKeyFor({ vin: l.vin, year: l.year, make: l.make, model: l.model, mileage: l.mileage, zip: l.zip, source: "ksl", sourceListingId: l.sourceListingId });
    if (enriched > 0) await new Promise((r) => setTimeout(r, CARBLY_DELAY_MS)); // pace Carbly
    const val = await carblyLookup(l.vin!, l.mileage, session);
    if (val.limited) { limited = true; break; } // Carbly daily limit hit -> stop, don't hammer
    enriched++; // count only real value pulls (not failed/limited lookups)
    if (val.jdCleanTrade == null && val.kbbLending == null) continue;
    const g = applyGapRule(l.price, val, { factor, branded: titleStatus === "branded" });
    if (!g.qualifies) {
      // A car we already had as a deal but that no longer fits (usually a price bump) -> retire it.
      if (existing[key]) disqualified.push({ key, price: l.price });
      continue;
    }
    if (val.uuid) await assignToFolder(val.uuid, session); // file every qualifier into "KSL leads"
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
  // Keep every still-live listing fresh so markStale only retires truly-vanished cars.
  await ctx.runMutation(internal.listings.touchSeen, { keys: Array.from(keyByListing.keys()) });
  if (deals.length) await ctx.runMutation(internal.listings.dealUpsert, { deals, notify });
  if (disqualified.length) await ctx.runMutation(internal.listings.markDisqualified, { items: disqualified });
  return { scraped: listings.length, enriched, qualified: deals.length, hot, limited };
}

/**
 * Scrape a config (clean + branded) straight into the scrape queue — NO Carbly.
 * This is the Laser-mode path: Laser Appraiser drains the queue and appraises
 * externally, posting valued listings back via /ingest.
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

/** Sweep one grid cell: clean-title (full books) + branded-title (70% books). */
async function scanBand(
  ctx: { runQuery: any; runMutation: any },
  priceMin: number,
  priceMax: number,
  mileageMin = 0,
  mileageMax = 120000,
  notify = false,
  yearMin?: number,
  yearMax?: number
): Promise<SweepResult> {
  if (!brightDataConfigured()) return { scraped: 0, enriched: 0, qualified: 0, hot: 0, error: "BRIGHTDATA_API_TOKEN not set" };

  // Laser mode (DEFAULT): appraisal is done externally by Laser Appraiser, which
  // drains the scrape queue and posts valued listings back via POST /ingest. So
  // just scrape this band straight into the queue — never log into Carbly. This
  // is what stops a dead Carbly session from ever blocking the scrape again.
  if (process.env.CARBLY_ENRICH !== "true") {
    const cell: KslSearchConfig = {
      ...BASE_CONFIG, priceMin, priceMax, mileageMin, mileageMax,
      yearMin: yearMin ?? CURRENT_YEAR - 10, yearMax,
    };
    const q = await enqueueBand(ctx, cell);
    return { scraped: q.scraped, enriched: 0, qualified: 0, hot: 0 };
  }

  // --- Legacy Carbly path (only when CARBLY_ENRICH="true") ---
  if (!carblyConfigured()) return { scraped: 0, enriched: 0, qualified: 0, hot: 0, error: "Carbly env not set" };
  const session = await carblyLogin(); // fresh login each run -> reclaims the single-device slot
  if (!session) return { scraped: 0, enriched: 0, qualified: 0, hot: 0, error: "Carbly login failed" };
  const cell: KslSearchConfig = {
    ...BASE_CONFIG,
    priceMin,
    priceMax,
    mileageMin,
    mileageMax,
    yearMin: yearMin ?? CURRENT_YEAR - 10,
    yearMax,
  };
  const clean = await scanOne(ctx, { ...cell, titleType: CLEAN_TITLE }, 1.0, "clean", notify, session);
  let branded: SweepResult = { scraped: 0, enriched: 0, qualified: 0, hot: 0 };
  // If the clean pass already hit Carbly's limit, don't bother with the branded pass.
  if (!clean.limited) {
    try {
      branded = await scanOne(ctx, { ...cell, titleType: BRANDED_TITLE }, BRANDED_FACTOR, "branded", notify, session);
    } catch (e) {
      branded.error = String(e).slice(0, 120);
    }
  }
  return {
    scraped: clean.scraped + branded.scraped,
    enriched: clean.enriched + branded.enriched,
    qualified: clean.qualified + branded.qualified,
    hot: clean.hot + branded.hot,
    limited: clean.limited || branded.limited,
    error: clean.error ?? branded.error,
  };
}

// After hitting Carbly's daily cap, the cron sleeps this long before probing
// again — so it doesn't waste a scrape + bump the Carbly app every 2 minutes
// for ~24h. It auto-resumes once Carbly's window resets.
const CARBLY_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3h

export const getScanState = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("scanState").first(),
});

export const setCarblyLimited = internalMutation({
  args: { limited: v.boolean() },
  handler: async (ctx, { limited }) => {
    const row = await ctx.db.query("scanState").first();
    const patch = { carblyLimitedAt: limited ? Date.now() : undefined, lastTickAt: Date.now() };
    if (row) await ctx.db.patch(row._id, patch);
    else await ctx.db.insert("scanState", patch);
  },
});

/** Cron entrypoint — sweep one rotating grid cell per tick (full market ≈ every ~1.5h). */
export const runScan = internalAction({
  args: {},
  handler: async (ctx) => {
    // Kill-switch: only run when explicitly enabled (set SCAN_ENABLED=true once
    // the Carbly token is healthy — keeps the cron from poking a locked account).
    if (process.env.SCAN_ENABLED !== "true") {
      console.log("autoScan paused (SCAN_ENABLED != true)");
      return { paused: true };
    }
    // Cooldown: if we recently hit Carbly's daily cap, skip this tick entirely
    // (no scrape, no Carbly login) until the window likely reset.
    const st = await ctx.runQuery(internal.autoScan.getScanState, {});
    if (st?.carblyLimitedAt && Date.now() - st.carblyLimitedAt < CARBLY_COOLDOWN_MS) {
      const mins = Math.round((CARBLY_COOLDOWN_MS - (Date.now() - st.carblyLimitedAt)) / 60000);
      console.log(`autoScan cooling down after Carbly limit (~${mins}m left)`);
      return { coolingDown: true, minutesLeft: mins };
    }
    const cell = GRID[Math.floor(Date.now() / 120000) % GRID.length];
    const res = await scanBand(ctx, cell.pmin, cell.pmax, cell.mmin, cell.mmax, true, cell.yearMin, cell.yearMax);
    // Arm the cooldown when limited; clear it on any clean run.
    await ctx.runMutation(internal.autoScan.setCarblyLimited, { limited: !!res.limited });
    const tag = res.limited ? " [CARBLY LIMIT REACHED — cooling down 3h]" : "";
    console.log(`autoScan ${cell.yearMin}${cell.yearMax ? "-" + cell.yearMax : "+"} $${cell.pmin}-${cell.pmax} / ${cell.mmin}-${cell.mmax}mi:${tag}`, JSON.stringify(res));
    return res;
  },
});

/**
 * Continuous scrape (NO Carbly) — runs every 2 min, stores every buy-box
 * candidate in the queue. Never blocked by the Carbly limit; just fills the
 * queue so the enricher can value them whenever quota is available.
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
 * Deferred enrichment — runs every 2 min, drains pending queue rows through
 * Carbly (JD clean trade + KBB lending), applies the gap rule, files qualifiers
 * into "KSL leads" + texts Contact-Now deals. Honors the 3h cooldown after the
 * daily cap, so it auto-resumes draining the backlog once Carbly resets.
 */
export const enrichTick = internalAction({
  args: {},
  handler: async (ctx) => {
    if (process.env.SCAN_ENABLED !== "true") return { paused: true };
    // Carbly disabled by default — appraisal moved to Laser Appraiser (run externally).
    // Set CARBLY_ENRICH=true only to re-enable the in-Convex Carbly enrichment.
    if (process.env.CARBLY_ENRICH !== "true") return { disabled: true };
    if (!carblyConfigured()) return { error: "Carbly env not set" };
    const st = await ctx.runQuery(internal.autoScan.getScanState, {});
    if (st?.carblyLimitedAt && Date.now() - st.carblyLimitedAt < CARBLY_COOLDOWN_MS) {
      const mins = Math.round((CARBLY_COOLDOWN_MS - (Date.now() - st.carblyLimitedAt)) / 60000);
      return { coolingDown: true, minutesLeft: mins };
    }
    const pending = await ctx.runQuery(internal.scrapeQueue.pendingToEnrich, { limit: ENRICH_BATCH });
    if (!pending.length) return { pending: 0 };
    const session = await carblyLogin();
    if (!session) return { error: "Carbly login failed" };
    const deals: any[] = [];
    let enriched = 0;
    let hot = 0;
    let limited = false;
    for (const q of pending) {
      if (enriched > 0) await new Promise((r) => setTimeout(r, CARBLY_DELAY_MS)); // pace Carbly
      const val = await carblyLookup(q.vin, q.mileage ?? null, session);
      if (val.limited) { limited = true; break; } // daily cap -> stop, leave row pending
      enriched++;
      await ctx.runMutation(internal.scrapeQueue.markEnriched, { dedupeKey: q.dedupeKey, price: q.price });
      if (val.jdCleanTrade == null && val.kbbLending == null) continue;
      const branded = q.titleType === "branded";
      const g = applyGapRule(q.price, val, { factor: branded ? BRANDED_FACTOR : 1.0, branded });
      if (!g.qualifies) continue;
      if (val.uuid) await assignToFolder(val.uuid, session);
      if (g.hot) hot++;
      deals.push({
        source: q.source,
        sourceListingId: q.sourceListingId,
        url: q.url,
        title: q.title,
        year: q.year ?? null,
        make: q.make ?? null,
        model: q.model ?? null,
        trim: q.trim ?? null,
        vin: q.vin,
        mileage: q.mileage ?? null,
        price: q.price,
        titleStatus: q.titleType,
        location: q.location ?? null,
        zip: q.zip ?? null,
        photoUrl: q.photoUrl ?? null,
        photos: q.photos ?? [],
        postedAt: q.postedAt ?? null,
        jdCleanTrade: g.effJd,
        kbbLending: g.effKbb,
        jdGap: g.jdGap,
        kbbGap: g.kbbGap,
        estValue: g.estValue,
        estProfit: g.bestGap,
        dealScore: dealScoreFor(g.bestGap, q.price, g.hot),
        hot: g.hot,
      });
    }
    if (deals.length) await ctx.runMutation(internal.listings.dealUpsert, { deals, notify: true });
    await ctx.runMutation(internal.autoScan.setCarblyLimited, { limited });
    const tag = limited ? " [CARBLY LIMIT — cooling down 3h]" : "";
    console.log(`enrichTick batch=${pending.length} enriched=${enriched} qualified=${deals.length} hot=${hot}${tag}`);
    return { enriched, qualified: deals.length, hot, limited, batch: pending.length };
  },
});

/** File every current qualifier into the Carbly "KSL leads" folder (one-time backfill). */
export const backfillFolder = action({
  args: {},
  handler: async (ctx) => {
    const session = await carblyLogin();
    if (!session) return { total: 0, filed: 0, error: "Carbly login failed" };
    const rows: { vin: string; mileage: number | null }[] = await ctx.runQuery(internal.listings.activeWithVin, {});
    let filed = 0;
    let limited = false;
    for (const r of rows) {
      const val = await carblyLookup(r.vin, r.mileage, session);
      if (val.limited) { limited = true; break; } // Carbly daily limit -> stop
      if (val.uuid && (await assignToFolder(val.uuid, session))) filed++;
    }
    return { total: rows.length, filed, limited };
  },
});

/** Manual trigger: sweep a specific price (and optional mileage) cell now — used to backfill. */
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
    return await scanBand(ctx, priceMin, priceMax, mileageMin ?? 0, mileageMax ?? 120000, false, yearMin, yearMax);
  },
});
