/**
 * Public, secret-gated read API for the CarHunter MCP app (Manufact Cloud).
 *
 * The remote MCP server calls these over HTTPS (ConvexHttpClient) to get live
 * deal data WITH the four-number valuation gate already applied, so every tool
 * response can show JD Clean Trade / JD Full Retail / KBB Lending / Base MMR and
 * their VERIFIED / DATA MISSING / ... status. Convex stays the source of truth.
 *
 * Gated by INGEST_SECRET (the MCP app passes it); read-only except createTask.
 */
import { query, mutation, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { buildReport } from "./valuations";

function authed(secret: string | undefined): boolean {
  return !!secret && secret === process.env.INGEST_SECRET;
}
const veh = (l: Doc<"listings">) =>
  [l.year, l.make, l.model, l.trim].filter(Boolean).join(" ") || l.title || "Unknown vehicle";

/** Shape one listing with its four-number gate report for the MCP layer. */
async function withReport(ctx: QueryCtx, l: Doc<"listings">) {
  const rows = await ctx.db
    .query("valuations")
    .withIndex("by_listing", (q) => q.eq("listingId", l._id))
    .collect();
  const rep = buildReport(l, rows);
  const n = (k: string) => {
    const r = rep.results.find((x) => x.kind === k)!;
    return { value: r.value, status: r.status, second: r.secondValue ?? null };
  };
  return {
    listingId: l._id,
    vehicle: veh(l),
    vin: l.vin ?? null,
    mileage: l.mileage ?? null,
    price: l.price,
    location: l.location ?? null,
    titleStatus: l.titleStatus ?? null,
    dealScore: l.dealScore ?? null,
    estProfit: l.estProfit ?? null,
    estValue: l.estValue ?? null,
    hot: !!l.hot,
    mechanicSpecial: !!l.mechanicSpecial,
    url: l.url,
    values: {
      jdCleanTrade: n("jd_clean_trade"),
      jdFullRetail: n("jd_full_retail"),
      kbbLending: n("kbb_lending"),
      baseMmr: n("base_mmr"),
    },
    valuationStatus: rep.overall,
    reviewReady: rep.reviewReady,
    missing: rep.missing,
  };
}

async function activeByScore(ctx: QueryCtx): Promise<Doc<"listings">[]> {
  const rows = await ctx.db.query("listings").withIndex("by_score").order("desc").take(600);
  return rows.filter((l) => l.status === "active" || l.status === "price_drop");
}

export const dealFeed = query({
  args: { secret: v.string(), limit: v.optional(v.number()), sort: v.optional(v.string()) },
  handler: async (ctx, { secret, limit, sort }) => {
    if (!authed(secret)) return { error: "unauthorized" };
    let rows = await activeByScore(ctx);
    if (sort === "profit") rows.sort((a, b) => (b.estProfit ?? -Infinity) - (a.estProfit ?? -Infinity));
    else if (sort === "newest") rows.sort((a, b) => b.firstSeenAt - a.firstSeenAt);
    const top = rows.slice(0, Math.min(limit ?? 15, 50));
    return { deals: await Promise.all(top.map((l) => withReport(ctx, l))) };
  },
});

export const hotDeals = query({
  args: { secret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { secret, limit }) => {
    if (!authed(secret)) return { error: "unauthorized" };
    const rows = (await activeByScore(ctx)).filter((l) => l.hot);
    rows.sort((a, b) => (b.estProfit ?? -Infinity) - (a.estProfit ?? -Infinity));
    return { deals: await Promise.all(rows.slice(0, Math.min(limit ?? 15, 50)).map((l) => withReport(ctx, l))) };
  },
});

export const mechanicSpecials = query({
  args: { secret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { secret, limit }) => {
    if (!authed(secret)) return { error: "unauthorized" };
    const rows = (await activeByScore(ctx)).filter((l) => l.mechanicSpecial);
    return { deals: await Promise.all(rows.slice(0, Math.min(limit ?? 15, 50)).map((l) => withReport(ctx, l))) };
  },
});

export const missingData = query({
  args: { secret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { secret, limit }) => {
    if (!authed(secret)) return { error: "unauthorized" };
    const shaped = await Promise.all((await activeByScore(ctx)).map((l) => withReport(ctx, l)));
    const out = shaped.filter((d) => !d.reviewReady);
    return { deals: out.slice(0, Math.min(limit ?? 25, 60)) };
  },
});

export const searchListings = query({
  args: { secret: v.string(), q: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { secret, q, limit }) => {
    if (!authed(secret)) return { error: "unauthorized" };
    const needle = q.toLowerCase();
    const rows = (await activeByScore(ctx)).filter((l) =>
      [l.make, l.model, l.trim, l.vin, l.title].some((s) => (s ?? "").toLowerCase().includes(needle))
    );
    return { deals: await Promise.all(rows.slice(0, Math.min(limit ?? 15, 40)).map((l) => withReport(ctx, l))) };
  },
});

async function resolve(ctx: QueryCtx, vin?: string, listingId?: string) {
  if (listingId) return ctx.db.get(listingId as any);
  if (vin) {
    const all = await ctx.db.query("listings").withIndex("by_status").collect();
    return all.find((l) => (l.vin ?? "").toUpperCase() === vin.toUpperCase()) ?? null;
  }
  return null;
}

export const explainDeal = query({
  args: { secret: v.string(), vin: v.optional(v.string()), listingId: v.optional(v.string()) },
  handler: async (ctx, { secret, vin, listingId }) => {
    if (!authed(secret)) return { error: "unauthorized" };
    const l = await resolve(ctx, vin, listingId);
    if (!l) return { error: "not_found" };
    const shaped = await withReport(ctx, l);
    return {
      ...shaped,
      description: l.description ?? null,
      reconBreakdown: l.reconBreakdown ?? null,
      scoreBreakdown: l.scoreBreakdown ?? null,
      daysListed: l.daysListed ?? null,
    };
  },
});

export const feedHealth = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    if (!authed(secret)) return { error: "unauthorized" };
    const active = await activeByScore(ctx);
    let newestAt = 0;
    for (const l of active) if (l.firstSeenAt > newestAt) newestAt = l.firstSeenAt;
    const searches = await ctx.db.query("searches").withIndex("by_active", (q) => q.eq("active", true)).collect();
    const openIssues = (await ctx.db.query("toolIssues").withIndex("by_status", (q) => q.eq("status", "open")).collect()).length;
    const ageHours = newestAt ? Math.round(((Date.now() - newestAt) / 3.6e6) * 10) / 10 : null;
    return {
      activeListings: active.length,
      hot: active.filter((l) => l.hot).length,
      missingVin: active.filter((l) => !l.vin).length,
      missingValues: active.filter((l) => l.carblyJdCleanTrade == null && l.carblyKbbLending == null).length,
      activeSearches: searches.length,
      openToolIssues: openIssues,
      newestListingAgeHours: ageHours,
      feedStale: ageHours == null || ageHours > 3,
    };
  },
});

