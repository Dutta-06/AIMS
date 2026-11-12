import { beforeEach, describe, expect, it, vi } from "vitest";
import { Core } from "./core";
import { ApiError } from "./errors";

const DAY = 86_400_000;
let clock = new Date("2026-03-10T10:00:00Z");
let core: Core;
let changes = 0;

beforeEach(() => {
  clock = new Date("2026-03-10T10:00:00Z");
  changes = 0;
  core = new Core(undefined, () => clock, () => (changes += 1));
});

const ago = (days: number) => new Date(clock.getTime() - days * DAY).toISOString();
const fails = (fn: () => unknown, status: number, text?: RegExp | string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(status);
    if (text) expect((e as ApiError).message).toMatch(text);
    return;
  }
  throw new Error("expected it to fail");
};
const lead = () => {
  const company = core.createCompany({ name: "Acme" });
  const contact = core.createContact({ company_id: company.id, name: "Raj Mehta", email: "raj@acme.com", role: "DevRel" });
  return { company, contact };
};

describe("companies", () => {
  it("refuses a duplicate name, ignoring case and spaces", () => {
    core.createCompany({ name: "Acme" });
    fails(() => core.createCompany({ name: "  acme " }), 409);
  });

  it("needs a name and trims blanks to nothing", () => {
    fails(() => core.createCompany({ name: "   " }), 422);
    const c = core.createCompany({ name: "Zed", industry: "  ", website: "", notes: " hi " });
    expect([c.industry, c.website, c.notes]).toEqual([null, null, "hi"]);
  });

  it("searches by name, sorted", () => {
    for (const n of ["Beta", "alpha", "Acme"]) core.createCompany({ name: n });
    expect(core.listCompanies().map((c) => c.name)).toEqual(["Acme", "alpha", "Beta"]);
    expect(core.listCompanies("acm").map((c) => c.name)).toEqual(["Acme"]);
  });

  it("can be renamed, but not onto another company's name", () => {
    const a = core.createCompany({ name: "A" });
    core.createCompany({ name: "B" });
    expect(core.updateCompany(a.id, { name: "A2", industry: "AI" }).name).toBe("A2");
    fails(() => core.updateCompany(a.id, { name: "b" }), 409);
    expect(core.updateCompany(a.id, { name: "A2" }).name).toBe("A2"); // its own name is fine
  });

  it("deleting a company removes its leads, their history and drafts", () => {
    const { company, contact } = lead();
    core.logInteraction(contact.id, { type: "note", content: "x" });
    core.db.drafts.push({ id: 1, contact_id: contact.id } as never);
    core.deleteCompany(company.id);
    expect([core.db.contacts, core.db.interactions, core.db.drafts].map((x) => x.length)).toEqual([0, 0, 0]);
    fails(() => core.getCompany(company.id), 404);
  });
});

