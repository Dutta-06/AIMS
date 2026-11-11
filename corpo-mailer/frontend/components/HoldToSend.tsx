"use client";

import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const HOLD_SECONDS = 1.1;

/**
 * The only control in the app that sends an email. Press and hold for 1.1s to fill the ring;
 * letting go early cancels. Keyboard, screen-reader and reduced-motion users never hold: a click
 * with no pointer press (Enter/Space/AT) or any click under reduced motion asks `onConfirmRequest`,
 * which opens an explicit confirmation naming the recipient.
 */
export default function HoldToSend({
  recipient,
  disabled,
  busy,
  buttonRef,
  onHoldComplete,
  onConfirmRequest,
}: {
  recipient: string;
  disabled?: boolean;
  busy?: boolean;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  onHoldComplete: () => void;
  onConfirmRequest: () => void;
}) {
  const reduce = useReducedMotion();
  const progress = useMotionValue(0);
  const running = useRef<ReturnType<typeof animate> | null>(null);
  const holding = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  // SVG clamps rx and ry separately, so a "huge" rx makes an ellipse. A pill needs a real radius,
  // which is half the measured height of the button plus its ring.
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const RING_GAP = 6; // px the ring sits outside the button
  const radius = (height + RING_GAP * 2 - 2) / 2;

  // A failed send re-enables the control: drain the ring so it can be tried again.
  useEffect(() => {
    if (!busy && !holding.current) animate(progress, 0, { duration: 0.25 });
  }, [busy, progress]);

  const release = () => {
    if (!holding.current) return;
    holding.current = false;
    running.current?.stop();
    running.current = animate(progress, 0, { duration: 0.25, ease: "easeOut" });
  };

  const press = (e: React.PointerEvent) => {
    if (disabled || busy || reduce || (e.pointerType === "mouse" && e.button !== 0)) return;
    holding.current = true;
    running.current?.stop();
    running.current = animate(progress, 1, {
      duration: HOLD_SECONDS,
      ease: "linear",
      onComplete: () => {
        if (!holding.current) return;
        holding.current = false;
        onHoldComplete();
      },
    });
  };

  return (
    <div ref={wrap} className="relative inline-flex">
      {height > 0 && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute overflow-visible"
          style={{ inset: -RING_GAP, width: `calc(100% + ${RING_GAP * 2}px)`, height: height + RING_GAP * 2 }}
        >
          <defs>
            <linearGradient id="hold-ring" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffb347" />
              <stop offset="40%" stopColor="#ff6b5e" />
              <stop offset="75%" stopColor="#e6399b" />
              <stop offset="100%" stopColor="#7a5cff" />
            </linearGradient>
          </defs>
          <rect
            x="1"
            y="1"
            rx={radius}
            ry={radius}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="2"
            style={{ width: "calc(100% - 2px)", height: height + RING_GAP * 2 - 2 }}
          />
          <motion.rect
            x="1"
            y="1"
            rx={radius}
            ry={radius}
            fill="none"
            stroke="url(#hold-ring)"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ width: "calc(100% - 2px)", height: height + RING_GAP * 2 - 2, pathLength: progress }}
          />
        </svg>
      )}
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled || busy}
        aria-label={`Send to ${recipient}. Hold to send, or press Enter to confirm in a dialog.`}
        onPointerDown={press}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          // A mouse/touch press has detail >= 1 and is handled by the hold. detail === 0 means
          // keyboard or assistive tech; under reduced motion everyone confirms in the dialog.
          if (e.detail === 0 || reduce) onConfirmRequest();
        }}
        className="inline-flex h-10 touch-none select-none items-center justify-center rounded-full bg-[image:var(--ember)] px-5 text-[0.9rem] font-semibold text-white transition-[filter,transform] duration-150 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heading/70 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45"
      >
        {busy ? "Sending…" : reduce ? `Send to ${recipient}` : `Hold to send to ${recipient}`}
      </button>
    </div>
  );
}
