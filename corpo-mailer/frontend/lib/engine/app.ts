/**
 * The whole app, in the browser: who is signed in, their data (kept in their own Google Drive),
 * the AI, the mailer, and the background reply check. Screens talk to it through `lib/api.ts` and
 * read its state with `useApp()`.
 */
import { useSyncExternalStore } from "react";
import { Core } from "./core";
import type { Mailer } from "./drafts";
import { Drafts, recoverInterruptedSends } from "./drafts";
import { ApiError } from "./errors";
import { GoogleAuth, loadGis, ReauthNeeded } from "./google/auth";
import type { Gis, KeyValueStore } from "./google/auth";
import { DriveStore } from "./google/drive";
import type { DriveLike } from "./google/drive";
import { GmailApi } from "./google/gmail";
import { DEFAULT_MODELS, OpenRouterLLM } from "./llm";
import type { LLM } from "./llm";
import type { DB } from "./model";
import { Persistence } from "./persistence";
import type { SaveStatus } from "./persistence";
import type { MailboxReader } from "./replies";
import { syncReplies } from "./replies";
import type { SyncResult } from "../types";

export type Phase = "signed_out" | "loading" | "ready" | "error";

export type AppState = {
  phase: Phase;
  email: string | null;
  error: string | null;
  /** The Google sign-in expired and needs a click to renew. */
  needs_reauth: boolean;
  save: SaveStatus;
  client_id_set: boolean;
  /** Bumped whenever the data changes, so screens that read it can refresh. */
  data_version: number;
  restored_unsaved: boolean;
  /** The first look at whether this tab is already signed in has finished. */
  booted: boolean;
};

const SIGNED_OUT: SaveStatus = { state: "idle", dirty: false, last_saved_at: null, error: null };
const POLL_MS = 5 * 60_000;
const KEEPALIVE_MS = 60_000;

/** Browser settings that are never sent anywhere but the service they're for. */
export const LOCAL_KEYS = { clientId: "corpo.googleClientId", openrouterKey: "corpo.openrouterKey", models: "corpo.models" };

export type AppOptions = {
  store?: KeyValueStore; // persistent (localStorage)
  session?: KeyValueStore; // per-tab (sessionStorage)
  defaultClientId?: string;
  gis?: () => Promise<Gis>;
  drive?: (auth: GoogleAuth) => DriveLike;
  mailer?: (auth: GoogleAuth, fromName: () => string) => Mailer & MailboxReader;
  llm?: LLM;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  pollMs?: number;
  keepaliveMs?: number;
  debounceMs?: number;
};

export class App {
  state: AppState;
  auth: GoogleAuth;
  core: Core | null = null;
  drafts: Drafts | null = null;
  persistence: Persistence | null = null;
  private mail: (Mailer & MailboxReader) | null = null;
  private listeners = new Set<() => void>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private unsub: (() => void)[] = [];

  constructor(private o: AppOptions = {}) {
    this.auth = new GoogleAuth({
      clientId: () => this.clientId(),
      gis: o.gis ?? loadGis,
      fetchImpl: o.fetchImpl,
      now: o.now ? () => o.now!().getTime() : undefined,
      store: o.session,
    });
    this.state = { phase: "signed_out", email: null, error: null, needs_reauth: false, save: SIGNED_OUT, client_id_set: false, data_version: 0, restored_unsaved: false, booted: false };
    this.state.client_id_set = !!this.clientId();
  }

  // ------------------------------------------------------------------ browser-only settings
  private read(k: string): string {
    try {
      return this.o.store?.getItem(k) ?? "";
    } catch {
      return "";
    }
  }
  private write(k: string, v: string) {
    try {
      if (v) this.o.store?.setItem(k, v);
      else this.o.store?.removeItem(k);
    } catch {
      /* storage unavailable: the setting lasts until the page is closed */
    }
  }
  clientId(): string {
    return (this.read(LOCAL_KEYS.clientId) || this.o.defaultClientId || "").trim();
  }
  setClientId(v: string) {
    this.write(LOCAL_KEYS.clientId, v.trim());
    this.patch({ client_id_set: !!this.clientId() });
  }
  openrouterKey(): string {
    return this.read(LOCAL_KEYS.openrouterKey);
  }
  setOpenrouterKey(v: string) {
    this.write(LOCAL_KEYS.openrouterKey, v.trim());
    this.emit();
  }
  models(): string[] {
    const saved = this.read(LOCAL_KEYS.models)
      .split(/[\s,]+/)
      .filter(Boolean);
    return saved.length ? saved : DEFAULT_MODELS;
  }
  setModels(v: string) {
    this.write(LOCAL_KEYS.models, v.split(/[\s,]+/).filter(Boolean).join(","));
    this.emit();
  }