describe("leads", () => {
  it("need something to identify them", () => {
    const co = core.createCompany({ name: "Acme" });
    fails(() => core.createContact({ company_id: co.id }), 422);
    fails(() => core.createContact({ company_id: co.id, name: "  " }), 422);
    for (const ok of [{ name: "A" }, { email: "a@b.com" }, { linkedin: "https://linkedin.com/in/a" }]) {
      expect(core.createContact({ company_id: co.id, ...ok }).id).toBeGreaterThan(0);
    }
  });

  it("must belong to a company that exists", () => {
    fails(() => core.createContact({ company_id: 99, name: "X" }), 404);
  });

  it("email is optional but validated, and stored in lowercase", () => {
    const co = core.createCompany({ name: "Acme" });
    expect(core.createContact({ company_id: co.id, linkedin: "x" }).email).toBeNull();
    fails(() => core.createContact({ company_id: co.id, name: "P", email: "not-an-email" }), 422);
    expect(core.createContact({ company_id: co.id, name: "Q", email: " Q@Acme.COM " }).email).toBe("q@acme.com");
  });

  it("turns blank strings into nothing", () => {
    const co = core.createCompany({ name: "Acme" });
    const c = core.createContact({ company_id: co.id, name: "P", role: "  ", remarks: "" });
    expect([c.role, c.remarks]).toEqual([null, null]);
  });

  it("start not contacted, with no channels, carrying their company's name", () => {
    const { contact } = lead();
    expect([contact.status, contact.channels, contact.last_contacted_at, contact.company_name]).toEqual(["not_contacted", [], null, "Acme"]);
  });

  it("only have channels once contacted; going back clears them", () => {
    const { contact } = lead();
    fails(() => core.updateContact(contact.id, { channels: ["email"] }), 422);
    const c = core.updateContact(contact.id, { status: "contacted", channels: ["email", "linkedin", "email"] });
    expect(c.channels).toEqual(["email", "linkedin"]);
    expect(core.updateContact(contact.id, { status: "not_contacted" }).channels).toEqual([]);
  });

  it("marking contacted by hand starts the follow-up clock", () => {
    const { contact } = lead();
    expect(core.updateContact(contact.id, { status: "contacted" }).last_contacted_at).toBe(clock.toISOString());
  });

  it("refuse unknown channels and statuses", () => {
    const { contact } = lead();
    fails(() => core.updateContact(contact.id, { status: "contacted", channels: ["fax" as never] }), 422);
    fails(() => core.updateContact(contact.id, { status: "won" as never }), 422);
  });

  it("can't lose their last identifier, and a failed edit changes nothing", () => {
    const co = core.createCompany({ name: "Acme" });
    const c = core.createContact({ company_id: co.id, name: "Only Name" });
    fails(() => core.updateContact(c.id, { name: "", remarks: "should not stick" }), 422);
    const after = core.getContact(c.id);
    expect([after.name, after.remarks]).toEqual(["Only Name", null]);
  });

  it("filter by company, status and search (names, roles, remarks, companies)", () => {
    const { company } = lead();
    const zeta = core.createCompany({ name: "Zeta" });
    core.createContact({ company_id: company.id, name: "Ann", role: "CEO", remarks: "met at expo" });
    const bob = core.createContact({ company_id: zeta.id, name: "Bob" });
    core.updateContact(bob.id, { status: "contacted", channels: ["discord"] });
    const names = (p: Parameters<Core["listContacts"]>[0]) => core.listContacts(p).map((c) => c.name).sort();
    expect(names({ status: "contacted" })).toEqual(["Bob"]);
    expect(names({ company_id: zeta.id })).toEqual(["Bob"]);
    expect(names({ q: "expo" })).toEqual(["Ann"]);
    expect(names({ q: "zeta" })).toEqual(["Bob"]);
    expect(names({ q: "devrel" })).toEqual(["Raj Mehta"]);
  });

  it("are listed by company then name", () => {
    const b = core.createCompany({ name: "B" });
    const a = core.createCompany({ name: "A" });
    core.createContact({ company_id: b.id, name: "Zed" });
    core.createContact({ company_id: a.id, name: "Yan" });
    core.createContact({ company_id: a.id, name: "Abe" });
    expect(core.listContacts().map((c) => c.name)).toEqual(["Abe", "Yan", "Zed"]);
  });

  it("are returned as copies, so a screen can't change the stored data by accident", () => {
    const { contact } = lead();
    contact.name = "Hacked";
    contact.channels.push("email");
    expect(core.getContact(contact.id).name).toBe("Raj Mehta");
    expect(core.getContact(contact.id).channels).toEqual([]);
  });
});

describe("logging what happened", () => {
  it("outreach marks the lead contacted on that channel", () => {
    const { contact } = lead();
    core.logInteraction(contact.id, { type: "outreach", channel: "linkedin", content: "sent a request" });
    let c = core.getContact(contact.id);
    expect([c.status, c.channels, c.last_contacted_at]).toEqual(["contacted", ["linkedin"], clock.toISOString()]);
    core.logInteraction(contact.id, { type: "outreach", channel: "discord" });
    c = core.getContact(contact.id);
    expect(c.channels).toEqual(["linkedin", "discord"]);
  });

  it("outreach and replies must say which channel", () => {
    const { contact } = lead();
    fails(() => core.logInteraction(contact.id, { type: "outreach" }), 422, /channel/);
    fails(() => core.logInteraction(contact.id, { type: "reply" }), 422, /channel/);
  });

  it("a reply makes them responded, and clears 'unread'", () => {
    const { contact } = lead();
    core.updateContact(contact.id, { reply_unread: true });
    core.logInteraction(contact.id, { type: "outreach", channel: "email" });
    core.logInteraction(contact.id, { type: "reply", channel: "email", content: "Sounds good" });
    const c = core.getContact(contact.id);
    expect([c.status, c.reply_unread]).toEqual(["responded", false]);
  });

  it("follow-up outreach never moves a responded lead backwards", () => {
    const { contact } = lead();
    core.logInteraction(contact.id, { type: "reply", channel: "linkedin" });
    core.logInteraction(contact.id, { type: "outreach", channel: "email" });
    expect(core.getContact(contact.id).status).toBe("responded");
  });

  it("calls and notes don't change status; a call counts as being in touch", () => {
    const { contact } = lead();
    core.logInteraction(contact.id, { type: "note", content: "x" });
    expect(core.getContact(contact.id).last_contacted_at).toBeNull();
    core.logInteraction(contact.id, { type: "call", content: "y" });
    const c = core.getContact(contact.id);
    expect([c.status, c.last_contacted_at]).toEqual(["not_contacted", clock.toISOString()]);
  });

  it("can't fake a sent email by logging one", () => {
    const { contact } = lead();
    fails(() => core.logInteraction(contact.id, { type: "email_sent" }), 422);
  });

  it("rejects unknown types, channels and dates", () => {
    const { contact } = lead();
    fails(() => core.logInteraction(contact.id, { type: "poke" as never }), 422);
    fails(() => core.logInteraction(contact.id, { type: "note", channel: "fax" as never }), 422);
    fails(() => core.logInteraction(contact.id, { type: "note", occurred_at: "yesterday-ish" }), 422);
  });

  it("returns the timeline oldest first, without the app's private bookkeeping", () => {
    const { contact } = lead();
    core.logInteraction(contact.id, { type: "note", content: "second", occurred_at: ago(1) });
    core.logInteraction(contact.id, { type: "note", content: "first", occurred_at: ago(5) });
    const log = core.listInteractions(contact.id);
    expect(log.map((i) => i.content)).toEqual(["first", "second"]);
    expect(Object.keys(log[0])).not.toContain("message_id");
  });

  it("an older reply doesn't pull 'last contacted' backwards", () => {
    const { contact } = lead();
    core.logInteraction(contact.id, { type: "outreach", channel: "email", occurred_at: ago(1) });
    core.logInteraction(contact.id, { type: "reply", channel: "email", occurred_at: ago(9) });
    expect(core.getContact(contact.id).last_contacted_at).toBe(ago(1));
  });
});

