import { beforeEach, describe, expect, it } from "vitest";
import { Core } from "./core";
import { addressOf, parseGmailMessage, stripQuoted, syncReplies } from "./replies";
import type { GmailMessage, GmailPart, IncomingMessage, MailboxReader } from "./replies";

const enc = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const h = (o: Record<string, string>) => Object.entries(o).map(([name, value]) => ({ name, value }));

/** A Gmail API message the way the API returns it (format=full). */
const gm = (o: { id?: string; thread?: string; at?: string; headers?: Record<string, string>; text?: string; html?: string; mime?: string; parts?: GmailPart[] }): GmailMessage => ({
  id: o.id ?? "m1",
  threadId: o.thread ?? "t1",
  internalDate: String(new Date(o.at ?? "2026-03-11T09:00:00Z").getTime()),
  payload: {
    mimeType: o.mime ?? "multipart/alternative",
    headers: h({ From: "Raj Mehta <raj@acme.com>", Subject: "Re: Sponsor brAInwave 3", "Message-ID": "<reply-1@acme.com>", ...(o.headers ?? {}) }),
    parts: o.parts ?? [
      ...(o.text !== undefined ? [{ mimeType: "text/plain", body: { data: enc(o.text) } }] : []),
      ...(o.html !== undefined ? [{ mimeType: "text/html", body: { data: enc(o.html) } }] : []),
    ],
  },
});

