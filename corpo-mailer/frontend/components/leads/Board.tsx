"use client";

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { snap, soft } from "@/components/motion/springs";
import { Card, ChannelPills, Pill } from "@/components/ui";
import { STATUS_COLOR, STATUS_LABEL, contactLabel, daysAgo } from "@/lib/format";
import { STATUSES, type Contact, type Status } from "@/lib/types";
import { leadHref } from "@/lib/routes";

// The column under the pointer wins; if the pointer is between columns, fall back to overlap.
const byPointer: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

function CardBody({ lead, lifted, onMove }: { lead: Contact; lifted?: boolean; onMove?: (trigger: HTMLElement) => void }) {
  const who = contactLabel(lead);
  return (
    <Card
      glass
      className={`space-y-2 p-3.5 ${lifted ? "shadow-[0_28px_60px_-12px_rgba(0,0,0,0.75)]" : ""}`}
      style={lifted ? { transform: "rotate(2deg) scale(1.03)" } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={leadHref(lead.id)} draggable={false} className="block truncate font-medium text-heading hover:underline">
            {who}
          </Link>
          <p className="truncate text-[0.8rem] text-body">
            {lead.company_name}
            {lead.role ? ` · ${lead.role}` : ""}
          </p>
        </div>
        {onMove && (
          <button
            type="button"
            aria-label={`Move ${who} to another status`}
            onClick={(e) => onMove(e.currentTarget)}
            className="-mr-1 -mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-glass-strong hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heading/70"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <circle cx="3" cy="8" r="1.3" />
              <circle cx="8" cy="8" r="1.3" />
              <circle cx="13" cy="8" r="1.3" />
            </svg>
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[0.72rem] text-body">
        {lead.last_contacted_at && <span>· {daysAgo(lead.last_contacted_at)}d ago</span>}
      </div>
      {lead.channels.length > 0 && <ChannelPills channels={lead.channels} />}
      {lead.reply_unread && <Pill tone="green">New reply</Pill>}
    </Card>
  );
}

function DraggableCard({ lead, onMove }: { lead: Contact; onMove: (trigger: HTMLElement) => void }) {
  const reduce = useReducedMotion();
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: lead.id });
  return (
    <motion.div
      ref={setNodeRef}
      layout={!isDragging}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: isDragging ? 0.3 : 1, y: 0 }}
      transition={{ layout: snap, default: soft }}
      className="cursor-grab touch-manipulation select-none active:cursor-grabbing"
      {...listeners}
    >
      <CardBody lead={lead} onMove={onMove} />
    </motion.div>
  );
}

function Column({ status, leads, dragging, onMove }: { status: Status; leads: Contact[]; dragging: boolean; onMove: (lead: Contact, trigger: HTMLElement) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const color = STATUS_COLOR[status];
  return (
    <section aria-label={STATUS_LABEL[status]} className="min-w-[16rem] flex-1">
      <div className="px-1 pb-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          <h2 className="text-sm font-semibold text-heading">{STATUS_LABEL[status]}</h2>
          <span className="font-mono text-xs text-body">{leads.length}</span>
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
        {leads.length === 0 && (
          <p className="rounded-xl border border-dashed border-hairline py-6 text-center text-xs text-faint">
            {dragging ? "Drop here" : "Empty"}
          </p>
        )}
        {leads.map((l) => (
          <DraggableCard key={l.id} lead={l} onMove={(t) => onMove(l, t)} />
        ))}
      </div>
    </section>
  );
}

/** The four statuses as columns. Drag a lead across, or use the ⋯ button on a card. */
export default function Board({
  leads,
  onMoveLead,
  onPickMove,
}: {
  leads: Contact[];
  onMoveLead: (lead: Contact, to: Status, at: { x: number; y: number } | null) => void;
  onPickMove: (lead: Contact, trigger: HTMLElement) => void;
}) {
  const [activeId, setActiveId] = useState<number | null>(null);
  // A mouse needs a few pixels of travel (so clicks still follow links); touch needs a short
  // press (so the page can still be scrolled).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );
  const active = activeId == null ? null : (leads.find((l) => l.id === activeId) ?? null);

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const lead = leads.find((l) => l.id === Number(e.active.id));
    const to = e.over?.id as Status | undefined;
    if (!lead || !to || !STATUSES.includes(to)) return;
    const r = e.active.rect.current.translated;
    onMoveLead(lead, to, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={byPointer}
      onDragStart={(e) => setActiveId(Number(e.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div data-lenis-prevent className="-mx-5 overflow-x-auto px-5 pb-6">
        <div className="flex min-w-[68rem] gap-4">
          {STATUSES.map((s) => (
            <Column key={s} status={s} leads={leads.filter((l) => l.status === s)} dragging={activeId != null} onMove={onPickMove} />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {active && <CardBody lead={active} lifted />}
      </DragOverlay>
    </DndContext>
  );
}
