import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";

const searchFields = {
  name: v.string(),
  sources: v.array(v.string()),
  location: v.string(),
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
  intervalMinutes: v.number(),
};

/** Search Builder: create a buy-box/scan. */
export const create = mutation({
  args: searchFields,
  handler: async (ctx, args) => {
    return await ctx.db.insert("searches", {
      ...args,
      active: true,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: { searchId: v.id("searches"), ...searchFields },
  handler: async (ctx, { searchId, ...fields }) => {
    await ctx.db.patch(searchId, fields);
  },
});

export const toggleActive = mutation({
  args: { searchId: v.id("searches"), active: v.boolean() },
  handler: async (ctx, { searchId, active }) => {
    await ctx.db.patch(searchId, { active });
  },
});

export const remove = mutation({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    await ctx.db.delete(searchId);
  },
});

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

// a dispatch claim older than this is considered dead (2.5× the 120s sandbox
// timeout) and the search becomes due again
const CLAIM_TTL_MS = 5 * 60_000;

/** Searches whose schedule says they should run now (cron dispatch).
 * A search with an in-flight dispatch claim is NOT due — prevents the next
 * cron tick double-running a slow sandbox (M6 reviewer advisory A1). */
export const listDue = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const active = await ctx.db
      .query("searches")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return active.filter((s) => {
      const scheduleDue =
        s.lastRunAt === undefined ||
        s.lastRunAt + s.intervalMinutes * 60_000 <= now;
      if (!scheduleDue) return false;
      const claim = s.lastDispatchedAt;
      const claimInFlight =
        claim !== undefined &&
        claim + CLAIM_TTL_MS > now &&
        (s.lastRunAt ?? 0) < claim; // run hasn't completed since the claim
      return !claimInFlight;
    });
  },
});

/** Stamp a dispatch claim (called by the dispatcher before spawning). */
export const claimDispatch = internalMutation({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    await ctx.db.patch(searchId, { lastDispatchedAt: Date.now() });
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
