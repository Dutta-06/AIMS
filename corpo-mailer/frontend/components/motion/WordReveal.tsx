"use client";

import { motion, useReducedMotion } from "motion/react";
import { easeOutCubic } from "./springs";

/**
 * Reveals text one word at a time. Words listed in `accent` render in the italic serif with the
 * ember gradient. `delay`, `stagger` and `duration` are in ms; `rise` is the starting offset in px.
 */
export default function WordReveal({
  text,
  accent = [],
  delay = 0,
  stagger = 85,
  duration = 720,
  rise = 26,
  as: Tag = "span",
  className,
}: {
  text: string;
  accent?: string[];
  delay?: number;
  stagger?: number;
  duration?: number;
  rise?: number;
  as?: "span" | "h1" | "h2" | "p";
  className?: string;
}) {
  const reduce = useReducedMotion();
  const words = text.split(" ");
  const M = motion[Tag];
  return (
    <M className={className} aria-label={text}>
      {words.map((word, i) => {
        const isAccent = accent.includes(word);
        return (
          <motion.span
            key={`${word}-${i}`}
            aria-hidden="true"
            className={`inline-block ${isAccent ? "font-serif font-normal italic tracking-[-0.01em] text-ember" : ""}`}
            initial={{ opacity: 0, y: reduce ? 0 : rise }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduce
                ? { duration: 0.15 }
                : { duration: duration / 1000, delay: (delay + i * stagger) / 1000, ease: easeOutCubic }
            }
          >
            {word}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        );
      })}
    </M>
  );
}
