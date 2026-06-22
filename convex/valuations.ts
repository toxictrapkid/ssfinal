/**
 * Valuation assembly + the hard-rule gate (Convex side).
 *
 * Assembles the four required numbers for a listing from (a) the listing's own
 * Laser-sourced JD Clean / KBB fields and (b) any `valuations` provenance rows
 * (which carry second checks, JD Full Retail, Base MMR, manual entries, proof),
 * then runs the pure status logic. The MCP tools call these — they never invent
 * values and never let a vehicle past the gate without all four VERIFIED.
 */
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  REQUIRED_KINDS,
  KIND_LABEL,
  numberStatus,
  overallStatus,
  isReviewReady,
  missingOrBad,
  type ValuationInput,
  type ValuationKind,
  type ValuationResult,
} from "./lib/valuationStatus";

/** Merge listing fields + provenance rows into one ValuationInput per kind. */
function assemble(listing: Doc<"listings">, rows: Doc<"valuations">[]): ValuationInput[] {
  const byKind = new Map<string, Doc<"valuations">>();
  for (const r of rows) byKind.set(r.kind, r);

  // Seed JD Clean + KBB from the listing's Laser fields when no provenance row
  // exists yet (single source = will fall to MANUAL REVIEW until second-checked).
  const seed: Partial<Record<ValuationKind, ValuationInput>> = {
    jd_clean_trade: {
      kind: "jd_clean_trade",
      value: listing.carblyJdCleanTrade ?? null,
      source: listing.carblyJdCleanTrade != null ? "laser" : null,
      checkedAt: listing.carblyCheckedAt ?? null,
      checkedBy: "system",
      confidence: "medium",
    },
    kbb_lending: {
      kind: "kbb_lending",
      value: listing.carblyKbbLending ?? null,
      source: listing.carblyKbbLending != null ? "laser" : null,
      checkedAt: listing.carblyCheckedAt ?? null,
      checkedBy: "system",
      confidence: "medium",
    },
    jd_full_retail: {
      kind: "jd_full_retail",
      value: listing.jdFullRetail ?? null,
      source: listing.jdFullRetail != null ? "laser" : null,
      checkedAt: listing.jdFullRetail != null ? (listing.carblyCheckedAt ?? null) : null,
      checkedBy: "system",
      confidence: "medium",
    },
    base_mmr: {
      kind: "base_mmr",
      value: listing.baseMmr ?? null,
      source: listing.baseMmr != null ? "laser" : null,
      checkedAt: listing.baseMmr != null ? (listing.carblyCheckedAt ?? null) : null,
      checkedBy: "system",
      confidence: "medium",
    },
  };

  return REQUIRED_KINDS.map((kind) => {
    const row = byKind.get(kind);
    if (row) {
      return {
        kind,
        value: row.value,
        source: row.source,
        checkedAt: row.checkedAt,
        checkedBy: row.checkedBy,
        secondValue: row.secondValue ?? null,
        secondSource: row.secondSource ?? null,
        secondCheckedAt: row.secondCheckedAt ?? null,
        confidence: (row.confidence as ValuationInput["confidence"]) ?? null,
      };
    }
    return seed[kind] ?? { kind, value: null, checkedBy: "system" };
  });
}

export interface ValuationReport {
  results: ValuationResult[];
  overall: ReturnType<typeof overallStatus>;
  reviewReady: boolean;
  missing: { label: string; status: string; warning: string | null }[];
}

export function buildReport(listing: Doc<"listings">, rows: Doc<"valuations">[]): ValuationReport {
  const inputs = assemble(listing, rows);
  const results = inputs.map((i) => numberStatus(i));
  return {
    results,
    overall: overallStatus(results),
    reviewReady: isReviewReady(results),
    missing: missingOrBad(results),
  };
}

/** Full valuation report for one listing (used by get/double_check/analyze/score). */
export const reportForListing = internalQuery({
  args: { listingId: v.id("listings") },
  handler: async (ctx, { listingId }) => {
    const listing = await ctx.db.get(listingId);
    if (!listing) return null;
    const rows = await ctx.db
      .query("valuations")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
      .collect();
    return { listing, ...buildReport(listing, rows) };
  },
});

/** Top current opportunities with their valuation gate status (ask_new_cars). */
export const reviewCandidates = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("listings")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    rows.sort((a, b) => (b.dealScore ?? -1) - (a.dealScore ?? -1));
    const top = rows.slice(0, limit ?? 15);
    const out = [];
    for (const listing of top) {
      const vrows = await ctx.db
        .query("valuations")
        .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
        .collect();
      out.push({ listing, report: buildReport(listing, vrows) });
    }
    return out;
  },
});

