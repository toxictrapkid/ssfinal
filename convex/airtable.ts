/**
 * CarHunter -> Airtable one-way sync (CRM integration).
 *
 * Design (per integration + source-of-truth rules):
 *  - Upsert by "CarHunter Lead ID" (the listing _id). Never creates duplicates.
 *  - Pushes ONLY CarHunter-owned fields (imported data, values, score, flags).
 *    Airtable-owned workflow fields (Status, Assigned employee, Seller, Next
 *    action, Owner approval/decision, Final outcome, Notes) are NEVER written on
 *    update, so employee/owner edits in Airtable are never clobbered. On create
 *    we seed Status="New" and "Owner approval needed"=false as starting defaults.
 *  - Debounced by a content hash of the owned fields: a re-score that changes
 *    nothing does not re-push (and does not re-alert).
 *  - Every attempt is logged (syncLog); every failure is raised as a Tool Issue
 *    and (after a grace window) surfaced to Slack #carhunter-errors. No silent
 *    failures.
 *
 * Env (set in Convex):
 *   AIRTABLE_PAT             personal access token (data.records:read/write)
 *   AIRTABLE_BASE_ID         appXXXXXXXXXXXXXX
 *   AIRTABLE_DEALS_TABLE_ID  tblXXXXXXXXXXXXXX  (or the table name "Deals")
 * When unset, the sync is a no-op (HOT Slack alerts still fire).
 */
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

const API = "https://api.airtable.com/v0";

function cfg() {
  const pat = process.env.AIRTABLE_PAT;
  const base = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_DEALS_TABLE_ID || process.env.AIRTABLE_DEALS_TABLE || "Deals";
  if (!pat || !base) return null;
  return { pat, base, table };
}

// ---- field mapping helpers -------------------------------------------------

function riskFlags(l: Doc<"listings">): string[] {
  const f: string[] = [];
  const t = (l.titleStatus || "").toLowerCase();
  if (t.includes("salvage")) f.push("Salvage");
  if (t.includes("rebuilt")) f.push("Rebuilt");
  if (t && t !== "clean" && t !== "salvage" && t !== "rebuilt" && t !== "unknown") f.push("Branded title");
  if (l.mechanicSpecial) f.push("Mechanic special");
  if (!l.vin) f.push("No VIN");
  if (l.mileage != null && l.mileage > 150000) f.push("High miles");
  // a price far under both books is usually damage/scam, not free money
  const book = Math.max(l.carblyJdCleanTrade ?? 0, l.carblyKbbLending ?? 0);
  if (book > 0 && l.price < book * 0.35) f.push("Very low price");
  return f;
}

function missingData(l: Doc<"listings">): string[] {
  const m: string[] = [];
  if (!l.vin) m.push("VIN");
  if (l.carblyJdCleanTrade == null && l.carblyKbbLending == null) m.push("Values");
  if (l.mileage == null) m.push("Mileage");
  if (!l.titleStatus || l.titleStatus === "unknown") m.push("Title");
  if (!l.photos?.length && !l.photoUrl) m.push("Photos");
  return m;
}

/**
 * Only CarHunter-owned fields. Workflow fields are intentionally absent.
 * NOTE: carblyJdCleanTrade / carblyKbbLending are LEGACY column names — the
 * values come from the Laser Appraiser bridge (valuationSource = "laser"),
 * not Carbly (which is no longer used). The columns were never renamed.
 */
