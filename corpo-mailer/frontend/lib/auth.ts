/**
 * The sign-in token, kept in this browser. It is not a secret the website holds: the site is public
 * static files and checks nothing itself. The backend refuses every request without a valid token.
 * (localStorage can be unavailable, e.g. in private windows, so every use is guarded.)
 */
import { useSyncExternalStore } from "react";

const KEY = "corpo.session";
export const SIGNED_OUT = "corpo:signed-out";

type Session = { token: string; expires_at: number };

function read(): Session | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return typeof s.token === "string" && s.expires_at * 1000 > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export const getToken = (): string | null => (typeof window === "undefined" ? null : (read()?.token ?? null));

export function saveSession(token: string, expiresAt: number) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ token, expires_at: expiresAt }));
  } catch {
    /* without storage you'll just be asked again on the next page load */
  }
}

export function clearSession() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Forget the token and tell the app to show the sign-in page. */
export function signOut() {
  clearSession();
  window.dispatchEvent(new Event(SIGNED_OUT));
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SIGNED_OUT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SIGNED_OUT, onChange);
  };
}

/** Does this browser hold a sign-in right now? (False on the server render.) */
export const useSignedIn = () => useSyncExternalStore(subscribe, () => getToken() !== null, () => false);
