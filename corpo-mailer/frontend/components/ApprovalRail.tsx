"use client";

import { motion, useReducedMotion } from "motion/react";
import type { DraftStatus } from "@/lib/types";

const STEPS = ["Draft", "Approved", "Sent"] as const;
const POSITION: Record<DraftStatus, number> = { draft: 0, approved: 1, sending: 1, sent: 2 };

/** Draft → Approved → Sent. The connectors fill as an email moves forward. */
export default function ApprovalRail({ status }: { status: DraftStatus }) {
  const reduce = useReducedMotion();
  const at = POSITION[status];
  return (
    <ol
      aria-label={`Progress: ${status === "sending" ? "sending" : STEPS[at]}`}
      className="flex items-center"
    >
      {STEPS.map((label, i) => {
        const done = i < at || (status === "sent" && i === 2);
        const current = i === at && !done;
        return (
          <li key={label} className="flex items-center" aria-current={current ? "step" : undefined}>
            {i > 0 && (
              <span aria-hidden="true" className="relative mx-2 h-px w-8 overflow-hidden bg-white/10 sm:w-12">
                <motion.span
                  className="absolute inset-0 origin-left bg-[image:var(--ember)]"
                  initial={false}
                  animate={{ scaleX: i <= at ? 1 : 0 }}
                  transition={{ duration: reduce ? 0 : 0.4, ease: [0.2, 0, 0, 1] }}
                />
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 items-center justify-center rounded-full border text-[0.6rem] transition-colors duration-300 ${
                  done
                    ? "border-transparent bg-[image:var(--ember)] text-white"
                    : current
                      ? "border-white/40 bg-white/10"
                      : "border-white/10 text-faint"
                }`}
              >
                {done ? (
                  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 6.5l2.2 2.2L9.5 3.8" />
                  </svg>
                ) : current ? (
                  <span className="breathe h-1.5 w-1.5 rounded-full bg-heading" />
                ) : null}
              </span>
              <span className={`text-xs ${current || done ? "text-heading" : "text-faint"}`}>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
