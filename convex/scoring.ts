import { internalAction } from "./_generated/server";
import { v } from "convex/values";

/**
 * M5 placeholder so the ingest -> score data flow is wired end to end now.
 * upsertFromScrape schedules this for every new, price-dropped, or relisted
 * listing; M5 replaces the body with the full §4 engine (comps via
 * MarketCheck-first chain, partsCosts recon, profit/score/hot + alerts).
 */
export const scoreListing = internalAction({
  args: { listingId: v.id("listings") },
  handler: async (_ctx, { listingId }) => {
    console.log(
      JSON.stringify({
        event: "scoring.skipped",
        reason: "scoring engine lands at M5",
        listingId,
      })
    );
  },
});
