"use client";

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { useSignal } from "@/components/signal/SignalProvider";
import { useToast } from "@/components/ToastProvider";
import DraggableDealCard, { DealCardBody } from "@/components/pipeline/DealCard";
import StagePicker from "@/components/pipeline/StagePicker";
import { ErrorNote, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { STAGE_COLOR, STAGE_LABEL, fmtMoney } from "@/lib/format";
import { errorMessage, useQuery } from "@/lib/hooks";
import { STAGES, type Deal, type Stage } from "@/lib/types";

const CELEBRATE: Stage[] = ["committed", "paid"];

// The column under the pointer wins; if the pointer is between columns, fall back to overlap.
const byPointer: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};
type Pending = Record<number, { from: Stage; to: Stage }>;

function Column({
  stage,
  deals,
  names,
  dragging,
  onMove,
}: {
  stage: Stage;
  deals: Deal[];
  names: Map<number, string>;
  dragging: boolean;
  onMove: (deal: Deal, trigger: HTMLElement) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const color = STAGE_COLOR[stage];
  const total = deals.reduce((sum, d) => sum + (d.target_amount ?? 0), 0);
  return (
    <section aria-label={STAGE_LABEL[stage]} className="w-[18rem] shrink-0 snap-start">
      <div className="px-1 pb-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          <h2 className="text-sm font-semibold text-heading">{STAGE_LABEL[stage]}</h2>
          <span className="font-mono text-xs text-body">{deals.length}</span>
          {total > 0 && <span className="ml-auto font-mono text-xs text-faint">{fmtMoney(total)}</span>}
        </div>
        <div className="mt-2 h-0.5 rounded-full" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      </div>
      <div
        ref={setNodeRef}
        className="min-h-[22rem] space-y-2.5 rounded-[1.25rem] p-1.5 transition-[box-shadow,background-color] duration-200"
        style={{
          boxShadow: isOver ? `inset 0 0 0 1px ${color}, 0 0 44px -14px ${color}` : undefined,
          backgroundColor: isOver ? `color-mix(in srgb, ${color} 9%, transparent)` : dragging ? "rgba(255,255,255,0.02)" : undefined,
        }}
      >
        {deals.length === 0 && (
          <p className="rounded-xl border border-dashed border-hairline py-6 text-center text-xs text-faint">
            {dragging ? "Drop here" : "Empty"}
          </p>
        )}
        {deals.map((d) => (
          <DraggableDealCard key={d.id} deal={d} company={names.get(d.company_id) ?? `Deal ${d.id}`} onMove={(t) => onMove(d, t)} />
        ))}
      </div>
    </section>
  );
}

export default function PipelinePage() {
  const signal = useSignal();
  const toast = useToast();
  const { data, error, loading, reload } = useQuery("pipeline", async () => {
    const [deals, companies] = await Promise.all([api.deals.list(), api.companies.list()]);
    return { deals, names: new Map(companies.map((c) => [c.id, c.name])) };
  });
  const [pending, setPending] = useState<Pending>({});
  const [activeId, setActiveId] = useState<number | null>(null);
  const [picking, setPicking] = useState<{ deal: Deal; trigger: HTMLElement } | null>(null);

  // A mouse needs a few pixels of travel (so clicks still follow links); touch needs a short press
  // (so the board can still be scrolled sideways).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error} />;

  // Show a move immediately; the server's answer takes over once it differs from where we started.
  const stageOf = (d: Deal): Stage => {
    const p = pending[d.id];
    return p && d.stage === p.from ? p.to : d.stage;
  };
  const dealsIn = (s: Stage) => data.deals.filter((d) => stageOf(d) === s);
  const active = activeId == null ? null : data.deals.find((d) => d.id === activeId) ?? null;

  async function move(deal: Deal, to: Stage, pulseAt: HTMLElement | { x: number; y: number } | null) {
    if (stageOf(deal) === to) return;
    setPending((m) => ({ ...m, [deal.id]: { from: deal.stage, to } }));
    try {
      await api.deals.update(deal.id, { stage: to });
      reload();
      if (CELEBRATE.includes(to)) signal.pulse(pulseAt); // only once the save actually succeeded
    } catch (e) {
      // Put it back (the card animates home) and say why.
      setPending((m) => {
        const next = { ...m };
        delete next[deal.id];
        return next;
      });
      toast(`Couldn't move ${data?.names.get(deal.company_id) ?? "the deal"}: ${errorMessage(e)}`, "error");
    }
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(Number(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const deal = data?.deals.find((d) => d.id === Number(e.active.id));
    const to = e.over?.id as Stage | undefined;
    if (!deal || !to || !STAGES.includes(to)) return;
    const r = e.active.rect.current.translated;
    move(deal, to, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);
  }

  return (
    <>
      <PageHeader title="Pipeline" subtitle="Drag a deal to a new stage, or use the ⋯ button on a card." />

      <DndContext sensors={sensors} collisionDetection={byPointer} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        {/* Full-bleed: the board breaks out of the page column so nine stages get the whole screen,
            while its first column still lines up with the page content. */}
        <div
          data-lenis-prevent
          className="relative left-1/2 w-screen -translate-x-1/2 snap-x snap-proximity overflow-x-auto pb-6 [mask-image:linear-gradient(to_right,transparent,#000_1.25rem,#000_calc(100%-1.25rem),transparent)]"
          style={{
            paddingInline: "max(1.25rem, calc((100vw - 76rem) / 2 + 1.25rem))",
            scrollPaddingInline: "max(1.25rem, calc((100vw - 76rem) / 2 + 1.25rem))",
          }}
        >
          <div className="flex gap-4">
            {STAGES.map((s) => (
              <Column key={s} stage={s} deals={dealsIn(s)} names={data.names} dragging={activeId != null} onMove={(deal, trigger) => setPicking({ deal, trigger })} />
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
          {active && <DealCardBody deal={active} company={data.names.get(active.company_id) ?? ""} lifted />}
        </DragOverlay>
      </DndContext>

      <AnimatePresence>
        {picking && (
          <StagePicker
            company={data.names.get(picking.deal.company_id) ?? "this deal"}
            current={stageOf(picking.deal)}
            onClose={() => setPicking(null)}
            onPick={(stage) => {
              const { deal, trigger } = picking;
              setPicking(null);
              move(deal, stage, trigger);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
