/**
 * The approval gate: the only code path that can send an email.
 *
 * Rules (all enforced here, covered by drafts.test.ts):
 *  - A draft can only be sent when a human has approved it.
 *  - Approval is bound to a hash of recipient + subject + body. Editing a draft, or changing the
 *    recipient's address, voids the approval.
 *  - Nothing but `send` calls the mailer; the AI and the reply tracker can only create or rewrite
 *    draft text.
 *  - An email can only become "sent" by being sent. A LinkedIn note is never sent from here: the
 *    team pastes it in themselves and records that they did.
 */
import type { Channel, Draft, DraftKind, DraftStatus } from "../types";
import type { Core } from "./core";
import { generateDraft, reviseDraft } from "./drafting";
import { ApiError, conflict, invalid, notFound } from "./errors";
import type { ContactRow, DraftRow } from "./model";
import type { LLM } from "./llm";
import { recordOutreach } from "./rules";

export interface Mailer {
  /** Send one email; returns the new message's ids (kept for matching replies). */
  send(m: { to: string; subject: string; body: string }): Promise<{ messageId: string | null; threadId: string | null }>;
}

export type Deps = {
  llm: () => LLM;
  /** null: no Gmail is connected, so nothing can be sent. */
  mailer: () => Mailer | null;
  /** Called after the claim is made and before the email goes out: saves the claim to the shared
   * file and looks for a teammate's claim on the same draft. */
  settle?: () => Promise<void>;
  /** Who is acting (their Google account), recorded as the approver. */
  who: () => string | null;
};

