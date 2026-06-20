/**
 * KSL scraper (server-side) via Bright Data Web Unlocker.
 *
 * KSL is behind PerimeterX, so we fetch the human search page through the Web
 * Unlocker API (api.brightdata.com/request, Bearer auth) which solves the
 * challenge and renders from a residential exit, then extract KSL's listing
 * records from the Next.js RSC stream (self.__next_f pushes). This is a TS port
 * of scrapers/ksl_unlocker.py so the whole pipeline can run inside a Convex
 * action (24/7 on cron, no sandbox/Daytona).
 *
 * Env vars (Convex): BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE (default web_unlocker1)
 */

const BRD_API = "https://api.brightdata.com/request";

export interface KslSearchConfig {
  makes?: string[];
  models?: string[];
  yearMin?: number;
  yearMax?: number;
  mileageMin?: number;
  mileageMax?: number;
  priceMin?: number;
  priceMax?: number;
  zip?: string;
  radiusMiles?: number;
  cleanTitleOnly?: boolean;
  titleType?: string; // explicit KSL titleType filter, e.g. "Clean Title" | "Salvage Title;Rebuilt/Reconstructed Title"
  sort?: string; // default NEWEST_TO_OLDEST
}

export interface KslRawListing {
  sourceListingId: string;
  vin: string | null;
  price: number;
  mileage: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  title: string;
  sellerType: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  location: string | null;
  photoUrl: string | null;
  photos: string[];
  url: string;
  postedAt: number | null;
  titleStatus: string;
}

export function brightDataConfigured(): boolean {
  return !!process.env.BRIGHTDATA_API_TOKEN;
}

function buildSearchUrl(cfg: KslSearchConfig): string {
  const seg: string[] = [];
  const add = (name: string, value: string | number | undefined | null | string[]) => {
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) return;
    seg.push(name, Array.isArray(value) ? value.join(";") : String(value));
  };
  add("make", cfg.makes);
  add("model", cfg.models);
  add("yearFrom", cfg.yearMin);
  add("yearTo", cfg.yearMax);
  add("mileageFrom", cfg.mileageMin);
  add("mileageTo", cfg.mileageMax);
  add("priceFrom", cfg.priceMin);
  add("priceTo", cfg.priceMax);
  add("zip", cfg.zip);
  add("miles", cfg.radiusMiles);
  if (cfg.titleType) add("titleType", cfg.titleType);
  else if (cfg.cleanTitleOnly) add("titleType", "Clean Title");
  add("sellerType", "For Sale By Owner");
  add("sort", cfg.sort ?? "NEWEST_TO_OLDEST");
  const encoded = seg.map((s) => encodeURIComponent(s).replace(/%3B/g, ";").replace(/%2B/g, "+")).join("/");
  return "https://cars.ksl.com/search/" + encoded;
}

/** Decode the concatenated self.__next_f RSC string pushes. */
function decodeRscStream(html: string): string {
  const re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/g;
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out += JSON.parse(m[1]) as string;
    } catch {
      /* skip malformed chunk */
    }
  }
  return out;
}

