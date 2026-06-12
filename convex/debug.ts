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
