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
    if (!listing) return;
    // hot = profit ≥ margin; mechanic specials alert regardless of profit
    // (standing user override — the human reviews every one of them)
    const reason = listing.hot
      ? "hot"
      : listing.mechanicSpecial
        ? "mechanic_special"
        : null;
    if (!reason) return;

    // M8: Resend (email) / Twilio (SMS) when keys exist. Until then: log channel.
    const channel = "log";
    console.log(
      JSON.stringify({
        event: "alert.deal",
        reason,
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
    channel: v.string(),
    score: v.number(),
    price: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { listingId, channel, score, price, reason }) => {
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
    await ctx.db.insert("alerts", {
      listingId,
      channel,
      sentAt: Date.now(),
      score,
      reason,
    });
    await ctx.db.patch(listingId, { lastAlertPrice: price });
    return { suppressed: false };
  },
});
