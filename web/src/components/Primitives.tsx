/**
 * Small shared primitives. Usage:
 *   <ScoreChip score={l.dealScore} />
 *   <SourceBadge source="ksl" />
 *   <AmberFlag label="curve value" title="explanation" />
 *   <EmptyState title="No deals yet" body="…" />
 *   <ErrorState message="…" />
 *   <SkeletonCard /> (loading placeholder, same height as a DealCard)
 */
import { scoreTier } from "../lib/format";

export function ScoreChip({ score }: { score: number | null | undefined }) {
  const tier = scoreTier(score);
  return (
    <span
      data-testid="score-chip"
      title="Deal score 0–100 (profit, margin, freshness, mileage fit, title)"
      className={`inline-flex min-w-9 items-center justify-center rounded-full px-2 py-0.5 text-sm font-bold tabular-nums ${tier.chip}`}
    >
      {tier.label}
    </span>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const styles =
    source === "ksl"
      ? "bg-sky-900 text-sky-200"
      : "bg-indigo-900 text-indigo-200";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${styles}`}>
      {source}
    </span>
  );
}

export function AmberFlag({ label, title }: { label: string; title: string }) {
  return (
    <span
      title={title}
      className="rounded border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-300"
    >
      ⚠ {label}
    </span>
  );
}

export function HotRibbon() {
  return (
    <span
      data-testid="hot-ribbon"
      className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-widest text-white"
    >
      Hot
    </span>
  );
}

export function SpecialBadge() {
  return (
    <span
      data-testid="special-badge"
      title="Mechanic special — you review every one of these (recon math inside)"
      className="rounded bg-purple-700 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-purple-100"
    >
      🔧 Special
    </span>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-800 p-10 text-center">
      <p className="text-lg font-semibold text-zinc-300">{title}</p>
      <p className="max-w-sm text-sm text-zinc-500">{body}</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-300">
      {message}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="flex gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      <div className="skeleton h-24 w-24 shrink-0" />
      <div className="flex-1 space-y-2 py-1">
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-3 w-1/2" />
        <div className="skeleton h-6 w-1/3" />
      </div>
    </div>
  );
}
