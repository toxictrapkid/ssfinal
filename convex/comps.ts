import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { fetchComps } from "./lib/marketcheck";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // spec §3: comps cached 7 days

/** Fresh cache row for ymm+bucket, or null. */
export const getCached = internalQuery({
  args: { ymm: v.string(), mileageBucket: v.string() },
  handler: async (ctx, { ymm, mileageBucket }) => {
    const row = await ctx.db
      .query("comps")
      .withIndex("by_ymm_bucket", (q) =>
        q.eq("ymm", ymm).eq("mileageBucket", mileageBucket)
      )
      .first();
    if (!row) return null;
    if (Date.now() - row.refreshedAt > SEVEN_DAYS_MS) return null; // stale
    return row;
  },
});

/**
 * Upsert a comp set. Called by getOrFetchComp (REST driver) and by the
 * operator/MCP seeding path (`npx convex run comps:upsertComp '…'`) — same
 * table, same TTL, either way (ARCHITECTURE §6).
 */
export const upsertComp = internalMutation({
  args: {
    ymm: v.string(),
    mileageBucket: v.string(),
    sampleSize: v.number(),
    medianRetail: v.number(),
    p25Retail: v.number(),
    p75Retail: v.number(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("comps")
      .withIndex("by_ymm_bucket", (q) =>
        q.eq("ymm", args.ymm).eq("mileageBucket", args.mileageBucket)
      )
      .first();
    const row = { ...args, refreshedAt: Date.now() };
    if (existing) {
      await ctx.db.replace(existing._id, row);
      return { id: existing._id, updated: true };
    }
    return { id: await ctx.db.insert("comps", row), updated: false };
  },
});

/**
 * The §4 comp chain: fresh cache → MarketCheck REST (iff a key is configured)
 * → null (caller falls back to the flagged depreciation curve).
 */
export const getOrFetchComp = internalAction({
  args: {
    ymm: v.string(),
    mileageBucket: v.string(),
    mileageLo: v.number(),
    mileageHi: v.number(),
    zip: v.string(),
    radiusMiles: v.number(),
  },
  handler: async (ctx, args) => {
    const cached = await ctx.runQuery(internal.comps.getCached, {
      ymm: args.ymm,
      mileageBucket: args.mileageBucket,
    });
    if (cached) return cached;

    const settings = await ctx.runQuery(internal.settings.getInternal, {});
    const apiKey = process.env.MARKETCHECK_KEY ?? settings?.marketcheckKey;
    if (!apiKey) {
      console.log(
        JSON.stringify({
          event: "comps.no_marketcheck_key",
          note: "operator/MCP cache seeding is the comp path on this deployment",
          ymm: args.ymm,
        })
      );
      return null;
    }

    const [year, make, model] = args.ymm.split("|");
    const compSet = await fetchComps({
      apiKey,
      year: Number(year),
      make,
      model,
      mileageLo: args.mileageLo,
      mileageHi: args.mileageHi,
      zip: args.zip,
      radiusMiles: args.radiusMiles,
    });
    if (!compSet) return null;

    await ctx.runMutation(internal.comps.upsertComp, {
      ymm: args.ymm,
      mileageBucket: args.mileageBucket,
      sampleSize: compSet.sampleSize,
      medianRetail: compSet.medianRetail,
      p25Retail: compSet.p25Retail,
      p75Retail: compSet.p75Retail,
      source: compSet.source,
    });
    return await ctx.runQuery(internal.comps.getCached, {
      ymm: args.ymm,
      mileageBucket: args.mileageBucket,
    });
  },
});
