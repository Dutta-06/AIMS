"use client";

import { motion, useReducedMotion } from "motion/react";
import { soft } from "./springs";

/** Fade + slide in once. `delay` is in ms. Under reduced motion it is a plain 150ms fade. */
export default function Reveal({
  children,
  delay = 0,
  y = 20,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: "div" | "header" | "footer" | "section";
}) {
  const reduce = useReducedMotion();
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y: reduce ? 0 : y }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0.15 } : { ...soft, delay: delay / 1000 }}
    >
      {children}
    </Tag>
  );
}