export const pipelineStatus = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    if (!authed(secret)) return { error: "unauthorized" };
    const tasks = await ctx.db.query("tasks").collect();
    const open = tasks.filter((t) => t.status === "open");
    return {
      openTasks: open.length,
      doneTasks: tasks.length - open.length,
      tasks: open.slice(0, 25).map((t) => ({ kind: t.kind, title: t.title, instructions: t.instructions })),
    };
  },
});

export const createTask = mutation({
  args: {
    secret: v.string(),
    vin: v.optional(v.string()),
    listingId: v.optional(v.string()),
    kind: v.string(),
    title: v.string(),
    instructions: v.string(),
  },
  handler: async (ctx, { secret, vin, listingId, kind, title, instructions }) => {
    if (!authed(secret)) return { error: "unauthorized" };
    let lid: any = listingId ?? undefined;
    if (!lid && vin) {
      const l = await resolve(ctx, vin, undefined);
      lid = l?._id;
    }
    const id = await ctx.db.insert("tasks", {
      listingId: lid,
      kind,
      title,
      instructions,
      status: "open",
      createdAt: Date.now(),
    });
    return { taskId: id };
  },
});

/** Cheapest engine + transmission from Car-Part data (ZIP 84101) — separate scenarios. */
export const repairParts = query({
  args: { secret: v.string(), vin: v.optional(v.string()), listingId: v.optional(v.string()) },
  handler: async (ctx, { secret, vin, listingId }) => {
    if (!authed(secret)) return { error: "unauthorized" };
    const l = await resolve(ctx, vin, listingId);
    if (!l || l.year == null || !l.make || !l.model) return { engine: null, transmission: null };
    const look = async (part: string) => {
      const row = await ctx.db
        .query("partsCosts")
        .withIndex("by_key", (q) => q.eq("key", `${l.year}|${l.make}|${l.model}|${part}`))
        .first();
      return row ? { price: row.medianPrice, sampleSize: row.sampleSize, source: "car-part.com (ZIP 84101)" } : null;
    };
    return { engine: await look("Engine"), transmission: await look("Transmission") };
  },
});

/** Push every active deal to Airtable (upsert by Lead ID). No-op if Airtable env unset. */
export const syncAirtable = action({
  args: { secret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { secret, limit }): Promise<{ error?: string; scheduled?: number }> => {
    if (secret !== process.env.INGEST_SECRET) return { error: "unauthorized" };
    return await ctx.runAction(internal.airtable.backfillAll, { limit });
  },
});

/** Send a HOT/OWNER-REVIEW Slack alert — REFUSED unless all four numbers are verified. */
export const sendSlackAlert = action({
  args: { secret: v.string(), vin: v.optional(v.string()), listingId: v.optional(v.string()) },
  handler: async (ctx, { secret, vin, listingId }): Promise<{ error?: string; sent?: boolean; refused?: string }> => {
    if (secret !== process.env.INGEST_SECRET) return { error: "unauthorized" };
    const l: any = await ctx.runQuery(internal.valuations.findListing, { vin, listingId: listingId as any });
    if (!l) return { error: "not_found" };
    const rep: any = await ctx.runQuery(internal.valuations.reportForListing, { listingId: l._id });
    if (!rep.reviewReady) {
      return { sent: false, refused: `valuation not verified (missing: ${rep.missing.map((x: any) => x.label).join(", ")})` };
    }
    await ctx.scheduler.runAfter(0, internal.slack.sendHotLead, { listingId: l._id });
    return { sent: true };
  },
});
