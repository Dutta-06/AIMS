/**
 * Saving the data to the person's own Google Drive (one private JSON file).
 *
 * Changes are saved a moment after the last one, one save at a time. Until a save succeeds a copy
 * is also kept in this browser, so closing the tab or losing the connection doesn't lose work: the
 * next visit finds it and saves it.
 */
import type { DriveFile, DriveLike } from "./google/drive";
import type { DB } from "./model";
import { emptyDb, normaliseDb } from "./model";
import type { KeyValueStore } from "./google/auth";

export type SaveState = "idle" | "saving" | "saved" | "error";
export type SaveStatus = { state: SaveState; dirty: boolean; last_saved_at: string | null; error: string | null };

const PENDING_KEY = "corpo.pending";

type Pending = { owner: string; base: string | null; saved_at: string; db: DB };

export type PersistenceOptions = {
  /** Which account's data this is (a copy kept for one account is never shown to another). */
  owner: string;
  debounceMs?: number;
  retryMs?: number;
  store?: KeyValueStore;
  now?: () => Date;
};

export class Persistence {
  private file: DriveFile | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private getDb: (() => DB) | null = null;
  status: SaveStatus = { state: "idle", dirty: false, last_saved_at: null, error: null };
  private listeners = new Set<() => void>();

  constructor(
    private drive: DriveLike,
    private o: PersistenceOptions,
  ) {}

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SaveStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l());
  }

  private readPending(): Pending | null {
    try {
      const raw = this.o.store?.getItem(PENDING_KEY);
      const p = raw ? (JSON.parse(raw) as Pending) : null;
      return p && p.owner === this.o.owner ? p : null;
    } catch {
      return null;
    }
  }

  private writePending(db: DB) {
    try {
      const p: Pending = { owner: this.o.owner, base: this.file?.modifiedTime ?? null, saved_at: (this.o.now?.() ?? new Date()).toISOString(), db };
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

  /** Open the person's data: from Drive (creating an empty file the first time). If an unsaved
   * copy from a previous visit is newer than what Drive has, that is used and saved straight away. */
  async load(): Promise<{ db: DB; restoredUnsaved: boolean }> {
    this.file = await this.drive.find();
    let stored: DB | null = null;
    if (this.file) {
      const text = await this.drive.read(this.file.id);
      try {
        stored = normaliseDb(JSON.parse(text));
      } catch {
        // Never carry on with an empty app here: the next save would overwrite the real file.
        throw new Error("Your saved data file in Google Drive couldn't be read, so nothing was changed. Try again, and if it keeps happening, restore a backup from Settings.");
      }
    }
    const pending = this.readPending();
    if (pending && (this.file === null ? true : pending.base === this.file.modifiedTime)) {
      this.set({ dirty: true });
      return { db: normaliseDb(pending.db), restoredUnsaved: true };
    }
    this.clearPending(); // a copy based on an older Drive version would overwrite newer data
    if (stored) return { db: stored, restoredUnsaved: false };
    const fresh = emptyDb();
    this.file = await this.drive.create(JSON.stringify(fresh));
    return { db: fresh, restoredUnsaved: false };
  }

  /** The data changed: save it soon. */
  schedule(getDb: () => DB) {
    this.getDb = getDb;
    this.writePending(getDb());
    this.set({ dirty: true });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch(() => this.retryLater()), this.o.debounceMs ?? 800);
  }

  /** A save failed (offline, Google hiccup): try again shortly. The changes are safe in this
   * browser's copy in the meantime. */
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
    const snapshot = JSON.stringify(getDb());
    this.set({ state: "saving", error: null });
    try {
      this.file = this.file ? await this.drive.update(this.file.id, snapshot) : await this.drive.create(snapshot);
    } catch (e) {
      this.set({ state: "error", error: e instanceof Error ? e.message : "Couldn't save to Google Drive" });
      throw e;
    }
    const changedMeanwhile = JSON.stringify(getDb()) !== snapshot;
    if (changedMeanwhile) {
      this.writePending(getDb()); // newer work arrived while saving: keep protecting it
      this.set({ state: "saved", last_saved_at: (this.o.now?.() ?? new Date()).toISOString() });
      return this.saveOnce();
    }
    this.clearPending();
    this.set({ state: "saved", dirty: false, last_saved_at: (this.o.now?.() ?? new Date()).toISOString() });
  }

  /** Forget this browser's copy (on sign-out, after everything is saved). */
  forget() {
    this.clearPending();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.getDb = null;
  }
}