describe("reading a Gmail message", () => {
  it("pulls out the sender, subject, ids, time and the plain-text body", () => {
    const m = parseGmailMessage(gm({ headers: { "In-Reply-To": "<sent-1@x>", References: "<a@x> <sent-1@x>" }, text: "Sounds good, call me Tuesday." }));
    expect(m).toMatchObject({ id: "m1", thread_id: "t1", message_id: "<reply-1@acme.com>", from_email: "raj@acme.com", subject: "Re: Sponsor brAInwave 3", body: "Sounds good, call me Tuesday.", is_bounce: false, is_auto_reply: false });
    expect(m.in_reply_to).toEqual(["<sent-1@x>", "<a@x>", "<sent-1@x>"]);
    expect(m.sent_at).toBe("2026-03-11T09:00:00.000Z");
  });

  it("reads non-English text and falls back to HTML when there is no plain part", () => {
    expect(parseGmailMessage(gm({ text: "धन्यवाद — très bien ✓" })).body).toBe("धन्यवाद — très bien ✓");
    const html = parseGmailMessage(gm({ html: "<style>p{}</style><p>Hello&nbsp;<b>there</b></p><div>Bye</div>" })).body;
    expect(html.replace(/\s+/g, " ")).toBe("Hello there Bye");
  });

  it("keeps what the person wrote and drops the quoted thread", () => {
    const text = "Yes, interested.\n\n> earlier text\nOn Tue, 10 Mar 2026, Asha <a@x.com> wrote:\nOur pitch...\n";
    expect(stripQuoted(text)).toBe("Yes, interested.");
    expect(stripQuoted("Hi\n-----Original Message-----\nold")).toBe("Hi");
    expect(stripQuoted("Hi\nFrom: Bob <b@x.com>\nold")).toBe("Hi");
    expect(stripQuoted("a".repeat(9000)).length).toBe(4000);
  });

  it("handles 'Name <addr>' forms, odd case and quotes", () => {
    expect(addressOf('"Mehta, Raj" <Raj@Acme.COM>')).toBe("raj@acme.com");
    expect(addressOf("raj@acme.com")).toBe("raj@acme.com");
  });

  it("makes up an id when the email has no Message-ID, and tidies a multi-line subject", () => {
    const m = parseGmailMessage(gm({ id: "abc", headers: { "Message-ID": "", Subject: "Re:  hello\r\n   world" }, text: "x" }));
    expect([m.message_id, m.subject]).toEqual(["<gmail-abc@no-message-id>", "Re: hello world"]);
  });

  it.each([
    [{ "Auto-Submitted": "auto-replied" }, ""],
    [{ Precedence: "bulk" }, ""],
    [{ "X-Autoreply": "yes" }, ""],
    [{}, "Out of office: back Monday"],
    [{}, "Automatic reply: away"],
    [{}, "Autoreply"],
  ])("recognises an auto-reply (%j / %j)", (headers, subject) => {
    expect(parseGmailMessage(gm({ headers: { ...headers, ...(subject ? { Subject: subject } : {}) }, text: "x" })).is_auto_reply).toBe(true);
  });

  it("doesn't mistake a normal reply, or 'Auto-Submitted: no', for an auto-reply", () => {
    expect(parseGmailMessage(gm({ headers: { "Auto-Submitted": "no" }, text: "x" })).is_auto_reply).toBe(false);
  });

  it("recognises delivery failures by sender, by report type, and by subject", () => {
    expect(parseGmailMessage(gm({ headers: { From: "Mail Delivery Subsystem <MAILER-DAEMON@googlemail.com>" }, text: "x" })).is_bounce).toBe(true);
    expect(parseGmailMessage(gm({ headers: { From: "postmaster@x.com" }, text: "x" })).is_bounce).toBe(true);
    expect(parseGmailMessage(gm({ mime: "multipart/report", headers: { From: "x@y.com", "Content-Type": 'multipart/report; report-type=delivery-status; boundary="b"' }, text: "x" })).is_bounce).toBe(true);
    expect(parseGmailMessage(gm({ headers: { From: "x@y.com", Subject: "Undeliverable: Hi" }, text: "x" })).is_bounce).toBe(true);
    expect(parseGmailMessage(gm({ mime: "multipart/report", headers: { From: "x@y.com", "Content-Type": "multipart/report; report-type=disposition-notification" }, text: "x" })).is_bounce).toBe(false);
  });

  it("keeps the whole delivery report (including the status part) for bounce handling", () => {
    const m = parseGmailMessage(
      gm({ headers: { From: "mailer-daemon@googlemail.com" }, parts: [{ mimeType: "text/plain", body: { data: enc("Delivery failed") } }, { mimeType: "message/delivery-status", body: { data: enc("Final-Recipient: rfc822; raj@acme.com\nStatus: 5.1.1") } }] }),
    );
    expect(m.raw_text).toContain("Status: 5.1.1");
    expect(parseGmailMessage(gm({ text: "ordinary" })).raw_text).toBe(""); // only kept for bounces
  });

  it("ignores attachments when looking for the body", () => {
    const m = parseGmailMessage(gm({ parts: [{ mimeType: "text/plain", filename: "notes.txt", body: { data: enc("ATTACHED") } }, { mimeType: "text/plain", body: { data: enc("the message") } }] }));
    expect(m.body).toBe("the message");
  });
});

// ---------------------------------------------------------------- the sync
let clock: Date;
let core: Core;
const now = () => clock;

class FakeInbox implements MailboxReader {
  inbox: IncomingMessage[] = [];
  fail: string | null = null;
  asked: { sinceMs: number; skipIds: string[] }[] = [];
  async fetch(a: { sinceMs: number; skipIds: Set<string> }) {
    this.asked.push({ sinceMs: a.sinceMs, skipIds: [...a.skipIds] });
    if (this.fail) throw new Error(this.fail);
    return this.inbox.filter((m) => !a.skipIds.has(m.id));
  }
}
let inbox: FakeInbox;

const msg = (o: Partial<IncomingMessage> = {}): IncomingMessage => ({
  id: "g1",
  thread_id: "t-other",
  message_id: "<r1@acme.com>",
  from_email: "raj@acme.com",
  subject: "Re: Sponsor",
  body: "Sounds good",
  sent_at: "2026-03-11T09:00:00.000Z",
  in_reply_to: ["<sent-1@x>"],
  is_auto_reply: false,
  is_bounce: false,
  raw_text: "",
  ...o,
});

