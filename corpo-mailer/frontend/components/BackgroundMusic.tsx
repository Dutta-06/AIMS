"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/** The queue. Add a file to public/audio and a line here; the songs play in turn and start over. */
const FILES = ["track-1.mp3", "track-2.mp3", "track-3.mp3"];
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const TRACKS = FILES.map((f) => `${BASE}/audio/${f}`);

const VOLUME_KEY = "corpo.music.volume";
const LAST_KEY = "corpo.music.lastVolume";
const TRACK_KEY = "corpo.music.track";
const OLD_MUTED_KEY = "corpo.music.muted"; // from the first version, which only had a mute button
const DEFAULT_VOLUME = 0.35;

// ---- the two things we remember (volume and which song is up), kept in local storage
const listeners = new Set<() => void>();
const memory = { volume: DEFAULT_VOLUME, last: DEFAULT_VOLUME, track: 0 };
const emit = () => listeners.forEach((l) => l());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const get = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const put = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* the setting lasts until the page is closed */
  }
};
const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_VOLUME);

function volumeNow(): number {
  const v = get(VOLUME_KEY);
  if (v !== null) return clamp(Number(v));
  if (get(OLD_MUTED_KEY) === "1") return 0; // they had muted it before the slider existed
  return memory.volume;
}
function trackNow(): number {
  const t = Number(get(TRACK_KEY));
  return Number.isInteger(t) && t >= 0 && t < TRACKS.length ? t : memory.track;
}
function setVolume(v: number) {
  const next = clamp(v);
  memory.volume = next;
  put(VOLUME_KEY, String(next));
  if (next > 0) {
    memory.last = next;
    put(LAST_KEY, String(next));
  }
  emit();
}
function setTrack(i: number) {
  memory.track = i;
  put(TRACK_KEY, String(i));
  emit();
}
function lastAudible(): number {
  const l = clamp(Number(get(LAST_KEY) ?? memory.last));
  return l > 0 ? l : DEFAULT_VOLUME;
}

/**
 * Background music: a rolling queue of songs with a small volume control in the lower right (the
 * speaker button mutes and unmutes; the slider sets the volume). Browsers don't allow sound until the
 * visitor has interacted, so it starts on their first click, tap or key press. Volume and the current
 * song are remembered; it pauses while the tab is hidden and while the volume is at zero.
 */
export default function BackgroundMusic() {
  const audio = useRef<HTMLAudioElement>(null);
  const started = useRef(false); // true once the browser has let us play
  const failures = useRef(0);
  const volume = useSyncExternalStore(subscribe, volumeNow, () => DEFAULT_VOLUME);
  const track = useSyncExternalStore(subscribe, trackNow, () => 0);

  const play = () => {
    const a = audio.current;
    if (!a) return;
    const v = volumeNow();
    if (v === 0) return a.pause(); // silent: stay stopped
    a.volume = v;
    void a
      .play()
      .then(() => {
        started.current = true;
        failures.current = 0;
      })
      .catch(() => {
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

  // The volume changed: apply it, stop at zero, start again above zero.
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    a.volume = volume;
    if (volume === 0) a.pause();
    else if (a.paused) play();
  }, [volume]);

  // A new song is up: carry on playing if music was already going.
  useEffect(() => {
    if (started.current && volumeNow() > 0) play();
  }, [track]);

  const next = () => {
    if (TRACKS.length === 1) {
      const a = audio.current;
      if (a) {
        a.currentTime = 0;
        play();
      }
      return;
    }
    setTrack((trackNow() + 1) % TRACKS.length);
  };

  const muted = volume === 0;
  const pct = Math.round(volume * 100);

  return (
    <>
      <audio
        ref={audio}
        src={TRACKS[track]}
        preload="none"
        onEnded={next}
        onError={() => {
          // a song that can't be loaded is skipped (but never loop forever if none can)
          failures.current += 1;
          if (failures.current < TRACKS.length) next();
        }}
      />
      <div
        role="group"
        aria-label="Music"
        className="fixed bottom-4 right-4 z-40 flex h-10 items-center gap-1 rounded-full border border-glass-border bg-[rgba(14,13,20,0.75)] pl-1 pr-3 backdrop-blur-[14px] max-md:bottom-24"
      >
        <button
          type="button"
          onClick={() => setVolume(muted ? lastAudible() : 0)}
          aria-label={muted ? "Unmute music" : "Mute music"}
          aria-pressed={muted}
          title={muted ? "Unmute music" : "Mute music"}
          className="grid h-8 w-8 place-items-center rounded-full text-body transition-colors hover:text-heading focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/60"
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
                {volume > 0.5 && <path d="M18.5 6a9 9 0 0 1 0 12" />}
              </>
            )}
          </svg>
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Music volume"
          aria-valuetext={muted ? "Muted" : `${pct}%`}
          title={muted ? "Muted" : `Volume ${pct}%`}
          className="h-1 w-20 cursor-pointer accent-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60"
        />
      </div>
    </>
  );
}
