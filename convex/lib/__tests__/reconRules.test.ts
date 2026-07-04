import { describe, expect, it } from "vitest";
import {
  BASE_RECON,
  BUMP_ACCIDENT,
  BUMP_CHECK_ENGINE,
  BUMP_DOESNT_START,
  BUMP_NEEDS_WORK,
  BUMP_SALVAGE_REBUILT,
  CREDIT_NEW_TIRES_BRAKES,
  ENGINE_LABOR,
  TRANSMISSION_LABOR,
  classifyDrivetrain,
  computeRecon,
} from "../reconRules";

const ENGINE = { medianPrice: 2639, sampleSize: 248, matchedYear: 2019 };
const TRANS = { medianPrice: 1450, sampleSize: 96, matchedYear: 2019 };
const PRICIER_TRANS = { medianPrice: 3100, sampleSize: 40, matchedYear: 2018 };

const clean = (over: Partial<Parameters<typeof computeRecon>[0]> = {}) =>
  computeRecon({
    title: "2019 GMC Terrain SLE",
    description: "runs and drives great",
    titleStatus: "clean",
    engineCost: ENGINE,
    transmissionCost: TRANS,
    ...over,
  });

describe("spec constants (RULES #3/#3b — never drift)", () => {
  it("pins every number", () => {
    expect(BASE_RECON).toBe(400);
    expect(ENGINE_LABOR).toBe(1300);
    expect(TRANSMISSION_LABOR).toBe(900);
    expect(BUMP_SALVAGE_REBUILT).toBe(2500);
    expect(BUMP_DOESNT_START).toBe(2000);
    expect(BUMP_NEEDS_WORK).toBe(1000);
    expect(BUMP_ACCIDENT).toBe(800);
    expect(BUMP_CHECK_ENGINE).toBe(600);
    expect(CREDIT_NEW_TIRES_BRAKES).toBe(-200);
  });
});

describe("drivetrain classification", () => {
  it("engine phrases", () => {
    expect(classifyDrivetrain("blown engine, otherwise clean")).toBe("engine");
    expect(classifyDrivetrain("needs engine")).toBe("engine");
    expect(classifyDrivetrain("motor is knocking bad")).toBe("engine");
    expect(classifyDrivetrain("no compression cyl 3")).toBe("engine");
  });
  it("won't start WITH engine context is an engine job (recon rule 1)", () => {
    expect(classifyDrivetrain("won't start, engine cranks but no fire")).toBe("engine");
  });
  it("transmission phrases", () => {
    expect(classifyDrivetrain("bad trans, drives in 2nd only")).toBe("transmission");
    expect(classifyDrivetrain("needs transmission")).toBe("transmission");
    expect(classifyDrivetrain("slipping between gears")).toBe("transmission");
    expect(classifyDrivetrain("won't shift past 3rd")).toBe("transmission");
  });
  it("generic broken with no component named (recon rule 3)", () => {
    expect(classifyDrivetrain("mechanic special, doesn't run")).toBe("generic");
    expect(classifyDrivetrain("as-is, broken")).toBe("generic");
    expect(classifyDrivetrain("won't start")).toBe("generic");
  });
  it("healthy text classifies as nothing", () => {
    expect(classifyDrivetrain("runs and drives excellent")).toBe(null);
  });
  it("seller slang: 'tranny slips when cold' is a transmission job (advisory B)", () => {
    expect(classifyDrivetrain("tranny slips when cold")).toBe("transmission");
    expect(classifyDrivetrain("trans slips between gears")).toBe("transmission");
    expect(classifyDrivetrain("bad tranny")).toBe("transmission");
  });
  it("'dead battery' is NOT a drivetrain replacement (advisory A)", () => {
    expect(classifyDrivetrain("dead battery, needs a jump")).toBe(null);
    expect(classifyDrivetrain("found it dead in the driveway")).toBe("generic");
  });
  it("'dead pedal' (a footrest) is NOT a mechanic special", () => {
    expect(classifyDrivetrain("aftermarket dead pedal installed, runs great")).toBe(null);
  });
});

