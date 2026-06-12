/**
 * §4 Step 2 recon estimation, with the parts-based override for drivetrain
 * failures (LOOP_PROMPT RECON section; RULES #3b). Pure — partsCosts medians
 * are passed in, already fetched.
 *
 * Order of operations:
 *   1. Base $400 always.
 *   2. Drivetrain classification from title+description text:
 *        engine keywords        -> partsCosts median(YMM, Engine) + $1,300 labor
 *        transmission keywords  -> partsCosts median(YMM, Transmission) + $900
 *        generic broken         -> the PRICIER component (by part price) + its
 *                                  labor — worst case protects margin
 *      When the YMM has no partsCosts data, fall back to §4's flat
 *      "doesn't start" bump (+$2,000) and flag reconSource:"keyword".
 *      Parts-based pricing REPLACES the §4 flat bumps for these cases —
 *      the doesn't-start/+needs-work bumps are not double-applied on top.
 *   3. Non-drivetrain §4 bumps apply as written: salvage/rebuilt +$2,500,
 *      accident/damage +$800, check engine +$600, new tires/brakes −$200,
 *      needs work/as-is +$1,000 (only when not consumed by a drivetrain
 *      classification).
 *
 * "won't start"/"doesn't run"/"dead" without a named component classifies as
 * generic drivetrain (rule 3's own examples) — worst case protects margin.
 */

export interface PartsCost {
  medianPrice: number;
  sampleSize: number;
  matchedYear: number;
}

export interface ReconLineItem {
  label: string;
  amount: number;
  meta?: string;
}

export interface ReconResult {
  estRecon: number;
  reconSource: "parts" | "keyword" | "base";
  reconBreakdown: ReconLineItem[];
}

export const BASE_RECON = 400;
export const ENGINE_LABOR = 1300;
export const TRANSMISSION_LABOR = 900;

// §4 Step 2 flat bumps (RULES #3 numbers)
export const BUMP_SALVAGE_REBUILT = 2500;
export const BUMP_DOESNT_START = 2000;
export const BUMP_NEEDS_WORK = 1000;
export const BUMP_ACCIDENT = 800;
export const BUMP_CHECK_ENGINE = 600;
export const CREDIT_NEW_TIRES_BRAKES = -200;

const ENGINE_RE =
  /\b(blown (engine|motor)|needs? (an? )?(new )?(engine|motor)|engine (is )?(blown|bad|gone|shot|knocking|seized)|motor (is )?(blown|bad|gone|shot|seized)|rod knock|knocking|no compression|spun bearing|cracked block|blown head ?gasket)\b/i;