/** String-aware brace matcher: returns the JSON object starting at s[start]==='{'. */
function extractObject(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

const KSL_TITLE_STATUS: Record<string, string> = {
  "clean title": "clean",
  "salvage title": "salvage",
  "rebuilt/reconstructed title": "rebuilt",
  "rebuilt title": "rebuilt",
  "reconstructed title": "rebuilt",
};

function epochMs(v: unknown): number | null {
  if (typeof v !== "number" || v <= 0) return null;
  return v > 1e12 ? Math.round(v) : Math.round(v * 1000);
}

function mapRecord(r: Record<string, unknown>): KslRawListing | null {
  const id = r.id;
  const price = r.price;
  if (id == null || typeof price !== "number" || price <= 0) return null;
  const loc = (r.location ?? {}) as Record<string, unknown>;
  const img = (r.primaryImage ?? {}) as Record<string, unknown>;
  const noImage = r.noImage === true;
  const photoUrl = !noImage && typeof img.url === "string" ? (img.url as string) : null;
  const city = typeof loc.city === "string" ? (loc.city as string) : null;
  const state = typeof loc.state === "string" ? (loc.state as string) : null;
  const zip = typeof loc.zip === "string" ? (loc.zip as string) : null;
  const titleTypeRaw = typeof r.titleType === "string" ? (r.titleType as string).toLowerCase() : "";
  const titleStatus = KSL_TITLE_STATUS[titleTypeRaw] ?? "unknown";
  const year = typeof r.makeYear === "number" ? (r.makeYear as number) : null;
  const make = typeof r.make === "string" ? (r.make as string) : null;
  const model = typeof r.model === "string" ? (r.model as string) : null;
  const trim = typeof r.trim === "string" ? (r.trim as string) : null;
  const vinRaw = typeof r.vin === "string" ? (r.vin as string).trim() : null;
  const vin = vinRaw && vinRaw.length >= 11 ? vinRaw.toUpperCase() : null;
  const title =
    (typeof r.title === "string" && r.title) ||
    [year, make, model, trim].filter(Boolean).join(" ") ||
    `KSL listing ${id}`;
  return {
    sourceListingId: String(id),
    vin,
    price,
    mileage: typeof r.mileage === "number" && r.mileage > 0 ? (r.mileage as number) : null,
    year,
    make,
    model,
    trim,
    title,
    sellerType: typeof r.sellerType === "string" ? (r.sellerType as string) : null,
    city,
    state,
    zip,
    location: [city, state].filter(Boolean).join(", ") || null,
    photoUrl,
    photos: photoUrl ? [photoUrl] : [],
    url: `https://cars.ksl.com/listing/${id}`,
    postedAt: epochMs(r.displayAt) ?? epochMs(r.createdAt),
    titleStatus,
  };
}

/**
 * Fetch a single listing's seller DESCRIPTION through the Web Unlocker.
 * The search page omits it, so "needs engine"/"blown motor"/"won't start" only
 * appears here. Reads the description out of the detail page's RSC stream.
 */
export async function fetchKslDescription(listingId: string): Promise<string | null> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token) throw new Error("BRIGHTDATA_API_TOKEN not set");
  const zone = process.env.BRIGHTDATA_ZONE ?? "web_unlocker1";
  const url = `https://cars.ksl.com/listing/${listingId}`;
  const resp = await fetch(BRD_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ zone, url, format: "raw" }),
  });
  if (!resp.ok) throw new Error(`Web Unlocker ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
  const html = await resp.text();
  const low = html.toLowerCase();
  if (low.includes("perimeterx") || low.includes("px2sz8xyop") || low.includes("access to this page has been denied")) {
    throw new Error("PerimeterX block returned by Web Unlocker");
  }
  const stream = decodeRscStream(html) || html;
  // Prefer the full CAR listing record, else fall back to any "description" key.
  const re = /\{"id":\d+,"listingType":"CAR"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream)) !== null) {
    const obj = extractObject(stream, m.index);
    if (!obj) continue;
    try {
      const rec = JSON.parse(obj) as Record<string, unknown>;
      if (typeof rec.description === "string" && rec.description.trim()) return rec.description;
    } catch {
      /* skip malformed record */
    }
  }
  const dm = stream.match(/"description":"((?:[^"\\]|\\.)*)"/);
  if (dm) {
    try {
      const v = JSON.parse('"' + dm[1] + '"') as string;
      if (v.trim()) return v;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Fetch one KSL search page through the Web Unlocker and return private-party listings. */
export async function fetchKslListings(cfg: KslSearchConfig): Promise<KslRawListing[]> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token) throw new Error("BRIGHTDATA_API_TOKEN not set");
  const zone = process.env.BRIGHTDATA_ZONE ?? "web_unlocker1";
  const url = buildSearchUrl(cfg);
  const resp = await fetch(BRD_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ zone, url, format: "raw" }),
  });
  if (!resp.ok) throw new Error(`Web Unlocker ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
  const html = await resp.text();
  const low = html.toLowerCase();
  if (low.includes("perimeterx") || low.includes("px2sz8xyop") || low.includes("access to this page has been denied")) {
    throw new Error("PerimeterX block returned by Web Unlocker");
  }
  const stream = decodeRscStream(html);
  const re = /\{"id":\d+,"listingType":"CAR"/g;
  const out: KslRawListing[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream)) !== null) {
    const objTxt = extractObject(stream, m.index);
    if (!objTxt) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(objTxt) as Record<string, unknown>;
    } catch {
      continue;
    }
    const mapped = mapRecord(rec);
    if (!mapped) continue;
    if (seen.has(mapped.sourceListingId)) continue;
    seen.add(mapped.sourceListingId);
    // private-party only
    if (mapped.sellerType && mapped.sellerType.toLowerCase().includes("dealer")) continue;
    out.push(mapped);
  }
  return out;
}

export { buildSearchUrl };
