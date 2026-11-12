"use client";

import { motion } from "motion/react";
import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { snap } from "@/components/motion/springs";
import { useModalKeys } from "@/components/useModalKeys";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/format";
import { STATUSES, type Status } from "@/lib/types";

/**
 * The keyboard, touch and screen-reader way to change a lead's status from the board: a dialog
 * listing the four statuses. (Dragging is the fast path; nothing depends on it.)
 */
export default function StatusPicker({
  who,
  current,
  onPick,
  onClose,
}: {
  who: string;
  current: Status;
  onPick: (status: Status) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useModalKeys(box, onClose);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowUp" ? -1 : 1) + items.length) % items.length].focus();
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
        className="w-[20rem] max-w-full rounded-[1.25rem] border border-glass-border bg-[rgba(14,13,20,0.9)] p-3 shadow-2xl backdrop-blur-2xl"
      >
        <h2 id={titleId} className="px-3 pb-2 pt-2 text-[0.95rem] font-medium text-heading">
          Move {who} to…
        </h2>
        <ul>
          {STATUSES.map((s) => (
            <li key={s}>
              <button
                type="button"
                autoFocus={s === STATUSES[(STATUSES.indexOf(current) + 1) % STATUSES.length]}
                disabled={s === current}
                onClick={() => onPick(s)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-body transition-colors hover:bg-glass-strong hover:text-heading focus-visible:bg-glass-strong focus-visible:text-heading focus-visible:outline-none disabled:opacity-100"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                <span className={s === current ? "text-heading" : ""}>{STATUS_LABEL[s]}</span>
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
