/**
 * Pure §4 scoring math. No I/O, no Convex imports — vitest-covered with
 * known-input/known-output cases (M5 gate).
 *
 * Spec §4 Step 4 (numbers are RULES #3-protected):
 *   estProfit = estValue − price − estRecon − estFees
 *   dealScore = 45·clamp(estProfit/4000, 0, 1)
 *             + 20·clamp((estValue − price)/estValue, 0, 1)
 *             + 15·freshnessBonus(daysListed)
 *             + 10·mileageFit(mileage, buyboxBand)
 *             + 10·titleBonus(titleStatus)
 * Step 5:
 *   targetBuy = estValue − estRecon − estFees − marginThreshold
 *   walkAway  = estValue − estRecon − estFees − marginThreshold·0.6
 *
 * Inner curve shapes (architecture decisions, ARCHITECTURE §6 — the spec
 * fixes the weights, not the curves):
 *   freshnessBonus(d) = 1 − clamp(d/30, 0, 1)          (newer = closer to 1)
 *   mileageFit        = 1 inside the band, linear → 0 at 30k miles outside,
 *                       0.5 neutral when mileage unknown
 *   titleBonus        = clean 1.0 · unknown 0.4 · rebuilt 0.2 · salvage 0.1
 */

export interface MileageBand {
  min: number;
  max: number;
}

/** Global §2 default band — used when a listing has no matched search. */
export const GLOBAL_MILEAGE_BAND: MileageBand = { min: 25000, max: 130000 };

export const HOT_EXCLUDED_COMP_SOURCES = ["curve"];

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function freshnessBonus(daysListed: number | null | undefined): number {
  if (daysListed === null || daysListed === undefined) return 0.5;
  return 1 - clamp(daysListed / 30, 0, 1);
}

const MILEAGE_FALLOFF = 30000;

export function mileageFit(
  mileage: number | null | undefined,
  band: MileageBand
): number {
  if (!mileage) return 0.5;
  if (mileage >= band.min && mileage <= band.max) return 1;
  const overshoot =
    mileage < band.min ? band.min - mileage : mileage - band.max;
  return clamp(1 - overshoot / MILEAGE_FALLOFF, 0, 1);
}

export function titleBonus(titleStatus: string | null | undefined): number {
  switch ((titleStatus ?? "unknown").toLowerCase()) {
    case "clean":
      return 1.0;
    case "rebuilt":
      return 0.2;
    case "salvage":
      return 0.1;
    default:
      return 0.4;
  }
}

export function estProfitOf(
  estValue: number,
  price: number,
  estRecon: number,
  estFees: number
): number {
  return Math.round(estValue - price - estRecon - estFees);
}

export interface ScoreInput {
  estProfit: number;
  estValue: number;
  price: number;
  daysListed: number | null | undefined;
  mileage: number | null | undefined;
  band: MileageBand;
  titleStatus: string | null | undefined;
}

export interface ScoreBreakdown {
  profit: number;
  marginPct: number;
  freshness: number;
  mileageFit: number;
  titleBonus: number;
}

export function dealScore(input: ScoreInput): {
  score: number;
  breakdown: ScoreBreakdown;
} {
  const breakdown: ScoreBreakdown = {
    profit: 45 * clamp(input.estProfit / 4000, 0, 1),
    marginPct:
      input.estValue > 0
        ? 20 * clamp((input.estValue - input.price) / input.estValue, 0, 1)
        : 0,
    freshness: 15 * freshnessBonus(input.daysListed),
    mileageFit: 10 * mileageFit(input.mileage, input.band),
    titleBonus: 10 * titleBonus(input.titleStatus),
  };
  const total =
    breakdown.profit +
    breakdown.marginPct +
    breakdown.freshness +
    breakdown.mileageFit +
    breakdown.titleBonus;
  return { score: Math.round(total * 10) / 10, breakdown };
}

export function isHot(
  estProfit: number,
  marginThreshold: number,
  compSource: string | null | undefined
): boolean {
  if (compSource && HOT_EXCLUDED_COMP_SOURCES.includes(compSource)) return false;
  return estProfit >= marginThreshold;
}

export function suggestedNumbers(
  estValue: number,
  estRecon: number,
  estFees: number,
  marginThreshold: number
): { targetBuy: number; walkAway: number } {
  const net = estValue - estRecon - estFees;
  return {
    targetBuy: Math.round(net - marginThreshold),
    walkAway: Math.round(net - marginThreshold * 0.6),
  };
}

// ----------------------------------------------------------- comp adjusters

/** 20k-wide mileage buckets: 73,400 -> "60k-80k" (ARCHITECTURE §10). */
export function mileageBucket(mileage: number): { label: string; midpoint: number } {
  const lo = Math.floor(mileage / 20000) * 20;
  return { label: `${lo}k-${lo + 20}k`, midpoint: lo * 1000 + 10000 };
}

export const SALVAGE_REBUILT_FACTOR = 0.7; // standing user override (replaces §4 ×0.65)
export const AWD_FACTOR = 1.03; // §4: AWD/4WD +3%
export const MILEAGE_DOLLARS_PER_MILE = 0.06; // §4: ±$0.06/mile vs bucket median

const AWD_RE = /\b(awd|4wd|4x4|four wheel drive|all wheel drive)\b/i;

export function hasAwd(text: string): boolean {
  return AWD_RE.test(text);
}

/**
 * §4 Step 1 adjustments on a CLEAN-TITLE comp anchor:
 * mileage delta vs bucket midpoint at $0.06/mi, AWD +3%,
 * salvage/rebuilt = 0.70 × clean value (clean comps only — never anchored on
 * salvage listings; standing user override).
 */
export function adjustValue(args: {
  anchor: number;
  mileage: number | null | undefined;
  bucketMidpoint: number | null;
  awd: boolean;
  titleStatus: string | null | undefined;
}): number {
  let value = args.anchor;
  if (args.mileage && args.bucketMidpoint !== null) {
    value += (args.bucketMidpoint - args.mileage) * MILEAGE_DOLLARS_PER_MILE;
  }
  if (args.awd) value *= AWD_FACTOR;
  const title = (args.titleStatus ?? "").toLowerCase();
  if (title === "salvage" || title === "rebuilt") value *= SALVAGE_REBUILT_FACTOR;
  return Math.max(0, Math.round(value));
}