const TRANS_RE =
  /\b(bad trans(mission)?|needs? (a )?(new )?trans(mission)?|trans(mission)? (is )?(bad|gone|out|slipping|shot)|slipping|won'?t shift|no (reverse|3rd|third) gear)\b/i;
const GENERIC_BROKEN_RE =
  /\b(mechanic'?s? special|doesn'?t run|does not run|won'?t start|doesn'?t start|not running|non.?running|won'?t run|as.?is,? broken|dead|needs? work to run)\b/i;
const ENGINE_CONTEXT_RE = /\b(engine|motor)\b/i;

const SALVAGE_REBUILT_RE = /\b(salvage|rebuilt|reconstructed|branded)\b/i;
const NEEDS_WORK_RE = /\b(needs? (some )?work|as.?is|fixer|project car)\b/i;
const ACCIDENT_RE = /\b(accident|wreck(ed)?|collision|(hail|body|front end|rear end|frame) damage|damaged?)\b/i;
const CHECK_ENGINE_RE = /\b(check engine|cel\b|engine light)\b/i;
const NEW_TIRES_BRAKES_RE = /\bnew (tires|brakes|tires and brakes|brakes and tires)\b/i;

export type DrivetrainIssue = "engine" | "transmission" | "generic" | null;

export function classifyDrivetrain(text: string): DrivetrainIssue {
  if (ENGINE_RE.test(text)) return "engine";
  if (TRANS_RE.test(text)) return "transmission";
  if (GENERIC_BROKEN_RE.test(text)) {
    // "won't start" with engine words nearby is an engine job (recon rule 1)
    if (ENGINE_CONTEXT_RE.test(text)) return "engine";
    return "generic";
  }
  return null;
}

export function computeRecon(args: {
  title: string | null | undefined;
  description: string | null | undefined;
  titleStatus: string | null | undefined;
  engineCost: PartsCost | null;
  transmissionCost: PartsCost | null;
}): ReconResult {
  const text = `${args.title ?? ""} ${args.description ?? ""}`;
  const lines: ReconLineItem[] = [
    { label: "Base recon (detail, title, transport)", amount: BASE_RECON },
  ];
  let source: ReconResult["reconSource"] = "base";

  const issue = classifyDrivetrain(text);
  let drivetrainPricedFromParts = false;

  if (issue) {
    const engine = args.engineCost;
    const trans = args.transmissionCost;
    let pick: { part: "Engine" | "Transmission"; cost: PartsCost; labor: number } | null =
      null;

    if (issue === "engine" && engine) {
      pick = { part: "Engine", cost: engine, labor: ENGINE_LABOR };
    } else if (issue === "transmission" && trans) {
      pick = { part: "Transmission", cost: trans, labor: TRANSMISSION_LABOR };
    } else if (issue === "generic" && (engine || trans)) {
      // worst case: pricier PART, its own labor; tie -> engine (higher labor)
      if (engine && (!trans || engine.medianPrice >= trans.medianPrice)) {
        pick = { part: "Engine", cost: engine, labor: ENGINE_LABOR };
      } else if (trans) {
        pick = { part: "Transmission", cost: trans, labor: TRANSMISSION_LABOR };
      }
    }

    if (pick) {
      drivetrainPricedFromParts = true;
      source = "parts";
      lines.push({
        label: `Used ${pick.part.toLowerCase()} (Grade-A median)`,
        amount: pick.cost.medianPrice,
        meta: `median of ${pick.cost.sampleSize} listings, model year ${pick.cost.matchedYear}${issue === "generic" ? "; worst-case component for unnamed failure" : ""}`,
      });
      lines.push({
        label: `${pick.part} labor (wholesale)`,
        amount: pick.labor,
      });
    } else {
      // YMM not in the dataset -> §4 flat bump, flagged (recon rule 4)
      source = "keyword";
      lines.push({
        label: "Drivetrain failure — flat §4 bump (no parts data for this YMM)",
        amount: BUMP_DOESNT_START,
      });
    }
  }

  // §4 non-drivetrain bumps as written (recon rule 5)
  const titleIsBranded =
    args.titleStatus === "salvage" || args.titleStatus === "rebuilt";
  if (titleIsBranded || SALVAGE_REBUILT_RE.test(text)) {
    lines.push({ label: "Salvage/rebuilt title (§4 bump)", amount: BUMP_SALVAGE_REBUILT });
  }
  if (!issue && NEEDS_WORK_RE.test(text)) {
    lines.push({ label: "Needs work / as-is (§4 bump)", amount: BUMP_NEEDS_WORK });
  }
  if (ACCIDENT_RE.test(text)) {
    lines.push({ label: "Accident / damage (§4 bump)", amount: BUMP_ACCIDENT });
  }
  if (CHECK_ENGINE_RE.test(text) && !drivetrainPricedFromParts && issue !== "engine") {
    lines.push({ label: "Check engine light (§4 bump)", amount: BUMP_CHECK_ENGINE });
  }
  if (NEW_TIRES_BRAKES_RE.test(text)) {
    lines.push({
      label: "New tires/brakes (§4 credit)",
      amount: CREDIT_NEW_TIRES_BRAKES,
    });
  }

  const estRecon = Math.max(
    0,
    Math.round(lines.reduce((sum, line) => sum + line.amount, 0))
  );
  return { estRecon, reconSource: source, reconBreakdown: lines };
}
