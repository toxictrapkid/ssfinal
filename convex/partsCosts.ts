import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

const partsCostRow = v.object({
  key: v.string(),
  year: v.number(),
  make: v.string(),
  model: v.string(),
  part: v.string(),
  medianPrice: v.number(),
  sampleSize: v.number(),
  variants: v.array(
    v.object({
      variant: v.string(),
      medianPrice: v.number(),
      numListings: v.number(),
    })
  ),
  refreshedAt: v.number(),
});

/**
 * Median used-part price for a year|make|model|part.
 *
 * Returns the exact-year row when it exists. When the exact year has no data
 * but a nearby model-year does (used drivetrain prices move slowly within a
 * generation), falls back to the nearest year within ±2 and says so in
 * `matchedYear`. Returns null when the YMM has no data at all — recon then
 * uses the §4 keyword bumps flagged reconSource:"keyword" (LOOP_PROMPT recon rule 4).
 */
export const lookup = query({
  args: {
    year: v.number(),
    make: v.string(),
    model: v.string(),
    part: v.string(),
  },
  handler: async (ctx, { year, make, model, part }) => {
    const exact = await ctx.db
      .query("partsCosts")
      .withIndex("by_key", (q) =>
        q.eq("key", `${year}|${make}|${model}|${part}`)
      )
      .unique();
    if (exact) return { ...exact, matchedYear: year };

    for (const delta of [1, -1, 2, -2]) {
      const near = await ctx.db
        .query("partsCosts")
        .withIndex("by_key", (q) =>
          q.eq("key", `${year + delta}|${make}|${model}|${part}`)
        )
        .unique();
      if (near) return { ...near, matchedYear: year + delta };
    }
    return null;
  },
});

/** Seed/refresh a batch of aggregated CSV rows. Idempotent: upserts by key. */
export const seedBatch = internalMutation({
  args: { rows: v.array(partsCostRow) },
  handler: async (ctx, { rows }) => {
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const existing = await ctx.db
        .query("partsCosts")
        .withIndex("by_key", (q) => q.eq("key", row.key))
        .unique();
      if (existing) {
        await ctx.db.replace(existing._id, row);
        updated++;
      } else {
        await ctx.db.insert("partsCosts", row);
        inserted++;
      }
    }
    return { inserted, updated };
  },
});

/** Dataset coverage stats (Settings/diagnostics). */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("partsCosts").collect();
    return {
      keys: rows.length,
      engines: rows.filter((r) => r.part === "Engine").length,
      transmissions: rows.filter((r) => r.part === "Transmission").length,
    };
  },
});
