/**
 * Keeping the team's data in the shared Drive file.
 *
 * Several people save to the same file, so a save is never "overwrite what's there": it reads the
 * file, merges this person's changes onto it (see merge.ts), writes the result, and updates the
 * screen with anything a teammate added. A background check picks up teammates' changes between saves.
 *
 * Until a save succeeds a copy is also kept in this browser, so closing the tab or losing the
 * connection doesn't lose work: the next visit merges it in and saves it.
 */
import type { KeyValueStore } from "./google/auth";
import type { DriveFile, DriveLike } from "./google/drive";
import { clone, reconcile, sameData } from "./merge";
import type { DB } from "./model";
import { emptyDb, normaliseDb } from "./model";

export type SaveState = "idle" | "saving" | "saved" | "error";
export type SaveStatus = { state: SaveState; dirty: boolean; last_saved_at: string | null; error: string | null };

const PENDING_KEY = "corpo.pending";

type Pending = { owner: string; file_id: string; saved_at: string; base: DB | null; db: DB };

export type PersistenceOptions = {
  /** Whose browser this is (their email); their mailbox position is stored under it. */
  owner: string;
  fileId: string;
  /** Put data that arrived from the file onto the screen. Must not count as a change to save. */
  apply: (db: DB) => void;
  debounceMs?: number;
  retryMs?: number;
  pollMs?: number;
  store?: KeyValueStore;
  now?: () => Date;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Persistence {
  private file: DriveFile | null = null;
  /** The file as this browser last saw it; what "my changes" are measured against. */
  private base: DB | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private poller: ReturnType<typeof setInterval> | null = null;
  private saving: Promise<void> | null = null;
  private pulling: Promise<boolean> | null = null;
  private getDb: (() => DB) | null = null;
  status: SaveStatus = { state: "idle", dirty: false, last_saved_at: null, error: null };
  private listeners = new Set<() => void>();

  constructor(
    private drive: DriveLike,
    private o: PersistenceOptions,
  ) {}

  private me() {
    return this.o.owner.toLowerCase();
  }
  private nowIso() {
    return (this.o.now?.() ?? new Date()).toISOString();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SaveStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ------------------------------------------------------------------ this browser's spare copy
  private readPending(): Pending | null {
    try {
      const raw = this.o.store?.getItem(PENDING_KEY);
      const p = raw ? (JSON.parse(raw) as Pending) : null;
      return p && p.owner === this.o.owner && p.file_id === this.o.fileId ? p : null;
    } catch {
      return null;
    }
  }

  private writePending(db: DB) {
    try {
      const p: Pending = { owner: this.o.owner, file_id: this.o.fileId, saved_at: this.nowIso(), base: this.base, db };
      this.o.store?.setItem(PENDING_KEY, JSON.stringify(p));
    } catch {
      /* storage full or unavailable: the Drive save is still on its way */
    }
  }

  private clearPending() {
    try {
      this.o.store?.removeItem(PENDING_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  // ------------------------------------------------------------------ reading the file
  private async readRemote(): Promise<DB> {
    const text = await this.drive.read(this.o.fileId);
    try {
      return normaliseDb(JSON.parse(text));
    } catch {
      // Never carry on with an empty app here: the next save would overwrite the real file.
      throw new Error("The shared data file in Google Drive couldn't be read, so nothing was changed. Try again, and if it keeps happening, restore a backup from Settings.");
    }
  }

  /** What this person's screen shows for a copy of the file: their own mailbox position. */
  private forMe(file: DB): DB {
    const db = clone(file);
    db.mailbox = { ...emptyDb().mailbox, ...(file.mailboxes[this.me()] ?? {}) };
    return db;
  }

  /** Open the shared data. If an unsaved copy from a previous visit exists, its changes are merged
   * onto what's in the file now and flagged for saving. */
  async load(): Promise<{ db: DB; restoredUnsaved: boolean }> {
    this.file = await this.drive.meta(this.o.fileId);
    const remote = await this.readRemote();
    this.base = clone(remote);
    const pending = this.readPending();
    if (pending) {
      const local = normaliseDb(pending.db);
      const base = pending.base ? normaliseDb(pending.base) : null;
      const merged = reconcile(base, local, remote, this.nowIso(), this.me());
      this.set({ dirty: true });
      return { db: merged, restoredUnsaved: true };
    }
    return { db: this.forMe(remote), restoredUnsaved: false };
  }

  /** Remember how to read the screen's data (so background checks can compare). */
  bind(getDb: () => DB) {
    this.getDb = getDb;
  }

  // ------------------------------------------------------------------ saving
  /** The data changed: save it soon. */
  schedule(getDb: () => DB) {
    this.getDb = getDb;
    this.writePending(getDb());
    this.set({ dirty: true });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch(() => this.retryLater()), this.o.debounceMs ?? 800);
  }

  /** A save failed (offline, Google hiccup): try again shortly. */
  private retryLater() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch(() => this.retryLater()), this.o.retryMs ?? 15_000);
  }

  /** Save now (waits for a save already under way, then saves anything newer). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.saving) {
      await this.saving.catch(() => {});
      if (!this.status.dirty) return;
    }
    if (!this.getDb) return;
    this.saving = this.saveOnce().finally(() => {
      this.saving = null;
    });
    return this.saving;
  }

  private async saveOnce(): Promise<void> {
    const getDb = this.getDb!;
    const snap = clone(getDb());
    this.set({ state: "saving", error: null });
    let merged: DB;
    try {
      const meta = await this.drive.meta(this.o.fileId);
      // Nobody else has saved since we last looked: the file is what we already hold.
      const remote = this.file && this.base && meta.version === this.file.version ? this.base : await this.readRemote();
      merged = reconcile(this.base, snap, remote, this.nowIso(), this.me());
      this.file = await this.drive.update(this.o.fileId, JSON.stringify(merged));
      this.base = clone(merged);
    } catch (e) {
      this.set({ state: "error", error: e instanceof Error ? e.message : "Couldn't save to Google Drive" });
      throw e;
    }
    const cur = getDb();
    if (JSON.stringify(cur) === JSON.stringify(snap)) {
      if (!sameData(merged, cur)) this.o.apply(merged); // a teammate's changes arrived with the save
      this.clearPending();
      this.set({ state: "saved", dirty: false, last_saved_at: this.nowIso() });
      return;
    }
    // More edits arrived while saving: lay them over what the file now holds, and save again.
    this.o.apply(reconcile(snap, cur, merged, this.nowIso(), this.me()));
    this.writePending(getDb());
    this.set({ state: "saved", last_saved_at: this.nowIso() });
    return this.saveOnce();
  }

  // ------------------------------------------------------------------ teammates' changes
  /** Look for a teammate's save and bring it in. Returns true if anything new arrived. Unsaved
   * changes here are saved first (which merges as well). */
  async pull(force = false): Promise<boolean> {
    if (this.pulling) return this.pulling;
    this.pulling = this.pullOnce(force).finally(() => {
      this.pulling = null;
    });
    return this.pulling;
  }

  private async pullOnce(force: boolean): Promise<boolean> {
    if (!this.getDb) return false;
    if (this.saving) await this.saving.catch(() => {});
    if (this.status.dirty) {
      await this.flush();
      return true;
    }
    const meta = await this.drive.meta(this.o.fileId);
    if (!force && this.file && meta.version === this.file.version) return false;
    const remote = await this.readRemote();
    // Everything from here to apply() is synchronous, so an edit can't slip in between.
    const cur = this.getDb();
    const merged = reconcile(this.base, cur, remote, this.nowIso(), this.me());
    this.file = meta;
    this.base = clone(remote);
    if (sameData(merged, cur)) return false;
    this.o.apply(merged);
    return true;
  }

  /** Check for teammates' changes every so often while the page is open. */
  startPolling() {
    this.stopPolling();
    this.poller = setInterval(() => void this.pull().catch(() => {}), this.o.pollMs ?? 30_000);
  }
  stopPolling() {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }

  /** Save, wait a moment, then look again: used right before an email goes out, so that two people
   * pressing Send on the same draft find out about each other first. */
  async settle(delayMs = 1000): Promise<void> {
    await this.flush();
    await sleep(delayMs);
    await this.pull(true);
    if (this.status.dirty) await this.flush();
  }

  /** Forget this browser's copy (on sign-out, after everything is saved). */
  forget() {
    this.clearPending();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopPolling();
    this.getDb = null;
  }
}
