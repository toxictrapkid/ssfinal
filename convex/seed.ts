import { internalMutation } from "./_generated/server";

// Spec §2 — global buy-box defaults
const GLOBALS = {
  active: true,
  sources: ["ksl"], // facebook deferred (standing user override 2026-06-12)
  location: "Salt Lake City, UT",
  zip: "84104",
  radiusMiles: 150,
  priceMin: 2000,
  priceMax: 28000,
  maxDaysListed: 30,
  cleanTitleOnly: true, // exclude salvage/rebuilt/branded unless opted in per-search
  intervalMinutes: 15,
};

// Spec §2 — the seven buy-box searches
const BUY_BOX = [
  {
    name: "Chevrolet Traverse 2019–2024",
    makes: ["Chevrolet"],
    models: ["Traverse"],
    yearMin: 2019,
    yearMax: 2024,
    mileageMin: 30000,
    mileageMax: 110000,
  },
  {
    name: "VW Tiguan / Atlas 2019–2023",
    makes: ["Volkswagen"],
    models: ["Tiguan", "Atlas"],
    yearMin: 2019,
    yearMax: 2023,
    mileageMin: 30000,
    mileageMax: 120000,
  },
  {
    name: "Mazda CX-5 / CX-9 / Mazda3 2018–2023",
    makes: ["Mazda"],
    models: ["CX-5", "CX-9", "Mazda3"],
    yearMin: 2018,
    yearMax: 2023,
    mileageMin: 25000,
    mileageMax: 120000,
  },
  {
    name: "GMC Terrain / Chevy Equinox 2017–2023",
    makes: ["GMC", "Chevrolet"],
    models: ["Terrain", "Equinox"],
    yearMin: 2017,
    yearMax: 2023,
    mileageMin: 40000,
    mileageMax: 130000,
  },
  {
    name: "Jeep Wrangler Unlimited 2018–2023",
    makes: ["Jeep"],
    models: ["Wrangler Unlimited"],
    yearMin: 2018,
    yearMax: 2023,
    mileageMin: 20000,
    mileageMax: 110000,
  },
  {
    name: "Ford Edge / Escape 2017–2023",
    makes: ["Ford"],
    models: ["Edge", "Escape"],
    yearMin: 2017,
    yearMax: 2023,
    mileageMin: 40000,
    mileageMax: 130000,
  },
  {
    name: "Acura MDX 2016–2022",
    makes: ["Acura"],
    models: ["MDX"],
    yearMin: 2016,
    yearMax: 2022,
    mileageMin: 40000,
    mileageMax: 120000,
  },
];

// Standing user overrides 2026-06-12:
//   "do not search for make and models — identify opportunity of arbitrage"
//   "I will never see a deal if you filter it out before and I never see it"
// The SEEDED strategy is maximally inclusive market scans: price bands only
// (pagination coverage), all makes, all titles, all years, all mileages —
// title/mileage/year are RANKING signals in the scoring engine, never gates.
// The only hard filter anywhere is private-party-only (the user's own RULES
// #4 — dealer margin is not our margin). Mechanic specials are identified at
// scoring time from listing text and always surfaced for manual review.
const ARBITRAGE_SCANS = [
  {
    // floor widened $2k -> $500 (never-pre-filter spirit; sub-$500 is parts
    // listings and scams). The $28k ceiling is the user's own capital
    // constraint from the §2 buy-box — change it in the Search Builder.
    name: "Market scan — $500–$8k, everything",
    priceMin: 500,
    priceMax: 8000,
  },
  {
    name: "Market scan — $8k–$16k, everything",
    priceMin: 8000,
    priceMax: 16000,
  },
  {
    name: "Market scan — $16k–$28k, everything",
    priceMin: 16000,
    priceMax: 28000,
  },
].map((band) => ({
  ...band,
  makes: [] as string[],
  models: [] as string[],
  yearMin: 2000,
  yearMax: 2027,
  mileageMin: 0,
  mileageMax: 400000,
  cleanTitleOnly: false,
}));

// names of previously-seeded strategies that the current seed supersedes
const SUPERSEDED_SEED_NAMES = [
  "Arbitrage scan — $2k–$12k, all makes",
  "Arbitrage scan — $12k–$28k, all makes",
  "Mechanic specials & branded titles — $2k–$12k, all makes",
  "Market scan — $2k–$8k, everything",
];

/**
 * Idempotent seed: settings row (margin 1500, fees 400) + the arbitrage scans
 * (standing override of the §2 YMM buy-boxes, which are deactivated if present
 * — any can be re-enabled from the Search Builder). partsCosts is seeded
 * separately (scripts/seed_partscosts.sh).
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    let createdSettings = false;
    const settings = await ctx.db.query("settings").first();
    if (!settings) {
      await ctx.db.insert("settings", {
        marginThreshold: 1500,
        feesFlat: 400,
      });
      createdSettings = true;
    }

    const existing = await ctx.db.query("searches").collect();
    const byName = new Map(existing.map((s) => [s.name, s]));

    let deactivatedLegacy = 0;
    for (const name of [...BUY_BOX.map((b) => b.name), ...SUPERSEDED_SEED_NAMES]) {
      const row = byName.get(name);
      if (row?.active) {
        await ctx.db.patch(row._id, { active: false });
        deactivatedLegacy++;
      }
    }

    let createdSearches = 0;
    for (const scan of ARBITRAGE_SCANS) {
      if (byName.has(scan.name)) continue;
      await ctx.db.insert("searches", {
        ...GLOBALS,
        ...scan,
        createdAt: Date.now(),
      });
      createdSearches++;
    }

    return {
      createdSettings,
      createdSearches,
      deactivatedLegacy,
      totalScans: ARBITRAGE_SCANS.length,
    };
  },
});