export async function contentHash(toEmail: string, subject: string, body: string): Promise<string> {
  const data = new TextEncoder().encode([toEmail.trim().toLowerCase(), subject, body].join("\u0000"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const publicDraft = ({ approved_hash, ...rest }: DraftRow): Draft => {
  void approved_hash;
  return { ...rest, history: rest.history.map((h) => ({ ...h })) };
};

const LOCKED: DraftStatus[] = ["sending", "sent"];
const voidApproval = (d: DraftRow) => {
  d.status = "draft";
  d.approved_hash = d.approved_by = d.approved_at = null;
};

export class Drafts {
  constructor(
    private core: Core,
    private deps: Deps,
  ) {}

  private require(id: number): DraftRow {
    const d = this.core.db.drafts.find((x) => x.id === id);
    if (!d) throw notFound("Draft", id);
    return d;
  }

  private contactOf(d: DraftRow): ContactRow {
    const c = this.core.db.contacts.find((x) => x.id === d.contact_id);
    if (!c) throw conflict("Recipient no longer exists");
    return c;
  }

  private emailOnly(d: DraftRow, what: string) {
    if (d.channel !== "email") {
      throw conflict(`${what} applies to emails. A LinkedIn note is copied into LinkedIn by hand; use “I sent it” afterwards`);
    }
  }

  private address(c: ContactRow): string {
    if (!c.email) throw conflict("This contact has no email address yet; add one first");
    return c.email;
  }

  list(p: { status?: DraftStatus; contact_id?: number } = {}): Draft[] {
    return this.core.db.drafts
      .filter((d) => (p.status === undefined || d.status === p.status) && (p.contact_id === undefined || d.contact_id === p.contact_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
      .map(publicDraft);
  }

  create(b: { contact_id: number; subject: string; body: string; channel?: Channel }): Draft {
    this.core.requireContact(b.contact_id);
    const channel = b.channel ?? "email";
    if (channel !== "email" && channel !== "linkedin") throw invalid("Drafts can be written for email or LinkedIn");
    if (!b.subject?.trim() || !b.body?.trim()) throw invalid("A draft needs a subject and a body");
    const d: DraftRow = {
      id: this.core.newId("draft"),
      contact_id: b.contact_id,
      channel,
      subject: b.subject,
      body: b.body,
      status: "draft",
      generated_by_ai: false,
      approved_hash: null,
      approved_by: null,
      approved_at: null,
      sent_at: null,
      last_error: null,
      created_at: this.core.iso(),
      history: [],
    };
    this.core.db.drafts.push(d);
    this.core.changed();
    return publicDraft(d);
  }

  async generate(b: { contact_id: number; kind: DraftKind; instructions?: string; channel?: Channel }): Promise<Draft> {
    const contact = this.core.requireContact(b.contact_id);
    const channel = b.channel ?? "email";
    if (contact.do_not_contact) throw conflict("This contact is marked do-not-contact");
    if (channel === "email" && !contact.email) throw conflict("This contact has no email address yet; add one first");
    return publicDraft(await generateDraft(this.core, this.deps.llm(), contact, b.kind, b.instructions, channel));
  }

  edit(id: number, b: { subject?: string; body?: string }): Draft {
    const d = this.require(id);
    if (LOCKED.includes(d.status)) throw conflict(`A ${d.status} draft cannot be edited`);
    if (b.subject !== undefined) {
      if (!b.subject.trim()) throw invalid("The subject can't be empty");
      d.subject = b.subject;
    }
    if (b.body !== undefined) {
      if (!b.body.trim()) throw invalid("The body can't be empty");
      d.body = b.body;
    }
    voidApproval(d); // any edit means the approval no longer covers what would be sent
    this.core.changed();
    return publicDraft(d);
  }

  async revise(id: number, feedback: string): Promise<Draft> {
    const d = this.require(id);
    if (LOCKED.includes(d.status)) throw conflict(`A ${d.status} draft cannot be changed`);
    return publicDraft(await reviseDraft(this.core, this.deps.llm(), d, feedback));
  }

  /** Put back the version before the last AI revision. The approval stays voided. */
  undo(id: number): Draft {
    const d = this.require(id);
    if (LOCKED.includes(d.status)) throw conflict(`A ${d.status} draft cannot be changed`);
    const last = d.history[d.history.length - 1];
    if (!last) throw conflict("There is no earlier version to go back to");
    d.history = d.history.slice(0, -1);
    d.subject = last.subject;
    d.body = last.body;
    voidApproval(d);
    this.core.changed();
    return publicDraft(d);
  }

  async approve(id: number): Promise<Draft> {
    const d = this.require(id);
    this.emailOnly(d, "Approval");
    if (d.status !== "draft") throw conflict(`Only drafts awaiting review can be approved (is ${d.status})`);
    const contact = this.contactOf(d);
    if (contact.do_not_contact) throw conflict("This contact is marked do-not-contact");
    const hash = await contentHash(this.address(contact), d.subject, d.body);
    if (d.status !== "draft") throw conflict("This draft changed while it was being approved; reload and check");
    d.status = "approved";
    d.approved_hash = hash;
    d.approved_by = this.deps.who() ?? "Team";
    d.approved_at = this.core.iso();
    d.last_error = null;
    this.core.changed();
    return publicDraft(d);
  }

  revoke(id: number): Draft {
    const d = this.require(id);
    if (d.status !== "approved") throw conflict("Only approved drafts can be revoked");
    voidApproval(d);
    this.core.changed();
    return publicDraft(d);
  }

  async send(id: number): Promise<Draft> {
    let d = this.require(id);
    this.emailOnly(d, "Sending");
    if (d.status !== "approved" || d.approved_hash === null) throw conflict("Draft has not been approved by a human");
    let contact = this.contactOf(d);
    if (contact.do_not_contact) throw conflict("This contact is marked do-not-contact");
    const address = this.address(contact);
    const mailer = this.deps.mailer();
    if (!mailer) throw conflict("Gmail isn't connected. Connect it in Settings.");

    // Claim the draft before anything slow happens. Setting the status here, with nothing awaited
    // since the check above, is the lock: of two sends only one gets past, the other sees "sending".
    const me = this.deps.who() ?? "someone";
    d.status = "sending";
    d.claimed_by = me;
    d.claimed_at = this.core.iso();
    this.core.changed();
    const expected = d.approved_hash;
    const hashNow = await contentHash(address, d.subject, d.body);
    // Re-check under the claim: a change to the address that landed meanwhile voids the approval.
    const stillThere = this.core.db.contacts.find((c) => c.id === d.contact_id);
    if (hashNow !== expected || stillThere?.email?.toLowerCase() !== address.toLowerCase()) {
      voidApproval(d);
      this.core.changed();
      throw conflict("Draft changed since approval; review and approve it again");
    }
    if (this.deps.settle) {
      // Tell teammates this email is being sent, and check none of them got there first.
      await this.deps.settle().catch(() => {}); // an offline save here is fine: the in-memory claim still holds
      const live = this.core.db.drafts.find((x) => x.id === id);
      if (!live || live.status !== "sending" || live.claimed_by !== me) {
        throw conflict(live?.status === "sent" ? "A teammate has already sent this email" : "A teammate is sending this email right now");
      }
      d = live;
      contact = this.contactOf(d); // the merge replaced the records; work on the current ones
    }
    let sent: { messageId: string | null; threadId: string | null };
    try {
      sent = await mailer.send({ to: address, subject: d.subject, body: d.body });
    } catch (e) {
      d.status = "approved";
      d.claimed_by = d.claimed_at = null;
      d.last_error = e instanceof Error ? e.message : "The email couldn't be sent";
      this.core.changed();
      throw conflict(`Sending failed: ${d.last_error}`);
    }
    const now = this.core.iso();
    d.status = "sent";
    d.sent_at = now;
    d.last_error = null;
    d.claimed_by = d.claimed_at = null;
    recordOutreach(contact, "email", now); // contacted, by email, just now
    contact.updated_at = now;
    this.core.addInteraction(contact.id, {
      type: "email_sent",
      channel: "email",
      subject: d.subject,
      content: d.body,
      source: "manual",
      occurred_at: now,
      draft_id: d.id,
      approved_by: d.approved_by,
      message_id: sent.messageId,
      thread_id: sent.threadId,
    });
    this.core.changed();
    return publicDraft(d);
  }

  /** The team pasted a LinkedIn note into LinkedIn themselves; record that they did.
   * This sends nothing, and only works for notes: an email can only become Sent by being sent. */
  markNoteSent(id: number): Draft {
    const d = this.require(id);
    if (d.channel !== "linkedin") throw conflict("Only LinkedIn notes can be marked sent by hand; emails go through Send");
    if (d.status === "sent") throw conflict("This note is already marked sent");
    const contact = this.contactOf(d);
    if (contact.do_not_contact) throw conflict("This contact is marked do-not-contact");
    const now = this.core.iso();
    d.status = "sent";
    d.sent_at = now;
    recordOutreach(contact, "linkedin", now);
    contact.updated_at = now;
    this.core.addInteraction(contact.id, { type: "outreach", channel: "linkedin", content: d.body, occurred_at: now, draft_id: d.id });
    this.core.changed();
    return publicDraft(d);
  }
}

export { ApiError };

/** A tab closed (or the network dropped) in the middle of a send leaves a draft marked "sending".
 * We can't know whether Gmail got it, so put it back as approved with a warning to check first. */
export const STALE_SEND_MS = 15 * 60_000;
export function recoverInterruptedSends(core: Core, me: string | null = null, opts: { staleOnly?: boolean } = {}): number {
  let n = 0;
  const now = core.now().getTime();
  for (const d of core.db.drafts) {
    // A teammate's send that is still fresh is theirs to finish; only mine (from a closed tab) or
    // one nobody has touched for a while counts as interrupted.
    const stale = d.claimed_at ? now - Date.parse(d.claimed_at) > STALE_SEND_MS : true;
    const mine = !d.claimed_by || d.claimed_by === me;
    if (d.status === "sending" && (opts.staleOnly ? stale : mine || stale)) {
      d.claimed_by = d.claimed_at = null;
      d.status = "approved";
      d.last_error = "A send was interrupted (the page was closed or the connection dropped). Check your Gmail Sent folder before sending this again.";
      n += 1;
    }
  }
  return n;
}
