/**
 * Home: the ranked deal feed. Hottest first. Filters NARROW only when asked —
 * defaults show everything (standing user override: never hide a deal).
 */
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DealCard, type Listing } from "../components/DealCard";
import { DetailDrawer } from "../components/DetailDrawer";
import { EmptyState, SkeletonCard } from "../components/Primitives";

export interface FeedFilters {
  source?: string;
  minProfit?: number;
  minScore?: number;
  maxPrice?: number;
  maxDaysListed?: number;
  hotOnly?: boolean;
  specialsOnly?: boolean;
  sort?: string;
}

export function FeedView() {
  const [filters, setFilters] = useState<FeedFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [drawer, setDrawer] = useState<Id<"listings"> | null>(null);
  const feed = useQuery(api.listings.feed, filters);

  const activeFilterCount = Object.values(filters).filter(
    (value) => value !== undefined && value !== false && value !== "score"
  ).length;

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold">Deal feed</h2>
        <span className="text-sm text-zinc-500">{feed ? `${feed.length} cars` : "…"}</span>
        <button
          onClick={() => setShowFilters((s) => !s)}
          aria-expanded={showFilters}
          className="ml-auto rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-semibold hover:bg-zinc-700"
        >
          Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
        </button>
      </div>

      {showFilters && <FilterPanel filters={filters} onChange={setFilters} />}

      <div className="flex gap-1.5">
        <QuickChip
          label="🔥 Hot only"
          active={!!filters.hotOnly}
          onClick={() => setFilters((f) => ({ ...f, hotOnly: !f.hotOnly || undefined }))}
        />
        <QuickChip
          label="🔧 Specials"
          active={!!filters.specialsOnly}
          onClick={() => setFilters((f) => ({ ...f, specialsOnly: !f.specialsOnly || undefined }))}
        />
        <QuickChip
          label="▼ Best profit"
          active={filters.sort === "profit"}
          onClick={() => setFilters((f) => ({ ...f, sort: f.sort === "profit" ? undefined : "profit" }))}
        />
      </div>

      {feed === undefined && (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {feed && feed.length === 0 && (
        <EmptyState
          title="No deals match"
          body={
            activeFilterCount
              ? "Loosen the filters — nothing is hidden by default."
              : "The scans haven't found cars yet. They run every 15 minutes; check the Searches tab for last-run status."
          }
        />
      )}

      <div data-testid="feed-list" className="space-y-3">
        {feed?.map((listing: Listing) => (
          <DealCard key={listing._id} listing={listing} onOpen={() => setDrawer(listing._id)} />
        ))}
      </div>

      {drawer && <DetailDrawer listingId={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function QuickChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
    >
      {label}
    </button>
  );
}

function FilterPanel({
  filters,
  onChange,
}: {
  filters: FeedFilters;
  onChange: (f: FeedFilters) => void;
}) {
  const num = (value: string) => (value === "" ? undefined : Number(value));
  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3 sm:grid-cols-3">
      <Field label="Min profit $">
        <input
          type="number"
          inputMode="numeric"
          value={filters.minProfit ?? ""}
          onChange={(e) => onChange({ ...filters, minProfit: num(e.target.value) })}
          className="input"
          placeholder="any"
        />
      </Field>
      <Field label="Min score">
        <input
          type="number"
          inputMode="numeric"
          value={filters.minScore ?? ""}
          onChange={(e) => onChange({ ...filters, minScore: num(e.target.value) })}
          className="input"
          placeholder="any"
        />
      </Field>
      <Field label="Max price $">
        <input
          type="number"
          inputMode="numeric"
          value={filters.maxPrice ?? ""}
          onChange={(e) => onChange({ ...filters, maxPrice: num(e.target.value) })}
          className="input"
          placeholder="any"
        />
      </Field>
      <Field label="Max days listed">
        <input
          type="number"
          inputMode="numeric"
          value={filters.maxDaysListed ?? ""}
          onChange={(e) => onChange({ ...filters, maxDaysListed: num(e.target.value) })}
          className="input"
          placeholder="any"
        />
      </Field>
      <Field label="Sort">
        <select
          value={filters.sort ?? "score"}
          onChange={(e) => onChange({ ...filters, sort: e.target.value === "score" ? undefined : e.target.value })}
          className="input"
        >
          <option value="score">Score</option>
          <option value="profit">Profit</option>
          <option value="newest">Newest</option>
          <option value="price">Price ↑</option>
        </select>
      </Field>
      <div className="flex items-end">
        <button
          onClick={() => onChange({})}
          className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm font-semibold hover:bg-zinc-700"
        >
          Clear all
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}
