"use client";

/**
 * "Who is using this", remembered in this browser. It is a label, not a login: it names the owner
 * on new leads, powers "My leads", and records who approved an email. Anyone can change it.
 */
import { useSyncExternalStore } from "react";

const KEY = "corpo-mailer-me";
const listeners = new Set<() => void>();

export function getMe(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setMe(name: string) {
  try {
    if (name.trim()) localStorage.setItem(KEY, name.trim());
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: it just won't be remembered */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** The remembered name ("" if not set). Empty on the server and first render. */
export function useMe(): string {
  return useSyncExternalStore(subscribe, getMe, () => "");
}
