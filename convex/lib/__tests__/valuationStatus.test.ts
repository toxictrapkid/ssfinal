import { describe, expect, it } from "vitest";
import {
  REQUIRED_KINDS,
  STALE_MS,
  isMismatch,
  isReviewReady,
  missingOrBad,
  mismatchThreshold,
  numberStatus,
  overallStatus,
  type ValuationInput,
  type ValuationResult,
} from "../valuationStatus";

const NOW = Date.parse("2026-06-12T00:00:00Z");
const FRESH = NOW - 1000; // 1s ago
const STALE = NOW - STALE_MS - 1; // just past the 14-day window

/** Build a two-check, fresh, agreeing input for a kind (=> VERIFIED). */
function verified(kind: ValuationInput["kind"], value = 20000): ValuationInput {
  return {
    kind,
    value,
    source: "nada",
    checkedAt: FRESH,
    checkedBy: "employee",
    secondValue: value + 100,
    secondSource: "kbb",
    secondCheckedAt: FRESH,
  };
}

describe("mismatchThreshold / isMismatch (the larger of $500 or 3%)", () => {
  it("uses the $500 floor for small numbers", () => {
    expect(mismatchThreshold(1000, 1500)).toBe(500); // 3% of 1500 = 45 < 500
  });
  it("uses 3% of the larger number when that exceeds $500", () => {
    expect(mismatchThreshold(100000, 103000)).toBeCloseTo(3090); // 3% of 103000
  });
  it("$500 boundary is exclusive — exactly $500 apart is NOT a mismatch", () => {
    expect(isMismatch(1000, 1500)).toBe(false);
    expect(isMismatch(1000, 1501)).toBe(true);
  });
  it("3% boundary is exclusive", () => {
    expect(isMismatch(100000, 103090)).toBe(false); // exactly at threshold
    expect(isMismatch(100000, 103100)).toBe(true);
  });
});

describe("numberStatus — never accept $0/null/negative as a value", () => {
  it("null value => DATA MISSING", () => {
    const r = numberStatus({ kind: "kbb_lending", value: null }, NOW);
    expect(r.status).toBe("DATA MISSING");
    expect(r.warning).toBe("no value on record");
  });
  it("$0 => DATA MISSING with the explicit $0 warning (never a placeholder)", () => {
    const r = numberStatus({ kind: "kbb_lending", value: 0 }, NOW);
    expect(r.status).toBe("DATA MISSING");
    expect(r.warning).toBe("$0 is not a valid value");
  });
  it("negative => DATA MISSING", () => {
    expect(numberStatus({ kind: "kbb_lending", value: -5 }, NOW).status).toBe("DATA MISSING");
  });
});

describe("numberStatus — second-check + freshness gate", () => {
  it("a single fresh check is MANUAL REVIEW REQUIRED by default (needs an independent second check)", () => {
    const r = numberStatus(
      { kind: "jd_clean_trade", value: 20000, checkedAt: FRESH },
      NOW
    );
    expect(r.status).toBe("MANUAL REVIEW REQUIRED");
  });
  it("requireSecondCheck=false lets one fresh check VERIFY", () => {
    const r = numberStatus(
      { kind: "jd_clean_trade", value: 20000, checkedAt: FRESH },
      NOW,
      { requireSecondCheck: false }
    );
    expect(r.status).toBe("VERIFIED");
  });
  it("two agreeing fresh checks => VERIFIED", () => {
    expect(numberStatus(verified("jd_clean_trade"), NOW).status).toBe("VERIFIED");
  });
  it("two checks that disagree beyond the tolerance => VALUE MISMATCH", () => {
    const r = numberStatus(
      {
        kind: "base_mmr",
        value: 20000,
        checkedAt: FRESH,
        secondValue: 22000, // $2000 apart > max($500, 3%)
        secondCheckedAt: FRESH,
      },
      NOW
    );
    expect(r.status).toBe("VALUE MISMATCH");
    expect(r.mismatch).toBe(true);
  });
  it("VALUE MISMATCH outranks staleness (a disagreement is reported even when old)", () => {
    const r = numberStatus(
      { kind: "base_mmr", value: 20000, checkedAt: STALE, secondValue: 30000, secondCheckedAt: STALE },
      NOW
    );
    expect(r.status).toBe("VALUE MISMATCH");
  });
  it("two agreeing but old checks => STALE DATA", () => {
    const r = numberStatus(
      { kind: "jd_full_retail", value: 20000, checkedAt: STALE, secondValue: 20050, secondCheckedAt: STALE },
      NOW
    );
    expect(r.status).toBe("STALE DATA");
    expect(r.stale).toBe(true);
  });
  it("single fresh check with requireSecondCheck=false but stale => STALE DATA", () => {
    const r = numberStatus(
      { kind: "jd_full_retail", value: 20000, checkedAt: STALE },
      NOW,
      { requireSecondCheck: false }
    );
    expect(r.status).toBe("STALE DATA");
  });
  it("exactly at the 14-day edge is still fresh; one ms past is stale", () => {
    const atEdge = numberStatus(
      { kind: "kbb_lending", value: 20000, checkedAt: NOW - STALE_MS, secondValue: 20000, secondCheckedAt: NOW - STALE_MS },
      NOW,
      { requireSecondCheck: false }
    );
    expect(atEdge.status).toBe("VERIFIED");
  });
});

describe("overallStatus — worst present wins", () => {
  const res = (kind: ValuationInput["kind"], status: ValuationResult["status"]) =>
    ({ kind, status } as ValuationResult);
  it("DATA MISSING beats everything", () => {
    expect(
      overallStatus([res("jd_clean_trade", "VERIFIED"), res("kbb_lending", "DATA MISSING")])
    ).toBe("DATA MISSING");
  });
  it("VALUE MISMATCH beats STALE / MANUAL / VERIFIED", () => {
    expect(
      overallStatus([res("jd_clean_trade", "STALE DATA"), res("kbb_lending", "VALUE MISMATCH")])
    ).toBe("VALUE MISMATCH");
  });
  it("all VERIFIED => VERIFIED", () => {
    expect(
      overallStatus([res("jd_clean_trade", "VERIFIED"), res("kbb_lending", "VERIFIED")])
    ).toBe("VERIFIED");
  });
});

describe("isReviewReady / missingOrBad — the hard rule", () => {
  const all = (fn: (k: ValuationInput["kind"]) => ValuationInput) =>
    REQUIRED_KINDS.map((k) => numberStatus(fn(k), NOW));

  it("review-ready ONLY when all four required numbers are VERIFIED", () => {
    const results = all((k) => verified(k));
    expect(isReviewReady(results)).toBe(true);
    expect(missingOrBad(results)).toHaveLength(0);
  });

  it("one missing number blocks review-ready and is listed in missingOrBad", () => {
    const results = all((k) =>
      k === "base_mmr" ? { kind: k, value: null } : verified(k)
    );
    expect(isReviewReady(results)).toBe(false);
    const missing = missingOrBad(results);
    expect(missing).toHaveLength(1);
    expect(missing[0].label).toBe("Base MMR");
    expect(missing[0].status).toBe("DATA MISSING");
  });

  it("a single-checked (unverified) number also blocks review-ready", () => {
    const results = all((k) =>
      k === "jd_full_retail" ? { kind: k, value: 25000, checkedAt: FRESH } : verified(k)
    );
    expect(isReviewReady(results)).toBe(false);
    expect(missingOrBad(results).map((m) => m.status)).toContain("MANUAL REVIEW REQUIRED");
  });
});
