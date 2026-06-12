/**
 * Built-in depreciation-curve valuation — the FLAGGED fallback (RULES #3a):
 * used only when no MarketCheck comp and no fresh cache row exists, always
 * surfaced as compSource:"curve" (amber in the UI), and curve-valued cars can
 * NEVER trigger HOT alerts (scoreMath.isHot).
 *
 * Shape: segment anchor "typical new price" × 0.85^age, floored at $1,500,
 * then mileage-adjusted vs 12k mi/yr expectation at $0.06/mi. Anchors are
 * seeded from the §2 buy-box (spec §4 Step 1: "a built-in depreciation curve
 * seeded from my buy-box"). Rough by design — it ranks, it doesn't appraise.
 */

const YEARLY_RETENTION = 0.85;
const FLOOR = 1500;
const EXPECTED_MILES_PER_YEAR = 12000;
const DOLLARS_PER_MILE = 0.06;

/** Typical-new-price anchors, lowercased "make model". Buy-box first. */
const MODEL_ANCHORS: Record<string, number> = {
  "chevrolet traverse": 38000,
  "volkswagen tiguan": 30000,
  "volkswagen atlas": 38000,
  "mazda cx-5": 30000,
  "mazda cx-9": 38000,
  "mazda mazda3": 25000,
  "gmc terrain": 31000,
  "chevrolet equinox": 28000,
  "jeep wrangler unlimited": 42000,
  "ford edge": 36000,
  "ford escape": 29000,
  "acura mdx": 48000,
};

/** Segment fallbacks when the exact model has no anchor. */
const SEGMENT_DEFAULT = 30000;

export function curveValue(args: {
  year: number | null | undefined;
  make: string | null | undefined;
  model: string | null | undefined;
  mileage: number | null | undefined;
  now?: number;
}): number | null {
  if (!args.year || !args.make) return null;
  const currentYear = new Date(args.now ?? Date.now()).getFullYear();
  const age = Math.max(0, currentYear - args.year);

  const key = `${args.make} ${args.model ?? ""}`.trim().toLowerCase();
  const anchor = MODEL_ANCHORS[key] ?? SEGMENT_DEFAULT;

  let value = anchor * Math.pow(YEARLY_RETENTION, age);

  if (args.mileage) {
    const expected = age * EXPECTED_MILES_PER_YEAR;
    value += (expected - args.mileage) * DOLLARS_PER_MILE;
  }
  return Math.max(FLOOR, Math.round(value));
}
