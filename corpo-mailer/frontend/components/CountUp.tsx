"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import { easeOutCubic } from "./motion/springs";

/**
 * A number that counts up from zero the first time it appears (900ms, easeOutCubic). If the value
 * later changes because data refreshed, it glides to the new value instead of replaying the intro.
 */
export default function CountUp({
  value,
  format = (n: number) => String(n),
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  // Reduced motion: paint the real number on the very first frame instead of 0 then a jump.
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => format(Math.round(v)));
  const first = useRef(true);

  useEffect(() => {
    const intro = first.current;
    first.current = false;
    const controls = animate(mv, value, {
      duration: reduce ? 0 : intro ? 0.9 : 0.35,
      ease: easeOutCubic,
    });
    return () => controls.stop();
  }, [value, reduce, mv]);

  return <motion.span className={className}>{text}</motion.span>;
}
