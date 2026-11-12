import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyValueStore } from "./google/auth";
import type { DriveFile, DriveLike } from "./google/drive";
import { emptyDb } from "./model";
import type { DB } from "./model";
import { Persistence } from "./persistence";

class FakeDrive implements DriveLike {
  file: DriveFile | null = null;
  content = "";
  version = 0;
  writes: string[] = [];
  failNext = 0;
  delayMs = 0;
  async find() {
    return this.file;
  }
  async read() {
    return this.content;
  }
  private async write(json: string): Promise<DriveFile> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error("Couldn't reach Google. Check your connection");
    }
    this.content = json;
    this.writes.push(json);
    this.version += 1;
    this.file = { id: "f1", modifiedTime: `v${this.version}` };
    return this.file;
  }
  create(json: string) {
    return this.write(json);
  }
  update(_id: string, json: string) {
    return this.write(json);
  }
}

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

let drive: FakeDrive;
let store: ReturnType<typeof memory>;
let db: DB;
const make = (owner = "team@gmail.com") => new Persistence(drive, { owner, store, debounceMs: 800, retryMs: 15_000, now: () => new Date("2026-03-10T10:00:00Z") });
const edit = (p: Persistence, name: string) => {
  db.companies.push({ id: db.companies.length + 1, name, industry: null, website: null, source: null, notes: null, created_at: "x" });
  p.schedule(() => db);
};

beforeEach(() => {
  vi.useFakeTimers();
  drive = new FakeDrive();
  store = memory();
  db = emptyDb();
});
afterEach(() => vi.useRealTimers());

