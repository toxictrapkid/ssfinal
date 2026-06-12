import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import {
  alertBody,
  alertSubject,
  decideChannels,
  sendEmailViaResend,
  sendSmsViaTwilio,
} from "./lib/alertTransports";

/** Recent alerts with their listings — the in-app "provide it to me" surface. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("alerts").order("desc").take(limit ?? 50);
    const out = [];
    for (const row of rows) {
      const listing = await ctx.db.get(row.listingId);
      if (listing) out.push({ ...row, listing });
    }
    return out;
  },
});

/**
 * Hot-deal alerting. M5 wires the flow; M8 adds Resend/Twilio delivery.
 * Keyless deployments (this one — user directive: no additional access) use
 * the "log" channel: an alerts row is still written so the once-per-car-
 * unless-price-drops dedupe is real, auditable, and testable (VISION #3).
 */
export const sendHotAlert = internalAction({
  args: { listingId: v.id("listings") },
  handler: async (ctx, { listingId }) => {
    const listing = await ctx.runQuery(internal.scoring.getListing, { listingId });
    if (!listing) return;
    // hot = profit ≥ margin; mechanic specials alert regardless of profit
    // (standing user override — the human reviews every one of them)
    const reason = listing.hot
      ? "hot"
      : listing.mechanicSpecial
        ? "mechanic_special"
        : null;
    if (!reason) return;

    // Channel selection: Resend email / Twilio SMS when keys + contacts
    // exist; the log channel is the floor — an alert is never dropped.
    const settings = await ctx.runQuery(internal.settings.getInternal, {});
    const plan = decideChannels({
      resendKey: process.env.RESEND_KEY,
      twilioSid: process.env.TWILIO_ACCOUNT_SID,
      twilioToken: process.env.TWILIO_AUTH_TOKEN,
      twilioFrom: process.env.TWILIO_FROM,
      alertEmail: settings?.alertEmail,
      alertPhone: settings?.alertPhone,
    });
    const body = alertBody(listing);
    const delivered: string[] = [];

    if (plan.email) {
      const result = await sendEmailViaResend({
        apiKey: process.env.RESEND_KEY!,
        to: plan.email,
        subject: alertSubject(reason, listing.title, listing.estProfit),
        html: body.html,
      });
      console.log(JSON.stringify({ event: "alert.email", ok: result.ok, detail: result.detail }));
      if (result.ok) delivered.push("email");
    }
    if (plan.sms) {
      const result = await sendSmsViaTwilio({
        accountSid: process.env.TWILIO_ACCOUNT_SID!,
        authToken: process.env.TWILIO_AUTH_TOKEN!,
        from: process.env.TWILIO_FROM!,
        to: plan.sms,
        body: `${alertSubject(reason, listing.title, listing.estProfit)}\n${body.text}`,
      });
      console.log(JSON.stringify({ event: "alert.sms", ok: result.ok, detail: result.detail }));
      if (result.ok) delivered.push("sms");
    }
    // failed deliveries fall back to the log row too — never silently dropped
    if (delivered.length === 0) delivered.push("log");

    console.log(
      JSON.stringify({
        event: "alert.deal",
        reason,
        channels: delivered,
        listingId,
        title: listing.title,
        price: listing.price,
        estProfit: listing.estProfit,
        dealScore: listing.dealScore,
        url: listing.url,
      })
    );
    // NOTE (M8 reviewer A): on a KEYED deployment, delivery happens before
    // the transactional dedupe check — a double-scheduled action could send
    // twice even though only one row lands. Keyless (this deployment) is
    // exact-once because delivery IS the row. Before adding delivery keys,
    // flip to claim-first: recordAlert reserves, then send.
    await ctx.runMutation(internal.alerts.recordAlert, {
      listingId,
      channels: delivered,
      score: listing.dealScore ?? 0,
      reason,
    });
  },
});

/** Write the alert row + stamp the dedupe anchor on the listing.
 *
 * The dedupe condition is re-checked HERE, inside the mutation, because the
 * applyScore-side check races: two score passes in flight can both see
 * lastAlertPrice undefined before either stamp commits (M5 reviewer
 * advisory C). Convex serializes mutations, so this check is airtight. */
export const recordAlert = internalMutation({
  args: {
    listingId: v.id("listings"),
    channels: v.array(v.string()), // one row per delivered channel, one transaction
    score: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { listingId, channels, score, reason }) => {
    const listing = await ctx.db.get(listingId);
    if (!listing) return { suppressed: true };
    if (
      listing.lastAlertPrice !== undefined &&
      listing.price >= listing.lastAlertPrice
    ) {
      console.log(
        JSON.stringify({ event: "alert.dedupe_suppressed", listingId })
      );
      return { suppressed: true };
    }
    const sentAt = Date.now();
    for (const channel of channels) {
      await ctx.db.insert("alerts", {
        listingId,
        channel,
        sentAt,
        score,
        reason,
        price: listing.price, // audit: the price this alert fired at (M8 rev. D)
      });
    }
    // stamp the CURRENT price, not an action-time snapshot (M8 reviewer F)
    await ctx.db.patch(listingId, { lastAlertPrice: listing.price });
    return { suppressed: false };
  },
});
