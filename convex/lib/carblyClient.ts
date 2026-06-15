/**
 * Carbly book-value client with AUTO-LOGIN (server-side, used from the scan action).
 *
 * Carbly allows only one active device per account, so a static token gets
 * "bumped" whenever another device (your phone/browser) uses Carbly. To stay
 * reliable for automation we log in fresh at the start of each run
 * (POST /v6/auth/sign_in, devise_token_auth) and use that session's headers for
 * every call — reclaiming the slot each time.
 *
 * Per-VIN flow once authed:
 *   POST /v6/vehicles {vin, mileage}  -> creates/values, returns uuid
 *   GET  /v6/vehicles/{uuid}          -> full_valuations (mileage-adjusted books)
 *   JD Power (NADA) clean trade-in = full_valuations.nada.results[0].appraisal.clean.tradein.adjusted
 *   KBB lending                    = full_valuations.kbb.results[0].appraisal.lending.adjusted
 *
 * Env vars (Convex): CARBLY_EMAIL, CARBLY_PASSWORD, CARBLY_FOLDER_ID
 * NOTE: auto-login bumps your personal Carbly app each run — use a dedicated
 * Carbly login for the scanner if you also use Carbly yourself.
 */

const CARBLY_BASE = "https://api.getcarbly.com";
const SFX = "?platform=web&app_version=6.7.4";

export interface CarblySession {
  accessToken: string;
  client: string;
  uid: string;
}

export interface CarblyValuation {
  jdCleanTrade: number | null;
  kbbLending: number | null;
  uuid: string | null;
  /** True when Carbly rejected the lookup with its daily add/rate limit ("Limit Reached"). */
  limited?: boolean;
}

function sessionHeaders(s: CarblySession): Record<string, string> {
  return {
    "access-token": s.accessToken,
    client: s.client,
    uid: s.uid,
    "token-type": "Bearer",
    Authorization: `Bearer ${s.accessToken}`,
    Origin: "https://web.getcarbly.com",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

export function carblyConfigured(): boolean {
  return !!(process.env.CARBLY_EMAIL && process.env.CARBLY_PASSWORD);
}

/** Log in fresh and return a session (reclaims the single-device slot). */
export async function carblyLogin(): Promise<CarblySession | null> {
  const email = process.env.CARBLY_EMAIL;
  const password = process.env.CARBLY_PASSWORD;
  if (!email || !password) return null;
  try {
    const r = await fetch(`${CARBLY_BASE}/v6/auth/sign_in${SFX}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://web.getcarbly.com", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) return null;
    const accessToken = r.headers.get("access-token");
    const client = r.headers.get("client");
    const uid = r.headers.get("uid") ?? email;
    if (!accessToken || !client) return null;
    return { accessToken, client, uid };
  } catch {
    return null;
  }
}

/** File a Carbly vehicle into the "KSL leads" folder (CARBLY_FOLDER_ID). */
export async function assignToFolder(uuid: string, session: CarblySession): Promise<boolean> {
  const fid = process.env.CARBLY_FOLDER_ID;
  if (!fid || !uuid) return false;
  try {
    const r = await fetch(`${CARBLY_BASE}/v6/vehicles/${uuid}${SFX}`, {
      method: "PATCH",
      headers: sessionHeaders(session),
      body: JSON.stringify({ vehicle_folder_id: Number(fid) }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function nodeValue(node: unknown): number | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  const v = typeof n.adjusted === "number" ? n.adjusted : typeof n.base === "number" ? n.base : null;
  return typeof v === "number" && v > 0 ? Math.round(v) : null;
}

/** JD clean trade-in + KBB lending for a VIN at mileage. Never throws. */
export async function carblyLookup(
  vin: string,
  mileage: number | null,
  session: CarblySession
): Promise<CarblyValuation> {
  const empty: CarblyValuation = { jdCleanTrade: null, kbbLending: null, uuid: null };
  try {
    const body: Record<string, unknown> = { vin };
    if (mileage && mileage > 0) body.mileage = mileage;
    const post = await fetch(`${CARBLY_BASE}/v6/vehicles${SFX}`, {
      method: "POST",
      headers: sessionHeaders(session),
      body: JSON.stringify(body),
    });
    if (!post.ok) {
      // Carbly's daily add/rate limit returns 422 {"errors":["Limit Reached"]}.
      // Signal it so the scan backs off instead of hammering a wall every tick.
      if (post.status === 422) {
        const txt = await post.text().catch(() => "");
        if (txt.includes("Limit Reached")) return { ...empty, limited: true };
      }
      return empty;
    }
    const created = (await post.json()) as Record<string, unknown>;
    const cdata = (created.data ?? created) as Record<string, unknown>;
    const uuid = typeof cdata.uuid === "string" ? cdata.uuid : null;
    if (!uuid) return empty;

    const det = await fetch(`${CARBLY_BASE}/v6/vehicles/${uuid}${SFX}`, { headers: sessionHeaders(session) });
    if (!det.ok) return { ...empty, uuid };
    const dj = (await det.json()) as Record<string, unknown>;
    const d = (dj.data ?? dj) as Record<string, unknown>;
    const fv = (d.full_valuations ?? {}) as Record<string, unknown>;
    const nada = fv.nada as Record<string, unknown> | undefined;
    const kbb = fv.kbb as Record<string, unknown> | undefined;
    const nadaApp = (nada?.results as Record<string, unknown>[] | undefined)?.[0]?.appraisal as Record<string, unknown> | undefined;
    const kbbApp = (kbb?.results as Record<string, unknown>[] | undefined)?.[0]?.appraisal as Record<string, unknown> | undefined;
    const jdNode = (nadaApp?.clean as Record<string, unknown> | undefined)?.tradein;
    const kbbNode = kbbApp?.lending;
    return { jdCleanTrade: nodeValue(jdNode), kbbLending: nodeValue(kbbNode), uuid };
  } catch {
    return empty;
  }
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

// Buy-box thresholds (user rule 2026-06-15):
//   QUALIFY: price <= reference book + $750 (within $750 over, or anything below)
//   CONTACT NOW (hot): price >= $1,000 under the reference book(s)
//   clean -> reference = higher of JD clean trade / KBB lending; contact-now needs under BOTH
//   branded/salvage -> books at 70%, decision FOCUSES on JD clean trade
export const QUALIFY_ABOVE = 750;
export const CONTACT_NOW_UNDER = 1000;
export const BRANDED_FACTOR = 0.7;

export function applyGapRule(
  price: number,
  val: CarblyValuation,
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
