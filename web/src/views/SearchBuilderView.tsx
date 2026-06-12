/**
 * Search Builder: the saved scans/buy-boxes that run on a schedule. Shows
 * last-run time, last error, and # new deals per search; create/edit via an
 * inline form. Leaving makes/models EMPTY scans the whole market — the
 * default posture (never pre-filter a deal away).
 */
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { relativeTime } from "../lib/format";
import { EmptyState } from "../components/Primitives";

type Search = Doc<"searches">;

const BLANK = {
  name: "",
  sources: ["ksl"],
  location: "Salt Lake City, UT",
  zip: "84104",
  radiusMiles: 150,
  priceMin: 500,
  priceMax: 28000,
  yearMin: 2000,
  yearMax: 2027,
  mileageMin: 0,
  mileageMax: 400000,
  makes: [] as string[],
  models: [] as string[],
  maxDaysListed: 30,
  cleanTitleOnly: false,
  intervalMinutes: 15,
};

export function SearchBuilderView() {
  const searches = useQuery(api.searches.list);
  const toggleActive = useMutation(api.searches.toggleActive);
  const remove = useMutation(api.searches.remove);
  const [editing, setEditing] = useState<Search | "new" | null>(null);

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold">Searches</h2>
        <button
          onClick={() => setEditing("new")}
          className="ml-auto rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-sky-500"
        >
          + New search
        </button>
      </div>

      {editing && (
        <SearchForm
          initial={editing === "new" ? BLANK : editing}
          searchId={editing === "new" ? null : editing._id}
          onDone={() => setEditing(null)}
        />
      )}

      {searches?.length === 0 && (
        <EmptyState title="No searches" body="Create one — empty makes/models scans the whole market." />
      )}

      <div className="space-y-2">
        {searches
          ?.sort(
            (a: Search, b: Search) =>
              Number(b.active) - Number(a.active) || b.createdAt - a.createdAt
          )
          .map((search: Search) => (
            <div
              key={search._id}
              className={`rounded-xl border p-3 ${search.active ? "border-zinc-700 bg-zinc-900" : "border-zinc-800 bg-zinc-950 opacity-60"}`}
            >
              <div className="flex items-center gap-2">
                <h3 className="truncate font-semibold">{search.name}</h3>
                <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={search.active}
                    onChange={(e) => void toggleActive({ searchId: search._id, active: e.target.checked })}
                    className="h-4 w-4 accent-emerald-500"
                  />
                  active
                </label>
              </div>
              <p className="mt-0.5 text-xs text-zinc-400">
                {search.makes.length ? search.makes.join(", ") : "All makes"} · $
                {search.priceMin.toLocaleString()}–${search.priceMax.toLocaleString()} ·{" "}
                {search.radiusMiles} mi of {search.zip} · every {search.intervalMinutes} min
                {search.cleanTitleOnly && " · clean title only"}
              </p>
              <p className="mt-1 text-xs">
                <span className="text-zinc-500">last run {relativeTime(search.lastRunAt)}</span>
                {search.newDealsLastRun !== undefined && (
                  <span className="ml-2 text-emerald-500">+{search.newDealsLastRun} new</span>
                )}
                {search.lastError && (
                  <span className="ml-2 text-rose-400" title={search.lastError}>
                    ⚠ {search.lastError.slice(0, 60)}…
                  </span>
                )}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setEditing(search)}
                  className="rounded-lg bg-zinc-800 px-2.5 py-1 text-xs font-semibold hover:bg-zinc-700"
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${search.name}"?`)) void remove({ searchId: search._id });
                  }}
                  className="rounded-lg bg-zinc-800 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-950"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function SearchForm({
  initial,
  searchId,
  onDone,
}: {
  initial: typeof BLANK | Search;
  searchId: Id<"searches"> | null;
  onDone: () => void;
}) {
  const create = useMutation(api.searches.create);
  const update = useMutation(api.searches.update);
  const [form, setForm] = useState({
    name: initial.name,
    zip: initial.zip,
    radiusMiles: initial.radiusMiles,
    priceMin: initial.priceMin,
    priceMax: initial.priceMax,
    yearMin: initial.yearMin,
    yearMax: initial.yearMax,
    mileageMin: initial.mileageMin,
    mileageMax: initial.mileageMax,
    makes: initial.makes.join(", "),
    models: initial.models.join(", "),
    cleanTitleOnly: initial.cleanTitleOnly,
    intervalMinutes: initial.intervalMinutes,
  });
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!form.name.trim()) {
      setError("Give the search a name.");
      return;
    }
    const payload = {
      name: form.name.trim(),
      sources: ["ksl"],
      location: "Salt Lake City, UT",
      zip: form.zip,
      radiusMiles: Number(form.radiusMiles),
      priceMin: Number(form.priceMin),
      priceMax: Number(form.priceMax),
      yearMin: Number(form.yearMin),
      yearMax: Number(form.yearMax),
      mileageMin: Number(form.mileageMin),
      mileageMax: Number(form.mileageMax),
      makes: form.makes.split(",").map((s) => s.trim()).filter(Boolean),
      models: form.models.split(",").map((s) => s.trim()).filter(Boolean),
      maxDaysListed: 30,
      cleanTitleOnly: form.cleanTitleOnly,
      intervalMinutes: Number(form.intervalMinutes),
    };
    try {
      if (searchId) await update({ searchId, ...payload });
      else await create(payload);
      onDone();
    } catch (e) {
      setError(String(e));
    }
  };

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({
      ...f,
      [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  return (
    <div className="space-y-2 rounded-xl border border-sky-900 bg-zinc-900 p-3">
      <h3 className="font-bold">{searchId ? "Edit search" : "New search"}</h3>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <input value={form.name} onChange={set("name")} placeholder="Name" className="input" />
      <div className="grid grid-cols-2 gap-2">
        <input value={form.makes} onChange={set("makes")} placeholder="Makes (empty = all)" className="input" />
        <input value={form.models} onChange={set("models")} placeholder="Models (empty = all)" className="input" />
        <input value={form.zip} onChange={set("zip")} placeholder="ZIP" className="input" />
        <input type="number" value={form.radiusMiles} onChange={set("radiusMiles")} placeholder="Radius mi" className="input" />
        <input type="number" value={form.priceMin} onChange={set("priceMin")} placeholder="Price min" className="input" />
        <input type="number" value={form.priceMax} onChange={set("priceMax")} placeholder="Price max" className="input" />
        <input type="number" value={form.yearMin} onChange={set("yearMin")} placeholder="Year min" className="input" />
        <input type="number" value={form.yearMax} onChange={set("yearMax")} placeholder="Year max" className="input" />
        <input type="number" value={form.mileageMin} onChange={set("mileageMin")} placeholder="Miles min" className="input" />
        <input type="number" value={form.mileageMax} onChange={set("mileageMax")} placeholder="Miles max" className="input" />
        <input type="number" value={form.intervalMinutes} onChange={set("intervalMinutes")} placeholder="Every N min" className="input" />
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={form.cleanTitleOnly} onChange={set("cleanTitleOnly")} className="h-4 w-4 accent-emerald-500" />
          clean title only
        </label>
      </div>
      <div className="flex gap-2">
        <button onClick={() => void submit()} className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-bold text-white hover:bg-sky-500">
          {searchId ? "Save" : "Create"}
        </button>
        <button onClick={onDone} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-semibold hover:bg-zinc-700">
          Cancel
        </button>
      </div>
    </div>
  );
}
