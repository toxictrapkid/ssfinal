import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";

/** All saved buy-boxes, for the Search Builder view. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("searches").collect();
  },
});

/** Active buy-boxes (gate check + cron dispatch input). */
export const listActive = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("searches")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
  },
});

/** Searches whose schedule says they should run now (cron dispatch). */
export const listDue = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const active = await ctx.db
      .query("searches")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return active.filter(
      (s) =>
        s.lastRunAt === undefined ||
        s.lastRunAt + s.intervalMinutes * 60_000 <= now
    );
  },
});

/** Record a run result; failures land on the search row, never on siblings. */
export const markRun = internalMutation({
  args: {
    searchId: v.id("searches"),
    error: v.optional(v.string()),
    newDeals: v.optional(v.number()),
  },
  handler: async (ctx, { searchId, error, newDeals }) => {
    await ctx.db.patch(searchId, {
      lastRunAt: Date.now(),
      lastError: error,
      newDealsLastRun: newDeals,
    });
  },
});
