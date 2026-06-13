/**
 * Full listing detail: photos, profit math broken out line by line, comp
 * panel (source + sample size — its work shown), recon math table (every
 * line item, per RULES #3b — render the BREAKDOWN, never just reconSource),
 * price history, description, suggested target-buy / walk-away, decisions.
 *
 * Usage: <DetailDrawer listingId={id} onClose={() => setDrawer(null)} />
 * Mobile: full-screen slide-up. Desktop: right side panel.
 */
import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { days, miles, money, relativeTime } from "../lib/format";
import { AmberFlag, ErrorState, HotRibbon, ScoreChip, SourceBadge, SpecialBadge } from "./Primitives";

export function DetailDrawer({
  listingId,
  onClose,
}: {
  listingId: Id<"listings">;
  onClose: () => void;
}) {
  const listing = useQuery(api.listings.get, { listingId });
  const settings = useQuery(api.settings.get);
  const setDecision = useMutation(api.listings.setDecision);

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // focus management: move focus in on open, trap Tab inside the dialog,
  // hand focus back to the opener on close (M7 reviewer A5)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("button")?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel?.addEventListener("keydown", trap);
    return () => {
      panel?.removeEventListener("keydown", trap);
      opener?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose} role="dialog" aria-modal="true" aria-label="Listing detail">
      <div
        ref={panelRef}
        data-testid="detail-drawer"
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-800 bg-zinc-950/95 p-3 backdrop-blur">
          <button
            onClick={onClose}
            aria-label="Close detail"
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-semibold hover:bg-zinc-700"
          >
            ← Back
          </button>
          <span className="truncate text-sm font-semibold text-zinc-300">
            {listing?.title ?? "Loading…"}
          </span>
        </header>

        {listing === undefined && (
          <div className="space-y-3 p-4">
            <div className="skeleton h-52 w-full" />
            <div className="skeleton h-6 w-2/3" />
            <div className="skeleton h-32 w-full" />
          </div>
        )}
        {listing === null && (
          <div className="p-4">
            <ErrorState message="This listing no longer exists." />
          </div>
        )}

        {listing && (
          <div className="space-y-4 p-4">
            {/* photos */}
            {(listing.photos ?? []).length > 0 ? (
              <div className="thin-scroll flex gap-2 overflow-x-auto">
                {(listing.photos ?? []).map((url) => (
                  <img key={url} src={url} alt="" className="h-52 rounded-lg object-cover" />
                ))}
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg bg-zinc-900 text-5xl">🚗</div>
            )}

            {/* headline */}
            <div className="flex flex-wrap items-center gap-2">
              {listing.hot && <HotRibbon />}
              {listing.mechanicSpecial && <SpecialBadge />}
              <SourceBadge source={listing.source} />
              <ScoreChip score={listing.dealScore} />
              {listing.compSource === "curve" && (
                <AmberFlag label="curve value" title="Valued by the fallback depreciation curve — no market comps yet. Never auto-flagged HOT." />
              )}
            </div>
            <div>
              <p className="text-2xl font-extrabold tabular-nums">{money(listing.price)}</p>
              <p className="text-sm text-zinc-400">
                {miles(listing.mileage)} · {listing.location ?? "—"} · listed {days(listing.daysListed)} ·{" "}
                <span className={listing.titleStatus === "clean" ? "text-emerald-400" : "text-amber-400"}>
                  {listing.titleStatus ?? "unknown"} title
                </span>
              </p>
            </div>

            {/* decisions */}
            <div className="flex gap-2">
              {(["pursue", "pass", "contacted"] as const).map((decision) => (
                <button
                  key={decision}
                  onClick={() => void setDecision({ listingId: listing._id, decision })}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-bold capitalize ${
                    listing.decision === decision
                      ? decision === "pursue"
                        ? "bg-emerald-500 text-emerald-950"
                        : decision === "pass"
                          ? "bg-rose-500 text-rose-950"
                          : "bg-sky-500 text-sky-950"
                      : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                  }`}
                >
                  {decision}
                </button>
              ))}
            </div>

            {/* profit math, line by line */}
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
                Profit math
              </h4>
              <dl className="space-y-1 text-sm tabular-nums">
                <Row label="Estimated resale value" value={money(listing.estValue)} />
                <Row label="Asking price" value={`− ${money(listing.price)}`} />
                <Row label="Recon estimate" value={`− ${money(listing.estRecon)}`} />
                <Row label="Fees (title, transport, detail)" value={`− ${money(listing.estFees)}`} />
                <div className="border-t border-zinc-700 pt-1">
                  <Row
                    label="Estimated profit"
                    value={money(listing.estProfit)}
                    strong
                    color={(listing.estProfit ?? 0) >= (settings?.marginThreshold ?? 1500) ? "text-emerald-400" : (listing.estProfit ?? 0) >= 0 ? "text-emerald-600" : "text-rose-400"}
                  />
                </div>
              </dl>
              {listing.suggested && (
                <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg bg-emerald-950/60 p-2">
                    <p className="text-[11px] uppercase tracking-wide text-emerald-500">Target buy</p>
                    <p className="text-lg font-extrabold text-emerald-300 tabular-nums">
                      {money(listing.suggested.targetBuy)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-rose-950/50 p-2">
                    <p className="text-[11px] uppercase tracking-wide text-rose-500">Walk away</p>
                    <p className="text-lg font-extrabold text-rose-300 tabular-nums">
                      {money(listing.suggested.walkAway)}
                    </p>
                  </div>
                </div>
              )}
            </section>

            {/* comp panel — shows its work */}
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
                Where the value came from
              </h4>
              {listing.compSource ? (
                <p className="text-sm text-zinc-300">
                  {listing.compSource === "curve" ? (
                    <>Fallback <span className="font-semibold text-amber-400">depreciation curve</span> — no market comps cached for this car yet. Treat as a rough rank, verify before money moves.</>
                  ) : (
                    <>
                      <span className="font-semibold capitalize">{listing.compSource.replace("marketcheck_", "MarketCheck ")}</span>{" "}
                      comps · sample of <span className="font-bold">{listing.compSampleSize ?? "?"}</span>{" "}
                      {listing.compSource === "marketcheck_sold" ? "actual sales" : "listings"} near you
                    </>
                  )}
                </p>
              ) : (
                <p className="text-sm text-zinc-500">Not scored yet.</p>
              )}
            </section>

            {/* recon math — EVERY line item (RULES #3b) */}
            <section data-testid="recon-table" className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
                Recon math
              </h4>
              {listing.reconBreakdown?.length ? (
                <dl className="space-y-1 text-sm tabular-nums">
                  {listing.reconBreakdown.map((line, i) => (
                    <div key={i}>
                      <Row
                        label={line.label}
                        value={money(line.amount)}
                        color={line.amount < 0 ? "text-emerald-400" : undefined}
                      />
                      {line.meta && <p className="pl-1 text-[11px] text-zinc-500">{line.meta}</p>}
                    </div>
                  ))}
                  <div className="border-t border-zinc-700 pt-1">
                    <Row label="Total recon" value={money(listing.estRecon)} strong />
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-zinc-500">Not scored yet.</p>
              )}
            </section>

            {/* price history */}
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
                Price history
              </h4>
              <PriceHistory history={listing.priceHistory} />
            </section>

            {/* description */}
            {listing.description && (
              <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
                  Seller says
                </h4>
                <p className="whitespace-pre-wrap text-sm text-zinc-300">{listing.description}</p>
              </section>
            )}

            <a
              href={listing.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-xl bg-sky-600 py-3 text-center text-sm font-bold text-white hover:bg-sky-500"
            >
              View listing on {listing.source.toUpperCase()} ↗
            </a>
            <p className="pb-6 text-center text-[11px] text-zinc-500">
              first seen {relativeTime(listing.firstSeenAt)} · last seen {relativeTime(listing.lastSeenAt)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  color,
}: {
  label: string;
  value: string;
  strong?: boolean;
  color?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={`${strong ? "font-bold text-zinc-200" : "text-zinc-400"}`}>{label}</dt>
      <dd className={`${strong ? "text-base font-extrabold" : "font-semibold"} ${color ?? "text-zinc-200"}`}>
        {value}
      </dd>
    </div>
  );
}

/** Inline sparkline + list — no chart dependency. */
function PriceHistory({ history }: { history: { price: number; at: number }[] }) {
  if (history.length <= 1) {
    return <p className="text-sm text-zinc-500">No changes since first seen — {money(history[0]?.price)}.</p>;
  }
  const prices = history.map((h) => h.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(1, max - min);
  const points = prices
    .map((p, i) => `${(i / (prices.length - 1)) * 100},${30 - ((p - min) / span) * 26 + 2}`)
    .join(" ");
  return (
    <div>
      <svg viewBox="0 0 100 32" className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
        <polyline points={points} fill="none" stroke="rgb(52 211 153)" strokeWidth="1.5" />
      </svg>
      <ul className="mt-1 space-y-0.5 text-xs text-zinc-400 tabular-nums">
        {history.map((h, i) => (
          <li key={i} className="flex justify-between">
            <span>{new Date(h.at).toLocaleDateString()}</span>
            <span className={i > 0 && h.price < history[i - 1].price ? "font-bold text-emerald-400" : ""}>
              {money(h.price)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
