import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Test/ops fixture helpers. Internal-only (never client-callable); used by
 * gate verification and the M6 failure-isolation test to put rows into
 * states that normally take wall-clock time to reach (e.g. 48h-stale).
 */
export const setListingStatus = internalMutation({
  args: { dedupeKey: v.string(), status: v.string() },
  handler: async (ctx, { dedupeKey, status }) => {
    const listing = await ctx.db
      .query("listings")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (!listing) throw new Error(`no listing for dedupeKey ${dedupeKey}`);
    await ctx.db.patch(listing._id, { status });
    return { id: listing._id, status };
  },
});

/** Create a throwaway search row (M6 failure-isolation gate uses a bad config). */
export const createTestSearch = internalMutation({
  args: { name: v.string(), sources: v.array(v.string()) },
  handler: async (ctx, { name, sources }) => {
    return await ctx.db.insert("searches", {
      name,
      active: true,
      sources,
      location: "Salt Lake City, UT",
      zip: "84104",
      radiusMiles: 150,
      priceMin: 2000,
      priceMax: 28000,
      yearMin: 2000,
      yearMax: 2027,
      mileageMin: 0,
      mileageMax: 400000,
      makes: [],
      models: [],
      maxDaysListed: 30,
      cleanTitleOnly: false,
      intervalMinutes: 15,
      createdAt: Date.now(),
    });
  },
});

/** Clear run markers on all active searches so they become due immediately. */
export const clearSearchRuns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const active = await ctx.db
      .query("searches")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    for (const search of active) {
      await ctx.db.patch(search._id, { lastRunAt: undefined, lastError: undefined });
    }
    return { cleared: active.length };
  },
});

export const removeSearch = internalMutation({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    await ctx.db.delete(searchId);
  },
});

export const setListingLastSeen = internalMutation({
  args: { dedupeKey: v.string(), lastSeenAt: v.number() },
  handler: async (ctx, { dedupeKey, lastSeenAt }) => {
    const listing = await ctx.db
      .query("listings")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (!listing) throw new Error(`no listing for dedupeKey ${dedupeKey}`);
    await ctx.db.patch(listing._id, { lastSeenAt });
    return { id: listing._id, lastSeenAt };
  },
});