describe("dashboard", () => {
  it("counts by status and lists who needs a follow-up", () => {
    const co = core.createCompany({ name: "Acme" });
    const mk = (name: string) => core.createContact({ company_id: co.id, name });
    const quiet = mk("Quiet");
    core.logInteraction(quiet.id, { type: "outreach", channel: "email", occurred_at: ago(30) });
    const due = mk("Due");
    core.updateContact(due.id, { status: "contacted", next_followup_at: ago(1) });
    const fresh = mk("Fresh");
    core.updateContact(fresh.id, { status: "contacted" });
    const later = mk("Later");
    core.updateContact(later.id, { status: "contacted", next_followup_at: new Date(clock.getTime() + 3 * DAY).toISOString() });
    const done = mk("Done");
    core.updateContact(done.id, { status: "responded", next_followup_at: ago(1) });
    mk("Cold");

    const d = core.dashboard();
    expect(d.total).toBe(6);
    expect(d.status_counts).toEqual({ not_contacted: 1, contacted: 4, responded: 1, no_response: 0 });
    expect(d.needs_followup.map((c) => c.name).sort()).toEqual(["Due", "Quiet"]); // not Fresh, Later or Done
  });

  it("doesn't chase people marked do-not-contact", () => {
    const { contact } = lead();
    core.logInteraction(contact.id, { type: "outreach", channel: "email", occurred_at: ago(30) });
    core.updateContact(contact.id, { do_not_contact: true });
    expect(core.dashboard().needs_followup).toEqual([]);
  });

  it("lists unread replies separately from follow-ups", () => {
    const { contact } = lead();
    core.logInteraction(contact.id, { type: "outreach", channel: "email", occurred_at: ago(30) });
    core.updateContact(contact.id, { reply_unread: true });
    const d = core.dashboard();
    expect(d.new_replies.map((c) => c.id)).toEqual([contact.id]);
    expect(d.needs_followup).toEqual([]); // already surfaced as a reply
  });

  it("uses the configured number of quiet days", () => {
    const { contact } = lead();
    core.logInteraction(contact.id, { type: "outreach", channel: "email", occurred_at: ago(3) });
    expect(core.dashboard().needs_followup).toEqual([]);
    core.db.settings.stale_after_days = 2;
    expect(core.dashboard().needs_followup.map((c) => c.id)).toEqual([contact.id]);
  });
});

describe("saving", () => {
  it("tells the owner about every change, and about nothing when only reading", () => {
    const { contact } = lead();
    const after = changes;
    core.listCompanies();
    core.listContacts();
    core.getContact(contact.id);
    core.dashboard();
    core.listInteractions(contact.id);
    expect(changes).toBe(after);
    core.updateContact(contact.id, { remarks: "x" });
    core.logInteraction(contact.id, { type: "note", content: "n" });
    core.deleteContact(contact.id);
    expect(changes).toBe(after + 3);
  });

  it("failed changes are not saved", () => {
    const { contact } = lead();
    const before = changes;
    fails(() => core.updateContact(contact.id, { channels: ["email"] }), 422);
    fails(() => core.createCompany({ name: "Acme" }), 409);
    expect(changes).toBe(before);
    vi.useRealTimers();
  });
});