/** We emailed Raj (message id <sent-1@x>, conversation t-sent). */
const sent = () => {
  const company = core.createCompany({ name: "Acme" });
  const raj = core.createContact({ company_id: company.id, name: "Raj", email: "raj@acme.com" });
  core.updateContact(raj.id, { status: "contacted", channels: ["email"] });
  core.addInteraction(raj.id, { type: "email_sent", channel: "email", subject: "Sponsor", occurred_at: "2026-03-10T09:00:00.000Z", message_id: "<sent-1@x>", thread_id: "t-sent" });
  return { company, raj };
};
const sync = () => syncReplies(core, inbox, "us@gmail.com");

beforeEach(() => {
  clock = new Date("2026-03-12T12:00:00Z");
  core = new Core(undefined, now);
  inbox = new FakeInbox();
});

describe("syncing replies", () => {
  it("a reply to our email is logged on the lead and flagged for a person; status is left alone", async () => {
    const { raj } = sent();
    inbox.inbox = [msg()];
    const r = await sync();
    expect(r).toEqual({ fetched: 1, replies: 1, bounces: 0, ignored: 0, unmatched: 0 });
    const c = core.getContact(raj.id);
    expect([c.reply_unread, c.status]).toEqual([true, "contacted"]);
    expect(c.last_contacted_at).toBe("2026-03-12T12:00:00.000Z"); // already later: a reply never pulls it back
    const item = core.db.interactions.find((i) => i.type === "email_reply")!;
    expect([item.source, item.channel, item.content, item.contact_id]).toEqual(["auto", "email", "Sounds good", raj.id]);
    expect(core.dashboard().new_replies.map((x) => x.id)).toEqual([raj.id]);
  });

  it("matches by Gmail's conversation id even if the Message-ID was rewritten", async () => {
    const { raj } = sent();
    inbox.inbox = [msg({ in_reply_to: ["<something-else@x>"], thread_id: "t-sent", from_email: "someone-else@acme.com" })];
    expect((await sync()).replies).toBe(1);
    expect(core.getContact(raj.id).reply_unread).toBe(true);
  });

  it("falls back to the sender's address, and says so", async () => {
    sent();
    inbox.inbox = [msg({ in_reply_to: [] })];
    await sync();
    expect(core.db.interactions.find((i) => i.type === "email_reply")!.content).toContain("Matched by the sender's address");
  });

  it("credits a colleague who answers on their behalf", async () => {
    const { company } = sent();
    const sam = core.createContact({ company_id: company.id, name: "Sam", email: "sam@acme.com" });
    inbox.inbox = [msg({ from_email: "sam@acme.com" })];
    await sync();
    expect(core.getContact(sam.id).reply_unread).toBe(true);
  });

  it("leaves mail from strangers alone", async () => {
    sent();
    inbox.inbox = [msg({ from_email: "newsletter@random.com", in_reply_to: [] })];
    expect(await sync()).toMatchObject({ unmatched: 1, replies: 0 });
    expect(core.db.interactions.filter((i) => i.type === "email_reply")).toHaveLength(0);
  });

  it("ignores our own mail and auto-replies", async () => {
    sent();
    inbox.inbox = [msg({ id: "a", is_auto_reply: true }), msg({ id: "b", message_id: "<own@x>", from_email: "us@gmail.com" })];
    expect(await sync()).toMatchObject({ ignored: 2, replies: 0 });
  });

  it("a permanent bounce marks the lead do-not-contact and leaves a note", async () => {
    const { raj } = sent();
    inbox.inbox = [msg({ is_bounce: true, from_email: "mailer-daemon@googlemail.com", raw_text: "Final-Recipient: rfc822; raj@acme.com\nStatus: 5.1.1", message_id: "<b1@g>" })];
    expect(await sync()).toMatchObject({ bounces: 1 });
    expect(core.getContact(raj.id).do_not_contact).toBe(true);
    const note = core.db.interactions.find((i) => i.type === "note")!;
    expect(note.subject).toBe("Delivery failed: raj@acme.com");
    expect(note.content).toContain("permanently");
  });

  it("a temporary bounce is only a note", async () => {
    const { raj } = sent();
    inbox.inbox = [msg({ is_bounce: true, from_email: "mailer-daemon@googlemail.com", raw_text: "Final-Recipient: rfc822; raj@acme.com\nStatus: 4.2.2", message_id: "<b2@g>" })];
    await sync();
    expect(core.getContact(raj.id).do_not_contact).toBe(false);
    expect(core.db.interactions.find((i) => i.type === "note")!.content).toContain("temporary");
  });

  it("finds the failed address in free text when there is no status block, and ignores strangers' bounces", async () => {
    const { raj } = sent();
    inbox.inbox = [
      msg({ id: "x", is_bounce: true, from_email: "mailer-daemon@g.com", raw_text: "Your message to raj@acme.com could not be delivered", message_id: "<b3@g>" }),
      msg({ id: "y", is_bounce: true, from_email: "mailer-daemon@g.com", raw_text: "Final-Recipient: rfc822; nobody@else.com\nStatus: 5.1.1", message_id: "<b4@g>" }),
    ];
    expect(await sync()).toMatchObject({ bounces: 1, ignored: 1 });
    expect(core.getContact(raj.id).do_not_contact).toBe(false); // no "Status: 5" seen, so not marked
  });

  it("ignores a bounce about a lead we never emailed (it can't have come from us)", async () => {
    const { company } = sent();
    const sam = core.createContact({ company_id: company.id, name: "Sam", email: "sam@acme.com" });
    inbox.inbox = [msg({ is_bounce: true, from_email: "mailer-daemon@g.com", raw_text: "Final-Recipient: rfc822; sam@acme.com\nStatus: 5.1.1", message_id: "<b5@g>" })];
    expect(await sync()).toMatchObject({ bounces: 0, ignored: 1 });
    expect(core.getContact(sam.id).do_not_contact).toBe(false);
  });

  it("running again doesn't duplicate anything", async () => {
    sent();
    inbox.inbox = [msg()];
    await sync();
    inbox.inbox = [msg({ id: "g-again" })]; // same email seen under a new Gmail id
    expect((await sync()).ignored).toBe(1);
    expect(core.db.interactions.filter((i) => i.type === "email_reply")).toHaveLength(1);
  });

  it("doesn't ask for messages it has already handled", async () => {
    sent();
    inbox.inbox = [msg()];
    await sync();
    await sync();
    expect(inbox.asked[1].skipIds).toEqual(["g1"]);
  });

  it("the first check looks back 14 days; later ones start a little before the last check", async () => {
    sent();
    await sync();
    expect(inbox.asked[0].sinceMs).toBe(clock.getTime() - 14 * 86_400_000);
    const firstDone = clock.getTime();
    clock = new Date(firstDone + 3_600_000 * 5);
    await sync();
    expect(inbox.asked[1].sinceMs).toBe(firstDone - 3_600_000);
  });

  it("records when it last checked and clears an old error", async () => {
    sent();
    inbox.fail = "Couldn't reach Google";
    await expect(sync()).rejects.toThrow("Couldn't reach Google");
    expect(core.db.mailbox.last_error).toBe("Couldn't reach Google");
    expect(core.db.mailbox.last_sync_at).toBeNull();
    inbox.fail = null;
    await sync();
    expect([core.db.mailbox.last_error, core.db.mailbox.last_sync_at]).toEqual([null, clock.toISOString()]);
  });

  it("a failed check doesn't move the cursor (nothing is skipped next time)", async () => {
    sent();
    inbox.fail = "down";
    await expect(sync()).rejects.toThrow();
    expect(core.db.mailbox.synced_until).toBeNull();
  });

  it("keeps the list of handled ids from growing forever", async () => {
    sent();
    inbox.inbox = Array.from({ length: 3100 }, (_, i) => msg({ id: `g${i}`, message_id: `<m${i}@x>`, from_email: "spam@x.com", in_reply_to: [] }));
    await sync();
    expect(core.db.mailbox.processed).toHaveLength(3000);
  });
});
