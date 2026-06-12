/**
 * MarketCheck comp client — the PRIMARY valuation source (RULES #3a).
 *
 * Two operating modes (ARCHITECTURE §6):
 *   - REST driver (this file): fully unattended when a MARKETCHECK_KEY /
 *     settings.marketcheckKey exists. Sold comps beat asking comps.
 *   - Operator/MCP path: without a key (this deployment — user directive: no
 *     additional access), comps are fetched through the MarketCheck MCP tools
 *     connected to the build harness and written via comps.upsertComp into
 *     the same cache this client feeds. The scoring engine reads the cache
 *     identically either way.
 *
 * Clean-title comps only — salvage/rebuilt estValue anchors on clean comps
 * × 0.70 (standing override), never on other salvage listings.
 */

export interface CompSet {
  medianRetail: number;
  p25Retail: number;
  p75Retail: number;
  sampleSize: number;
  source: "marketcheck_sold" | "marketcheck_active";
}

const BASE = "https://mc-api.marketcheck.com/v2";
const RETRIES = 3;
const BACKOFF_MS = [2000, 4000];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function compSetFromPrices(
  prices: number[],
  source: CompSet["source"]
): CompSet | null {
  const sorted = prices.filter((p) => p > 500).sort((a, b) => a - b);
  if (sorted.length < 3) return null; // too thin to anchor a valuation
  return {
    medianRetail: Math.round(percentile(sorted, 0.5)),
    p25Retail: Math.round(percentile(sorted, 0.25)),
    p75Retail: Math.round(percentile(sorted, 0.75)),
    sampleSize: sorted.length,
    source,
  };
}

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

async function fetchJson(
  url: string,
  fetchImpl: FetchLike
): Promise<any | null> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) return await response.json();
      if (response.status >= 400 && response.status < 500) {
        console.error(JSON.stringify({ event: "marketcheck.client_error", status: response.status }));
        return null; // bad key / bad params — retries won't help
      }
      lastError = new Error(`marketcheck ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
    }
  }
  console.error(JSON.stringify({ event: "marketcheck.failed", error: String(lastError) }));
  return null;
}

function extractPrices(payload: any): number[] {
  const listings = payload?.listings;
  if (!Array.isArray(listings)) return [];
  return listings
    .map((l: any) => Number(l?.price))
    .filter((p: number) => Number.isFinite(p) && p > 0);
}

/**
 * Fetch clean-title comps for a YMM + mileage window near a zip.
 * Sold (last-90-days) comps win over active asking comps when both exist.
 */
export async function fetchComps(args: {
  apiKey: string;
  year: number;
  make: string;
  model: string;
  mileageLo: number;
  mileageHi: number;
  zip: string;
  radiusMiles: number;
  fetchImpl?: FetchLike;
}): Promise<CompSet | null> {
  const fetchImpl = args.fetchImpl ?? (fetch as unknown as FetchLike);
  const common =
    `api_key=${encodeURIComponent(args.apiKey)}` +
    `&year=${args.year}&make=${encodeURIComponent(args.make)}` +
    `&model=${encodeURIComponent(args.model)}` +
    `&miles_range=${args.mileageLo}-${args.mileageHi}` +
    `&zip=${args.zip}&radius=${args.radiusMiles}` +
    `&title_status=clean&car_type=used&rows=50&include_relevant_links=false`;

  // sold comps first — what cars actually brought
  const sold = await fetchJson(`${BASE}/search/car/recents?${common}`, fetchImpl);
  const soldSet = sold ? compSetFromPrices(extractPrices(sold), "marketcheck_sold") : null;
  if (soldSet) return soldSet;

  const active = await fetchJson(`${BASE}/search/car/active?${common}`, fetchImpl);
  return active
    ? compSetFromPrices(extractPrices(active), "marketcheck_active")
    : null;
}
