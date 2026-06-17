/**
 * Scrape queue — decouples KSL scraping from Carbly enrichment.
 *
 * The scrape cron stores EVERY buy-box candidate here (no Carbly), 24/7. A
 * separate enrich cron drains the pending rows through Carbly whenever quota is
 * available (and backs off when Carbly's daily cap is hit). So listings are
 * never lost to the Carbly limit — they wait in the queue and get valued later.
 */
import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";

const queueItem = v.object({
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
});

/** Upsert scraped candidates. New rows -> pending. Price change -> pending again. */
export const enqueueScraped = internalMutation({
  args: { items: v.array(queueItem) },
  handler: async (ctx, { items }) => {
    const now = Date.now();
    let inserted = 0,
      repriced = 0,
      seen = 0;
    for (const it of items) {
      const existing = await ctx.db
        .query("scrapeQueue")
        .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", it.dedupeKey))
        .first();
      if (!existing) {
        await ctx.db.insert("scrapeQueue", { ...it, scrapedAt: now, pending: true });
        inserted++;
        continue;
      }
      const patch: Record<string, unknown> = { scrapedAt: now, ...it };
      if (it.price !== existing.price) {
        patch.pending = true; // re-value at the new price
        repriced++;
      } else {
        seen++;
      }
      await ctx.db.patch(existing._id, patch);
    }
    return { inserted, repriced, seen };
  },
});

/** Pending candidates to enrich, newest-scraped first. */
export const pendingToEnrich = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query("scrapeQueue")
      .withIndex("by_pending", (q) => q.eq("pending", true))
      .order("desc")
      .take(limit);
  },
});

/** Mark a queue row enriched — but only if its price hasn't changed since we read it
 * (a fresh scrape may have re-flagged it pending at a new price). */
export const markEnriched = internalMutation({
  args: { dedupeKey: v.string(), price: v.number() },
  handler: async (ctx, { dedupeKey, price }) => {
    const row = await ctx.db
      .query("scrapeQueue")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (row && row.price === price) {
      await ctx.db.patch(row._id, { pending: false, enrichedAt: Date.now() });
      return { marked: true };
    }
    return { marked: false };
  },
});

/** Queue depth — for status/observability. */
export const queueStats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("scrapeQueue").collect();
    const pending = all.filter((r) => r.pending).length;
    return { total: all.length, pending, enriched: all.length - pending };
  },
});
