import { describe, expect, it } from "vitest";
import { Core, sharedIds } from "./core";
import { canon, clone, reconcile, sameData } from "./merge";
import type { DB } from "./model";

const at = (min: number) => new Date(Date.UTC(2026, 2, 10, 10, min)).toISOString();
let clockMin = 0;
const core = (db?: DB) => new Core(db, () => new Date(at(clockMin)));

/** A shared starting point: Acme, with Raj, one draft. Everyone begins from a copy of this. */
function start() {
  clockMin = 0;
  const c = core();
  const co = c.createCompany({ name: "Acme" });
  const raj = c.createContact({ company_id: co.id, name: "Raj", email: "raj@acme.com" });
  c.db.drafts.push({
    id: 50, contact_id: raj.id, channel: "email", subject: "Hi", body: "Hello", status: "approved", generated_by_ai: false,
    approved_hash: "h", approved_by: "a@x", approved_at: at(0), sent_at: null, last_error: null, created_at: at(0), history: [],
  });
  return { base: clone(c.db), co, raj };
}
const person = (base: DB, rand: number) => new Core(clone(base), () => new Date(at(clockMin)), () => {}, sharedIds(() => Date.parse(at(clockMin)), () => rand));
const people = (base: DB) => ({ a: person(base, 0.2), b: person(base, 0.7) });
const merge = (base: DB | null, local: DB, remote: DB, min = 30) => reconcile(base, local, remote, at(min), "a@x");

describe("merging two people's edits", () => {
  it("keeps both people's changes to different leads", () => {
    const { base, co } = start();
    const { a, b } = people(base);
    clockMin = 5;
    a.createContact({ company_id: co.id, name: "Ana", email: "ana@acme.com" });
    clockMin = 6;
    b.createContact({ company_id: co.id, name: "Ben", email: "ben@acme.com" });
    const m = merge(base, a.db, b.db);
    expect(m.contacts.map((c) => c.name).sort()).toEqual(["Ana", "Ben", "Raj"]);
  });

  it("keeps both people's edits to different fields of... different leads, and the later edit wins on the same lead", () => {
    const { base, raj } = start();
    const { a, b } = people(base);
    clockMin = 5;
    a.updateContact(raj.id, { remarks: "from A" });
    clockMin = 9;
    b.updateContact(raj.id, { remarks: "from B" });
    expect(merge(base, a.db, b.db).contacts[0].remarks).toBe("from B"); // B edited later
    expect(merge(base, b.db, a.db).contacts[0].remarks).toBe("from B"); // whichever side is "mine"
  });

  it("does not change records nobody touched, or stamp them", () => {
    const { base } = start();
    const { a, b } = people(base);
    const m = merge(base, a.db, b.db);
    expect(canon(m.contacts)).toBe(canon(base.contacts));
    expect(m.contacts[0].updated_at).toBe(base.contacts[0].updated_at);
  });

  it("does not undo a teammate's edit just because this copy is older", () => {
    const { base, raj } = start();
    const { a, b } = people(base);
    clockMin = 9;
    b.updateContact(raj.id, { remarks: "B was here" });
    const m = merge(base, a.db, b.db, 20); // A did nothing
    expect(m.contacts[0].remarks).toBe("B was here");
  });

  it("is not thrown off by an edit time the app set itself", () => {
    const { base, raj } = start();
    const { a, b } = people(base);
    clockMin = 12;
    a.updateContact(raj.id, { remarks: "A at 12" });
    clockMin = 8;
    b.updateContact(raj.id, { remarks: "B at 8" });
    // A's save is delayed to minute 40, but A edited at 12 and B at 8: A's edit is later.
    expect(merge(base, a.db, b.db, 40).contacts[0].remarks).toBe("A at 12");
  });
});