function ownedFields(l: Doc<"listings">): Record<string, unknown> {
  const num = (n: number | undefined | null) => (n == null ? null : n);
  return {
    Vehicle: [l.year, l.make, l.model, l.trim].filter(Boolean).join(" ") || l.title,
    "CarHunter Lead ID": l._id,
    Source: l.source ?? null,
    "Source link": l.url ?? null,
    Year: num(l.year),
    Make: l.make ?? null,
    Model: l.model ?? null,
    Trim: l.trim ?? null,
    VIN: l.vin ?? null,
    Mileage: num(l.mileage),
    Price: num(l.price),
    Location: l.location ?? null,
    HOT: !!l.hot,
    "Mechanic special": !!l.mechanicSpecial,
    "Deal score": num(l.dealScore),
    "JD Clean Trade": num(l.carblyJdCleanTrade),
    "JD Full Retail": num(l.jdFullRetail),
    "KBB Lending": num(l.carblyKbbLending),
    "Base MMR": num(l.baseMmr),
    "Title status": l.titleStatus ?? null,
    "Risk flags": riskFlags(l),
    "Missing data": missingData(l),
    "Est profit": num(l.estProfit),
    "Est value": num(l.estValue),
    "CarHunter link": l.url ?? null,
  };
}

function hashFields(f: Record<string, unknown>): string {
  // small stable FNV-1a over the JSON of owned fields
  const s = JSON.stringify(f);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// ---- DB helpers ------------------------------------------------------------

export const getToolIssue = internalQuery({
  args: { issueId: v.id("toolIssues") },
  handler: async (ctx, { issueId }) => ctx.db.get(issueId),
});

export const recordAirtableMeta = internalMutation({
  args: { listingId: v.id("listings"), recordId: v.string(), hash: v.string() },
  handler: async (ctx, { listingId, recordId, hash }) => {
    const l = await ctx.db.get(listingId);
    if (!l) return;
    await ctx.db.patch(listingId, {
      airtableRecordId: recordId,
      airtableSyncHash: hash,
      airtableSyncedAt: Date.now(),
    });
  },
});

export const logSync = internalMutation({
  args: {
    listingId: v.optional(v.id("listings")),
    action: v.string(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { listingId, action, detail }) => {
    await ctx.db.insert("syncLog", { entity: "deal", listingId, action, detail, at: Date.now() });
    // self-prune: keep only the most recent ~500 rows
    const old = await ctx.db.query("syncLog").withIndex("by_at").order("asc").take(50);
    if (old.length === 50) {
      const total = (await ctx.db.query("syncLog").collect()).length;
      if (total > 500) {
        const excess = await ctx.db.query("syncLog").withIndex("by_at").order("asc").take(total - 500);
        for (const r of excess) await ctx.db.delete(r._id);
      }
    }
  },
});

export const raiseToolIssue = internalMutation({
  args: {
    dedupeKey: v.string(),
    tool: v.string(),
    severity: v.string(),
    summary: v.string(),
    detail: v.optional(v.string()),
    listingId: v.optional(v.id("listings")),
  },
  handler: async (ctx, a) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("toolIssues")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", a.dedupeKey))
      .first();
    if (existing && existing.status === "open") {
      await ctx.db.patch(existing._id, { lastSeenAt: now, count: existing.count + 1, detail: a.detail ?? existing.detail });
      return existing._id;
    }
    return await ctx.db.insert("toolIssues", {
      dedupeKey: a.dedupeKey,
      tool: a.tool,
      severity: a.severity,
      summary: a.summary,
      detail: a.detail,
      listingId: a.listingId,
      status: "open",
      firstSeenAt: now,
      lastSeenAt: now,
      count: 1,
    });
  },
});

export const resolveToolIssue = internalMutation({
  args: { dedupeKey: v.string() },
  handler: async (ctx, { dedupeKey }) => {
    const it = await ctx.db
      .query("toolIssues")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (it && it.status === "open") await ctx.db.patch(it._id, { status: "resolved", resolvedAt: Date.now() });
  },
});

export const openIssuesPastGrace = internalQuery({
  args: { graceMs: v.number() },
  handler: async (ctx, { graceMs }) => {
    const cutoff = Date.now() - graceMs;
    const open = await ctx.db.query("toolIssues").withIndex("by_status", (q) => q.eq("status", "open")).collect();
    return open.filter((i) => i.notifiedAt === undefined && i.severity !== "info" && i.firstSeenAt <= cutoff);
  },
});

export const markIssueNotified = internalMutation({
  args: { issueId: v.id("toolIssues") },
  handler: async (ctx, { issueId }) => {
    await ctx.db.patch(issueId, { notifiedAt: Date.now() });
  },
});

export const dailySummary = internalQuery({
  args: {},
  handler: async (ctx) => {
    const active = await ctx.db
      .query("listings")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const hot = active.filter((l) => l.hot).length;
    const missingVin = active.filter((l) => !l.vin).length;
    const missingVals = active.filter((l) => l.carblyJdCleanTrade == null && l.carblyKbbLending == null).length;
    const openIssues = (await ctx.db.query("toolIssues").withIndex("by_status", (q) => q.eq("status", "open")).collect()).length;
    return { active: active.length, hot, missingVin, missingVals, openIssues };
  },
});

// ---- the sync action -------------------------------------------------------

export const syncDeal = internalAction({
  args: { listingId: v.id("listings"), notifyHot: v.optional(v.boolean()) },
  handler: async (ctx, { listingId, notifyHot }) => {
    const l: Doc<"listings"> | null = await ctx.runQuery(internal.notifications.getListing, { listingId });
    if (!l) return { synced: false, reason: "listing gone" };

    const c = cfg();
    if (c) {
      const fields = ownedFields(l);
      const hash = hashFields(fields);
      if (l.airtableRecordId && l.airtableSyncHash === hash) {
        await ctx.runMutation(internal.airtable.logSync, { listingId, action: "skip", detail: "unchanged" });
      } else {
        try {
          let recordId = l.airtableRecordId ?? null;
          // resolve an existing record by Lead ID if we don't have one cached
          if (!recordId) {
            const formula = encodeURIComponent(`{CarHunter Lead ID}='${l._id}'`);
            const findRes = await fetch(
              `${API}/${c.base}/${encodeURIComponent(c.table)}?maxRecords=1&filterByFormula=${formula}`,
              { headers: { Authorization: `Bearer ${c.pat}` } }
            );
            if (findRes.ok) {
              const j = await findRes.json();
              recordId = j.records?.[0]?.id ?? null;
            }
          }
          let res: Response;
          if (recordId) {
            res = await fetch(`${API}/${c.base}/${encodeURIComponent(c.table)}/${recordId}`, {
              method: "PATCH",
              headers: { Authorization: `Bearer ${c.pat}`, "Content-Type": "application/json" },
              body: JSON.stringify({ fields, typecast: true }),
            });
          } else {
            res = await fetch(`${API}/${c.base}/${encodeURIComponent(c.table)}`, {
              method: "POST",
              headers: { Authorization: `Bearer ${c.pat}`, "Content-Type": "application/json" },
              body: JSON.stringify({ fields: { ...fields, Status: "New", "Owner approval needed": false }, typecast: true }),
            });
          }
          if (!res.ok) {
            const body = (await res.text()).slice(0, 300);
            throw new Error(`Airtable ${res.status}: ${body}`);
          }
          const out = await res.json();
          const newId = out.id ?? recordId;
          if (newId) await ctx.runMutation(internal.airtable.recordAirtableMeta, { listingId, recordId: newId, hash });
          await ctx.runMutation(internal.airtable.logSync, { listingId, action: recordId ? "update" : "create" });
          await ctx.runMutation(internal.airtable.resolveToolIssue, { dedupeKey: `airtable:sync:${listingId}` });
        } catch (e) {
          const detail = String(e).slice(0, 280);
          await ctx.runMutation(internal.airtable.logSync, { listingId, action: "error", detail });
          await ctx.runMutation(internal.airtable.raiseToolIssue, {
            dedupeKey: `airtable:sync:${listingId}`,
            tool: "airtable",
            severity: "error",
            summary: "Airtable sync failed for a deal",
            detail,
            listingId,
          });
        }
      }
    }

    // HOT Slack fires regardless of Airtable config (action item for the desk).
    if (notifyHot) await ctx.scheduler.runAfter(0, internal.slack.sendHotLead, { listingId });
    return { synced: !!c };
  },
});

/** Backfill: push every active listing to Airtable (throttled). Run once after provisioning. */
export const backfillAll = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<{ scheduled: number }> => {
    const ids: Array<{ _id: string }> = await ctx.runQuery(internal.airtable.activeListingIds, {});
    const slice = limit ? ids.slice(0, limit) : ids;
    let i = 0;
    for (const { _id } of slice) {
      // stagger ~5/sec to stay well under Airtable's 5 req/sec/base limit
      await ctx.scheduler.runAfter(i * 220, internal.airtable.syncDeal, { listingId: _id as any, notifyHot: false });
      i++;
    }
    return { scheduled: slice.length };
  },
});