/** Upsert one valuation number with provenance (manual entry / sourced check). */
export const recordValuation = internalMutation({
  args: {
    listingId: v.id("listings"),
    kind: v.string(),
    value: v.union(v.number(), v.null()),
    source: v.string(),
    checkedBy: v.string(),
    confidence: v.optional(v.string()),
    proofUrl: v.optional(v.string()),
    asSecondCheck: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    if (a.value === 0) throw new Error("Refusing to store $0 as a valuation — use null (DATA MISSING).");
    const now = Date.now();
    const existing = await ctx.db
      .query("valuations")
      .withIndex("by_listing_kind", (q) => q.eq("listingId", a.listingId).eq("kind", a.kind))
      .first();
    if (existing && a.asSecondCheck) {
      await ctx.db.patch(existing._id, {
        secondValue: a.value,
        secondSource: a.source,
        secondCheckedAt: now,
        updatedAt: now,
      });
      return existing._id;
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: a.value,
        source: a.source,
        checkedAt: now,
        checkedBy: a.checkedBy,
        confidence: a.confidence ?? existing.confidence,
        proofUrl: a.proofUrl ?? existing.proofUrl,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("valuations", {
      listingId: a.listingId,
      kind: a.kind,
      value: a.value,
      source: a.source,
      checkedAt: now,
      checkedBy: a.checkedBy,
      confidence: a.confidence ?? "medium",
      proofUrl: a.proofUrl,
      updatedAt: now,
    });
  },
});

/** Create the standard "go get this number" tasks for whatever's missing. */
export const createValuationTasks = internalMutation({
  args: { listingId: v.id("listings") },
  handler: async (ctx, { listingId }) => {
    const listing = await ctx.db.get(listingId);
    if (!listing) return { created: 0 };
    const rows = await ctx.db
      .query("valuations")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
      .collect();
    const report = buildReport(listing, rows);
    const veh = [listing.year, listing.make, listing.model, listing.trim].filter(Boolean).join(" ") || listing.title;
    let created = 0;
    for (const m of report.missing) {
      const kind = "check_" + Object.keys(KIND_LABEL).find((k) => KIND_LABEL[k as ValuationKind] === m.label)!;
      const existingOpen = await ctx.db
        .query("tasks")
        .withIndex("by_listing", (q) => q.eq("listingId", listingId))
        .collect();
      if (existingOpen.some((t) => t.kind === kind && t.status === "open")) continue;
      await ctx.db.insert("tasks", {
        listingId,
        kind,
        title: `${m.label}: ${m.status}`,
        instructions:
          `Vehicle: ${veh} (VIN ${listing.vin ?? "MISSING"}). ` +
          `Pull ${m.label} from the official source, record the value + a screenshot/export as proof, ` +
          `then run a second independent check. Reason flagged: ${m.warning ?? m.status}.`,
        status: "open",
        createdAt: Date.now(),
      });
      created++;
    }
    return { created };
  },
});

export const createTask = internalMutation({
  args: {
    listingId: v.optional(v.id("listings")),
    kind: v.string(),
    title: v.string(),
    instructions: v.string(),
    assignedTo: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    return await ctx.db.insert("tasks", { ...a, status: "open", createdAt: Date.now() });
  },
});

/** Resolve a listing by VIN or id (MCP tools accept either). */
export const findListing = internalQuery({
  args: { vin: v.optional(v.string()), listingId: v.optional(v.id("listings")) },
  handler: async (ctx, { vin, listingId }) => {
    if (listingId) return ctx.db.get(listingId);
    if (vin) {
      const all = await ctx.db.query("listings").withIndex("by_status").collect();
      return all.find((l) => (l.vin ?? "").toUpperCase() === vin.toUpperCase()) ?? null;
    }
    return null;
  },
});

/** Cheapest engine + cheapest transmission from the seeded Car-Part data (ZIP 84101).
 *  Returned SEPARATELY — never combined into one repair scenario. */
export const repairParts = internalQuery({
  args: { year: v.optional(v.number()), make: v.optional(v.string()), model: v.optional(v.string()) },
  handler: async (ctx, { year, make, model }) => {
    if (year == null || !make || !model) return { engine: null, transmission: null };
    const look = async (part: string) => {
      const key = `${year}|${make}|${model}|${part}`;
      const row = await ctx.db.query("partsCosts").withIndex("by_key", (q) => q.eq("key", key)).first();
      return row ? { price: row.medianPrice, sampleSize: row.sampleSize, source: "car-part.com (ZIP 84101)" } : null;
    };
    return { engine: await look("Engine"), transmission: await look("Transmission") };
  },
});

export const openTasks = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("tasks").withIndex("by_status", (q) => q.eq("status", "open")).collect();
    return rows.slice(0, limit ?? 50);
  },
});

export const audit = internalMutation({
  args: { role: v.string(), tool: v.string(), ok: v.boolean(), detail: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await ctx.db.insert("mcpAuditLog", { at: Date.now(), ...a });
  },
});
