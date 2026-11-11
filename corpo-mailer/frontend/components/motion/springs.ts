import type { Transition } from "motion/react";

export const soft: Transition = { type: "spring", stiffness: 120, damping: 24 };
export const snap: Transition = { type: "spring", stiffness: 420, damping: 34 };
/** cubic-bezier for easeOutCubic, the curve used by every word reveal. */
export const easeOutCubic = [0.33, 1, 0.68, 1] as const;
