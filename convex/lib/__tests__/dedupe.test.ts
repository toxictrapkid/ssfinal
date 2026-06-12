import { describe, expect, it } from "vitest";
import { dedupeKeyFor, sha1Hex } from "../dedupe";

describe("sha1Hex (pinned to sha1sum vectors)", () => {
  it("matches sha1sum for the empty string", () => {
    expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });
  it('matches sha1sum for "abc"', () => {
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });
  it("matches sha1sum for a real dedupe input", () => {
    expect(sha1Hex("2021|chevrolet|traverse|78000|840")).toBe(
      "5324bea51e3bea001d5769bed4f252802c76fc93"
    );
  });
  it("handles inputs spanning the 64-byte block boundary", () => {
    // 119 chars: forces two-block padding path
    const long = "x".repeat(119);
    expect(sha1Hex(long)).toHaveLength(40);
    expect(sha1Hex(long)).not.toBe(sha1Hex("x".repeat(120)));
  });
});

describe("dedupeKeyFor (§5 formula)", () => {
  const base = {
    vin: null,
    year: 2021,
    make: "Chevrolet",
    model: "Traverse",
    mileage: 78214,
    zip: "84070",
    source: "ksl",
    sourceListingId: "9210001",
  };

  it("uses the VIN when present", () => {
    expect(dedupeKeyFor({ ...base, vin: "1gnergkw5mj100001 " })).toBe(
      "1GNERGKW5MJ100001"
    );
  });

  it("hashes year|make|model|round(mileage,-3)|zip3 when no VIN", () => {
    // 78214 -> 78000; zip3 840; make/model lowercased
    expect(dedupeKeyFor(base)).toBe("5324bea51e3bea001d5769bed4f252802c76fc93");
  });

  it("same car across sources and case gets the same key", () => {
    const fb = {
      ...base,
      source: "facebook",
      sourceListingId: "fb123",
      make: "chevrolet",
      model: "TRAVERSE",
      mileage: 77950, // rounds to the same 78000
    };
    expect(dedupeKeyFor(fb)).toBe(dedupeKeyFor(base));
  });

  it("mileage rounds half-up to the nearest thousand", () => {
    expect(dedupeKeyFor({ ...base, mileage: 132449 })).toBe(
      dedupeKeyFor({ ...base, mileage: 131500 })
    );
    expect(dedupeKeyFor({ ...base, mileage: 131499 })).not.toBe(
      dedupeKeyFor({ ...base, mileage: 131500 })
    );
  });

  it("falls back to source:id when a component is missing", () => {
    expect(dedupeKeyFor({ ...base, mileage: null })).toBe("ksl:9210001");
    expect(dedupeKeyFor({ ...base, zip: null })).toBe("ksl:9210001");
    expect(dedupeKeyFor({ ...base, year: null })).toBe("ksl:9210001");
  });

  it("rejects junk VINs (too short / 'Unknown' handled upstream)", () => {
    expect(dedupeKeyFor({ ...base, vin: "12345" })).toBe(
      dedupeKeyFor({ ...base, vin: null })
    );
  });
});
