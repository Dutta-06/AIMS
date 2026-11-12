/**
 * Where the backend is. The website is plain static files, and the backend can live somewhere that
 * changes (a GitHub Codespace gets a new address each time you create one), so the address can be
 * set in the browser instead of being baked into the build. It is only ever typed in by a person
 * (never taken from a link), and saving a new one signs you out of the old one.
 */
import { useSyncExternalStore } from "react";
import { clearSession } from "./auth";

const KEY = "corpo.backend";
export const DEFAULT_BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Turn whatever was typed into a full API address, or explain what's wrong. */
export function parseBackend(input: string): string {
  let raw = input.trim();
  if (!raw) throw new Error("Type the backend address");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const host = raw.split(/[/:]/)[0].toLowerCase();
    raw = `${LOCAL.has(host) ? "http" : "https"}://${raw}`;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a web address");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL.has(url.hostname))) {
    throw new Error("Use an https:// address (plain http is only allowed for localhost), so your sign-in isn't sent in the open");
  }
  if (url.username || url.password) throw new Error("Leave out any username or password");
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path.endsWith("/api/v1") ? path : `${path}/api/v1`}`;
}

export function backendUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BACKEND;
  try {
    return window.localStorage.getItem(KEY) || DEFAULT_BACKEND;
  } catch {
    return DEFAULT_BACKEND;
  }
}


export function saveBackend(input: string): string {
  const url = parseBackend(input);
  clearSession(); // a sign-in for one backend means nothing to another
  try {
    window.localStorage.setItem(KEY, url);
  } catch {
    throw new Error("This browser won't let the address be saved (private window?)");
  }
  return url;
}

export function resetBackend() {
  clearSession();
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing saved */
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** The address in use. The server render (and first paint) always shows the default, so the page
 * hydrates cleanly; a saved address takes over right after. */
export const useBackendUrl = () => useSyncExternalStore(subscribe, backendUrl, () => DEFAULT_BACKEND);
