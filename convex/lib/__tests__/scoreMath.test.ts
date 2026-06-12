import { describe, expect, it } from "vitest";
import {
  GLOBAL_MILEAGE_BAND,
  adjustValue,
  dealScore,
  estProfitOf,
  freshnessBonus,
  hasAwd,
  isHot,
  mileageBucket,
  mileageFit,
  suggestedNumbers,
  titleBonus,
} from "../scoreMath";

describe("estProfit (§4: estValue − price − estRecon − estFees)", () => {
  it("computes the spec formula exactly", () => {
    expect(estProfitOf(22000, 17000, 1000, 400)).toBe(3600);
    expect(estProfitOf(10000, 9000, 400, 400)).toBe(200);
    expect(estProfitOf(8000, 9000, 400, 400)).toBe(-1800); // losses stay visible
  });
});

describe("dealScore (§4 weights 45/20/15/10/10 — hand-computed cases)", () => {
  it("known input #1: strong clean deal", () => {
    // profit 3600 -> 45*0.9 = 40.5
    // margin (22000-17000)/22000 -> 20*0.227272… = 4.5454…
    // 3 days listed -> 15*(1-3/30) = 13.5
    // 78k in 30k–110k band -> 10
    // clean -> 10                                total 78.5454… -> 78.5
    const { score, breakdown } = dealScore({
      estProfit: 3600,
      estValue: 22000,
      price: 17000,
      daysListed: 3,
      mileage: 78000,
      band: { min: 30000, max: 110000 },
      titleStatus: "clean",
    });
    expect(breakdown.profit).toBeCloseTo(40.5, 10);
    expect(breakdown.marginPct).toBeCloseTo(20 * (5000 / 22000), 10);
    expect(breakdown.freshness).toBeCloseTo(13.5, 10);
    expect(breakdown.mileageFit).toBe(10);
    expect(breakdown.titleBonus).toBe(10);
    expect(score).toBe(78.5);
  });

  it("known input #2: profit clamps at 4000, freshness floors at 30 days", () => {
    const { score, breakdown } = dealScore({
      estProfit: 9000, // clamped -> full 45
      estValue: 20000,
      price: 8000,
      daysListed: 45, // past 30 -> 0
      mileage: 60000,
      band: GLOBAL_MILEAGE_BAND,
      titleStatus: "clean",
    });
    expect(breakdown.profit).toBe(45);
    expect(breakdown.marginPct).toBe(12); // 20*(12000/20000)
    expect(breakdown.freshness).toBe(0);
    expect(score).toBe(45 + 12 + 0 + 10 + 10);
  });

  it("negative profit scores 0 on the profit component, never negative", () => {
    const { breakdown } = dealScore({
      estProfit: -2000,
      estValue: 10000,
      price: 11000,
      daysListed: 0,
      mileage: 80000,
      band: GLOBAL_MILEAGE_BAND,
      titleStatus: "salvage",
    });
    expect(breakdown.profit).toBe(0);
    expect(breakdown.marginPct).toBe(0); // price above value clamps at 0
    expect(breakdown.titleBonus).toBeCloseTo(1, 10); // salvage 10*0.1
  });
});

describe("hot threshold (margin 1500; curve never hot — RULES #3a)", () => {
  it("flips at exactly estProfit ≥ 1500", () => {
    expect(isHot(1499, 1500, "marketcheck_sold")).toBe(false);
    expect(isHot(1500, 1500, "marketcheck_sold")).toBe(true);
    expect(isHot(1501, 1500, "cache")).toBe(true);
  });
  it("curve-valued cars can never be hot, at any profit", () => {
    expect(isHot(99999, 1500, "curve")).toBe(false);
  });
});

describe("suggested numbers (§4 Step 5)", () => {
  it("targetBuy / walkAway formulas", () => {
    // estValue 22000, recon 1000, fees 400, margin 1500
    expect(suggestedNumbers(22000, 1000, 400, 1500)).toEqual({
      targetBuy: 19100, // 20600 - 1500
      walkAway: 19700, // 20600 - 900
    });
  });
});

describe("comp adjustments (§4 Step 1 + standing 0.70 override)", () => {
  it("salvage/rebuilt = 0.70 × clean comp value — NOT the spec's old 0.65", () => {
    const salvage = adjustValue({
      anchor: 20000,
      mileage: null,
      bucketMidpoint: null,
      awd: false,
      titleStatus: "salvage",
    });
    expect(salvage).toBe(14000);
    expect(salvage).not.toBe(13000); // 0.65 would give this
    expect(
      adjustValue({ anchor: 20000, mileage: null, bucketMidpoint: null, awd: false, titleStatus: "rebuilt" })
    ).toBe(14000);
  });

  it("mileage delta ±$0.06/mi vs bucket midpoint", () => {
    // 65k vs 70k midpoint -> +5000*0.06 = +300
    expect(
      adjustValue({ anchor: 20000, mileage: 65000, bucketMidpoint: 70000, awd: false, titleStatus: "clean" })
    ).toBe(20300);
    // 75k vs 70k midpoint -> -300
    expect(
      adjustValue({ anchor: 20000, mileage: 75000, bucketMidpoint: 70000, awd: false, titleStatus: "clean" })
    ).toBe(19700);
  });

  it("AWD +3%, applied before the title factor", () => {
    expect(
      adjustValue({ anchor: 20000, mileage: null, bucketMidpoint: null, awd: true, titleStatus: "clean" })
    ).toBe(20600);
    expect(
      adjustValue({ anchor: 20000, mileage: null, bucketMidpoint: null, awd: true, titleStatus: "salvage" })
    ).toBe(14420); // 20000*1.03*0.70
  });

  it("detects AWD from listing text", () => {
    expect(hasAwd("2021 Chevrolet Traverse LT AWD")).toBe(true);
    expect(hasAwd("Jeep 4x4, runs great")).toBe(true);
    expect(hasAwd("FWD sedan")).toBe(false);
  });
});

describe("inner curves", () => {
  it("freshness: 0 days -> 1.0, 15 days -> 0.5, ≥30 days -> 0, unknown -> 0.5", () => {
    expect(freshnessBonus(0)).toBe(1);
    expect(freshnessBonus(15)).toBe(0.5);
    expect(freshnessBonus(30)).toBe(0);
    expect(freshnessBonus(90)).toBe(0);
    expect(freshnessBonus(null)).toBe(0.5);
  });
  it("mileageFit: linear falloff to 0 at 30k outside the band", () => {
    const band = { min: 30000, max: 110000 };
    expect(mileageFit(70000, band)).toBe(1);
    expect(mileageFit(125000, band)).toBeCloseTo(0.5, 10); // 15k over
    expect(mileageFit(140000, band)).toBe(0);
    expect(mileageFit(15000, band)).toBeCloseTo(0.5, 10); // 15k under
    expect(mileageFit(null, band)).toBe(0.5);
  });
  it("titleBonus ladder: clean full 10 (spec), salvage lowest", () => {
    expect(titleBonus("clean")).toBe(1);
    expect(titleBonus("unknown")).toBe(0.4);
    expect(titleBonus("rebuilt")).toBe(0.2);
    expect(titleBonus("salvage")).toBe(0.1);
  });
  it("mileage buckets are 20k-wide with midpoints", () => {
    expect(mileageBucket(73400)).toEqual({ label: "60k-80k", midpoint: 70000 });
    expect(mileageBucket(91320)).toEqual({ label: "80k-100k", midpoint: 90000 });
    expect(mileageBucket(5000)).toEqual({ label: "0k-20k", midpoint: 10000 });
  });
});
