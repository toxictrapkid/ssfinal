import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** The single settings row (created by seed; null before seeding). */
export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("settings").first();
  },
});

export const getInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("settings").first();
  },
});

export const update = mutation({
  args: {
    marginThreshold: v.optional(v.number()),
    feesFlat: v.optional(v.number()),
    alertEmail: v.optional(v.string()),
    alertPhone: v.optional(v.string()),
    fbSessionCookie: v.optional(v.string()),
    daytonaApiKey: v.optional(v.string()),
    marketcheckKey: v.optional(v.string()),
  },
  handler: async (ctx, patch) => {
    const row = await ctx.db.query("settings").first();
    if (!row) throw new Error("settings not seeded — run seed:run first");
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, val]) => val !== undefined)
    );
    await ctx.db.patch(row._id, defined);
  },
});
