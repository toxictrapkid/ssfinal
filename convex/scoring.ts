import { api, internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { curveValue } from "./lib/depreciationCurve";
import { classifyDrivetrain, computeRecon, type PartsCost } from "./lib/reconRules";
import {
  GLOBAL_MILEAGE_BAND,
  adjustValue,
  dealScore,
  estProfitOf,
  hasAwd,
  isHot,
  mileageBucket,
} from "./lib/scoreMath";

/**
 * The §4 scoring pass (ARCHITECTURE §6). Runs as an action so the comp chain
 * can reach MarketCheck; all writes go through applyScore below.
 *
 * Comp chain: comps cache (7d) → MarketCheck (iff key) → depreciation curve
 * flagged compSource:"curve" (never HOT — RULES #3a). Salvage/rebuilt anchors
 * on CLEAN-title comps × 0.70 (standing override). Recon: parts-based for
 * drivetrain failures via partsCosts, §4 keyword bumps otherwise (RULES #3b).
 */
export const scoreListing = internalAction({
  args: { listingId: v.id("listings") },
  handler: async (ctx, { listingId }) => {
    const listing = await ctx.runQuery(internal.scoring.getListing, { listingId });
    if (!listing) {
      console.warn(JSON.stringify({ event: "scoring.missing_listing", listingId }));
      return;
    }
    const settings = await ctx.runQuery(internal.settings.getInternal, {});
    if (!settings) {
      console.error(JSON.stringify({ event: "scoring.no_settings", listingId }));
      return;
    }
    const search = listing.matchedSearchId
      ? await ctx.runQuery(internal.scoring.getSearch, { searchId: listing.matchedSearchId })
      : null;

    // ---- Step 1: estValue via the comp chain
    let comp = null;
    let compSource: string | null = null;
    const haveYmm = listing.year && listing.make && listing.model;
    const bucket = listing.mileage ? mileageBucket(listing.mileage) : null;

    if (haveYmm && bucket) {
      const ymm = `${listing.year}|${listing.make}|${listing.model}`;
      comp = await ctx.runAction(internal.comps.getOrFetchComp, {
        ymm,
        mileageBucket: bucket.label,
        mileageLo: Math.max(0, (listing.mileage ?? 0) - 10000),
        mileageHi: (listing.mileage ?? 0) + 10000,
        zip: search?.zip ?? "84104",
        radiusMiles: search?.radiusMiles ?? 150,
      });
      if (comp) compSource = comp.source ?? "cache";
    }

    const awd = hasAwd(
      `${listing.title} ${listing.trim ?? ""} ${listing.description ?? ""}`
    );

    let estValue: number | null = null;
    if (comp && bucket) {
      estValue = adjustValue({
        anchor: comp.medianRetail,
        mileage: listing.mileage,
        bucketMidpoint: bucket.midpoint,
        awd,
        titleStatus: listing.titleStatus,
      });
    } else {
      const curve = curveValue({
        year: listing.year,
        make: listing.make,
        model: listing.model,
        mileage: listing.mileage,
      });
      if (curve !== null) {
        compSource = "curve";
        estValue = adjustValue({
          anchor: curve,
          mileage: null, // curve already mileage-adjusted
          bucketMidpoint: null,
          awd,
          titleStatus: listing.titleStatus,
        });
      }
    }

    if (estValue === null) {
      console.warn(
        JSON.stringify({
          event: "scoring.unvaluable",
          listingId,
          reason: "no comp, no curve (missing year/make)",
        })
      );
      return;
    }

    // ---- Step 2: recon (parts-based for drivetrain, §4 bumps otherwise)
    let engineCost: PartsCost | null = null;
    let transmissionCost: PartsCost | null = null;
    if (haveYmm) {
      const [engine, trans] = await Promise.all([
        ctx.runQuery(api.partsCosts.lookup, {
          year: listing.year!,
          make: listing.make!,
          model: listing.model!,
          part: "Engine",
        }),
        ctx.runQuery(api.partsCosts.lookup, {
          year: listing.year!,
          make: listing.make!,
          model: listing.model!,
          part: "Transmission",
        }),
      ]);
      engineCost = engine
        ? { medianPrice: engine.medianPrice, sampleSize: engine.sampleSize, matchedYear: engine.matchedYear }
        : null;
      transmissionCost = trans
        ? { medianPrice: trans.medianPrice, sampleSize: trans.sampleSize, matchedYear: trans.matchedYear }
        : null;
    }
    const recon = computeRecon({
      title: listing.title,
      description: listing.description,
      titleStatus: listing.titleStatus,
      engineCost,
      transmissionCost,
    });

    // ---- Steps 3–4: fees, profit, score, hot
    const estFees = settings.feesFlat;
    const estProfit = estProfitOf(estValue, listing.price, recon.estRecon, estFees);
    const band = search
      ? { min: search.mileageMin, max: search.mileageMax }
      : GLOBAL_MILEAGE_BAND;
    const { score, breakdown } = dealScore({
      estProfit,
      estValue,
      price: listing.price,
      daysListed: listing.daysListed,
      mileage: listing.mileage,
      band,
      titleStatus: listing.titleStatus,
    });
    const hot = isHot(estProfit, settings.marginThreshold, compSource);
    // standing user override: every drivetrain-issue car is surfaced for
    // manual review regardless of computed profit — the human rules on
    // mechanic specials, the math just informs
    const mechanicSpecial =
      classifyDrivetrain(`${listing.title} ${listing.description ?? ""}`) !== null;

    await ctx.runMutation(internal.scoring.applyScore, {
      listingId,
      estValue,
      estRecon: recon.estRecon,
      estFees,
      estProfit,
      dealScore: score,
      hot,
      mechanicSpecial,
      compSource: compSource ?? undefined,
      compSampleSize: comp?.sampleSize,
      compRef: comp?._id,
      reconSource: recon.reconSource,
      reconBreakdown: recon.reconBreakdown,
      scoreBreakdown: breakdown,
    });
  },
});

/** Write the scoring result; trigger the hot-alert path when warranted. */
export const applyScore = internalMutation({
  args: {
    listingId: v.id("listings"),
    estValue: v.number(),
    estRecon: v.number(),
    estFees: v.number(),
    estProfit: v.number(),
    dealScore: v.number(),
    hot: v.boolean(),
    mechanicSpecial: v.boolean(),
    compSource: v.optional(v.string()),
    compSampleSize: v.optional(v.number()),
    compRef: v.optional(v.id("comps")),
    reconSource: v.string(),
    reconBreakdown: v.array(
      v.object({
        label: v.string(),
        amount: v.number(),
        meta: v.optional(v.string()),
      })
    ),
    scoreBreakdown: v.object({
      profit: v.number(),
      marginPct: v.number(),
      freshness: v.number(),
      mileageFit: v.number(),
      titleBonus: v.number(),
    }),
  },
  handler: async (ctx, { listingId, ...fields }) => {
    const listing = await ctx.db.get(listingId);
    if (!listing) return;
    await ctx.db.patch(listingId, fields);

    // Alert dedupe rule (VISION #3): once per car, again only on a price drop
    // below the price we last alerted at. Mechanic specials alert regardless
    // of profit (standing user override — manual review). recordAlert
    // re-checks the dedupe condition transactionally.
    if (
      (fields.hot || fields.mechanicSpecial) &&
      (listing.lastAlertPrice === undefined || listing.price < listing.lastAlertPrice)
    ) {
      await ctx.scheduler.runAfter(0, internal.alerts.sendHotAlert, { listingId });
    }
  },
});

export const getListing = internalQuery({
  args: { listingId: v.id("listings") },
  handler: async (ctx, { listingId }) => ctx.db.get(listingId),
});

export const getSearch = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => ctx.db.get(searchId),
});

/** Ops helper: re-score everything (comps refreshed, settings changed…). */
export const rescoreAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const listings = await ctx.db.query("listings").collect();
    let scheduled = 0;
    for (const listing of listings) {
      if (listing.status === "active" || listing.status === "price_drop") {
        await ctx.scheduler.runAfter(0, internal.scoring.scoreListing, {
          listingId: listing._id,
        });
        scheduled++;
      }
    }
    return { scheduled };
  },
});
