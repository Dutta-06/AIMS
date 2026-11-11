"use client";

import { motion } from "motion/react";
import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { snap } from "@/components/motion/springs";
import { STAGE_COLOR, STAGE_LABEL } from "@/lib/format";
import { STAGES, type Stage } from "@/lib/types";

/**
 * The keyboard, touch and screen-reader way to move a deal: a dialog listing all nine stages.
 * (Dragging is the fast path; this makes sure nothing depends on it.)
 */
export default function StagePicker({
  company,
  current,
  onPick,
  onClose,
}: {
  company: string;
  current: Stage;
  onPick: (stage: Stage) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") return onClose();
    if (e.key !== "Tab" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const back = e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey);
    items[(i + (back ? -1 : 1) + items.length) % items.length].focus();
  }

  return createPortal(
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,7,12,0.6)] px-4 backdrop-blur-[6px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={snap}
        className="w-[22rem] max-w-full rounded-[1.25rem] border border-glass-border bg-[rgba(14,13,20,0.9)] p-3 shadow-2xl backdrop-blur-2xl"
      >
        <h2 id={titleId} className="px-3 pb-2 pt-2 text-[0.95rem] font-medium text-heading">
          Move {company} to…
        </h2>
        <ul>
          {STAGES.map((s) => (
            <li key={s}>
              <button
                type="button"
                autoFocus={s !== current && s === STAGES[(STAGES.indexOf(current) + 1) % STAGES.length]}
                disabled={s === current}
                onClick={() => onPick(s)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-body transition-colors hover:bg-glass-strong hover:text-heading focus-visible:bg-glass-strong focus-visible:text-heading focus-visible:outline-none disabled:opacity-100"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLOR[s] }} />
                <span className={s === current ? "text-heading" : ""}>{STAGE_LABEL[s]}</span>
                {s === current && <span className="ml-auto text-xs text-faint">Current</span>}
              </button>
            </li>
          ))}
        </ul>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
