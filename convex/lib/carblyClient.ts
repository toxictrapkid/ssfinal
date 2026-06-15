/**
 * Carbly book-value client (server-side, used from the scan action).
 *
 * Carbly authenticates with Rails devise_token_auth headers (access-token /
 * client / uid). The token in the user's account is long-lived. Per-VIN flow:
 *   POST /v6/vehicles {vin, mileage}  -> creates/values the vehicle, returns uuid
 *   GET  /v6/vehicles/{uuid}          -> full_valuations with every book
 *
 * We extract the two books the deal rule uses, mileage-adjusted:
 *   - JD Power (NADA) clean trade-in  = full_valuations.nada.results[0].appraisal.clean.tradein.adjusted
 *   - KBB lending                     = full_valuations.kbb.results[0].appraisal.lending.adjusted
 *
 * Credentials come from Convex env vars (never committed):
 *   CARBLY_ACCESS_TOKEN, CARBLY_CLIENT, CARBLY_UID
 */

const CARBLY_BASE = "https://api.getcarbly.com";
const SFX = "?platform=web&app_version=6.7.4";

export interface CarblyValuation {
  jdCleanTrade: number | null; // JD Power / NADA clean trade-in (mileage adjusted)
  kbbLending: number | null; // KBB lending (mileage adjusted)
  uuid: string | null;
}

function headers(): Record<string, string> {
  const accessToken = process.env.CARBLY_ACCESS_TOKEN ?? "";
  const client = process.env.CARBLY_CLIENT ?? "";
  const uid = process.env.CARBLY_UID ?? "";
  return {
    "access-token": accessToken,
    client,
    uid,
    "token-type": "Bearer",
    Origin: "https://web.getcarbly.com",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

export function carblyConfigured(): boolean {
  return !!(process.env.CARBLY_ACCESS_TOKEN && process.env.CARBLY_CLIENT && process.env.CARBLY_UID);
}

/** Pull the mileage-adjusted (falling back to base) value out of an appraisal node. */
function nodeValue(node: unknown): number | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  const v = typeof n.adjusted === "number" ? n.adjusted : typeof n.base === "number" ? n.base : null;
  return typeof v === "number" && v > 0 ? Math.round(v) : null;
}

/**
 * Look up JD clean trade-in + KBB lending for a VIN at the given mileage.
 * Returns nulls (not throwing) on any failure so one bad VIN never breaks a scan.
 */
export async function carblyLookup(vin: string, mileage: number | null): Promise<CarblyValuation> {
  const empty: CarblyValuation = { jdCleanTrade: null, kbbLending: null, uuid: null };
  if (!carblyConfigured()) return empty;
  try {
    const body: Record<string, unknown> = { vin };
    if (mileage && mileage > 0) body.mileage = mileage;
    const post = await fetch(`${CARBLY_BASE}/v6/vehicles${SFX}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!post.ok) return empty;
    const created = (await post.json()) as Record<string, unknown>;
    const cdata = (created.data ?? created) as Record<string, unknown>;
    const uuid = typeof cdata.uuid === "string" ? cdata.uuid : null;
    if (!uuid) return empty;

    const det = await fetch(`${CARBLY_BASE}/v6/vehicles/${uuid}${SFX}`, { headers: headers() });
    if (!det.ok) return { ...empty, uuid };
    const dj = (await det.json()) as Record<string, unknown>;
    const d = (dj.data ?? dj) as Record<string, unknown>;
    const fv = (d.full_valuations ?? {}) as Record<string, unknown>;

    const nada = fv.nada as Record<string, unknown> | undefined;
    const kbb = fv.kbb as Record<string, unknown> | undefined;
    const nadaApp = (nada?.results as Record<string, unknown>[] | undefined)?.[0]?.appraisal as
      | Record<string, unknown>
      | undefined;
    const kbbApp = (kbb?.results as Record<string, unknown>[] | undefined)?.[0]?.appraisal as
      | Record<string, unknown>
      | undefined;

    const jdNode = (nadaApp?.clean as Record<string, unknown> | undefined)?.tradein;
    const kbbNode = kbbApp?.lending;

    return {
      jdCleanTrade: nodeValue(jdNode),
      kbbLending: nodeValue(kbbNode),
      uuid,
    };
  } catch {
    return empty;
  }
}

export interface GapResult {
  effJd: number | null; // title-adjusted JD clean trade
  effKbb: number | null; // title-adjusted KBB lending
  jdGap: number | null; // effJd - price
  kbbGap: number | null; // effKbb - price
  qualifies: boolean;
  hot: boolean;
  bestGap: number; // estValue - price (can be slightly negative for marginal qualifiers)
  estValue: number | null; // higher adjusted book, for display
}

// Buy-box thresholds (user rule 2026-06-15):
//   qualify: price <= max(adjusted books) + $500  (in range of the books, or up to $500 over either)
//   HOT:     price is way below BOTH adjusted books (>= HOT_UNDER under each)
//   branded title (salvage/rebuilt): books discounted to 70%
export const QUALIFY_ABOVE = 500;
export const HOT_UNDER = 1500;
export const BRANDED_FACTOR = 0.7;

/** factor: 1.0 for clean title, 0.7 for salvage/rebuilt. */
export function applyGapRule(price: number, val: CarblyValuation, factor = 1.0): GapResult {
  const effJd = val.jdCleanTrade != null ? Math.round(val.jdCleanTrade * factor) : null;
  const effKbb = val.kbbLending != null ? Math.round(val.kbbLending * factor) : null;
  const jdGap = effJd != null ? effJd - price : null;
  const kbbGap = effKbb != null ? effKbb - price : null;
  const books = [effJd, effKbb].filter((b): b is number => b != null);
  const estValue = books.length ? Math.max(...books) : null;
  const bestGap = estValue != null ? estValue - price : -Infinity;
  // qualify: within range of / up to $500 above the higher book
  const qualifies = estValue != null && price <= estValue + QUALIFY_ABOVE;
  // hot: way below BOTH books
  const hot = jdGap != null && kbbGap != null && jdGap >= HOT_UNDER && kbbGap >= HOT_UNDER;
  return { effJd, effKbb, jdGap, kbbGap, qualifies, hot, bestGap: Number.isFinite(bestGap) ? bestGap : 0, estValue };
}
