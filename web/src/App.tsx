import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

type Listing = Doc<"listings">;

/* ============================ helpers ============================ */
const IMG_FALLBACK =
  "data:image/svg+xml;charset=utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#E6EAF0"/><g fill="none" stroke="#AEB7C4" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" transform="translate(140,120)"><path d="M2 26l4-12a4 4 0 0 1 3.8-2.6h40.4A4 4 0 0 1 54 14l4 12"/><path d="M6 34h52"/><circle cx="14" cy="34" r="3.2"/><circle cx="46" cy="34" r="3.2"/></g><text x="200" y="205" font-family="sans-serif" font-size="14" fill="#AEB7C4" text-anchor="middle">No photo available</text></svg>'
  );

const money = (n: number | null | undefined) =>
  n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US");
const milesFmt = (n: number | null | undefined) =>
  n && n > 0 ? n.toLocaleString("en-US") + " mi" : "—";
const titleOf = (l: Listing) =>
  l.title || [l.year, l.make, l.model, l.trim].filter(Boolean).join(" ") || "Listing";
const photosOf = (l: Listing): string[] => {
  const p = (l.photos && l.photos.length ? l.photos : l.photoUrl ? [l.photoUrl] : []) as string[];
  return p.filter(Boolean);
};
const titleBadge = (s?: string) => {
  if (!s) return null;
  const k = s.toLowerCase();
  if (k === "salvage") return "Salvage title";
  if (k === "rebuilt") return "Rebuilt title";
  if (k === "branded") return "Branded title";
  return null;
};
const scoreColor = (score?: number) => {
  if (score == null) return "var(--ink-3)";
  if (score >= 70) return "var(--green)";
  if (score >= 45) return "var(--amber)";
  return "var(--ink-3)";
};

/* deal badges from real CarHunter fields */
function cardBadges(l: Listing): { cls: string; txt: string }[] {
  const b: { cls: string; txt: string }[] = [];
  if (l.hot) b.push({ cls: "hot", txt: "⚡ CONTACT NOW" });
  if (l.estProfit != null && l.estProfit > 0) b.push({ cls: "profit", txt: "+" + money(l.estProfit) });
  if (l.mechanicSpecial) b.push({ cls: "special", txt: "Mechanic special" });
  const tb = titleBadge(l.titleStatus);
  if (tb) b.push({ cls: "title", txt: tb });
  return b.slice(0, 3);
}

/* ============================ icons ============================ */
const Ic = {
  search: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
  ),
  gauge: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 14l3-3" /><path d="M3.5 19a9 9 0 1 1 17 0" /><circle cx="12" cy="14" r="1.3" fill="currentColor" stroke="none" /></svg>
  ),
  car: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5" /><path d="M5 17h14" /><circle cx="7.5" cy="17" r="1.4" /><circle cx="16.5" cy="17" r="1.4" /></svg>
  ),
  pin: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.4" /></svg>
  ),
  clock: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  ),
  copy: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
  ),
  heart: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20s-7-4.6-9.3-9A5.2 5.2 0 0 1 12 6a5.2 5.2 0 0 1 9.3 5C19 15.4 12 20 12 20z" /></svg>
  ),
  ext: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg>
  ),
  note: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M14 3v5h5" /><path d="M8 13h7M8 16h5" /></svg>
  ),
  x: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
  ),
  chevL: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
  ),
  chevR: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
  ),
  check: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
  ),
  logo: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5" /><path d="M5 17h14" /><circle cx="7.5" cy="17" r="1.6" /><circle cx="16.5" cy="17" r="1.6" /></svg>
  ),
};

