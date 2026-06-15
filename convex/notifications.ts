/**
 * SMS alerts via Mobile Text Alerts (api.mobile-text-alerts.com/v3/send).
 * Fires a text for each NEW Contact-Now deal (scheduled from listings.dealUpsert
 * with notify=true, i.e. the live cron — not the one-time backfill).
 *
 * Env vars (Convex): MTA_API_KEY (Bearer), MTA_NUMBERS (comma-separated phone numbers)
 */
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

const MTA_SEND = "https://api.mobile-text-alerts.com/v3/send";

export const getListing = internalQuery({
  args: { listingId: v.id("listings") },
  handler: async (ctx, { listingId }): Promise<Doc<"listings"> | null> => ctx.db.get(listingId),
});

export const sendDealSms = internalAction({
  args: { listingId: v.id("listings") },
  handler: async (
    ctx,
    { listingId }
  ): Promise<{ sent: boolean; reason?: string; status?: number }> => {
    const key = process.env.MTA_API_KEY;
    const numbersRaw = process.env.MTA_NUMBERS;
    if (!key || !numbersRaw) return { sent: false, reason: "sms not configured" };
    const l: Doc<"listings"> | null = await ctx.runQuery(internal.notifications.getListing, { listingId });
    if (!l) return { sent: false, reason: "listing gone" };

    const numbers = numbersRaw
      .split(",")
      .map((n) => Number(n.replace(/\D/g, "")))
      .filter((n) => n > 0);
    if (!numbers.length) return { sent: false, reason: "no numbers" };

    const title = l.title || [l.year, l.make, l.model].filter(Boolean).join(" ");
    const fmt = (n: number | undefined | null) => (n != null ? "$" + Math.round(n).toLocaleString("en-US") : "n/a");
    const msg =
      `CONTACT NOW: ${title} - ${fmt(l.price)}` +
      ` (${l.mileage ? l.mileage.toLocaleString("en-US") + "mi" : "?mi"}, ${l.titleStatus})` +
      ` | JD ${fmt(l.carblyJdCleanTrade)} / KBB ${fmt(l.carblyKbbLending)} | ${l.url}`;

    try {
      const r = await fetch(MTA_SEND, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, subscribers: numbers }),
      });
      return { sent: r.ok, status: r.status };
    } catch (e) {
      return { sent: false, reason: String(e).slice(0, 120) };
    }
  },
});
