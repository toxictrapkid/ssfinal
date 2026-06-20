/**
 * Description enrichment — fetch each listing's seller description from its KSL
 * detail page (via the Web Unlocker) and flag drivetrain "mechanic specials".
 *
 * The KSL search page the scraper reads omits the description, so the recon
 * classifier never sees "needs engine" / "blown motor" / "won't start". This
 * backfills it per-listing: detail-page fetch -> classifyDrivetrain (same rules
 * as scoring) -> persist description + mechanicSpecial. Once filled, the feed's
 * specialsOnly filter and the §4 recon math both light up.
 *
 * Cost control: one Web Unlocker call per listing, so we only fetch listings we
 * haven't checked yet (descCheckedAt unset), cheapest-first.
 */
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { fetchKslDescription, brightDataConfigured } from "./lib/kslWebUnlocker";
import { classifyDrivetrain } from "./lib/reconRules";

/** Active listings whose description we haven't fetched yet, cheapest first. */
export const needingDescription = internalQuery({
  args: { limit: v.number(), maxPrice: v.optional(v.number()), recheck: v.optional(v.boolean()) },
  handler: async (ctx, { limit, maxPrice, recheck }) => {
    const rows = await ctx.db.query("listings").withIndex("by_status").collect();
    let out = rows.filter(
      (l) => l.status === "active" || l.status === "price_drop"
    );
    if (!recheck) out = out.filter((l) => l.descCheckedAt === undefined);
    if (maxPrice !== undefined) out = out.filter((l) => l.price <= maxPrice);
    out.sort((a, b) => a.price - b.price);
    return out.slice(0, limit).map((l) => ({
      _id: l._id,
      sourceListingId: l.sourceListingId,
      url: l.url,
      title: l.title,
      price: l.price,
      mileage: l.mileage ?? null,
      estValue: l.estValue ?? null,
      dealScore: l.dealScore ?? null,
    }));
  },
});

export const setDescription = internalMutation({
  args: {
    listingId: v.id("listings"),
    description: v.string(),
    mechanicSpecial: v.boolean(),
  },
  handler: async (ctx, { listingId, description, mechanicSpecial }) => {
    await ctx.db.patch(listingId, {
      description: description || undefined,
      mechanicSpecial,
      descCheckedAt: Date.now(),
    });
  },
});

interface EnrichResult {
  checked: number;
  matched: number;
  errors: number;
  specials: {
    sourceListingId: string;
    url: string;
    issue: string;
    price: number;
    mileage: number | null;
    estValue: number | null;
    belowBook: number | null;
    dealScore: number | null;
    title: string;
    snippet: string;
  }[];
  error?: string;
}

/**
 * Fetch + classify descriptions for a batch of un-checked listings.
 * Returns the drivetrain matches inline (cheap/below-book ranked) so a single
 * call surfaces the "needs engine" set without a follow-up query.
 */
export const enrichDescriptions = action({
  args: { limit: v.optional(v.number()), maxPrice: v.optional(v.number()), recheck: v.optional(v.boolean()) },
  handler: async (ctx, { limit, maxPrice, recheck }): Promise<EnrichResult> => {
    if (!brightDataConfigured()) {
      return { checked: 0, matched: 0, errors: 0, specials: [], error: "BRIGHTDATA_API_TOKEN not set" };
    }
    const rows = await ctx.runQuery(internal.enrich.needingDescription, {
      limit: limit ?? 60,
      maxPrice,
      recheck,
    });
    let checked = 0;
    let errors = 0;
    const specials: EnrichResult["specials"] = [];
    for (const r of rows) {
      let desc: string | null = null;
      try {
        desc = await fetchKslDescription(r.sourceListingId);
      } catch {
        errors++;
        continue; // leave descCheckedAt unset so a later run retries it
      }
      const issue = desc ? classifyDrivetrain(`${r.title} ${desc}`) : null;
      await ctx.runMutation(internal.enrich.setDescription, {
        listingId: r._id,
        description: desc ?? "",
        mechanicSpecial: issue !== null,
      });
      checked++;
      if (issue) {
        specials.push({
          sourceListingId: r.sourceListingId,
          url: r.url,
          issue,
          price: r.price,
          mileage: r.mileage,
          estValue: r.estValue,
          belowBook: r.estValue != null ? r.estValue - r.price : null,
          dealScore: r.dealScore,
          title: r.title,
          snippet: (desc ?? "").trim().slice(0, 200),
        });
      }
    }
    specials.sort((a, b) => (b.belowBook ?? -Infinity) - (a.belowBook ?? -Infinity));
    return { checked, matched: specials.length, errors, specials };
  },
});

/** Cron-friendly wrapper: enrich a small batch each tick (no inline return). */
export const enrichTickDescriptions = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    if (process.env.SCAN_ENABLED !== "true" || !brightDataConfigured()) return;
    const rows = await ctx.runQuery(internal.enrich.needingDescription, { limit: 15 });
    for (const r of rows) {
      let desc: string | null = null;
      try {
        desc = await fetchKslDescription(r.sourceListingId);
      } catch {
        continue;
      }
      const issue = desc ? classifyDrivetrain(`${r.title} ${desc}`) : null;
      await ctx.runMutation(internal.enrich.setDescription, {
        listingId: r._id,
        description: desc ?? "",
        mechanicSpecial: issue !== null,
      });
    }
  },
});
