/**
 * Kanban pipeline: Lead → Contacted → Negotiating → Bought → Flipped → Dead.
 * Drag cards between stages (pointer-based, e2e-testable) or use the
 * keyboard-accessible stage menu on each card. Cards show target-buy /
 * walk-away and an inline notes field.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { money } from "../lib/format";
import { DetailDrawer } from "../components/DetailDrawer";
import { EmptyState } from "../components/Primitives";

const STAGES = ["lead", "contacted", "negotiating", "bought", "flipped", "dead"] as const;
const STAGE_LABEL: Record<string, string> = {
  lead: "Lead",
  contacted: "Contacted",
  negotiating: "Negotiating",
  bought: "Bought",
  flipped: "Flipped",
  dead: "Dead",
};

type BoardRow = {
  _id: Id<"pipeline">;
  stage: string;
  targetBuy?: number;
  walkAway?: number;
  notes?: string;
  listing: {
    _id: Id<"listings">;
    title: string;
    price: number;
    estProfit?: number;
    photoUrl?: string;
  };
};

export function PipelineView() {
  const board = useQuery(api.pipeline.board) as Record<string, BoardRow[]> | undefined;
  const moveStage = useMutation(api.pipeline.moveStage);
  const [drawer, setDrawer] = useState<Id<"listings"> | null>(null);
  const [dragging, setDragging] = useState<Id<"pipeline"> | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const columnAt = (x: number, y: number): string | null => {
    for (const stage of STAGES) {
      const el = columnRefs.current[stage];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return stage;
    }
    return null;
  };

  const onPointerDown = (pipelineId: Id<"pipeline">) => (e: React.PointerEvent) => {
    // left button / touch only; let buttons inside the card work normally
    if ((e.target as HTMLElement).closest("button,select,textarea,a")) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(pipelineId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDropTarget(columnAt(e.clientX, e.clientY));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    const stage = columnAt(e.clientX, e.clientY);
    if (stage) void moveStage({ pipelineId: dragging, stage });
    setDragging(null);
    setDropTarget(null);
  };

  const total = board ? Object.values(board).reduce((n, rows) => n + rows.length, 0) : 0;

  return (
    <div className="space-y-3 p-3" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div>
        <h2 className="text-lg font-bold">Pipeline</h2>
        <p className="text-sm text-zinc-400">
          Drag cards between stages, or use each card's stage menu.
        </p>
      </div>

      {board && total === 0 && (
        <EmptyState
          title="Nothing in the pipeline"
          body="Hit Pursue on a deal in the feed and it lands here as a Lead with suggested target-buy and walk-away numbers."
        />
      )}

      <div className="thin-scroll flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((stage) => (
          <div
            key={stage}
            ref={(el) => {
              columnRefs.current[stage] = el;
            }}
            data-testid={`column-${stage}`}
            className={`w-64 shrink-0 rounded-xl border p-2 transition ${
              dropTarget === stage
                ? "border-sky-500 bg-sky-950/30"
                : "border-zinc-800 bg-zinc-900/60"
            }`}
          >
            <h3 className="mb-2 flex items-center justify-between px-1 text-xs font-bold uppercase tracking-wide text-zinc-400">
              {STAGE_LABEL[stage]}
              <span className="rounded-full bg-zinc-800 px-2 text-zinc-300">
                {board?.[stage]?.length ?? 0}
              </span>
            </h3>
            <div className="space-y-2">
              {board?.[stage]?.map((row) => (
                <PipelineCard
                  key={row._id}
                  row={row}
                  isDragging={dragging === row._id}
                  onPointerDown={onPointerDown(row._id)}
                  onOpen={() => setDrawer(row.listing._id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {drawer && <DetailDrawer listingId={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function PipelineCard({
  row,
  isDragging,
  onPointerDown,
  onOpen,
}: {
  row: BoardRow;
  isDragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onOpen: () => void;
}) {
  const moveStage = useMutation(api.pipeline.moveStage);
  const setNotes = useMutation(api.pipeline.setNotes);
  const [notes, setNotesLocal] = useState(row.notes ?? "");

  return (
    <div
      data-testid="pipeline-card"
      data-title={row.listing.title}
      onPointerDown={onPointerDown}
      className={`cursor-grab touch-none select-none rounded-lg border border-zinc-700 bg-zinc-900 p-2.5 ${isDragging ? "opacity-50 ring-2 ring-sky-500" : ""}`}
    >
      <button onClick={onOpen} className="block w-full truncate text-left text-sm font-semibold hover:text-sky-400">
        {row.listing.title}
      </button>
      <p className="text-xs text-zinc-400 tabular-nums">
        ask {money(row.listing.price)}
        {row.listing.estProfit !== undefined && (
          <span className={row.listing.estProfit >= 0 ? " text-emerald-500" : " text-rose-400"}>
            {" "}· {row.listing.estProfit >= 0 ? "+" : ""}{money(row.listing.estProfit)}
          </span>
        )}
      </p>
      <div className="mt-1.5 grid grid-cols-2 gap-1 text-center text-[11px] tabular-nums">
        <div className="rounded bg-emerald-950/60 py-1 text-emerald-300" title="Suggested target buy">
          🎯 {money(row.targetBuy)}
        </div>
        <div className="rounded bg-rose-950/50 py-1 text-rose-300" title="Walk-away number">
          ✋ {money(row.walkAway)}
        </div>
      </div>
      <textarea
        value={notes}
        placeholder="notes…"
        rows={1}
        onChange={(e) => setNotesLocal(e.target.value)}
        onBlur={() => notes !== (row.notes ?? "") && void setNotes({ pipelineId: row._id, notes })}
        className="mt-1.5 w-full resize-none rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-sky-600"
      />
      <label className="mt-1 block">
        <span className="sr-only">Move stage</span>
        <select
          data-testid="stage-select"
          value={row.stage}
          onChange={(e) => void moveStage({ pipelineId: row._id, stage: e.target.value })}
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-400 outline-none"
        >
          {STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {STAGE_LABEL[stage]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
