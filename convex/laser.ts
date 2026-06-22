/**
 * Laser Appraiser browser bridge — server side.
 *
 * The native Laser session can't be reproduced server-side (the `security`
 * token is bound to a logged-in browser). So instead a Tampermonkey userscript
 * runs INSIDE the user's logged-in Laser tab, looks up each VIN in-session, and
 * posts the book values back here. This module is the two endpoints it talks to:
 *
 *   pendingVins  (query)  -> VINs in the scrape queue awaiting appraisal
 *   appraise     (action) -> receives {jdCleanTrade, kbbLending} per VIN,
 *                            applies the SAME gap rule Carbly used, writes deals
 *
 * Both are gated by the INGEST_SECRET (passed as an arg by the userscript).
 * Laser thus becomes the appraisal source with the original buy-box logic intact.
 */
import { action, query, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { applyGapRule, BRANDED_FACTOR } from "./lib/gapRule";

function authed(secret: string | undefined): boolean {
  return !!secret && secret === process.env.INGEST_SECRET;
}

// Same score curve the Carbly scan used (autoScan.dealScoreFor).
function dealScoreFor(bestGap: number, price: number, hot: boolean): number {
  const pct = (bestGap / Math.max(price, 1)) * 100;
  const base = Math.min(100, Math.max(0, Math.round(50 + pct)));
  return hot ? Math.min(100, base + 15) : base;
}

/** VINs awaiting Laser appraisal — the browser bridge polls this. */
export const pendingVins = query({
  args: { secret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { secret, limit }) => {
    if (!authed(secret)) return { error: "unauthorized" };
    const rows = await ctx.db
      .query("scrapeQueue")
      .withIndex("by_pending", (q) => q.eq("pending", true))
      .order("desc")
      .take(limit ?? 20);
    return {
      vins: rows.map((r) => ({ dedupeKey: r.dedupeKey, vin: r.vin, mileage: r.mileage ?? null })),
    };
  },
});

/** Load queue rows by dedupeKey (internal, used by appraise). */
export const queueByKeys = internalQuery({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    const out: any[] = [];
    for (const k of keys) {
      const row = await ctx.db
        .query("scrapeQueue")
        .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", k))
        .first();
      if (row) out.push(row);
    }
    return out;
  },
});

/** Browser bridge posts Laser book values; apply the gap rule + write to the feed. */
export const appraise = action({
  args: {
    secret: v.string(),
    values: v.array(
      v.object({
        dedupeKey: v.string(),
        jdCleanTrade: v.union(v.number(), v.null()),
        kbbLending: v.union(v.number(), v.null()),
        // bridge v4: also capture JD Full Retail (NADA panel) + Base MMR (Manheim).
        jdFullRetail: v.optional(v.union(v.number(), v.null())),
        baseMmr: v.optional(v.union(v.number(), v.null())),
      })
    ),
  },
  handler: async (ctx, { secret, values }) => {
    if (!authed(secret)) return { error: "unauthorized" };
    if (!values.length) return { appraised: 0, qualified: 0, hot: 0 };

    const rows = await ctx.runQuery(internal.laser.queueByKeys, {
      keys: values.map((x) => x.dedupeKey),
    });
    const byKey = new Map<string, any>(rows.map((r: any): [string, any] => [r.dedupeKey, r]));

    const deals: any[] = [];
    let appraised = 0;
    let hot = 0;
    for (const val of values) {
      const q: any = byKey.get(val.dedupeKey);
      if (!q) continue;
      appraised++;
      // mark the row done so it isn't re-served (re-flagged pending on a price change)
      await ctx.runMutation(internal.scrapeQueue.markEnriched, { dedupeKey: q.dedupeKey, price: q.price });
      if (val.jdCleanTrade == null && val.kbbLending == null) continue;
      const branded = q.titleType === "branded";
      const g = applyGapRule(
        q.price,
        { jdCleanTrade: val.jdCleanTrade, kbbLending: val.kbbLending, uuid: null },
        { factor: branded ? BRANDED_FACTOR : 1.0, branded }
      );
      if (!g.qualifies) continue;
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
        vin: q.vin ?? null,
        mileage: q.mileage ?? null,
        price: q.price,
        titleStatus: branded ? "rebuilt" : "clean",
        location: q.location ?? null,
        zip: q.zip ?? null,
        photoUrl: q.photoUrl ?? null,
        photos: q.photos ?? [],
        postedAt: q.postedAt ?? null,
        jdCleanTrade: g.effJd,
        kbbLending: g.effKbb,
        jdFullRetail: val.jdFullRetail ?? null,
        baseMmr: val.baseMmr ?? null,
        jdGap: g.jdGap,
        kbbGap: g.kbbGap,
        estValue: g.estValue,
        estProfit: g.bestGap,
        dealScore: dealScoreFor(g.bestGap, q.price, g.hot),
        hot: g.hot,
      });
    }
    if (deals.length) {
      await ctx.runMutation(internal.listings.dealUpsert, { deals, notify: true });
    }
    return { appraised, qualified: deals.length, hot };
  },
});
