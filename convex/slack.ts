/**
 * Slack notification layer — action items only.
 *
 * One Incoming Webhook per channel (set in Convex env):
 *   SLACK_WEBHOOK_OWNER_APPROVALS  -> #carhunter-owner-approvals
 *   SLACK_WEBHOOK_AUCTIONS         -> #carhunter-auctions
 *   SLACK_WEBHOOK_DAILY_DESK       -> #carhunter-daily-desk
 *   SLACK_WEBHOOK_ALERTS           -> #carhunter-alerts   (falls back to SLACK_WEBHOOK_URL)
 *   SLACK_WEBHOOK_ERRORS           -> #carhunter-errors   (falls back to SLACK_WEBHOOK_URL)
 *
 * CarHunter originates HOT-lead alerts (#alerts), tool-issue alerts (#errors),
 * and the end-of-day summary (#daily-desk). Owner-approval and auction-buy-
 * candidate messages originate in Airtable (those records live there) and are
 * sent by Airtable-native Slack automations — see the integration doc.
 */
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

const CHANNELS: Record<string, string[]> = {
  owner_approvals: ["SLACK_WEBHOOK_OWNER_APPROVALS"],
  auctions: ["SLACK_WEBHOOK_AUCTIONS"],
  daily_desk: ["SLACK_WEBHOOK_DAILY_DESK"],
  alerts: ["SLACK_WEBHOOK_ALERTS", "SLACK_WEBHOOK_URL"],
  errors: ["SLACK_WEBHOOK_ERRORS", "SLACK_WEBHOOK_URL"],
};

function webhookFor(channel: string): string | undefined {
  for (const key of CHANNELS[channel] ?? []) {
    const u = process.env[key];
    if (u) return u;
  }
  return undefined;
}

const money = (n?: number | null) => (n != null ? "$" + Math.round(n).toLocaleString("en-US") : "n/a");

async function post(channel: string, text: string): Promise<{ sent: boolean; status?: number; reason?: string }> {
  const url = webhookFor(channel);
  if (!url) return { sent: false, reason: `no webhook configured for #${channel}` };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, unfurl_links: false }),
    });
    return { sent: r.ok, status: r.status };
  } catch (e) {
    return { sent: false, reason: String(e).slice(0, 140) };
  }
}

function airtableUrl(recordId?: string): string | null {
  const base = process.env.AIRTABLE_BASE_ID;
  const tbl = process.env.AIRTABLE_DEALS_TABLE_ID || process.env.AIRTABLE_DEALS_TABLE;
  if (!base || !tbl || !recordId) return null;
  return `https://airtable.com/${base}/${tbl}/${recordId}`;
}

function missingList(l: Doc<"listings">): string[] {
  const m: string[] = [];
  if (!l.vin) m.push("VIN");
  if (l.carblyJdCleanTrade == null && l.carblyKbbLending == null) m.push("values");
  if (l.mileage == null) m.push("mileage");
  if (!l.titleStatus || l.titleStatus === "unknown") m.push("title");
  return m;
}

/** HOT lead needs review -> #carhunter-alerts. Format matches the spec exactly. */
export const sendHotLead = internalAction({
  args: { listingId: v.id("listings") },
  handler: async (ctx, { listingId }) => {
    const l: Doc<"listings"> | null = await ctx.runQuery(internal.notifications.getListing, { listingId });
    if (!l) return { sent: false, reason: "listing gone" };
    const vehicle = [l.year, l.make, l.model, l.trim].filter(Boolean).join(" ") || l.title;
    const missing = missingList(l);
    const action = !l.vin
      ? "Employee needs to request VIN and verify values."
      : missing.includes("values")
        ? "Employee needs to pull values in Laser and verify."
        : "Employee needs to verify the car and prep the owner packet.";
    const issue = l.mechanicSpecial
      ? "Mechanic special — verify repair scope"
      : missing.length
        ? `Missing ${missing[0].toUpperCase().slice(0, 1) + missing[0].slice(1)}`
        : "Priced under both books";
    const at = airtableUrl(l.airtableRecordId);
    const lines = [
      "*HOT Lead Needs Review*",
      `Vehicle: ${vehicle}`,
      `Price: ${money(l.price)}`,
      `Score: ${l.dealScore ?? "?"}`,
      `Issue: ${issue}`,
      `Missing data: ${missing.length ? missing.join(", ") : "none"}`,
      `Action: ${action}`,
      at ? `Airtable: <${at}|open record>` : "Airtable: (record syncing)",
      `CarHunter: <${l.url}|view listing>`,
    ];
    const res = await post("alerts", lines.join("\n"));
    if (!res.sent) {
      await ctx.runMutation(internal.airtable.raiseToolIssue, {
        dedupeKey: "slack:alerts",
        tool: "slack",
        severity: "warn",
        summary: "Slack HOT-lead alert failed to send",
        detail: res.reason ?? `status ${res.status}`,
      });
    }
    return res;
  },
});

/** Unresolved tool issue -> #carhunter-errors. */
export const sendToolIssue = internalAction({
  args: { issueId: v.id("toolIssues") },
  handler: async (ctx, { issueId }) => {
    const it = await ctx.runQuery(internal.airtable.getToolIssue, { issueId });
    if (!it) return { sent: false, reason: "issue gone" };
    const since = new Date(it.firstSeenAt).toISOString().slice(0, 16).replace("T", " ");
    const lines = [
      "*Tool Issue — unresolved 15+ min*",
      `Tool: ${it.tool}`,
      `Severity: ${it.severity}`,
      `Issue: ${it.summary}`,
      it.detail ? `Detail: ${it.detail.slice(0, 280)}` : "",
      `Seen: ${it.count}x since ${since}`,
      "Action: investigate and resolve (mark resolved in Airtable Tool Issues).",
    ].filter(Boolean);
    return await post("errors", lines.join("\n"));
  },
});

/** End-of-day desk summary -> #carhunter-daily-desk. */
export const sendEndOfDay = internalAction({
  args: {},
  handler: async (ctx) => {
    const s = await ctx.runQuery(internal.airtable.dailySummary, {});
    const lines = [
      "*End-of-Day Summary*",
      `Active deals: ${s.active}`,
      `HOT (Contact Now): ${s.hot}`,
      `Missing VIN: ${s.missingVin}`,
      `Missing values: ${s.missingVals}`,
      `Open tool issues: ${s.openIssues}`,
      "Action: clear HOT + missing-data items before tomorrow.",
    ];
    return await post("daily_desk", lines.join("\n"));
  },
});
