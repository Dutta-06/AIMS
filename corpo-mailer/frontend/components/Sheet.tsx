"use client";

import { motion } from "motion/react";
import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { soft } from "./motion/springs";
import { useModalKeys } from "./useModalKeys";

/** A panel that slides in from the right. Esc, the backdrop and the close button all dismiss it. */
export default function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);

  useModalKeys(box, onClose);

  // Rendered at the document root so it sits above the sticky nav (see ConfirmDialog).
  return createPortal(
    <motion.div
      className="fixed inset-0 z-50 flex justify-end bg-[rgba(7,7,12,0.6)] backdrop-blur-[6px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={soft}
        data-lenis-prevent
        className="flex h-full w-[30rem] max-w-full flex-col overflow-y-auto border-l border-hairline bg-[rgba(14,13,20,0.9)] p-6 shadow-2xl backdrop-blur-[22px]"
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 id={titleId} className="text-[1.25rem] font-medium tracking-[-0.01em] text-heading">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-body transition-colors hover:bg-glass-strong hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heading/70"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
