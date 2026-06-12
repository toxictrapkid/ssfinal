import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { dedupeKeyFor } from "./lib/dedupe";
import { normalizedListing } from "./lib/listingValidator";

const DAY_MS = 86_400_000;
const STALE_AFTER_MS = 48 * 60 * 60 * 1000; // §5: not seen for 48h -> gone

/**
 * daysListed anchors to the EARLIEST evidence of the car being for sale
 * (min of seller-claimed postedAt and our firstSeenAt), so relist bumps that
 * reset displayTime can't game maxDaysListed (VISION #5, M2 advisory A4).
 */
function daysListedFor(now: number, postedAt: number | null, firstSeenAt: number): number {
  const anchor = Math.min(postedAt ?? firstSeenAt, firstSeenAt);
  return Math.max(0, Math.floor((now - anchor) / DAY_MS));
}

/**
 * §5 upsert: one row per real car.
 *   new dedupeKey        -> insert active + schedule scoring
 *   seen, lower price    -> append priceHistory, status "price_drop", rescore
 *   seen, higher price   -> append priceHistory (truthful history), keep status
 *   seen, same price     -> touch lastSeenAt/daysListed
 *   was gone/sold, reappears -> relist: status back to active/price_drop,
 *                               firstSeenAt preserved, rescored
 * "sold" note: KSL search results carry no sold signal — "sold" arrives only
 * via manual decision (or a future detail-fetch heuristic). The 48h sweep
 * marks disappeared cars "gone"; the feed treats gone/sold alike (out of market).
 */
export const upsertFromScrape = internalMutation({
  args: {
    searchId: v.optional(v.id("searches")),
    listings: v.array(normalizedListing),
  },
  handler: async (ctx, { searchId, listings }) => {
    const now = Date.now();
    const result = { inserted: 0, updated: 0, priceDrops: 0, relists: 0, skipped: 0 };

    for (const item of listings) {
      if (item.sellerType !== "private") {
        // defense in depth — parse.py already hard-filters dealers (RULES #4)
        result.skipped++;
        continue;
      }
      const dedupeKey = dedupeKeyFor(item);
      const existing = await ctx.db
        .query("listings")
        .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
        .first();

      if (!existing) {
        const id = await ctx.db.insert("listings", {
          dedupeKey,
          source: item.source,
          sourceListingId: item.sourceListingId,
          url: item.url,
          title: item.title,
          year: item.year ?? undefined,
          make: item.make ?? undefined,
          model: item.model ?? undefined,
          trim: item.trim ?? undefined,
          vin: item.vin ?? undefined,
          mileage: item.mileage ?? undefined,
          price: item.price,
          titleStatus: item.titleStatus,
          location: item.location ?? undefined,
          distanceMiles: item.distanceMiles ?? undefined,
          sellerType: "private",
          photoUrl: item.photoUrl ?? undefined,
          photos: item.photos,
          description: item.description ?? undefined,
          firstSeenAt: now,
          lastSeenAt: now,
          daysListed: daysListedFor(now, item.postedAt, now),
          priceHistory: [{ price: item.price, at: now }],
          status: "active",
          decision: "new",
          matchedSearchId: searchId,
        });
        await ctx.scheduler.runAfter(0, internal.scoring.scoreListing, { listingId: id });
        result.inserted++;
        continue;
      }

      const wasOffMarket = existing.status === "gone" || existing.status === "sold";
      const priceChanged = item.price !== existing.price;
      const priceDropped = item.price < existing.price;

      const patch: Record<string, unknown> = {
        lastSeenAt: now,
        daysListed: daysListedFor(now, item.postedAt, existing.firstSeenAt),
        // full identity refresh — a relist under a new KSL id must not keep
        // the dead listing's id/title/titleStatus (M4 reviewer advisory A1)
        sourceListingId: item.sourceListingId,
        url: item.url,
        title: item.title,
        titleStatus: item.titleStatus,
        vin: item.vin ?? existing.vin,
        year: item.year ?? existing.year,
        make: item.make ?? existing.make,
        model: item.model ?? existing.model,
        trim: item.trim ?? existing.trim,
        photoUrl: item.photoUrl ?? existing.photoUrl,
        photos: item.photos.length ? item.photos : existing.photos,
        description: item.description ?? existing.description,
        mileage: item.mileage ?? existing.mileage,
      };
      if (priceChanged) {
        patch.price = item.price;
        patch.priceHistory = [...existing.priceHistory, { price: item.price, at: now }];
      }
      if (priceDropped) {
        patch.status = "price_drop";
      } else if (wasOffMarket) {
        patch.status = "active"; // relist (VISION #5)
      } else if (priceChanged && existing.status === "price_drop") {
        // a raise retracts the drop — don't advertise stale price_drop (A2)
        patch.status = "active";
      }
      await ctx.db.patch(existing._id, patch);

      if (priceDropped) result.priceDrops++;
      if (wasOffMarket) result.relists++;
      result.updated++;

      if (priceDropped || wasOffMarket) {
        await ctx.scheduler.runAfter(0, internal.scoring.scoreListing, {
          listingId: existing._id,
        });
      }
    }
    return result;
  },
});