  // ------------------------------------------------------------------ state
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  private emit() {
    this.listeners.forEach((l) => l());
  }
  private patch(p: Partial<AppState>) {
    this.state = { ...this.state, ...p };
    this.emit();
  }

  /** What every operation calls first: the data, or a clear "sign in" error. */
  ready(): { core: Core; drafts: Drafts } {
    if (this.state.phase !== "ready" || !this.core || !this.drafts) throw new ApiError(401, "Sign in with Google to continue");
    return { core: this.core, drafts: this.drafts };
  }

  /** Run something that talks to Google; if the sign-in has run out, show the Continue banner. */
  async guarded<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ReauthNeeded) {
        this.patch({ needs_reauth: true });
        throw new ApiError(401, e.message);
      }
      throw e;
    }
  }

  // ------------------------------------------------------------------ signing in and out
  /** On page load: carry on if this tab is still signed in. */
  private booting: Promise<void> | null = null;
  /** Once per page: carry on if this tab is already signed in. (Safe to call again; it won't repeat.) */
  init(): Promise<void> {
    this.booting ??= this.boot();
    return this.booting;
  }
  /** Try opening the data again after an error. */
  retry(): Promise<void> {
    this.booting = null;
    this.patch({ booted: false, error: null });
    return this.init();
  }

  private async boot(): Promise<void> {
    const t = this.auth.restore();
    try {
      if (t) await this.openData(t.email);
      else this.patch({ phase: "signed_out" });
    } catch {
      /* openData already recorded the error for the screen to show */
    } finally {
      this.patch({ booted: true });
    }
  }

  async signIn(): Promise<void> {
    this.patch({ error: null });
    try {
      const t = await this.auth.signIn();
      await this.openData(t.email);
    } catch (e) {
      this.patch({ phase: "signed_out", error: e instanceof Error ? e.message : "Sign-in didn't work" });
      throw e;
    }
  }

  /** The person pressed Continue after their sign-in expired. */
  async renew(): Promise<void> {
    await this.auth.renew();
    this.patch({ needs_reauth: false });
    void this.persistence?.flush().catch(() => {});
  }

  async signOut(): Promise<void> {
    try {
      await this.persistence?.flush(); // save anything pending before the token goes
    } catch {
      /* it stays in this browser's spare copy for the next visit */
    }
    this.stopTimers();
    this.unsub.forEach((u) => u());
    this.unsub = [];
    this.persistence?.forget();
    await this.auth.signOut();
    this.core = this.drafts = this.persistence = this.mail = null;
    this.patch({ phase: "signed_out", email: null, error: null, needs_reauth: false, save: SIGNED_OUT, restored_unsaved: false });
  }

  private async openData(email: string): Promise<void> {
    this.patch({ phase: "loading", email, error: null });
    const drive = this.o.drive ? this.o.drive(this.auth) : new DriveStore(this.auth, this.o.fetchImpl);
    const persistence = new Persistence(drive, { owner: email, store: this.o.store, debounceMs: this.o.debounceMs, now: this.o.now });
    try {
      const { db, restoredUnsaved } = await this.guarded(() => persistence.load());
      this.attach(email, db, persistence, restoredUnsaved);
    } catch (e) {
      this.patch({ phase: "error", error: e instanceof Error ? e.message : "Couldn't open your data" });
      throw e;
    }
  }

  private attach(email: string, db: DB, persistence: Persistence, restored: boolean) {
    const core = new Core(db, this.o.now, () => {
      persistence.schedule(() => core.db);
      this.patch({ data_version: this.state.data_version + 1 });
    });
    recoverInterruptedSends(core);
    const fromName = () => core.db.settings.from_name;
    this.mail = this.o.mailer ? this.o.mailer(this.auth, fromName) : new GmailApi(this.auth, fromName, this.o.fetchImpl);
    const llm = this.o.llm ?? new OpenRouterLLM({ apiKey: () => this.openrouterKey(), models: () => this.models(), fetchImpl: this.o.fetchImpl });
    this.core = core;
    this.persistence = persistence;
    this.drafts = new Drafts(core, { llm: () => llm, mailer: () => this.mail, who: () => this.auth.token?.email ?? email });
    this.unsub.push(
      persistence.subscribe(() => {
        const s = persistence.status;
        this.patch({ save: s, needs_reauth: this.state.needs_reauth || (s.state === "error" && !this.auth.valid) });
      }),
    );
    this.patch({ phase: "ready", restored_unsaved: restored, save: persistence.status });
    if (restored) persistence.schedule(() => core.db); // a copy from a closed tab: save it now
    this.startTimers();
  }

  // ------------------------------------------------------------------ background work
  private startTimers() {
    this.stopTimers();
    // While the page is open: check for replies every few minutes, and renew the Google token
    // before it runs out so saving and sending keep working.
    this.timers.push(setInterval(() => void this.syncReplies(true).catch(() => {}), this.o.pollMs ?? POLL_MS));
    this.timers.push(
      setInterval(() => {
        if (this.state.phase === "ready" && this.auth.token && !this.state.needs_reauth) {
          this.auth.ensure().catch((e) => e instanceof ReauthNeeded && this.patch({ needs_reauth: true }));
        }
      }, this.o.keepaliveMs ?? KEEPALIVE_MS),
    );
  }
  private stopTimers() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  /** Check the inbox for replies now. */
  async syncReplies(quiet = false): Promise<SyncResult> {
    const { core } = this.ready();
    if (!this.mail) throw new ApiError(409, "Gmail isn't connected");
    const reader = this.mail;
    try {
      return await this.guarded(() => syncReplies(core, reader, this.auth.token?.email ?? null));
    } catch (e) {
      if (quiet) throw e;
      throw e instanceof ApiError ? e : new ApiError(502, e instanceof Error ? e.message : "The inbox couldn't be checked");
    }
  }

  /** Ask the AI a trivial question, to check the key and models work. */
  async testAi(): Promise<string> {
    const llm = this.o.llm ?? new OpenRouterLLM({ apiKey: () => this.openrouterKey(), models: () => this.models(), fetchImpl: this.o.fetchImpl });
    try {
      return (await llm.complete({ system: "Reply with exactly the word OK.", user: "ping" })).trim().slice(0, 40);
    } catch (e) {
      throw new ApiError(502, e instanceof Error ? e.message : "The AI couldn't be reached");
    }
  }

  /** Save to Drive right now (used before sign-out and by the Save button). */
  async saveNow(): Promise<void> {
    await this.guarded(() => this.persistence?.flush() ?? Promise.resolve());
  }

  /** Replace everything with a backup file. */
  restoreBackup(db: DB) {
    const { core } = this.ready();
    core.db = db;
    core.changed();
  }

  dispose() {
    this.stopTimers();
    this.unsub.forEach((u) => u());
  }
}

// ---------------------------------------------------------------- the one app on the page
let instance: App | null = null;

const safeStore = (s: () => Storage): KeyValueStore | undefined => {
  try {
    return s();
  } catch {
    return undefined;
  }
};

export function app(): App {
  if (!instance) {
    instance = new App({
      store: typeof window === "undefined" ? undefined : safeStore(() => window.localStorage),
      session: typeof window === "undefined" ? undefined : safeStore(() => window.sessionStorage),
      defaultClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    });
  }
  return instance;
}

/** For tests and hot reloads. */
export function setApp(a: App | null) {
  instance = a;
}

const SERVER_STATE: AppState = { phase: "loading", email: null, error: null, needs_reauth: false, save: SIGNED_OUT, client_id_set: false, data_version: 0, restored_unsaved: false, booted: false };

export function useApp(): AppState {
  return useSyncExternalStore(
    (fn) => app().subscribe(fn),
    () => app().getState(),
    () => SERVER_STATE,
  );
}
