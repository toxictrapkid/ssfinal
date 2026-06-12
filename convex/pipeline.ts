import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const STAGES = [
  "lead",
  "contacted",
  "negotiating",
  "bought",
  "flipped",
  "dead",
] as const;

/** Kanban board: every pipeline row joined with its listing, grouped by stage. */
export const board = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("pipeline").collect();
    const out: Record<string, unknown[]> = {};
    for (const stage of STAGES) out[stage] = [];
    for (const row of rows) {
      const listing = await ctx.db.get(row.listingId);
      if (!listing) continue;
      const stage = STAGES.includes(row.stage as never) ? row.stage : "lead";
      out[stage].push({ ...row, listing });
    }
    // newest activity first within each column
    for (const stage of STAGES) {
      (out[stage] as { updatedAt: number }[]).sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return out;
  },
});

export const moveStage = mutation({
  args: { pipelineId: v.id("pipeline"), stage: v.string() },
  handler: async (ctx, { pipelineId, stage }) => {
    if (!STAGES.includes(stage as never)) {
      throw new Error(`invalid stage: ${stage}`);
    }
    await ctx.db.patch(pipelineId, { stage, updatedAt: Date.now() });
  },
});

export const setNumbers = mutation({
  args: {
    pipelineId: v.id("pipeline"),
    targetBuy: v.optional(v.number()),
    walkAway: v.optional(v.number()),
  },
  handler: async (ctx, { pipelineId, targetBuy, walkAway }) => {
    await ctx.db.patch(pipelineId, {
      ...(targetBuy !== undefined ? { targetBuy } : {}),
      ...(walkAway !== undefined ? { walkAway } : {}),
      updatedAt: Date.now(),
    });
  },
});

export const setNotes = mutation({
  args: { pipelineId: v.id("pipeline"), notes: v.string() },
  handler: async (ctx, { pipelineId, notes }) => {
    await ctx.db.patch(pipelineId, { notes, updatedAt: Date.now() });
  },
});
