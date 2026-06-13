/**
 * App shell: sticky header + content + bottom tab bar (mobile-first — the
 * user works this from the lot). Desktop gets the same tabs, top-aligned.
 */
import { Component, useState, type ReactNode } from "react";
import { FeedView } from "./views/FeedView";
import { SpecialsView } from "./views/SpecialsView";
import { PipelineView } from "./views/PipelineView";
import { SearchBuilderView } from "./views/SearchBuilderView";
import { SettingsView } from "./views/SettingsView";

const TABS = [
  { id: "feed", label: "Feed", icon: "🏁" },
  { id: "specials", label: "Specials", icon: "🔧" },
  { id: "pipeline", label: "Pipeline", icon: "📋" },
  { id: "searches", label: "Searches", icon: "🔍" },
  { id: "settings", label: "Settings", icon: "⚙️" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<TabId>("feed");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-2.5">
          <h1 className="text-base font-extrabold tracking-tight">
            🎯 CarHunter
          </h1>
          <span className="text-xs text-zinc-400">undervalued cars, found for you</span>
          <nav className="ml-auto hidden gap-1 sm:flex" aria-label="Sections">
            {TABS.map((t) => (
              <TabButton key={t.id} tab={t} active={tab === t.id} onClick={() => setTab(t.id)} />
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 pb-20 sm:pb-6">
        <ErrorBoundary>
          {tab === "feed" && <FeedView />}
          {tab === "specials" && <SpecialsView />}
          {tab === "pipeline" && <PipelineView />}
          {tab === "searches" && <SearchBuilderView />}
          {tab === "settings" && <SettingsView />}
        </ErrorBoundary>
      </main>

      {/* mobile bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-zinc-800 bg-zinc-950/95 backdrop-blur sm:hidden"
        aria-label="Sections"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${
              tab === t.id ? "text-sky-400" : "text-zinc-400"
            }`}
          >
            <span className="text-base leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function TabButton({
  tab,
  active,
  onClick,
}: {
  tab: (typeof TABS)[number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={`tab-${tab.id}-desktop`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {tab.icon} {tab.label}
    </button>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-md p-6">
          <div className="rounded-xl border border-rose-900 bg-rose-950/40 p-4">
            <p className="font-bold text-rose-300">Something broke in the UI.</p>
            <p className="mt-1 text-sm text-rose-400">{String(this.state.error)}</p>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-3 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-semibold text-zinc-200"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
