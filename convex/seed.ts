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

/**
 * Idempotent seed: settings row (margin 1500, fees 400) + the 7 §2 searches.
 * partsCosts is seeded separately (scripts/seed_partscosts.sh) — the CSV
 * aggregation runs outside Convex.
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

    let createdSearches = 0;
    const existing = await ctx.db.query("searches").collect();
    const existingNames = new Set(existing.map((s) => s.name));
    for (const box of BUY_BOX) {
      if (existingNames.has(box.name)) continue;
      await ctx.db.insert("searches", {
        ...GLOBALS,
        ...box,
        createdAt: Date.now(),
      });
      createdSearches++;
    }

    return { createdSettings, createdSearches, totalSearches: BUY_BOX.length };
  },
});