export const activeListingIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("listings")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    return rows.map((r) => ({ _id: r._id }));
  },
});

/** Cron: surface tool issues unresolved past the 15-minute grace window to Slack. */
export const toolIssueWatch = internalAction({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.runQuery(internal.airtable.openIssuesPastGrace, { graceMs: 15 * 60 * 1000 });
    for (const it of due) {
      await ctx.scheduler.runAfter(0, internal.slack.sendToolIssue, { issueId: it._id });
      await ctx.runMutation(internal.airtable.markIssueNotified, { issueId: it._id });
    }
    return { notified: due.length };
  },
});

/** Cron: end-of-day desk summary to Slack #carhunter-daily-desk. */
export const endOfDay = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.slack.sendEndOfDay, {});
    return { ok: true };
  },
});

/** Newest ingested listing + whether any search is active (feed-freshness input). */
export const feedFreshness = internalQuery({
  args: {},
  handler: async (ctx) => {
    const activeSearches = await ctx.db
      .query("searches")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    const rows = await ctx.db
      .query("listings")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    let newestAt = 0;
    for (const l of rows) if (l.firstSeenAt > newestAt) newestAt = l.firstSeenAt;
    return { activeSearches: activeSearches.length, newestAt, count: rows.length };
  },
});

/**
 * Cron: feed-freshness watchdog. If searches are active but no new listing has
 * been ingested in FEED_STALE_HOURS (default 3), the scrape has silently
 * stopped — this is exactly the failure a wrong page index + stop-on-duplicate
 * would cause. Raise a Tool Issue (escalated to Slack #errors by toolIssueWatch)
 * and auto-resolve it once new listings flow again. No silent failures.
 */
export const feedFreshnessWatch = internalAction({
  args: {},
  handler: async (ctx) => {
    const staleHours = Number(process.env.FEED_STALE_HOURS ?? "3");
    const f = await ctx.runQuery(internal.airtable.feedFreshness, {});
    if (f.activeSearches === 0) return { ok: true, reason: "no active searches" };
    const ageHours = f.newestAt ? (Date.now() - f.newestAt) / 3.6e6 : Infinity;
    if (ageHours > staleHours) {
      await ctx.runMutation(internal.airtable.raiseToolIssue, {
        dedupeKey: "feed:stale",
        tool: "carhunter",
        severity: "error",
        summary: `No new listings ingested in ${ageHours === Infinity ? "a long time" : ageHours.toFixed(1) + "h"} — scrape may be down`,
        detail: `Active searches: ${f.activeSearches}; active listings: ${f.count}; threshold ${staleHours}h. Check the KSL scraper / Bright Data token / pagination (a page-index bug can silently collapse the feed to one page).`,
      });
      return { stale: true, ageHours };
    }
    await ctx.runMutation(internal.airtable.resolveToolIssue, { dedupeKey: "feed:stale" });
    return { stale: false, ageHours };
  },
});
