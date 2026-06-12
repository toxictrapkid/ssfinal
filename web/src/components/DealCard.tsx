/**
 * One listing in the feed. Photo · YMM+trim · miles/distance/days · asking
 * price (big) · est value + est PROFIT (green/red) · score chip · badges ·
 * Pursue / Pass / Contacted. Tap anywhere else opens the detail drawer.
 *
 * Usage:
 *   <DealCard listing={l} onOpen={() => setDrawer(l._id)} />
 *
 * Memoized by listing identity + the fields that paint, so a feed update
 * re-renders only the cards that actually changed (M9 perf requirement).
 */
import { memo } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { days, distance, miles, money } from "../lib/format";
import {
  AmberFlag,
  HotRibbon,
  ScoreChip,
  SourceBadge,
  SpecialBadge,
} from "./Primitives";

export type Listing = Doc<"listings">;

function DealCardInner({ listing, onOpen }: { listing: Listing; onOpen: () => void }) {
  const setDecision = useMutation(api.listings.setDecision);
  const profit = listing.estProfit;
  const profitColor =
    profit === undefined
      ? "text-zinc-400"
      : profit >= 1500
        ? "text-emerald-400"
        : profit >= 0
          ? "text-emerald-600"
          : "text-rose-400";

  const decide = (decision: string) => (event: React.MouseEvent) => {
    event.stopPropagation();
    void setDecision({ listingId: listing._id, decision });
  };

  return (
    <article
      data-testid="deal-card"
      data-score={listing.dealScore ?? ""}
      data-title={listing.title}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      tabIndex={0}
      role="button"
      aria-label={`Open ${listing.title}`}
      className="flex cursor-pointer gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3 outline-none transition hover:border-zinc-600 focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
        {listing.photoUrl ? (
          <img
            src={listing.photoUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl">🚗</div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {listing.hot && <HotRibbon />}
          {listing.mechanicSpecial && <SpecialBadge />}
          <SourceBadge source={listing.source} />
          {listing.compSource === "curve" && (
            <AmberFlag label="curve value" title="No market comps yet — valued by the fallback depreciation curve. Verify before acting." />
          )}
          {listing.reconSource === "keyword" && (
            <AmberFlag label="keyword recon" title="No used-parts data for this car — recon estimated from §4 keyword bumps." />
          )}
          {listing.status === "price_drop" && (
            <span className="rounded bg-emerald-900/70 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-300">
              ▼ price drop
            </span>
          )}
        </div>

        <h3 className="mt-1 truncate font-semibold text-zinc-100">{listing.title}</h3>
        <p className="text-xs text-zinc-400">
          {miles(listing.mileage)} · {distance(listing.distanceMiles)} · listed {days(listing.daysListed)}
          {listing.titleStatus && listing.titleStatus !== "clean" && (
            <span className="ml-1 font-semibold text-amber-400">· {listing.titleStatus} title</span>
          )}
        </p>

        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="text-xl font-bold tabular-nums">{money(listing.price)}</span>
          <span className="text-xs text-zinc-400">
            est {money(listing.estValue)}
          </span>
          <span data-testid="card-profit" className={`text-sm font-bold tabular-nums ${profitColor}`}>
            {profit === undefined ? "scoring…" : `${profit >= 0 ? "+" : ""}${money(profit)} profit`}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <ScoreChip score={listing.dealScore} />
          <div className="ml-auto flex gap-1.5" aria-label="decisions">
            <button
              data-testid="pursue-btn"
              onClick={decide("pursue")}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold ${listing.decision === "pursue" ? "bg-emerald-500 text-emerald-950" : "bg-emerald-900/60 text-emerald-300 hover:bg-emerald-800"}`}
            >
              Pursue
            </button>
            <button
              onClick={decide("pass")}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold ${listing.decision === "pass" ? "bg-rose-500 text-rose-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
            >
              Pass
            </button>
            <button
              onClick={decide("contacted")}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold ${listing.decision === "contacted" ? "bg-sky-500 text-sky-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
            >
              Contacted
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export const DealCard = memo(
  DealCardInner,
  (prev, next) =>
    prev.listing._id === next.listing._id &&
    prev.listing.price === next.listing.price &&
    prev.listing.dealScore === next.listing.dealScore &&
    prev.listing.estProfit === next.listing.estProfit &&
    prev.listing.status === next.listing.status &&
    prev.listing.decision === next.listing.decision &&
    prev.listing.hot === next.listing.hot
);