describe("parts-based recon (RULES #3b)", () => {
  it("'needs engine' = base + YMM engine median + $1,300 labor, source 'parts'", () => {
    const result = clean({ description: "Mechanic special. Doesn't run — needs engine." });
    expect(result.estRecon).toBe(400 + 2639 + 1300);
    expect(result.reconSource).toBe("parts");
    const labels = result.reconBreakdown.map((l) => l.label);
    expect(labels.some((l) => l.includes("Used engine"))).toBe(true);
    expect(result.reconBreakdown.find((l) => l.label.includes("Used engine"))!.meta).toContain(
      "median of 248 listings"
    );
  });

  it("'needs transmission' = base + trans median + $900 labor", () => {
    const result = clean({ description: "needs transmission, otherwise solid" });
    expect(result.estRecon).toBe(400 + 1450 + 900);
    expect(result.reconSource).toBe("parts");
  });

  it("generic 'mechanic special' takes the PRICIER component + its labor", () => {
    // engine 2639 > trans 1450 -> engine + engine labor
    const enginePricier = clean({ description: "mechanic special, doesn't run" });
    expect(enginePricier.estRecon).toBe(400 + 2639 + 1300);
    // trans 3100 > engine 2639 -> trans + trans labor
    const transPricier = clean({
      description: "mechanic special, doesn't run",
      transmissionCost: PRICIER_TRANS,
    });
    expect(transPricier.estRecon).toBe(400 + 3100 + 900);
    expect(transPricier.reconBreakdown.find((l) => l.label.includes("transmission"))!.meta).toContain(
      "worst-case component"
    );
  });

  it("parts pricing REPLACES the flat §4 doesn't-start bump (no double count)", () => {
    const result = clean({ description: "doesn't run, needs engine" });
    const labels = result.reconBreakdown.map((l) => l.label);
    expect(labels.some((l) => l.includes("flat §4 bump"))).toBe(false);
    expect(labels.some((l) => l.includes("Needs work"))).toBe(false);
  });

  it("YMM missing from dataset -> §4 flat bump, flagged 'keyword' (rule 4)", () => {
    const result = clean({
      description: "blown engine",
      engineCost: null,
      transmissionCost: null,
    });
    expect(result.estRecon).toBe(400 + 2000);
    expect(result.reconSource).toBe("keyword");
  });
});

describe("§4 non-drivetrain bumps as written (rule 5)", () => {
  it("clean healthy listing = base $400 only, source 'base'", () => {
    const result = clean();
    expect(result.estRecon).toBe(400);
    expect(result.reconSource).toBe("base");
    expect(result.reconBreakdown).toHaveLength(1);
  });
  it("salvage title bumps +2500 (on top of the 0.70 value haircut)", () => {
    const titleOnly = clean({ titleStatus: "salvage", description: "drives perfect" });
    expect(titleOnly.estRecon).toBe(400 + 2500);
    const withDamage = clean({
      titleStatus: "salvage",
      description: "hail damage salvage, drives perfect",
    });
    expect(withDamage.estRecon).toBe(400 + 2500 + 800); // + damage wording
  });
  it("accident/damage +800, check engine +600, needs work +1000", () => {
    expect(clean({ description: "minor accident, fixed" }).estRecon).toBe(400 + 800);
    expect(clean({ description: "check engine light on" }).estRecon).toBe(400 + 600);
    expect(clean({ description: "needs some work, as-is" }).estRecon).toBe(400 + 1000);
  });
  it("new tires/brakes credit −200", () => {
    expect(clean({ description: "new tires last month" }).estRecon).toBe(400 - 200);
  });
  it("recon never goes negative", () => {
    const result = computeRecon({
      title: null,
      description: "new tires new brakes",
      titleStatus: "clean",
      engineCost: null,
      transmissionCost: null,
    });
    expect(result.estRecon).toBeGreaterThanOrEqual(0);
  });
  it("drivetrain + branded title stack: engine parts + salvage bump", () => {
    const result = clean({
      titleStatus: "rebuilt",
      description: "rebuilt title, needs engine",
    });
    expect(result.estRecon).toBe(400 + 2639 + 1300 + 2500);
    expect(result.reconSource).toBe("parts");
  });
});

describe("check-engine bump vs. the priced drivetrain job", () => {
  it("transmission job + an unrelated CEL still adds +600 (a trans repair doesn't cover an engine-side light)", () => {
    const result = clean({ description: "needs transmission, and the check engine light is on" });
    expect(result.estRecon).toBe(400 + 1450 + 900 + 600);
    expect(result.reconSource).toBe("parts");
  });
  it("engine job + CEL does NOT double-count the +600 (the engine repair subsumes it)", () => {
    const result = clean({ description: "blown engine; check engine light on" });
    expect(result.estRecon).toBe(400 + 2639 + 1300);
  });
  it("keyword-only engine failure (no parts data) + CEL still suppresses the +600", () => {
    const result = clean({
      description: "blown engine, check engine light on",
      engineCost: null,
      transmissionCost: null,
    });
    expect(result.estRecon).toBe(400 + 2000); // flat doesn't-start bump, no extra CEL
    expect(result.reconSource).toBe("keyword");
  });
  it("a CEL with no drivetrain failure still adds +600", () => {
    const result = clean({ description: "check engine light on, otherwise runs fine" });
    expect(result.estRecon).toBe(400 + 600);
  });
});
