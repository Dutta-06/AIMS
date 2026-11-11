"use client";

import { useDraggable } from "@dnd-kit/core";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { snap, soft } from "@/components/motion/springs";
import { Card, Pill } from "@/components/ui";
import { daysAgo, fmtDate, fmtMoney } from "@/lib/format";
import type { Deal } from "@/lib/types";

/** What a deal looks like on the board. Purely visual, so the drag overlay can reuse it. */
export function DealCardBody({
  deal,
  company,
  lifted,
  onMove,
}: {
  deal: Deal;
  company: string;
  lifted?: boolean;
  onMove?: (trigger: HTMLElement) => void;
}) {
  return (
    <Card
      glass
      className={`space-y-2 p-3.5 ${lifted ? "shadow-[0_28px_60px_-12px_rgba(0,0,0,0.75)]" : ""}`}
      style={lifted ? { transform: "rotate(2deg) scale(1.03)" } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/deals/${deal.id}`}
          draggable={false}
          className="min-w-0 truncate font-medium text-heading hover:underline"
        >
          {company}
        </Link>
        {onMove && (
          <button
            type="button"
            aria-label={`Move ${company} to another stage`}
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
      <p className="text-[0.8rem] leading-snug text-body">
        {deal.target_amount != null && <span className="font-mono">{fmtMoney(deal.target_amount)}</span>}
        {deal.target_amount != null && " · "}
        {deal.last_contacted_at ? `Contacted ${daysAgo(deal.last_contacted_at)}d ago` : "Not contacted yet"}
        {deal.next_followup_at && <> · Follow up {fmtDate(deal.next_followup_at)}</>}
      </p>
      {deal.reply_unread && <Pill tone="green">New reply</Pill>}
    </Card>
  );
}

/**
 * A card you can pick up with the pointer. Only pointer listeners are attached (no role or
 * tabindex), so the link and the Move button inside keep working for keyboards and screen readers.
 */
export default function DraggableDealCard({
  deal,
  company,
  onMove,
}: {
  deal: Deal;
  company: string;
  onMove: (trigger: HTMLElement) => void;
}) {
  const reduce = useReducedMotion();
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: deal.id });
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
      <DealCardBody deal={deal} company={company} onMove={onMove} />
    </motion.div>
  );
}
