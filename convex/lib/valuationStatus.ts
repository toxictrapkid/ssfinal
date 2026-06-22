/**
 * Valuation status logic (pure, dependency-free so it can be unit-tested).
 *
 * Enforces the hard rule: a vehicle is only "review ready" when ALL FOUR
 * required numbers are present, double-checked, fresh, and agree. Never treats
 * $0 as a value; never invents data. A number with no independent second check
 * is NOT verified (MANUAL REVIEW REQUIRED). Two checks that disagree by more
 * than the larger of $500 or 3% are a VALUE MISMATCH (owner review).
 */

export type ValuationKind = "jd_clean_trade" | "jd_full_retail" | "kbb_lending" | "base_mmr";

export const REQUIRED_KINDS: ValuationKind[] = [
  "jd_clean_trade",
  "jd_full_retail",
  "kbb_lending",
  "base_mmr",
];

export const KIND_LABEL: Record<ValuationKind, string> = {
  jd_clean_trade: "JD Clean Trade",
  jd_full_retail: "JD Full Retail",
  kbb_lending: "KBB Lending",
  base_mmr: "Base MMR",
};

export type NumberStatus =
  | "VERIFIED"
  | "DATA MISSING"
  | "STALE DATA"
  | "VALUE MISMATCH"
  | "MANUAL REVIEW REQUIRED";

export interface ValuationInput {
  kind: ValuationKind;
  value: number | null;
  source?: string | null;
  checkedAt?: number | null;
  checkedBy?: string | null;
  secondValue?: number | null;
  secondSource?: string | null;
  secondCheckedAt?: number | null;
  confidence?: "high" | "medium" | "low" | null;
}

export interface ValuationResult extends ValuationInput {
  label: string;
  status: NumberStatus;
  mismatch: boolean;
  stale: boolean;
  warning: string | null;
}

/** A value older than this is STALE and must be re-checked. */
export const STALE_MS = 14 * 24 * 60 * 60 * 1000;

/** Mismatch tolerance: the larger of $500 or 3% of the bigger number. */
export function mismatchThreshold(a: number, b: number): number {
  return Math.max(500, Math.max(Math.abs(a), Math.abs(b)) * 0.03);
}

export function isMismatch(a: number, b: number): boolean {
  return Math.abs(a - b) > mismatchThreshold(a, b);
}

function valid(n: number | null | undefined): n is number {
  return typeof n === "number" && n > 0;
}

/** Status for one valuation number. Order of checks encodes severity. */
export function numberStatus(v: ValuationInput, now: number = Date.now()): ValuationResult {
  const base = { ...v, label: KIND_LABEL[v.kind], mismatch: false, stale: false, warning: null as string | null };
  // Never accept $0 / null / negative as a real value.
  if (!valid(v.value)) {
    return { ...base, status: "DATA MISSING", warning: v.value === 0 ? "$0 is not a valid value" : "no value on record" };
  }
  // Must be double-checked against an independent source.
  if (!valid(v.secondValue)) {
    return { ...base, status: "MANUAL REVIEW REQUIRED", warning: "needs an independent second check" };
  }
  // Two checks must agree within $500 / 3%.
  if (isMismatch(v.value, v.secondValue)) {
    return {
      ...base,
      status: "VALUE MISMATCH",
      mismatch: true,
      warning: `first $${Math.round(v.value)} vs second $${Math.round(v.secondValue)} differ by more than $500/3%`,
    };
  }
  // Both checks must be fresh.
  const newest = Math.max(v.checkedAt ?? 0, v.secondCheckedAt ?? 0);
  if (newest === 0 || now - newest > STALE_MS) {
    return { ...base, status: "STALE DATA", stale: true, warning: "value older than 14 days — re-check" };
  }
  return { ...base, status: "VERIFIED" };
}

// worst -> best; the overall status is the worst present.
const PRIORITY: NumberStatus[] = ["DATA MISSING", "VALUE MISMATCH", "STALE DATA", "MANUAL REVIEW REQUIRED", "VERIFIED"];

export function overallStatus(results: ValuationResult[]): NumberStatus {
  for (const s of PRIORITY) if (results.some((r) => r.status === s)) return s;
  return "VERIFIED";
}

/** Review-ready iff every required number is VERIFIED. */
export function isReviewReady(results: ValuationResult[]): boolean {
  return REQUIRED_KINDS.every((k) => results.find((r) => r.kind === k)?.status === "VERIFIED");
}

/** Which required numbers are not yet VERIFIED, with why. */
export function missingOrBad(results: ValuationResult[]): { label: string; status: NumberStatus; warning: string | null }[] {
  return REQUIRED_KINDS.map((k) => results.find((r) => r.kind === k))
    .filter((r): r is ValuationResult => !!r && r.status !== "VERIFIED")
    .map((r) => ({ label: r.label, status: r.status, warning: r.warning }));
}
