import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // A saved buy-box that runs on a schedule (spec §3)
  searches: defineTable({
    name: v.string(),
    active: v.boolean(),
    sources: v.array(v.string()), // ["ksl","facebook"] — facebook deferred by user override
    location: v.string(), // "Salt Lake City, UT"
    zip: v.string(),
    radiusMiles: v.number(),
    priceMin: v.number(),
    priceMax: v.number(),
    yearMin: v.number(),
    yearMax: v.number(),
    mileageMin: v.number(),
    mileageMax: v.number(),
    makes: v.array(v.string()),
    models: v.array(v.string()),
    maxDaysListed: v.number(),
    cleanTitleOnly: v.boolean(),
    intervalMinutes: v.number(), // how often to run
    lastRunAt: v.optional(v.number()),
    createdAt: v.number(),
    // additions (ARCHITECTURE §5): observability for §8 builder + M6 failure isolation
    lastError: v.optional(v.string()),
    newDealsLastRun: v.optional(v.number()),
    // dispatch claim — prevents a >60s run being re-dispatched by the next
    // cron tick (M6 reviewer advisory A1)
    lastDispatchedAt: v.optional(v.number()),
  }).index("by_active", ["active"]),

  // One row per real car, deduped across sources (spec §3)
  listings: defineTable({
    dedupeKey: v.string(), // §5: vin else sha1(year|make|model|round(mileage,-3)|zip3)
    source: v.string(), // "ksl" | "facebook"
    sourceListingId: v.string(),
    url: v.string(),
    title: v.string(),
    year: v.optional(v.number()),
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    trim: v.optional(v.string()),
    vin: v.optional(v.string()),
    mileage: v.optional(v.number()),
    price: v.number(),
    titleStatus: v.optional(v.string()), // "clean" | "salvage" | "rebuilt" | "unknown"
    location: v.optional(v.string()),
    distanceMiles: v.optional(v.number()),
    sellerType: v.optional(v.string()), // "private" | "dealer" (dealers never ingested)
    photoUrl: v.optional(v.string()),
    photos: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    daysListed: v.optional(v.number()),
    priceHistory: v.array(v.object({ price: v.number(), at: v.number() })),
    status: v.string(), // "active" | "price_drop" | "gone" | "sold"
    // valuation + scoring (filled by scoring engine)
    estValue: v.optional(v.number()),
    estRecon: v.optional(v.number()),
    estFees: v.optional(v.number()),
    estProfit: v.optional(v.number()),
    dealScore: v.optional(v.number()), // 0–100
    hot: v.optional(v.boolean()),
    // workflow
    decision: v.optional(v.string()), // "new" | "pursue" | "pass" | "contacted"
    matchedSearchId: v.optional(v.id("searches")),
    // additions (ARCHITECTURE §5): provenance so the drawer can show its work
    compSource: v.optional(v.string()), // "marketcheck_sold"|"marketcheck_active"|"cache"|"curve"
    compSampleSize: v.optional(v.number()),
    compRef: v.optional(v.id("comps")),
    reconSource: v.optional(v.string()), // "parts" | "keyword" | "base"
    reconBreakdown: v.optional(
      v.array(
        v.object({
          label: v.string(),
          amount: v.number(),
          meta: v.optional(v.string()), // e.g. "median of 31 Grade-A listings"
        })
      )
    ),
    scoreBreakdown: v.optional(
      v.object({
        profit: v.number(),
        marginPct: v.number(),
        freshness: v.number(),
        mileageFit: v.number(),
        titleBonus: v.number(),
      })
    ),
    lastAlertPrice: v.optional(v.number()), // alert-dedupe anchor (re-alert only below this)
    // standing user override 2026-06-12: drivetrain-issue listings are always
    // surfaced for manual review ("we are here to get deals not turn them away")
    mechanicSpecial: v.optional(v.boolean()),
    // when the seller description was last fetched from the detail page (enrich.ts);
    // the search page omits it, so this gates the per-listing Web-Unlocker detail fetch
    descCheckedAt: v.optional(v.number()),
    // Carbly book-value enrichment (per-VIN, mileage-adjusted) + gap-rule output.
    // A listing qualifies for the feed when price is >= $1,000 under JD clean
    // trade-in OR KBB lending; HOT when under both. (user rule 2026-06-15)
    carblyJdCleanTrade: v.optional(v.number()),
    carblyKbbLending: v.optional(v.number()),
    carblyJdGap: v.optional(v.number()), // jdCleanTrade - price
    carblyKbbGap: v.optional(v.number()), // kbbLending - price
    carblyCheckedAt: v.optional(v.number()),
    valuationSource: v.optional(v.string()), // "carbly" | "curve" | ...
  })
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_score", ["dealScore"])
    .index("by_decision", ["decision"])
    .index("by_status", ["status"])
    .index("by_hot", ["hot"])
    .index("by_lastSeenAt", ["lastSeenAt"]),

  // Cached retail comp sets, 7-day TTL (spec §3)
  comps: defineTable({
    ymm: v.string(), // "2023|Chevrolet|Traverse"
    mileageBucket: v.string(), // "60k-80k" (20k-wide buckets)
    sampleSize: v.number(),
    medianRetail: v.number(),
    p25Retail: v.number(),
    p75Retail: v.number(),
    refreshedAt: v.number(),
    // addition: where this comp set came from ("marketcheck_sold" | "marketcheck_active")
    source: v.optional(v.string()),
  }).index("by_ymm_bucket", ["ymm", "mileageBucket"]),

  // Pipeline board (spec §3)
  pipeline: defineTable({
    listingId: v.id("listings"),
    stage: v.string(), // "lead"|"contacted"|"negotiating"|"bought"|"flipped"|"dead"
    targetBuy: v.optional(v.number()),
    walkAway: v.optional(v.number()),
    notes: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_stage", ["stage"])
    .index("by_listing", ["listingId"]),

  // Alert log (spec §3)
  alerts: defineTable({
    listingId: v.id("listings"),
    channel: v.string(), // "email" | "sms" | "log" (keyless fallback channel)
    sentAt: v.number(),
    score: v.number(),
    // "hot" (estProfit ≥ margin) | "mechanic_special" (manual-review override)
    reason: v.optional(v.string()),
    // the price the alert fired at (audit trail — M8 reviewer advisory D)
    price: v.optional(v.number()),
  }).index("by_listing", ["listingId"]),

  // Scrape queue — every buy-box candidate KSL listing, stored by the scrape
  // cron BEFORE Carbly enrichment. The enrich cron drains pending rows when
  // Carbly quota is available, so nothing is lost to the daily cap.
  scrapeQueue: defineTable({
    dedupeKey: v.string(),
    source: v.string(),
    sourceListingId: v.string(),
    url: v.string(),
    title: v.string(),
    vin: v.string(),
    year: v.optional(v.number()),
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    trim: v.optional(v.string()),
    mileage: v.optional(v.number()),
    price: v.number(),
    titleType: v.string(), // "clean" | "branded"
    zip: v.optional(v.string()),
    location: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    photos: v.optional(v.array(v.string())),
    postedAt: v.optional(v.number()),
    scrapedAt: v.number(),
    pending: v.boolean(), // true = needs Carbly enrichment (new or re-priced)
    enrichedAt: v.optional(v.number()),
  })
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_pending", ["pending", "scrapedAt"]),

  // Single-row scanner state — lets the cron back off after Carbly's daily
  // rate limit (so it doesn't scrape + bump the Carbly app every 2 min for a
  // full day once the cap is hit; it auto-resumes after the cooldown/reset).
  scanState: defineTable({
    carblyLimitedAt: v.optional(v.number()), // when we last hit Carbly's "Limit Reached"
    lastTickAt: v.optional(v.number()),
  }),

  // Single-row app settings (spec §3)
  settings: defineTable({
    marginThreshold: v.number(), // default 1500
    alertEmail: v.optional(v.string()),
    alertPhone: v.optional(v.string()),
    fbSessionCookie: v.optional(v.string()),
    daytonaApiKey: v.optional(v.string()),
    feesFlat: v.number(), // default 400
    // addition (spec §8 Settings view lists a MarketCheck key field)
    marketcheckKey: v.optional(v.string()),
  }),

  // Used engine/transmission prices from data/carpart_prices.csv (LOOP_PROMPT M1 addition).
  // One aggregated row per "year|make|model|part"; only rows with observed listings are seeded.
  partsCosts: defineTable({
    key: v.string(), // "2019|Chevrolet|Traverse|Engine"
    year: v.number(),
    make: v.string(),
    model: v.string(),
    part: v.string(), // "Engine" | "Transmission"
    medianPrice: v.number(), // median over all Grade-A <100k observations for the key
    sampleSize: v.number(), // total observations behind the median
    variants: v.array(
      v.object({
        variant: v.string(),
        medianPrice: v.number(),
        numListings: v.number(),
      })
    ),
    refreshedAt: v.number(),
  }).index("by_key", ["key"]),
});