describe("deleting", () => {
  it("a lead I delete stays deleted when merged with a teammate's older copy", () => {
    const { base, raj } = start();
    const { a, b } = people(base);
    clockMin = 5;
    a.deleteContact(raj.id);
    const m = merge(base, a.db, b.db);
    expect(m.contacts).toEqual([]);
    expect(m.interactions.filter((i) => i.contact_id === raj.id)).toEqual([]);
    expect(m.drafts).toEqual([]); // its draft went with it
    expect(m.tombstones.contact[raj.id]).toBeTruthy();
  });

  it("a lead a teammate deleted disappears from my copy if I didn't touch it", () => {
    const { base, raj } = start();
    const { a, b } = people(base);
    clockMin = 5;
    b.deleteContact(raj.id);
    const remote = merge(base, b.db, base); // B saved their deletion
    expect(merge(base, a.db, remote).contacts).toEqual([]);
  });

  it("an edit made after the deletion brings the record back", () => {
    const { base, raj } = start();
    const { a, b } = people(base);
    clockMin = 5;
    b.deleteContact(raj.id);
    const remote = merge(base, b.db, base, 6);
    clockMin = 20;
    a.updateContact(raj.id, { remarks: "still talking to them" });
    const m = merge(base, a.db, remote, 25);
    expect(m.contacts.map((c) => c.id)).toEqual([raj.id]);
    expect(m.tombstones.contact[raj.id]).toBeUndefined();
  });

  it("removing a company removes what hangs off it, even a lead a teammate just added to it", () => {
    const { base, co } = start();
    const { a, b } = people(base);
    clockMin = 5;
    a.deleteCompany(co.id);
    clockMin = 6;
    b.createContact({ company_id: co.id, name: "Late", email: "late@acme.com" });
    const m = merge(base, a.db, b.db);
    expect(m.companies).toEqual([]);
    expect(m.contacts).toEqual([]);
    expect(m.drafts).toEqual([]);
  });

  it("a deletion at the very same instant as the last edit still deletes", () => {
    const { base, raj } = start();
    const { a } = people(base);
    const remote = clone(base);
    remote.contacts[0].updated_at = at(7);
    remote.tombstones.contact[raj.id] = at(7);
    expect(merge(base, a.db, remote).contacts).toEqual([]);
  });

  it("an interaction removed with its lead leaves a note so it can't return", () => {
    const { base, raj } = start();
    const { a } = people(base);
    clockMin = 3;
    a.logInteraction(raj.id, { type: "outreach", channel: "email", content: "hi" });
    const mid = merge(base, a.db, base, 4);
    const { b } = people(mid);
    clockMin = 6;
    b.deleteContact(raj.id);
    const m = merge(mid, b.db, mid, 7);
    expect(m.interactions).toEqual([]);
    const stale = merge(mid, a.db, m, 8); // a teammate's copy that still has the interaction
    expect(stale.interactions).toEqual([]);
  });

  it("heals a lost update: a record missing from the file with no deletion note is kept", () => {
    const { base } = start();
    const { a } = people(base);
    const remote = clone(base);
    remote.contacts = []; // someone overwrote the file without it
    remote.drafts = [];
    const m = merge(base, a.db, remote);
    expect(m.contacts).toHaveLength(1);
    expect(m.drafts).toHaveLength(1);
  });

  it("forgets deletions older than half a year", () => {
    const { base } = start();
    const { a } = people(base);
    const remote = clone(base);
    remote.tombstones.contact["999"] = "2025-01-01T00:00:00.000Z";
    expect(merge(base, a.db, remote).tombstones.contact["999"]).toBeUndefined();
  });
});

describe("sending", () => {
  const sent = (d: DB, by: string, min: number) => {
    const dr = d.drafts[0];
    dr.status = "sent";
    dr.sent_at = at(min);
    dr.updated_at = at(min);
    dr.approved_by = by;
  };

  it("a sent email stays sent even if a teammate's copy was edited later", () => {
    const { base } = start();
    const { a, b } = people(base);
    sent(a.db, "a@x", 5);
    clockMin = 20;
    b.db.drafts[0].body = "edited later";
    b.db.drafts[0].status = "draft";
    b.db.drafts[0].updated_at = at(20);
    expect(merge(base, b.db, a.db).drafts[0].status).toBe("sent");
    expect(merge(base, a.db, b.db).drafts[0].status).toBe("sent");
  });

  it("if both sent it, the first send is the one recorded", () => {
    const { base } = start();
    const { a, b } = people(base);
    sent(a.db, "a@x", 7);
    sent(b.db, "b@x", 5);
    expect(merge(base, a.db, b.db).drafts[0].sent_at).toBe(at(5));
  });

  it("two people claiming the same draft: the earlier claim keeps it", () => {
    const { base } = start();
    const { a, b } = people(base);
    Object.assign(a.db.drafts[0], { status: "sending", claimed_by: "a@x", claimed_at: at(5), updated_at: at(5) });
    Object.assign(b.db.drafts[0], { status: "sending", claimed_by: "b@x", claimed_at: at(4), updated_at: at(4) });
    expect(merge(base, a.db, b.db).drafts[0].claimed_by).toBe("b@x");
    expect(merge(base, b.db, a.db).drafts[0].claimed_by).toBe("b@x");
  });

  it("a claim beats an older approved copy, and a failed send (back to approved, later) beats the claim", () => {
    const { base } = start();
    const { a, b } = people(base);
    Object.assign(a.db.drafts[0], { status: "sending", claimed_by: "a@x", claimed_at: at(5), updated_at: at(5) });
    expect(merge(base, b.db, a.db).drafts[0].status).toBe("sending");
    Object.assign(a.db.drafts[0], { status: "approved", updated_at: at(8) });
    const remote = clone(base);
    Object.assign(remote.drafts[0], { status: "sending", claimed_by: "a@x", claimed_at: at(5), updated_at: at(5) });
    expect(merge(base, a.db, remote).drafts[0].status).toBe("approved");
  });
});

