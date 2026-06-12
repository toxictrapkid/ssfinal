/** Shared display formatters. Keep ALL business math in Convex — these only
 * render fields the backend computed. */

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
}

export function miles(value: number | null | undefined): string {
  if (!value) return "— mi";
  return value >= 1000
    ? `${Math.round(value / 1000)}k mi`
    : `${value.toLocaleString()} mi`;
}

export function days(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value === 0) return "today";
  return value === 1 ? "1 day" : `${value} days`;
}

export function distance(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value)} mi away`;
}

export function relativeTime(epochMs: number | null | undefined): string {
  if (!epochMs) return "never";
  const deltaSeconds = Math.max(0, (Date.now() - epochMs) / 1000);
  if (deltaSeconds < 60) return "just now";
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

/** Score tier → color classes (chip + ring). */
export function scoreTier(score: number | null | undefined): {
  chip: string;
  label: string;
} {
  if (score === null || score === undefined)
    return { chip: "bg-zinc-700 text-zinc-300", label: "—" };
  if (score >= 70) return { chip: "bg-emerald-500 text-emerald-950", label: String(score) };
  if (score >= 45) return { chip: "bg-amber-400 text-amber-950", label: String(score) };
  return { chip: "bg-zinc-700 text-zinc-200", label: String(score) };
}