/** Daily sweep: anything unseen for 48h that still looks on-market -> gone. */
export const markStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_AFTER_MS;
    const stale = await ctx.db
      .query("listings")
      .withIndex("by_lastSeenAt", (q) => q.lt("lastSeenAt", cutoff))
      .collect();
    let marked = 0;
    for (const listing of stale) {
      if (listing.status === "active" || listing.status === "price_drop") {
        await ctx.db.patch(listing._id, { status: "gone" });
        marked++;
      }
    }
    return { marked };
  },
});

/**
 * Ranked deal feed. Defaults SHOW EVERYTHING (standing user override: never
 * pre-filter a deal away) — filters only narrow when the user asks.
 */
export const feed = query({
  args: {
    limit: v.optional(v.number()),
    source: v.optional(v.string()),
    make: v.optional(v.string()),
    minProfit: v.optional(v.number()),
    minScore: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
    maxDaysListed: v.optional(v.number()),
    specialsOnly: v.optional(v.boolean()),
    hotOnly: v.optional(v.boolean()),
    includeGone: v.optional(v.boolean()),
    sort: v.optional(v.string()), // "score" (default) | "profit" | "newest" | "price"
  },
  handler: async (ctx, args) => {
    const take = Math.min(args.limit ?? 100, 300);
    // by_score keeps unscored rows (undefined) last in desc order
    const rows = await ctx.db
      .query("listings")
      .withIndex("by_score")
      .order("desc")
      .take(600);
    let out = rows.filter((l) =>
      args.includeGone ? true : l.status === "active" || l.status === "price_drop"
    );
    if (args.source) out = out.filter((l) => l.source === args.source);
    if (args.make)
      out = out.filter(
        (l) => (l.make ?? "").toLowerCase() === args.make!.toLowerCase()
      );
    if (args.minProfit !== undefined)
      out = out.filter((l) => (l.estProfit ?? -Infinity) >= args.minProfit!);
    if (args.minScore !== undefined)
      out = out.filter((l) => (l.dealScore ?? -1) >= args.minScore!);
    if (args.maxPrice !== undefined) out = out.filter((l) => l.price <= args.maxPrice!);
    if (args.maxDaysListed !== undefined)
      out = out.filter((l) => (l.daysListed ?? 0) <= args.maxDaysListed!);
    if (args.specialsOnly) out = out.filter((l) => l.mechanicSpecial === true);
    if (args.hotOnly) out = out.filter((l) => l.hot === true);
    switch (args.sort) {
      case "profit":
        out.sort((a, b) => (b.estProfit ?? -Infinity) - (a.estProfit ?? -Infinity));
        break;
      case "newest":
        out.sort((a, b) => b.firstSeenAt - a.firstSeenAt);
        break;
      case "price":
        out.sort((a, b) => a.price - b.price);
        break;
      default:
        break; // already score-desc from the index
    }
    return out.slice(0, take);
  },
});

/** Single listing for the detail drawer. */
export const get = query({
  args: { listingId: v.id("listings") },
  handler: async (ctx, { listingId }) => ctx.db.get(listingId),
});

/**
 * Pursue / Pass / Contacted (§6). Pursue creates (or revives) the pipeline
 * row with the §4 Step-5 suggested numbers.
 */
export const setDecision = mutation({
  args: { listingId: v.id("listings"), decision: v.string() },
  handler: async (ctx, { listingId, decision }) => {
    if (!["new", "pursue", "pass", "contacted"].includes(decision)) {
      throw new Error(`invalid decision: ${decision}`);
    }
    const listing = await ctx.db.get(listingId);
    if (!listing) throw new Error("listing not found");
    await ctx.db.patch(listingId, { decision });

    if (decision === "pursue" || decision === "contacted") {
      const existing = await ctx.db
        .query("pipeline")
        .withIndex("by_listing", (q) => q.eq("listingId", listingId))
        .first();
      const settings = await ctx.db.query("settings").first();
      const margin = settings?.marginThreshold ?? 1500;
      let targetBuy: number | undefined;
      let walkAway: number | undefined;
      if (
        listing.estValue !== undefined &&
        listing.estRecon !== undefined &&
        listing.estFees !== undefined
      ) {
        const net = listing.estValue - listing.estRecon - listing.estFees;
        targetBuy = Math.round(net - margin); // §4 Step 5
        walkAway = Math.round(net - margin * 0.6);
      }
      const stage = decision === "contacted" ? "contacted" : "lead";
      if (existing) {
        await ctx.db.patch(existing._id, { stage, updatedAt: Date.now() });
      } else {
        await ctx.db.insert("pipeline", {
          listingId,
          stage,
          targetBuy,
          walkAway,
          updatedAt: Date.now(),
        });
      }
    }
  },
});

/** Single listing (detail drawer; also the M4 gate's inspection hook). */
export const byDedupeKey = query({
  args: { dedupeKey: v.string() },
  handler: async (ctx, { dedupeKey }) => {
    return await ctx.db
      .query("listings")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
  },
});

/** Table-level counts for verification and the dashboard header. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("listings").collect();
    const byStatus: Record<string, number> = {};
    for (const l of all) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
    return { total: all.length, byStatus };
  },
});
