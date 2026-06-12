import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { v } from "convex/values";

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
    if (!listing || !listing.hot) return;

    // M8: Resend (email) / Twilio (SMS) when keys exist. Until then: log channel.
    const channel = "log";
    console.log(
      JSON.stringify({
        event: "alert.hot_deal",
        channel,
        listingId,
        title: listing.title,
        price: listing.price,
        estProfit: listing.estProfit,
        dealScore: listing.dealScore,
        url: listing.url,
      })
    );
    await ctx.runMutation(internal.alerts.recordAlert, {
      listingId,
      channel,
      score: listing.dealScore ?? 0,
      price: listing.price,
    });
  },
});

/** Write the alert row + stamp the dedupe anchor on the listing. */
export const recordAlert = internalMutation({
  args: {
    listingId: v.id("listings"),
    channel: v.string(),
    score: v.number(),
    price: v.number(),
  },
  handler: async (ctx, { listingId, channel, score, price }) => {
    await ctx.db.insert("alerts", {
      listingId,
      channel,
      sentAt: Date.now(),
      score,
    });
    await ctx.db.patch(listingId, { lastAlertPrice: price });
  },
});
