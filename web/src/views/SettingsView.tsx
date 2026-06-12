/**
 * Settings: margin threshold, flat fees, alert contacts, FB session cookie
 * (for the source re-enable — never a password), Daytona/MarketCheck keys,
 * plus the recent-alert log (the in-app "provide it to me" surface) and
 * parts-data coverage stats.
 */
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { money, relativeTime } from "../lib/format";

type AlertRow = Doc<"alerts"> & { listing: Doc<"listings"> };
import { ErrorState } from "../components/Primitives";

export function SettingsView() {
  const settings = useQuery(api.settings.get);
  const partsStats = useQuery(api.partsCosts.stats);
  const alerts = useQuery(api.alerts.list, { limit: 25 });
  const update = useMutation(api.settings.update);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string> | null>(null);

  if (settings === undefined) {
    return (
      <div className="space-y-3 p-3">
        <div className="skeleton h-8 w-40" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }
  if (settings === null) {
    return (
      <div className="p-3">
        <ErrorState message="Settings not seeded yet — run `npm run seed` once." />
      </div>
    );
  }

  const current = form ?? {
    marginThreshold: String(settings.marginThreshold),
    feesFlat: String(settings.feesFlat),
    alertEmail: settings.alertEmail ?? "",
    alertPhone: settings.alertPhone ?? "",
    fbSessionCookie: settings.fbSessionCookie ?? "",
    marketcheckKey: settings.marketcheckKey ?? "",
  };
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setForm({ ...current, [key]: e.target.value });
  };

  const save = async () => {
    setError(null);
    try {
      await update({
        marginThreshold: Number(current.marginThreshold) || 1500,
        feesFlat: Number(current.feesFlat) || 400,
        alertEmail: current.alertEmail || undefined,
        alertPhone: current.alertPhone || undefined,
        fbSessionCookie: current.fbSessionCookie || undefined,
        marketcheckKey: current.marketcheckKey || undefined,
      });
      setSaved(true);
      setForm(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-3">
      <h2 className="text-lg font-bold">Settings</h2>
      {error && <ErrorState message={error} />}

      <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-400">Deal math</h3>
        <Field label="HOT threshold — min profit per unit ($)">
          <input type="number" value={current.marginThreshold} onChange={set("marginThreshold")} className="input" />
        </Field>
        <Field label="Flat fees per car ($ — title, transport, detail)">
          <input type="number" value={current.feesFlat} onChange={set("feesFlat")} className="input" />
        </Field>
      </section>

      <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-400">Alerts</h3>
        <Field label="Email (Resend key required to deliver)">
          <input value={current.alertEmail} onChange={set("alertEmail")} placeholder="you@example.com" className="input" />
        </Field>
        <Field label="Phone for SMS (Twilio keys required to deliver)">
          <input value={current.alertPhone} onChange={set("alertPhone")} placeholder="+1 801 …" className="input" />
        </Field>
        <p className="text-xs text-zinc-500">
          Without delivery keys, alerts still log below — nothing is lost.
        </p>
      </section>

      <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-400">Integrations</h3>
        <Field label="Facebook session cookie (for the FB source re-enable — never a password)">
          <textarea
            value={current.fbSessionCookie}
            onChange={set("fbSessionCookie")}
            rows={2}
            placeholder="paste cookie JSON here when re-enabling Facebook"
            className="input font-mono text-xs"
          />
        </Field>
        <Field label="MarketCheck API key (live comps without the operator)">
          <input value={current.marketcheckKey} onChange={set("marketcheckKey")} placeholder="optional" className="input font-mono text-xs" />
        </Field>
        {partsStats && (
          <p className="text-xs text-zinc-500">
            Parts-cost data: {partsStats.keys.toLocaleString()} year/model keys ({partsStats.engines} engines, {partsStats.transmissions} transmissions)
          </p>
        )}
      </section>

      <button
        onClick={() => void save()}
        className="w-full rounded-xl bg-sky-600 py-3 text-sm font-bold text-white hover:bg-sky-500"
      >
        {saved ? "Saved ✓" : "Save settings"}
      </button>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
          Recent alerts
        </h3>
        {alerts === undefined && <div className="skeleton h-20 w-full" />}
        {alerts && alerts.length === 0 && (
          <p className="text-sm text-zinc-500">No alerts yet — they appear the moment a hot deal or mechanic special lands.</p>
        )}
        <ul className="space-y-1.5">
          {alerts?.map((alert: AlertRow) => (
            <li key={alert._id} className="flex items-baseline gap-2 text-sm">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${alert.reason === "mechanic_special" ? "bg-purple-800 text-purple-100" : "bg-rose-700 text-white"}`}>
                {alert.reason === "mechanic_special" ? "🔧" : "🔥"}
              </span>
              <span className="truncate text-zinc-300">{alert.listing.title}</span>
              <span className="ml-auto shrink-0 text-xs text-zinc-500">
                {money(alert.listing.price)} · {relativeTime(alert.sentAt)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-400">{label}</span>
      {children}
    </label>
  );
}
