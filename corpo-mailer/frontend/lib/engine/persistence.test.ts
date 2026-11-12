import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Core, sharedIds } from "./core";
import type { KeyValueStore } from "./google/auth";
import type { DriveFile, DriveLike } from "./google/drive";
import { emptyDb } from "./model";
import type { DB } from "./model";
import { Persistence } from "./persistence";

/** One shared file in "Drive". Each person talks to it through their own FakeDrive. */
class Server {
  content = JSON.stringify(emptyDb());
  version = 1;
  reads = 0;
  writes: string[] = [];
  failNext = 0;
  delayMs = 0;
  unreadable = false;
}
class FakeDrive implements DriveLike {
  constructor(private s: Server) {}
  private meta0(): DriveFile {
    return { id: "f1", name: "Shared", modifiedTime: `t${this.s.version}`, version: String(this.s.version) };
  }
  async meta() {
    return this.meta0();
  }
  async read() {
    this.s.reads += 1;
    return this.s.unreadable ? "{ not json" : this.s.content;
  }
  async create(_n: string, json: string) {
    return this.update("f1", json);
  }
  async update(_id: string, json: string) {
    if (this.s.delayMs) await new Promise((r) => setTimeout(r, this.s.delayMs));
    if (this.s.failNext > 0) {
      this.s.failNext -= 1;
      throw new Error("Couldn't reach Google. Check your connection");
    }
    this.s.content = json;
    this.s.writes.push(json);
    this.s.version += 1;
    return this.meta0();
  }
  async share() {}
  async collaborators() {
    return [];
  }
}

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

let server: Server;
let clock: Date;
const saved = (): DB => JSON.parse(server.content) as DB;
const names = (db: DB) => db.companies.map((c) => c.name).sort();

/** A person with a browser: their own copy of the data, spare-copy storage and saver. */
async function join(email: string, rand: number, o: { store?: ReturnType<typeof memory>; fileId?: string } = {}) {
  const store = o.store ?? memory();
  // eslint-disable-next-line prefer-const
  let core!: Core;
  let applied = 0;
  const p = new Persistence(new FakeDrive(server), {
    owner: email,
    fileId: o.fileId ?? "f1",
    store,
    debounceMs: 800,
    retryMs: 15_000,
    pollMs: 30_000,
    now: () => clock,
    apply: (db) => {
      applied += 1;
      core.replaceDb(db);
    },
  });
  const { db, restoredUnsaved } = await p.load();
  core = new Core(db, () => clock, () => p.schedule(() => core.db), sharedIds(() => clock.getTime(), () => rand));
  p.bind(() => core.db);
  return { p, core, store, restoredUnsaved, applied: () => applied };
}
type Person = Awaited<ReturnType<typeof join>>;
const settle = (ms = 1000) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  clock = new Date("2026-03-10T10:00:00Z");
  server = new Server();
});
afterEach(() => vi.useRealTimers());

