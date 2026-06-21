import { describe, it, expect } from "vitest";
import { applyGapRule, QUALIFY_ABOVE, CONTACT_NOW_UNDER, BRANDED_FACTOR } from "../gapRule";

describe("applyGapRule (buy-box)", () => {
  it("clean: HOT when price is >= $1,000 under BOTH books", () => {
    const g = applyGapRule(8000, { jdCleanTrade: 10000, kbbLending: 9000, uuid: null });
    expect(g.estValue).toBe(10000); // higher of the two clean books
    expect(g.qualifies).toBe(true);
    expect(g.hot).toBe(true); // jdGap 2000 and kbbGap 1000 both >= 1000
    expect(g.bestGap).toBe(2000);
  });

  it("clean: qualifies within $750 over book but not HOT", () => {
    const g = applyGapRule(10500, { jdCleanTrade: 10000, kbbLending: 9000, uuid: null });
    expect(g.qualifies).toBe(true); // 10500 <= 10000 + 750
    expect(g.hot).toBe(false); // jdGap -500
  });

  it("clean: does not qualify when price is more than $750 over book", () => {
    const g = applyGapRule(12000, { jdCleanTrade: 10000, kbbLending: 9000, uuid: null });
    expect(g.qualifies).toBe(false);
  });

  it("clean: HOT requires under BOTH books, not just one", () => {
    // 8500 is >1000 under JD (10000) but only 500 under KBB (9000) -> not HOT
    const g = applyGapRule(8500, { jdCleanTrade: 10000, kbbLending: 9000, uuid: null });
    expect(g.qualifies).toBe(true);
    expect(g.hot).toBe(false);
  });

  it("branded: books discounted by BRANDED_FACTOR, decision on the reference book", () => {
    const g = applyGapRule(5000, { jdCleanTrade: 10000, kbbLending: null, uuid: null }, { factor: BRANDED_FACTOR, branded: true });
    expect(g.effJd).toBe(Math.round(10000 * BRANDED_FACTOR)); // 7000
    expect(g.estValue).toBe(7000);
    expect(g.qualifies).toBe(true); // 5000 <= 7000 + 750
    expect(g.hot).toBe(true); // 2000 under reference
  });

  it("no books -> does not qualify, no value", () => {
    const g = applyGapRule(5000, { jdCleanTrade: null, kbbLending: null, uuid: null });
    expect(g.estValue).toBeNull();
    expect(g.qualifies).toBe(false);
    expect(g.bestGap).toBe(0);
  });

  it("threshold constants match the buy-box spec", () => {
    expect(QUALIFY_ABOVE).toBe(750);
    expect(CONTACT_NOW_UNDER).toBe(1000);
    expect(BRANDED_FACTOR).toBe(0.7);
  });
});
