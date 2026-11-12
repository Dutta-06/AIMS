"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

const KEY = "corpo.music.muted";
const SRC = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/audio/theme.mp3`;
const VOLUME = 0.35;

let memory = false; // used when the browser won't let us store the choice
const listeners = new Set<() => void>();
function write(muted: boolean) {
  memory = muted;
  try {
    window.localStorage.setItem(KEY, muted ? "1" : "0");
  } catch {
    /* the choice lasts until the page is closed */
  }
  listeners.forEach((l) => l());
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const snapshot = () => {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === null ? memory : v === "1";
  } catch {
    return memory;
  }
};

/**
 * Background music with a small mute button in the lower right corner. Browsers don't allow sound
 * until the visitor has interacted with the page, so it starts on their first click, tap or key press.
 * Muting stops it and is remembered for next time; it also pauses while the tab is hidden.
 */
export default function BackgroundMusic() {
  const audio = useRef<HTMLAudioElement>(null);
  const muted = useSyncExternalStore(subscribe, snapshot, () => false);

  const play = () => {
    const a = audio.current;
    if (!a || snapshot()) return; // muted: stay quiet
    a.volume = VOLUME;
    void a.play().catch(() => {
      /* not allowed yet: the first interaction below tries again */
    });
  };

  useEffect(() => {
    play(); // works if the browser already allows sound for this site

    const events = ["pointerdown", "keydown", "touchend"] as const;
    const start = () => {
      events.forEach((e) => window.removeEventListener(e, start));
      play();
    };
    events.forEach((e) => window.addEventListener(e, start, { passive: true }));

    const onVisibility = () => {
      const a = audio.current;
      if (!a) return;
      if (document.visibilityState === "hidden") a.pause();
      else play();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      events.forEach((e) => window.removeEventListener(e, start));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const toggle = () => {
    const next = !snapshot();
    write(next);
    if (next) audio.current?.pause();
    else play();
  };

  return (
    <>
      <audio ref={audio} src={SRC} loop preload="none" />
      <button
        type="button"
        onClick={toggle}
        aria-label={muted ? "Unmute music" : "Mute music"}
        aria-pressed={muted}
        title={muted ? "Unmute music" : "Mute music"}
        className="fixed bottom-4 right-4 z-40 grid h-10 w-10 place-items-center rounded-full border border-glass-border bg-[rgba(14,13,20,0.75)] text-body backdrop-blur-[14px] transition-colors hover:text-heading focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 max-md:bottom-24"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4V5z" />
          {muted ? (
            <>
              <path d="m16 9 5 6" />
              <path d="m21 9-5 6" />
            </>
          ) : (
            <>
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M18.5 6a9 9 0 0 1 0 12" />
            </>
          )}
        </svg>
      </button>
    </>
  );
}