describe("opening the shared data", () => {
  it("reads what was saved, and fills in anything an older file didn't have", async () => {
    server.content = JSON.stringify({ companies: [{ id: 1, name: "Acme" }] }); // no settings, mailbox, tombstones...
    const { core } = await join("a@x.com", 0.1);
    expect(core.db.companies[0].name).toBe("Acme");
    expect(core.db.settings.event_name).toBe("brAInwave 3");
    expect(core.db.mailboxes).toEqual({});
    expect(core.db.tombstones).toEqual({ company: {}, contact: {}, draft: {}, interaction: {} });
  });

  it("shows this person their own mailbox position from the file", async () => {
    const db = emptyDb();
    db.mailboxes = { "a@x.com": { last_sync_at: null, last_error: null, synced_until: 111, processed: ["m1"] }, "b@x.com": { last_sync_at: null, last_error: null, synced_until: 222, processed: [] } };
    server.content = JSON.stringify(db);
    expect((await join("A@x.com", 0.1)).core.db.mailbox.synced_until).toBe(111);
    expect((await join("b@x.com", 0.2)).core.db.mailbox.synced_until).toBe(222);
    expect((await join("c@x.com", 0.3)).core.db.mailbox.synced_until).toBeNull();
  });

  it("fails loudly if the file can't be read (it never shows an empty app that could overwrite the real data)", async () => {
    server.unreadable = true;
    await expect(join("a@x.com", 0.1)).rejects.toThrow(/couldn't be read, so nothing was changed/);
    expect(server.writes).toHaveLength(0);
  });
});

describe("saving", () => {
  it("waits a moment after the last change, then saves once", async () => {
    const a = await join("a@x.com", 0.1);
    a.core.createCompany({ name: "A" });
    await settle(400);
    a.core.createCompany({ name: "B" });
    await settle(700);
    expect(server.writes).toHaveLength(0); // still inside the quiet period
    await settle(200);
    expect(server.writes).toHaveLength(1);
    expect(names(saved())).toEqual(["A", "B"]);
    expect(a.p.status).toMatchObject({ state: "saved", dirty: false });
  });

  it("shows 'saving' while a save is under way", async () => {
    server.delayMs = 500;
    const a = await join("a@x.com", 0.1);
    a.core.createCompany({ name: "A" });
    await settle(850);
    expect(a.p.status.state).toBe("saving");
    await settle(600);
    expect(a.p.status.state).toBe("saved");
  });

  it("flush() saves right away", async () => {
    const a = await join("a@x.com", 0.1);
    a.core.createCompany({ name: "A" });
    await a.p.flush();
    expect(names(saved())).toEqual(["A"]);
  });

  it("an edit made during a save is saved straight after, without losing either", async () => {
    server.delayMs = 500;
    const a = await join("a@x.com", 0.1);
    a.core.createCompany({ name: "First" });
    await settle(850);
    a.core.createCompany({ name: "Second" }); // lands while the first save is in flight
    await settle(3000);
    expect(names(saved())).toEqual(["First", "Second"]);
    expect(names(a.core.db)).toEqual(["First", "Second"]);
  });

  it("never runs two saves at once", async () => {
    server.delayMs = 400;
    let running = 0;
    let max = 0;
    const real = FakeDrive.prototype.update;
    FakeDrive.prototype.update = async function (this: FakeDrive, ...args: [string, string]) {
      running += 1;
      max = Math.max(max, running);
      try {
        return await real.apply(this, args);
      } finally {
        running -= 1;
      }
    };
    try {
      const a = await join("a@x.com", 0.1);
      a.core.createCompany({ name: "A" });
      const f1 = a.p.flush();
      const f2 = a.p.flush();
      a.core.createCompany({ name: "B" });
      await settle(5000);
      await Promise.all([f1, f2]);
      expect(max).toBe(1);
      expect(names(saved())).toEqual(["A", "B"]);
    } finally {
      FakeDrive.prototype.update = real;
    }
  });

  it("stores this person's mailbox position under their email and leaves everyone else's alone", async () => {
    const b = await join("b@x.com", 0.2);
    b.core.db.mailbox.synced_until = 222;
    b.core.changed();
    await b.p.flush();
    const a = await join("a@x.com", 0.1);
    a.core.db.mailbox.synced_until = 111;
    a.core.changed();
    await a.p.flush();
    expect(Object.fromEntries(Object.entries(saved().mailboxes).map(([k, v]) => [k, v.synced_until]))).toEqual({ "a@x.com": 111, "b@x.com": 222 });
    expect(a.core.db.mailbox.synced_until).toBe(111);
  });
});

describe("two people saving to the same file", () => {
  it("keeps both people's new leads, however the saves interleave", async () => {
    const a = await join("a@x.com", 0.1);
    const b = await join("b@x.com", 0.7);
    a.core.createCompany({ name: "From A" });
    b.core.createCompany({ name: "From B" });
    await a.p.flush();
    await b.p.flush(); // B has never seen A's save
    expect(names(saved())).toEqual(["From A", "From B"]);
    expect(names(b.core.db)).toEqual(["From A", "From B"]); // and B's screen now shows A's
    await a.p.pull();
    expect(names(a.core.db)).toEqual(["From A", "From B"]);
  });

  it("the later edit of the same lead wins, and the earlier person sees it", async () => {
    const seed = await join("a@x.com", 0.1);
    const co = seed.core.createCompany({ name: "Acme" });
    const lead = seed.core.createContact({ company_id: co.id, name: "Raj", email: "raj@acme.com" });
    await seed.p.flush();
    const b = await join("b@x.com", 0.7);
    clock = new Date("2026-03-10T10:05:00Z");
    seed.core.updateContact(lead.id, { remarks: "A's note" });
    await seed.p.flush();
    clock = new Date("2026-03-10T10:09:00Z");
    b.core.updateContact(lead.id, { remarks: "B's note" });
    await b.p.flush();
    expect(saved().contacts[0].remarks).toBe("B's note");
    await seed.p.pull();
    expect(seed.core.db.contacts[0].remarks).toBe("B's note");
  });

  it("a deleted lead stays deleted when a teammate with an old copy saves", async () => {
    const seed = await join("a@x.com", 0.1);
    const co = seed.core.createCompany({ name: "Acme" });
    const lead = seed.core.createContact({ company_id: co.id, name: "Raj", email: "raj@acme.com" });
    await seed.p.flush();
    const b = await join("b@x.com", 0.7); // has Raj
    clock = new Date("2026-03-10T10:05:00Z");
    seed.core.deleteContact(lead.id);
    await seed.p.flush();
    clock = new Date("2026-03-10T10:06:00Z");
    b.core.createCompany({ name: "Another" });
    await b.p.flush();
    expect(saved().contacts).toEqual([]);
    expect(b.core.db.contacts).toEqual([]);
  });

  it("a teammate's save arriving mid-save, plus my edit made meanwhile, all end up together", async () => {
    const a = await join("a@x.com", 0.1);
    const b = await join("b@x.com", 0.7);
    b.core.createCompany({ name: "From B" });
    await b.p.flush();
    server.delayMs = 500;
    a.core.createCompany({ name: "A one" });
    await settle(850); // A's save is in flight
    a.core.createCompany({ name: "A two" });
    await settle(4000);
    expect(names(saved())).toEqual(["A one", "A two", "From B"]);
    expect(names(a.core.db)).toEqual(["A one", "A two", "From B"]);
  });

  it("heals a save that overwrote a teammate's work: nobody's records are lost", async () => {
    const a = await join("a@x.com", 0.1);
    const b = await join("b@x.com", 0.7);
    a.core.createCompany({ name: "From A" });
    await a.p.flush();
    // Someone wipes A's company out of the file with a stale write (a lost update).
    const wiped = saved();
    wiped.companies = [];
    server.content = JSON.stringify(wiped);
    server.version += 1;
    b.core.createCompany({ name: "From B" });
    await b.p.flush();
    await a.p.flush();
    a.core.createCompany({ name: "More from A" });
    await a.p.flush();
    expect(names(saved())).toEqual(["From A", "From B", "More from A"]);
  });

  it("sends only one write per save and doesn't re-read the file when nobody else has saved", async () => {
    const a = await join("a@x.com", 0.1);
    const reads = server.reads;
    a.core.createCompany({ name: "A" });
    await a.p.flush();
    a.core.createCompany({ name: "B" });
    await a.p.flush();
    expect(server.reads).toBe(reads);
  });
});

describe("noticing a teammate's changes", () => {
  it("pull() brings in a teammate's save, and does nothing when there is none", async () => {
    const a = await join("a@x.com", 0.1);
    const b = await join("b@x.com", 0.7);
    expect(await a.p.pull()).toBe(false);
    const readsBefore = server.reads;
    expect(await a.p.pull()).toBe(false);
    expect(server.reads).toBe(readsBefore); // the version hadn't moved, so the file wasn't read
    b.core.createCompany({ name: "From B" });
    await b.p.flush();
    expect(await a.p.pull()).toBe(true);
    expect(names(a.core.db)).toEqual(["From B"]);
    expect(a.applied()).toBe(1);
  });

  it("does not touch the screen when what arrived changes nothing visible", async () => {
    const a = await join("a@x.com", 0.1);
    const b = await join("b@x.com", 0.7);
    b.core.db.mailbox.synced_until = 5; // only b's own mailbox position
    b.core.changed();
    await b.p.flush();
    await a.p.pull();
    expect(a.applied()).toBe(0);
  });

  it("checks by itself every so often while polling is on, and stops when told", async () => {
    const a = await join("a@x.com", 0.1);
    const b = await join("b@x.com", 0.7);
    a.p.startPolling();
    b.core.createCompany({ name: "From B" });
    await b.p.flush();
    await settle(31_000);
    expect(names(a.core.db)).toEqual(["From B"]);
    a.p.stopPolling();
    b.core.createCompany({ name: "Later" });
    await b.p.flush();
    await settle(60_000);
    expect(names(a.core.db)).toEqual(["From B"]);
  });

  it("with unsaved changes here, checking saves them (merging) instead of replacing them", async () => {
    const a = await join("a@x.com", 0.1);
    const b = await join("b@x.com", 0.7);
    b.core.createCompany({ name: "From B" });
    await b.p.flush();
    a.core.createCompany({ name: "Mine, unsaved" });
    await a.p.pull();
    expect(names(a.core.db)).toEqual(["From B", "Mine, unsaved"]);
    expect(names(saved())).toEqual(["From B", "Mine, unsaved"]);
  });

  it("settle() saves, waits, then looks again, so a teammate's claim made meanwhile is seen", async () => {
    const a = await join("a@x.com", 0.1);
    const b = await join("b@x.com", 0.7);
    a.core.createCompany({ name: "A" });
    const done = a.p.settle(1000);
    await settle(200);
    b.core.createCompany({ name: "B, during the wait" });
    await b.p.flush();
    await settle(1500);
    await done;
    expect(names(a.core.db)).toEqual(["A", "B, during the wait"]);
  });
});

describe("when saving fails", () => {
  it("reports it, keeps a copy in this browser, and tries again by itself", async () => {
    const a = await join("a@x.com", 0.1);
    server.failNext = 2;
    a.core.createCompany({ name: "A" });
    await settle(900);
    expect(a.p.status).toMatchObject({ state: "error", dirty: true });
    expect(a.p.status.error).toMatch(/Couldn't reach Google/);
    expect(a.store.data.get("corpo.pending")).toContain('"A"');
    await settle(15_500);
    expect(a.p.status.state).toBe("error"); // the second try failed too
    await settle(15_500);
    expect(a.p.status).toMatchObject({ state: "saved", dirty: false });
    expect(names(saved())).toEqual(["A"]);
    expect(a.store.data.has("corpo.pending")).toBe(false);
  });

  it("a visit after a closed tab finds the unsaved work and saves it", async () => {
    const a = await join("a@x.com", 0.1);
    server.failNext = 99;
    a.core.createCompany({ name: "Unsaved" });
    await settle(900);
    server.failNext = 0;
    const again = await join("a@x.com", 0.1, { store: a.store });
    expect(again.restoredUnsaved).toBe(true);
    expect(names(again.core.db)).toEqual(["Unsaved"]);
    expect(again.p.status.dirty).toBe(true);
    again.core.changed();
    await again.p.flush();
    expect(names(saved())).toEqual(["Unsaved"]);
  });

  it("unsaved work from a closed tab is merged onto what teammates saved in the meantime, not thrown away", async () => {
    const a = await join("a@x.com", 0.1);
    const b = await join("b@x.com", 0.7);
    server.failNext = 99;
    a.core.createCompany({ name: "A's unsaved" });
    await settle(900);
    server.failNext = 0;
    b.core.createCompany({ name: "B saved meanwhile" });
    await b.p.flush();
    const again = await join("a@x.com", 0.1, { store: a.store });
    expect(names(again.core.db)).toEqual(["A's unsaved", "B saved meanwhile"]);
    again.core.changed();
    await again.p.flush();
    expect(names(saved())).toEqual(["A's unsaved", "B saved meanwhile"]);
  });

  it("a deletion made while offline is still a deletion after the tab is closed and reopened", async () => {
    const seed = await join("a@x.com", 0.1);
    const co = seed.core.createCompany({ name: "Acme" });
    seed.core.createContact({ company_id: co.id, name: "Raj", email: "raj@acme.com" });
    await seed.p.flush();
    server.failNext = 99;
    clock = new Date("2026-03-10T10:05:00Z");
    seed.core.deleteContact(seed.core.db.contacts[0].id);
    await settle(900); // the save fails; the deletion is only in this browser's spare copy
    server.failNext = 0;
    const again = await join("a@x.com", 0.1, { store: seed.store });
    expect(again.restoredUnsaved).toBe(true);
    expect(again.core.db.contacts).toEqual([]);
    again.core.changed();
    await again.p.flush();
    expect(saved().contacts).toEqual([]);
  });

  it("another account, or another file, never gets to see this account's unsaved copy", async () => {
    const a = await join("a@x.com", 0.1);
    server.failNext = 99;
    a.core.createCompany({ name: "Private to A" });
    await settle(900);
    server.failNext = 0;
    const other = await join("b@x.com", 0.2, { store: a.store });
    expect(other.restoredUnsaved).toBe(false);
    expect(other.core.db.companies).toEqual([]);
    const elsewhere = await join("a@x.com", 0.1, { store: a.store, fileId: "another-file" });
    expect(elsewhere.restoredUnsaved).toBe(false);
  });
});

describe("signing out", () => {
  it("forgets this browser's copy, and stops the pending save and the checking", async () => {
    const a = await join("a@x.com", 0.1);
    a.p.startPolling();
    server.failNext = 99;
    a.core.createCompany({ name: "A" });
    await settle(900);
    a.p.forget();
    server.failNext = 0;
    await settle(120_000);
    expect(server.writes).toHaveLength(0);
    expect(a.store.data.has("corpo.pending")).toBe(false);
  });
});

export type { Person };