/* ============================ localStorage state ============================ */
type Status = "watching" | "contacted" | "negotiating" | "bought" | "passed";
const STATUSES: Status[] = ["watching", "contacted", "negotiating", "bought", "passed"];
const statusColor: Record<Status, string> = {
  watching: "var(--primary)",
  contacted: "#7A5BF8",
  negotiating: "var(--amber)",
  bought: "var(--green)",
  passed: "var(--ink-3)",
};
function lsGet<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}
function lsSet(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/* ============================ App ============================ */
export default function App() {
  const listings = useQuery(api.listings.feed, { limit: 300 });

  const [view, setView] = useState<"all" | "contact" | "saved">("all");
  const [q, setQ] = useState("");
  const [make, setMake] = useState("");
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [maxMiles, setMaxMiles] = useState<number | null>(null);
  const [sort, setSort] = useState("score");

  const [saved, setSaved] = useState<string[]>(() => lsGet<string[]>("apex_saved", []));
  const [notes, setNotes] = useState<Record<string, string>>(() => lsGet("apex_notes", {}));
  const [status, setStatus] = useState<Record<string, Status>>(() => lsGet("apex_status", {}));
  const [current, setCurrent] = useState<Listing | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => lsSet("apex_saved", saved), [saved]);
  useEffect(() => lsSet("apex_notes", notes), [notes]);
  useEffect(() => lsSet("apex_status", status), [status]);

  const toastTmr = useRef<number | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    if (toastTmr.current) window.clearTimeout(toastTmr.current);
    toastTmr.current = window.setTimeout(() => setToast(null), 1700);
  }
  function toggleSave(id: string) {
    const adding = !saved.includes(id);
    setSaved((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    showToast(adding ? "Added to watchlist" : "Removed from watchlist");
  }
  function copyVin(vin: string) {
    if (navigator.clipboard?.writeText)
      navigator.clipboard.writeText(vin).then(() => showToast("VIN copied"), () => {});
    else showToast("VIN copied");
  }

  const makes = useMemo(() => {
    const set = new Set<string>();
    (listings ?? []).forEach((l) => l.make && set.add(l.make));
    return Array.from(set).sort();
  }, [listings]);

  const filtered = useMemo(() => {
    let list = (listings ?? []).slice();
    if (view === "contact") list = list.filter((l) => l.hot);
    if (view === "saved")
      list = list.filter((l) => saved.includes(l._id) || (notes[l._id] || "").trim() || status[l._id]);
    const term = q.trim().toLowerCase();
    if (term)
      list = list.filter((l) =>
        (titleOf(l) + " " + (l.vin || "") + " " + (l.location || "")).toLowerCase().includes(term)
      );
    if (make) list = list.filter((l) => l.make === make);
    if (maxPrice) list = list.filter((l) => l.price <= maxPrice);
    if (maxMiles) list = list.filter((l) => (l.mileage || 0) > 0 && (l.mileage || 0) <= maxMiles);
    list.sort((a, b) => {
      switch (sort) {
        case "profit":
          return (b.estProfit ?? -Infinity) - (a.estProfit ?? -Infinity);
        case "plow":
          return a.price - b.price;
        case "phigh":
          return b.price - a.price;
        case "mlow":
          return (a.mileage || 1e9) - (b.mileage || 1e9);
        case "ynew":
          return (b.year ?? 0) - (a.year ?? 0);
        case "newest":
          return b.firstSeenAt - a.firstSeenAt;
        default:
          return (b.dealScore ?? -1) - (a.dealScore ?? -1);
      }
    });
    return list;
  }, [listings, view, saved, notes, status, q, make, maxPrice, maxMiles, sort]);

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (q) chips.push({ key: "q", label: `“${q}”`, clear: () => setQ("") });
  if (make) chips.push({ key: "make", label: make, clear: () => setMake("") });
  if (maxPrice) chips.push({ key: "mp", label: "≤ " + money(maxPrice), clear: () => setMaxPrice(null) });
  if (maxMiles) chips.push({ key: "mm", label: "≤ " + maxMiles.toLocaleString() + " mi", clear: () => setMaxMiles(null) });

  function reset() {
    setQ(""); setMake(""); setMaxPrice(null); setMaxMiles(null); setSort("score");
  }

  return (
    <>
      <header className="top">
        <div className="top-inner">
          <div className="brand">
            <div className="logo">{Ic.logo}</div>
            <div>
              <h1>APEX</h1>
              <div className="sub">Deal Radar</div>
            </div>
          </div>
          <div className="search">
            {Ic.search}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search make, model, trim or VIN…" autoComplete="off" />
          </div>
          <div className="seg" role="tablist">
            <button className={view === "all" ? "active" : ""} onClick={() => setView("all")}>All deals</button>
            <button className={view === "contact" ? "active" : ""} onClick={() => setView("contact")}>
              Contact Now <span className="pill">{(listings ?? []).filter((l) => l.hot).length}</span>
            </button>
            <button className={view === "saved" ? "active" : ""} onClick={() => setView("saved")}>
              Watchlist <span className="pill">{saved.length}</span>
            </button>
          </div>
        </div>

        <div className="filters">
          <div className="field"><label>Make</label>
            <select className="ctrl" value={make} onChange={(e) => setMake(e.target.value)}>
              <option value="">All makes</option>
              {makes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="field"><label>Max price</label>
            <input className="ctrl tnum" type="number" inputMode="numeric" placeholder="Any"
              value={maxPrice ?? ""} onChange={(e) => setMaxPrice(e.target.value ? +e.target.value : null)} />
          </div>
          <div className="field"><label>Max miles</label>
            <input className="ctrl tnum" type="number" inputMode="numeric" placeholder="Any"
              value={maxMiles ?? ""} onChange={(e) => setMaxMiles(e.target.value ? +e.target.value : null)} />
          </div>
          <div className="field"><label>Sort</label>
            <select className="ctrl" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="score">Best deal score</option>
              <option value="profit">Most profit</option>
              <option value="newest">Newest listed</option>
              <option value="plow">Price: low → high</option>
              <option value="phigh">Price: high → low</option>
              <option value="mlow">Miles: low → high</option>
              <option value="ynew">Year: new → old</option>
            </select>
          </div>
          <button className="btn-reset" onClick={reset}>Reset</button>
          <div className="spacer" />
          <div className="count"><b>{filtered.length}</b> vehicles</div>
        </div>

        {chips.length > 0 && (
          <div className="chips">
            {chips.map((c) => (
              <span className="chip" key={c.key}>{c.label}
                <button onClick={c.clear} aria-label="Remove">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </span>
            ))}
          </div>
        )}
      </header>

      <main>
        {listings === undefined ? (
          <div className="grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div className="skel" key={i}>
                <div className="ph" />
                <div className="body"><div className="ln" style={{ width: "70%" }} /><div className="ln" style={{ width: "45%" }} /><div className="ln" style={{ width: "60%" }} /></div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <div className="ic">{Ic.search}</div>
            <h3>{view === "saved" ? "Your watchlist is empty" : view === "contact" ? "No Contact-Now deals yet" : "No matches"}</h3>
            <p>{view === "saved" ? "Tap the heart on any car, or add a note, to track it here." : view === "contact" ? "Cars priced $1,000+ under both books land here automatically." : "Try widening your filters or clearing the search."}</p>
          </div>
        ) : (
          <div className="grid">
            {filtered.map((l) => (
              <Card key={l._id} l={l} saved={saved.includes(l._id)} status={status[l._id]} hasNote={!!(notes[l._id] || "").trim()}
                onOpen={() => setCurrent(l)} onSave={() => toggleSave(l._id)} onCopy={copyVin} />
            ))}
          </div>
        )}
      </main>

      <div className={"overlay" + (current ? " show" : "")} onClick={() => setCurrent(null)} />
      {current && (
        <Drawer
          l={current}
          saved={saved.includes(current._id)}
          status={status[current._id]}
          note={notes[current._id] || ""}
          onClose={() => setCurrent(null)}
          onSave={() => toggleSave(current._id)}
          onCopy={copyVin}
          onStatus={(k) =>
            setStatus((s) => {
              const next = { ...s };
              if (next[current._id] === k) delete next[current._id];
              else next[current._id] = k;
              return next;
            })
          }
          onNote={(v) => setNotes((n) => ({ ...n, [current._id]: v }))}
        />
      )}

      <div className={"toast" + (toast ? " show" : "")}>{Ic.check}{toast}</div>
    </>
  );
}

/* ============================ Card ============================ */
function Card({ l, saved, status, hasNote, onOpen, onSave, onCopy }: {
  l: Listing; saved: boolean; status?: Status; hasNote: boolean;
  onOpen: () => void; onSave: () => void; onCopy: (vin: string) => void;
}) {
  const photos = photosOf(l);
  const bs = cardBadges(l);
  return (
    <article className="card" onClick={onOpen}>
      <div className="ph">
        <img src={photos[0] || IMG_FALLBACK} loading="lazy" alt={titleOf(l)}
          onError={(e) => { const t = e.currentTarget; t.onerror = null; t.src = IMG_FALLBACK; }} />
        <div className="scrim" />
        <div className="badges">{bs.map((b, i) => <span className={"bdg " + b.cls} key={i}>{b.txt}</span>)}</div>
        <button className={"heart" + (saved ? " on" : "")} onClick={(e) => { e.stopPropagation(); onSave(); }} aria-label="Save">{Ic.heart}</button>
        <div className="price tnum">{money(l.price)}</div>
      </div>
      <div className="body">
        <div className="ttl">{titleOf(l)}</div>
        <div className="specs">
          <span className="s">{Ic.gauge}<span className="tnum">{milesFmt(l.mileage)}</span></span>
          {l.distanceMiles != null && <span className="s">{Ic.pin}{Math.round(l.distanceMiles)} mi away</span>}
          <span className="s">{Ic.car}{l.titleStatus && l.titleStatus !== "unknown" ? l.titleStatus : "title n/a"}</span>
        </div>
        <div className="meta">
          <span className="s" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>{Ic.pin}{l.location || "—"}</span>
          <span className="s" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>{Ic.clock}{l.daysListed ?? 0}d listed</span>
        </div>
        {l.vin && (
          <div className="vin">VIN {l.vin}
            <button onClick={(e) => { e.stopPropagation(); onCopy(l.vin!); }} title="Copy VIN">{Ic.copy}</button>
          </div>
        )}
        <div className="cfoot">
          <a className="lnk" href={l.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{Ic.ext}View listing</a>
          {status ? (
            <span className="score-pill" style={{ color: statusColor[status], borderColor: statusColor[status] + "33" }}>
              <span className="dot" style={{ background: statusColor[status] }} />{status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
          ) : (
            <span className="score-pill"><span className="dot" style={{ background: scoreColor(l.dealScore) }} />
              {l.dealScore != null ? "Score " + Math.round(l.dealScore) : hasNote ? "Noted" : Ic.note}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/* ============================ Drawer ============================ */
function Drawer({ l, saved, status, note, onClose, onSave, onCopy, onStatus, onNote }: {
  l: Listing; saved: boolean; status?: Status; note: string;
  onClose: () => void; onSave: () => void; onCopy: (vin: string) => void;
  onStatus: (k: Status) => void; onNote: (v: string) => void;
}) {
  const photos = photosOf(l);
  const [gi, setGi] = useState(0);
  const [savedFlag, setSavedFlag] = useState(false);
  const flagTmr = useRef<number | null>(null);
  useEffect(() => setGi(0), [l._id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const profitNeg = (l.estProfit ?? 0) <= 0;
  const tb = titleBadge(l.titleStatus);
  const facts: { k: string; v: string; cls?: string }[] = [
    { k: "Year", v: l.year ? String(l.year) : "—" },
    { k: "Mileage", v: milesFmt(l.mileage) },
    { k: "Trim", v: l.trim || "—" },
    { k: "Title", v: l.titleStatus && l.titleStatus !== "unknown" ? l.titleStatus : "Not stated" },
    { k: "Est. resale value", v: money(l.estValue) },
    { k: "Est. profit", v: (l.estProfit != null && l.estProfit > 0 ? "+" : "") + money(l.estProfit), cls: l.estProfit == null ? "" : l.estProfit > 0 ? "green" : "rose" },
    { k: "Deal score", v: l.dealScore != null ? String(Math.round(l.dealScore)) + " / 100" : "—" },
    { k: "Distance", v: l.distanceMiles != null ? Math.round(l.distanceMiles) + " mi" : "—" },
  ];

  return (
    <aside className="drawer show">
      <div className="d-head">
        <div className="t">{titleOf(l)}</div>
        <button className="iconbtn" onClick={onClose} aria-label="Close">{Ic.x}</button>
      </div>
      <div className="d-scroll">
        <div className="gal">
          <img src={photos[gi] || IMG_FALLBACK} alt="" onError={(e) => { const t = e.currentTarget; t.onerror = null; t.src = IMG_FALLBACK; }} />
          {photos.length > 1 && (
            <>
              <button className="nav prev" onClick={() => setGi((i) => (i - 1 + photos.length) % photos.length)}>{Ic.chevL}</button>
              <button className="nav next" onClick={() => setGi((i) => (i + 1) % photos.length)}>{Ic.chevR}</button>
              <div className="gcount">{gi + 1} / {photos.length}</div>
            </>
          )}
        </div>
        {photos.length > 1 && (
          <div className="thumbs">
            {photos.map((p, i) => (
              <img key={i} src={p} className={i === gi ? "on" : ""} onClick={() => setGi(i)} onError={(e) => { e.currentTarget.style.display = "none"; }} />
            ))}
          </div>
        )}
        <div className="d-pad">
          <div className="d-title-row">
            <div className="d-title">{titleOf(l)}</div>
            <div className="d-price tnum">{money(l.price)}</div>
          </div>
          <div className="d-sub">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>{Ic.pin}{l.location || "—"}{l.distanceMiles != null ? ` · ${Math.round(l.distanceMiles)} mi away` : ""}</span>
          </div>
          <div className="d-badges">
            {l.hot && <span className="d-bdg hot">⚡ Contact now</span>}
            {l.estProfit != null && <span className={"d-bdg profit" + (profitNeg ? " neg" : "")}>{(l.estProfit > 0 ? "+" : "") + money(l.estProfit)} est. profit</span>}
            {l.mechanicSpecial && <span className="d-bdg special">Mechanic special</span>}
            {tb && <span className="d-bdg title">{tb}</span>}
            {(l.daysListed ?? 0) >= 30 && <span className="d-bdg stale">{Ic.clock} On market {l.daysListed}d</span>}
          </div>

          <div className="facts">
            {facts.map((f, i) => (
              <div className="fact" key={i}>
                <div className="k">{f.k}</div>
                <div className={"v" + (f.cls ? " " + f.cls : "")}>{f.v}</div>
              </div>
            ))}
            {l.vin && (
              <div className="fact mono" style={{ gridColumn: "1 / -1" }}>
                <div className="k">VIN</div>
                <div className="v">{l.vin}<button onClick={() => onCopy(l.vin!)} title="Copy VIN">{Ic.copy}</button></div>
              </div>
            )}
          </div>

          {l.description && (<><div className="sect-t">Seller description</div><p className="desc">{l.description}</p></>)}

          <div className="d-actions">
            <a className="btn primary" href={l.url} target="_blank" rel="noopener noreferrer">{Ic.ext}View live listing</a>
            <button className={"btn ghost" + (saved ? " on" : "")} onClick={onSave} title="Save to watchlist">{Ic.heart}</button>
          </div>

          <div className="sect-t">Pipeline status</div>
          <div className="status-row">
            {STATUSES.map((k) => (
              <button key={k} className={"sbtn" + (status === k ? " on" : "")} data-k={k} onClick={() => onStatus(k)}>
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </button>
            ))}
          </div>

          <div className="notes-wrap">
            <div className="notes-head">
              <div className="sect-t" style={{ margin: 0 }}>My notes</div>
              <span className={"saved" + (savedFlag ? " show" : "")}>{Ic.check} Saved</span>
            </div>
            <textarea className="notes" value={note} placeholder="Inspection notes, asking vs. offer, recon costs, target resale, who to call…"
              onChange={(e) => {
                onNote(e.target.value);
                setSavedFlag(true);
                if (flagTmr.current) window.clearTimeout(flagTmr.current);
                flagTmr.current = window.setTimeout(() => setSavedFlag(false), 1100);
              }} />
          </div>
        </div>
      </div>
    </aside>
  );
}
