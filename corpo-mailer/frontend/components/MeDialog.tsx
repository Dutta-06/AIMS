"use client";

import { motion } from "motion/react";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { snap } from "@/components/motion/springs";
import { useModalKeys } from "@/components/useModalKeys";
import { Button, Input } from "@/components/ui";
import { getMe, setMe } from "@/lib/me";

/** Pick the name you work under. A label saved in this browser, not an account. */
export default function MeDialog({ onClose, owners }: { onClose: () => void; owners: string[] }) {
  const titleId = useId();
  const box = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(getMe());
  useModalKeys(box, onClose);

  function save(value: string) {
    setMe(value);
    onClose();
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
      <motion.form
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(e) => {
          e.preventDefault();
          save(name);
        }}
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={snap}
        className="w-[24rem] max-w-full rounded-[1.25rem] border border-glass-border bg-[rgba(14,13,20,0.9)] p-6 shadow-2xl backdrop-blur-2xl"
      >
        <h2 id={titleId} className="text-[1.1rem] font-medium text-heading">
          Who&apos;s working?
        </h2>
        <p className="mt-2 text-sm text-body">
          There are no accounts. This name is kept in this browser, used for &ldquo;My leads&rdquo;, and recorded when
          you approve an email.
        </p>
        <div className="mt-4">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            aria-label="Your name"
            list="me-owners"
          />
          <datalist id="me-owners">
            {owners.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </div>
        {owners.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {owners.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => save(o)}
                className="rounded-full border border-glass-border bg-glass px-3 py-1 text-xs text-body transition-colors hover:bg-glass-strong hover:text-heading"
              >
                {o}
              </button>
            ))}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          {getMe() && (
            <Button type="button" variant="ghost" onClick={() => save("")}>
              Clear
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </motion.form>
    </motion.div>,
    document.body,
  );
}
