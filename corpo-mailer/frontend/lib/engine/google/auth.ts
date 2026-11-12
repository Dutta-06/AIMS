/**
 * Signing in with Google, in the browser.
 *
 * We use Google's own sign-in script ("Google Identity Services", token model). It needs only a
 * public client ID: there is no client secret and no server. One consent covers everything the app
 * uses: who you are, a private app-data file in your Drive (where your leads are saved), and
 * sending and reading your Gmail. The access token lasts about an hour; asking again is quick and
 * usually silent, and when Google needs you to click, the app shows a "Continue" button.
 */
import { ApiError } from "../errors";

export const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.appdata", // a private file only this app can see
  "https://www.googleapis.com/auth/gmail.send", // send the emails you approve
  "https://www.googleapis.com/auth/gmail.readonly", // spot replies (the app never changes your mail)
];
const SCOPE_STRING = SCOPES.join(" ");

/** The sign-in ran out (or needs a click): the person has to press Continue. */
export class ReauthNeeded extends Error {
  constructor(message = "Your Google sign-in expired. Press Continue to renew it.") {
    super(message);
  }
}

export type TokenInfo = { access_token: string; expires_at: number; email: string };

type TokenResponse = { access_token?: string; expires_in?: number | string; scope?: string; error?: string; error_description?: string };
type TokenClient = { requestAccessToken(o?: { prompt?: string; hint?: string }): void };

/** The slice of Google's script that we use. */
export interface Gis {
  initTokenClient(c: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback: (e: { type?: string; message?: string }) => void;
  }): TokenClient;
  hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
  revoke(token: string, done?: () => void): void;
}

export type KeyValueStore = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

export type AuthOptions = {
  clientId: () => string;
  /** Resolves to Google's script (loaded on demand). */
  gis: () => Promise<Gis>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Where the current token is remembered for this browser tab (so a reload doesn't sign out). */
  store?: KeyValueStore;
};

const STORE_KEY = "corpo.google.token";
const MARGIN_MS = 60_000; // renew a minute before it runs out

export class GoogleAuth {
  token: TokenInfo | null = null;
  private listeners = new Set<() => void>();
  private pending: Promise<TokenInfo> | null = null;

  constructor(private o: AuthOptions) {}

  private now() {
    return this.o.now ? this.o.now() : Date.now();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(t: TokenInfo | null) {
    this.token = t;
    try {
      if (t) this.o.store?.setItem(STORE_KEY, JSON.stringify(t));
      else this.o.store?.removeItem(STORE_KEY);
    } catch {
      /* a private window may refuse storage: you'll just sign in again after a reload */
    }
    this.listeners.forEach((l) => l());
  }

  /** Pick up a still-valid sign-in from earlier in this tab. */
  restore(): TokenInfo | null {
    try {
      const raw = this.o.store?.getItem(STORE_KEY);
      const t = raw ? (JSON.parse(raw) as TokenInfo) : null;
      if (t && t.expires_at - MARGIN_MS > this.now()) {
        this.token = t;
        return t;
      }
    } catch {
      /* ignore unreadable data */
    }
    return null;
  }

  get valid(): boolean {
    return !!this.token && this.token.expires_at - MARGIN_MS > this.now();
  }

  private async userEmail(accessToken: string): Promise<string> {
    const doFetch = this.o.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {
      throw new ApiError(0, "Couldn't reach Google to confirm who you are");
    }
    if (!res.ok) throw new ApiError(res.status, "Google wouldn't say who you are");
    const info = (await res.json()) as { email?: string; email_verified?: boolean };
    if (!info.email || info.email_verified === false) throw new ApiError(403, "Google didn't confirm an email address for that account");
    return info.email.toLowerCase();
  }

  /** Ask Google for a token. `interactive` may open Google's window; otherwise it stays silent. */
  private request(interactive: boolean, hint?: string): Promise<TokenInfo> {
    if (this.pending) return this.pending;
    const run = async (): Promise<TokenInfo> => {
      const clientId = this.o.clientId().trim();
      if (!clientId) throw new ApiError(409, "Add your Google client ID first (see the setup guide)");
      const gis = await this.o.gis();
      const response = await new Promise<TokenResponse>((resolve, reject) => {
        const client = gis.initTokenClient({
          client_id: clientId,
          scope: SCOPE_STRING,
          callback: resolve,
          error_callback: (e) =>
            reject(
              interactive
                ? new ApiError(409, e.type === "popup_closed" ? "Sign-in was cancelled" : e.type === "popup_failed_to_open" ? "Your browser blocked Google's window. Allow pop-ups for this site and try again" : e.message || "Google sign-in didn't complete")
                : new ReauthNeeded(),
            ),
        });
        client.requestAccessToken({ prompt: interactive ? "select_account" : "", ...(hint ? { hint } : {}) });
      });
      if (response.error || !response.access_token) {
        throw interactive ? new ApiError(409, response.error_description || "Google sign-in didn't complete") : new ReauthNeeded();
      }
      if (!gis.hasGrantedAllScopes(response, ...SCOPES)) {
        throw new ApiError(
          409,
          "Corpo Mailer needs every permission it asked for (your email, its private Drive file, and Gmail send and read). Sign in again and leave all the boxes ticked.",
        );
      }
      const email = await this.userEmail(response.access_token);
      const info: TokenInfo = { access_token: response.access_token, expires_at: this.now() + Number(response.expires_in ?? 3600) * 1000, email };
      this.set(info);
      return info;
    };
    this.pending = run().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /** The person pressed Sign in. */
  signIn(): Promise<TokenInfo> {
    return this.request(true);
  }

  /** The person pressed Continue after their sign-in expired (keeps the same account). */
  renew(): Promise<TokenInfo> {
    return this.request(true, this.token?.email);
  }

  /** A token that is good for at least another minute. Tries a silent renewal; if Google needs a
   * click, throws ReauthNeeded so the screen can show Continue. */
  async ensure(): Promise<string> {
    if (this.valid) return this.token!.access_token;
    if (!this.token) throw new ReauthNeeded("Sign in with Google to continue.");
    return (await this.request(false, this.token.email)).access_token;
  }

  /** The server said 401: whatever we hold is no good. */
  invalidate() {
    if (this.token) this.set({ ...this.token, expires_at: 0 });
  }

  async signOut(): Promise<void> {
    const t = this.token;
    this.set(null);
    if (t) {
      try {
        const gis = await this.o.gis();
        gis.revoke(t.access_token);
      } catch {
        /* the token expires within the hour anyway */
      }
    }
  }
}

/** Load Google's script once. */
export function loadGis(): Promise<Gis> {
  const w = window as unknown as { google?: { accounts?: { oauth2?: Gis } } };
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google.accounts.oauth2);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => (w.google?.accounts?.oauth2 ? resolve(w.google.accounts.oauth2) : reject(new ApiError(0, "Google's sign-in script didn't start")));
    s.onerror = () => reject(new ApiError(0, "Couldn't load Google's sign-in. Check your connection (or an ad blocker) and try again"));
    document.head.appendChild(s);
  });
}