describe("opening the data", () => {
  it("the first time, creates an empty file in Drive", async () => {
    const { db: loaded, restoredUnsaved } = await make().load();
    expect(restoredUnsaved).toBe(false);
    expect(loaded.companies).toEqual([]);
    expect(drive.writes).toHaveLength(1);
  });

  it("reads what was saved, and fills in anything an older file didn't have", async () => {
    drive.file = { id: "f1", modifiedTime: "v1" };
    drive.content = JSON.stringify({ companies: [{ id: 1, name: "Acme" }] }); // no seq, settings or mailbox
    const { db: loaded } = await make().load();
    expect(loaded.companies[0].name).toBe("Acme");
    expect(loaded.settings.event_name).toBe("brAInwave 3");
    expect(loaded.mailbox.processed).toEqual([]);
    expect(loaded.seq).toEqual({ company: 0, contact: 0, interaction: 0, draft: 0 });
  });

  it("fails loudly if Drive can't be read (it never shows an empty app that could overwrite the real data)", async () => {
    drive.file = { id: "f1", modifiedTime: "v1" };
    drive.content = "{ this is not json";
    await expect(make().load()).rejects.toThrow(/couldn't be read, so nothing was changed/);
    expect(drive.writes).toHaveLength(0);
  });
});

describe("saving", () => {
  it("waits a moment after the last change, then saves once", async () => {
    const p = make();
    await p.load();
    drive.writes.length = 0;
    edit(p, "A");
    await vi.advanceTimersByTimeAsync(400);
    edit(p, "B");
    await vi.advanceTimersByTimeAsync(700);
    expect(drive.writes).toHaveLength(0); // still inside the quiet period
    await vi.advanceTimersByTimeAsync(200);
    expect(drive.writes).toHaveLength(1);
    expect(JSON.parse(drive.writes[0]).companies.map((c: { name: string }) => c.name)).toEqual(["A", "B"]);
    expect(p.status).toMatchObject({ state: "saved", dirty: false, error: null, last_saved_at: "2026-03-10T10:00:00.000Z" });
  });

  it("shows 'saving' while a save is in flight", async () => {
    const p = make();
    await p.load();
    drive.delayMs = 500;
    edit(p, "A");
    await vi.advanceTimersByTimeAsync(800);
    expect(p.status.state).toBe("saving");
    await vi.advanceTimersByTimeAsync(600);
    expect(p.status.state).toBe("saved");
  });

  it("flush() saves right away", async () => {
    const p = make();
    await p.load();
    drive.writes.length = 0;
    edit(p, "A");
    await p.flush();
    expect(drive.writes).toHaveLength(1);
  });

  it("changes made during a save are saved straight after, without waiting for the quiet period", async () => {
    const p = make();
    await p.load();
    drive.writes.length = 0;
    drive.delayMs = 300;
    edit(p, "A");
    const first = p.flush();
    await vi.advanceTimersByTimeAsync(100);
    edit(p, "B"); // arrives while the first save is under way (its own quiet-period timer is 800 ms away)
    await vi.advanceTimersByTimeAsync(600); // 700 ms in: the first save and the follow-up are done, the timer hasn't fired
    await first;
    expect(JSON.parse(drive.content).companies.map((c: { name: string }) => c.name)).toEqual(["A", "B"]);
    expect(p.status).toMatchObject({ state: "saved", dirty: false });
    expect(store.data.has("corpo.pending")).toBe(false);
  });

  it("never runs two saves at once", async () => {
    const p = make();
    await p.load();
    let inFlight = 0;
    let max = 0;
    const real = drive.update.bind(drive);
    drive.update = async (id, json) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      try {
        return await real(id, json);
      } finally {
        inFlight -= 1;
      }
    };
    drive.delayMs = 100;
    for (let i = 0; i < 5; i++) {
      edit(p, `C${i}`);
      void p.flush().catch(() => {});
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(3000);
    expect(max).toBe(1);
  });
});

describe("when saving fails", () => {
  it("reports it, keeps a copy in this browser, and tries again by itself", async () => {
    const p = make();
    await p.load();
    drive.writes.length = 0;
    drive.failNext = 2;
    edit(p, "A");
    await vi.advanceTimersByTimeAsync(800);
    expect(p.status).toMatchObject({ state: "error", dirty: true });
    expect(p.status.error).toMatch(/Couldn't reach Google/);
    expect(store.data.has("corpo.pending")).toBe(true); // the work is safe in this browser meanwhile
    await vi.advanceTimersByTimeAsync(15_000); // first retry fails too
    expect(p.status.state).toBe("error");
    await vi.advanceTimersByTimeAsync(15_000); // second retry works
    expect(p.status).toMatchObject({ state: "saved", dirty: false, error: null });
    expect(JSON.parse(drive.content).companies).toHaveLength(1);
    expect(store.data.has("corpo.pending")).toBe(false); // and the spare copy is cleaned up
  });

  it("a visit after a closed tab finds the unsaved work and saves it", async () => {
    const first = make();
    await first.load();
    drive.failNext = 99; // Drive never answers
    edit(first, "Typed just before closing the tab");
    await vi.advanceTimersByTimeAsync(800);
    expect(first.status.state).toBe("error");
    drive.failNext = 0;
    const second = make(); // a new visit
    const { db: loaded, restoredUnsaved } = await second.load();
    expect(restoredUnsaved).toBe(true);
    expect(loaded.companies.map((c) => c.name)).toEqual(["Typed just before closing the tab"]);
    expect(second.status.dirty).toBe(true);
    second.schedule(() => loaded);
    await vi.advanceTimersByTimeAsync(800);
    expect(JSON.parse(drive.content).companies).toHaveLength(1);
  });

  it("an unsaved copy from before someone else changed the Drive file is discarded, not allowed to overwrite it", async () => {
    const first = make();
    await first.load();
    drive.failNext = 99;
    edit(first, "Old unsaved");
    await vi.advanceTimersByTimeAsync(800);
    drive.failNext = 0;
    drive.content = JSON.stringify({ companies: [{ id: 9, name: "Newer, from another device" }] });
    drive.file = { id: "f1", modifiedTime: "changed-elsewhere" };
    const { db: loaded, restoredUnsaved } = await make().load();
    expect(restoredUnsaved).toBe(false);
    expect(loaded.companies.map((c) => c.name)).toEqual(["Newer, from another device"]);
    expect(store.data.has("corpo.pending")).toBe(false);
  });

  it("another account never gets to see this account's unsaved copy", async () => {
    const first = make("team@gmail.com");
    await first.load();
    drive.failNext = 99;
    edit(first, "Private to the first account");
    await vi.advanceTimersByTimeAsync(800);
    drive.failNext = 0;
    const other = new FakeDrive(); // a different account that has never used the app: no file yet
    const { db: loaded, restoredUnsaved } = await new Persistence(other, { owner: "someone-else@gmail.com", store }).load();
    expect(restoredUnsaved).toBe(false);
    expect(loaded.companies).toEqual([]);
  });
});

describe("signing out", () => {
  it("forgets this browser's copy and stops any pending save", async () => {
    const p = make();
    await p.load();
    drive.writes.length = 0;
    edit(p, "A");
    p.forget();
    await vi.advanceTimersByTimeAsync(5000);
    expect(drive.writes).toHaveLength(0);
    expect(store.data.has("corpo.pending")).toBe(false);
  });
});
