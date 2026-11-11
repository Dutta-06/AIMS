"use client";

import { motion } from "motion/react";
import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { snap } from "./motion/springs";
import { Button } from "./ui";

/**
 * A glass confirmation. Focus starts on Cancel, so an accidental Enter never confirms;
 * confirming takes a deliberate move to the other button.
 */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "ember" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") return onCancel();
    if (e.key !== "Tab") return;
    const buttons = box.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    if (!buttons?.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Rendered at the document root: inside the page it would sit under the sticky nav, because the
  // page content forms its own stacking context. (Only ever mounted after a user action, so
  // `document` exists.)
  return createPortal(
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,7,12,0.6)] px-4 backdrop-blur-[6px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
    >
      <motion.div
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={snap}
        className="w-[28rem] max-w-full rounded-[1.25rem] border border-glass-border bg-[rgba(14,13,20,0.88)] p-6 shadow-2xl backdrop-blur-2xl"
      >
        <h2 id={titleId} className="text-[1.1rem] font-medium leading-snug text-heading">
          {title}
        </h2>
        {children && <div className="mt-3 text-sm text-body">{children}</div>}
        <div className="mt-6 flex justify-end gap-2">
          <Button autoFocus variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
