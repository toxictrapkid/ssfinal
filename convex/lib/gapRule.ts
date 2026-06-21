/**
 * Buy-box gap rule — pure valuation math, source-agnostic.
 *
 * Given a price and book values (JD clean trade-in + KBB lending), decide whether
 * a car qualifies for the buy-box and whether it's a HOT (Contact-Now) deal.
 * Extracted from the former Carbly client so it stands alone; the Laser bridge
 * (convex/laser.ts) and any future valuation source use it identically.
 *
 * Thresholds (user rule 2026-06-15):
 *   QUALIFY: price <= reference book + $750 (within $750 over, or anything below)
 *   HOT    : price >= $1,000 under the reference book(s)
 *   clean  -> reference = higher of JD clean trade / KBB lending; HOT needs under BOTH
 *   branded/salvage -> books at 70%, decision focuses on JD clean trade
 */

export interface BookValuation {
  jdCleanTrade: number | null;
  kbbLending: number | null;
  uuid?: string | null;
}

export interface GapResult {
  effJd: number | null;
  effKbb: number | null;
  jdGap: number | null;
  kbbGap: number | null;
  qualifies: boolean;
  hot: boolean;
  bestGap: number;
  estValue: number | null;
}

export const QUALIFY_ABOVE = 750;
export const CONTACT_NOW_UNDER = 1000;
export const BRANDED_FACTOR = 0.7;

export function applyGapRule(
  price: number,
  val: BookValuation,
  opts: { factor?: number; branded?: boolean } = {}
): GapResult {
  const factor = opts.factor ?? 1.0;
  const branded = opts.branded ?? factor < 1.0;
  const effJd = val.jdCleanTrade != null ? Math.round(val.jdCleanTrade * factor) : null;
  const effKbb = val.kbbLending != null ? Math.round(val.kbbLending * factor) : null;
  const jdGap = effJd != null ? effJd - price : null;
  const kbbGap = effKbb != null ? effKbb - price : null;

  let qualifies = false;
  let hot = false;
  let estValue: number | null = null;
  if (branded) {
    const ref = effJd ?? effKbb;
    const refGap = effJd != null ? jdGap : kbbGap;
    estValue = ref;
    qualifies = ref != null && price <= ref + QUALIFY_ABOVE;
    hot = refGap != null && refGap >= CONTACT_NOW_UNDER;
  } else {
    const books = [effJd, effKbb].filter((b): b is number => b != null);
    estValue = books.length ? Math.max(...books) : null;
    qualifies = estValue != null && price <= estValue + QUALIFY_ABOVE;
    hot = jdGap != null && kbbGap != null && jdGap >= CONTACT_NOW_UNDER && kbbGap >= CONTACT_NOW_UNDER;
  }
  const bestGap = estValue != null ? estValue - price : 0;
  return { effJd, effKbb, jdGap, kbbGap, qualifies, hot, bestGap, estValue };
}
