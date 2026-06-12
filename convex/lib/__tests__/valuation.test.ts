import { describe, expect, it } from "vitest";
import { curveValue } from "../depreciationCurve";
import { compSetFromPrices, fetchComps } from "../marketcheck";

describe("depreciation curve (flagged fallback)", () => {
  it("newer + fewer miles is worth more", () => {
    const newer = curveValue({ year: 2022, make: "Chevrolet", model: "Traverse", mileage: 30000, now: Date.parse("2026-06-12") })!;
    const older = curveValue({ year: 2018, make: "Chevrolet", model: "Traverse", mileage: 30000, now: Date.parse("2026-06-12") })!;
    const highMiles = curveValue({ year: 2022, make: "Chevrolet", model: "Traverse", mileage: 90000, now: Date.parse("2026-06-12") })!;
    expect(newer).toBeGreaterThan(older);
    expect(newer).toBeGreaterThan(highMiles);
  });
  it("floors at $1,500 and never returns negative", () => {
    expect(
      curveValue({ year: 2000, make: "Ford", model: "Focus", mileage: 300000, now: Date.parse("2026-06-12") })
    ).toBe(1500);
  });
  it("returns null without a year or make (unvaluable)", () => {
    expect(curveValue({ year: null, make: "Ford", model: "Edge", mileage: 50000 })).toBeNull();
    expect(curveValue({ year: 2020, make: null, model: null, mileage: 50000 })).toBeNull();
  });
});

describe("marketcheck comp-set math", () => {
  it("median/p25/p75 from prices", () => {
    const set = compSetFromPrices([10000, 12000, 14000, 16000, 18000], "marketcheck_active")!;
    expect(set.medianRetail).toBe(14000);
    expect(set.p25Retail).toBe(12000);
    expect(set.p75Retail).toBe(16000);
    expect(set.sampleSize).toBe(5);
  });
  it("rejects thin samples (<3) and junk prices", () => {
    expect(compSetFromPrices([15000, 100], "marketcheck_active")).toBeNull();
    expect(compSetFromPrices([], "marketcheck_sold")).toBeNull();
  });
});

describe("marketcheck REST driver (parse-pinned via injected fetch)", () => {
  const listings = (prices: number[]) => ({
    ok: true,
    status: 200,
    json: async () => ({ listings: prices.map((p) => ({ price: p })) }),
  });

  it("sold comps beat asking comps when both exist", async () => {
    const calls: string[] = [];
    const set = await fetchComps({
      apiKey: "k",
      year: 2021,
      make: "Chevrolet",
      model: "Traverse",
      mileageLo: 60000,
      mileageHi: 80000,
      zip: "84104",
      radiusMiles: 150,
      fetchImpl: async (url) => {
        calls.push(url);
        return url.includes("/recents")
          ? listings([20000, 21000, 22000])
          : listings([30000, 31000, 32000]);
      },
    });
    expect(set!.source).toBe("marketcheck_sold");
    expect(set!.medianRetail).toBe(21000);
    expect(calls[0]).toContain("title_status=clean"); // clean comps only
  });

  it("falls through to active comps when sold is thin", async () => {
    const set = await fetchComps({
      apiKey: "k",
      year: 2021,
      make: "Chevrolet",
      model: "Traverse",
      mileageLo: 60000,
      mileageHi: 80000,
      zip: "84104",
      radiusMiles: 150,
      fetchImpl: async (url) =>
        url.includes("/recents") ? listings([20000]) : listings([24000, 25000, 26000]),
    });
    expect(set!.source).toBe("marketcheck_active");
    expect(set!.medianRetail).toBe(25000);
  });

  it("returns null (curve fallback) on auth failure, without throwing", async () => {
    const set = await fetchComps({
      apiKey: "bad",
      year: 2021,
      make: "Chevrolet",
      model: "Traverse",
      mileageLo: 0,
      mileageHi: 1,
      zip: "84104",
      radiusMiles: 150,
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    });
    expect(set).toBeNull();
  });
});