describe("everything else", () => {
  it("settings merge field by field", () => {
    const { base } = start();
    const { a, b } = people(base);
    a.db.settings.team_brief = "A's brief";
    b.db.settings.event_name = "B's name";
    const m = merge(base, a.db, b.db);
    expect([m.settings.team_brief, m.settings.event_name]).toEqual(["A's brief", "B's name"]);
  });

  it("each person keeps their own mailbox position, and sees everyone's in the file", () => {
    const { base } = start();
    const { a, b } = people(base);
    a.db.mailbox.synced_until = 111;
    b.db.mailbox.synced_until = 222;
    const remote = { ...clone(b.db), mailboxes: { "b@x": clone(b.db.mailbox) } };
    const m = reconcile(base, a.db, remote, at(30), "a@x");
    expect(m.mailbox.synced_until).toBe(111);
    expect(m.mailboxes["a@x"].synced_until).toBe(111);
    expect(m.mailboxes["b@x"].synced_until).toBe(222);
  });

  it("folds twin companies (same name added at once), moving their leads onto the older one", () => {
    const { base } = start();
    const { a, b } = people(base);
    clockMin = 5;
    const ca = a.createCompany({ name: "Globex" });
    a.createContact({ company_id: ca.id, name: "Gail", email: "gail@globex.com" });
    clockMin = 6;
    const cb = b.createCompany({ name: "globex" });
    b.createContact({ company_id: cb.id, name: "Greg", email: "greg@globex.com" });
    const m = merge(base, a.db, b.db);
    const globex = m.companies.filter((c) => c.name.toLowerCase() === "globex");
    expect(globex).toHaveLength(1);
    expect(m.contacts.filter((c) => c.company_id === globex[0].id).map((c) => c.name).sort()).toEqual(["Gail", "Greg"]);
    expect(globex[0].id).toBe(ca.id); // the older one
  });

  it("folds twin leads (same company and email), moving their history onto the older one", () => {
    const { base, co } = start();
    const { a, b } = people(base);
    clockMin = 5;
    const la = a.createContact({ company_id: co.id, name: "Sam", email: "sam@acme.com" });
    clockMin = 6;
    const lb = b.createContact({ company_id: co.id, name: "Sam", email: "SAM@acme.com" });
    b.logInteraction(lb.id, { type: "outreach", channel: "email", content: "called" });
    const m = merge(base, a.db, b.db);
    const sams = m.contacts.filter((c) => c.name === "Sam");
    expect(sams.map((c) => c.id)).toEqual([la.id]);
    expect(m.interactions.some((i) => i.contact_id === la.id && i.content === "called")).toBe(true);
  });

  it("without a base nothing is stamped and the later edit still wins", () => {
    const { base, raj } = start();
    const { a, b } = people(base);
    clockMin = 5;
    a.updateContact(raj.id, { remarks: "A" });
    clockMin = 9;
    b.updateContact(raj.id, { remarks: "B" });
    expect(merge(null, a.db, b.db).contacts[0].remarks).toBe("B");
    expect(merge(null, b.db, a.db).contacts[0].remarks).toBe("B");
  });

  it("does not change what it is given", () => {
    const { base, raj } = start();
    const { a, b } = people(base);
    a.updateContact(raj.id, { remarks: "x" });
    const [la, lb] = [JSON.stringify(a.db), JSON.stringify(b.db)];
    merge(base, a.db, b.db);
    expect([JSON.stringify(a.db), JSON.stringify(b.db)]).toEqual([la, lb]);
  });

  it("is stable: merging the result again changes nothing", () => {
    const { base, co } = start();
    const { a, b } = people(base);
    clockMin = 5;
    a.createContact({ company_id: co.id, name: "Ana", email: "ana@acme.com" });
    b.deleteContact(base.contacts[0].id);
    const m1 = merge(base, a.db, b.db);
    const m2 = merge(m1, m1, m1, 31);
    expect(sameData(m1, m2)).toBe(true);
  });
});

describe("helpers", () => {
  it("sameData ignores edit stamps and mailbox positions, but not real content", () => {
    const { base } = start();
    const x = clone(base);
    x.contacts[0].updated_at = "2030-01-01T00:00:00.000Z";
    x.mailbox.synced_until = 5;
    expect(sameData(base, x)).toBe(true);
    x.contacts[0].remarks = "changed";
    expect(sameData(base, x)).toBe(false);
  });

  it("shared ids are unique and rising even within one millisecond, and differ between people", () => {
    const gen = sharedIds(() => 1_800_000_000_000, () => 0.5);
    const ids = Array.from({ length: 1000 }, () => gen("contact", {} as DB));
    expect(new Set(ids).size).toBe(1000);
    expect([...ids].sort((p, q) => p - q)).toEqual(ids);
    expect(ids.every((i) => Number.isSafeInteger(i))).toBe(true);
    const x = sharedIds(() => 1_800_000_000_000, () => 0.1)("draft", {} as DB);
    const y = sharedIds(() => 1_800_000_000_000, () => 0.9)("draft", {} as DB);
    expect(x).not.toBe(y);
  });
});
