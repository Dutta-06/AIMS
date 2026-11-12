import { CHANNELS, STATUSES } from "../types";
import type { Channel, Company, Contact, Dashboard, Interaction, InteractionType, Status } from "../types";
import { ApiError, conflict, invalid, notFound } from "./errors";
import type { ContactRow, DB, InteractionRow } from "./model";
import { emptyDb } from "./model";
import * as rules from "./rules";

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const INTERACTION_TYPES: InteractionType[] = ["email_sent", "email_reply", "outreach", "reply", "call", "meeting", "note"];

export type CompanyInput = {
  name: string;
  industry?: string | null;
  website?: string | null;
  source?: string | null;
  notes?: string | null;
};
export type ContactInput = {
  company_id: number;
  name?: string | null;
  email?: string | null;
  linkedin?: string | null;
  role?: string | null;
  status?: Status;
  channels?: Channel[];
  remarks?: string | null;
  next_followup_at?: string | null;
};
export type ContactPatch = Partial<Omit<ContactInput, "company_id">> & {
  do_not_contact?: boolean;
  reply_unread?: boolean;
};
export type InteractionInput = {
  type: InteractionType;
  channel?: Channel | null;
  subject?: string;
  content?: string;
  occurred_at?: string;
};

/** Blank text means "nothing". */
export function blank(v: unknown): string | null {
  if (typeof v !== "string") return v == null ? null : String(v);
  const t = v.trim();
  return t === "" ? null : t;
}

function limit(label: string, v: string | null, max: number): string | null {
  if (v !== null && v.length > max) throw invalid(`${label} is too long (at most ${max} characters)`);
  return v;
}

function checkEmail(v: string | null): string | null {
  if (v !== null && !EMAIL.test(v)) throw invalid("That doesn't look like an email address");
  return v;
}

function checkChannels(v: unknown): Channel[] {
  const list = Array.isArray(v) ? v : [];
  for (const c of list) if (!CHANNELS.includes(c as Channel)) throw invalid(`Unknown channel "${String(c)}"`);
  return [...new Set(list as Channel[])];
}

function checkStatus(v: unknown): Status {
  if (!STATUSES.includes(v as Status)) throw invalid(`Unknown status "${String(v)}"`);
  return v as Status;
}

const cmp = (a: string | null, b: string | null) => (a ?? "").toLowerCase().localeCompare((b ?? "").toLowerCase());
const has = (haystack: (string | null)[], needle: string) => haystack.some((h) => (h ?? "").toLowerCase().includes(needle));

/** All of the app's data and rules, in memory. Persistence is somebody else's job: pass `onChange`. */
export class Core {
  constructor(
    public db: DB = emptyDb(),
    public now: () => Date = () => new Date(),
    public onChange: () => void = () => {},
  ) {}

  iso(): string {
    return this.now().toISOString();
  }

  /** Call after any change; the owner saves. */
  changed() {
    this.onChange();
  }

  private nextId(kind: keyof DB["seq"]): number {
    this.db.seq[kind] += 1;
    return this.db.seq[kind];
  }

  // ------------------------------------------------------------------ companies
  listCompanies(q?: string): Company[] {
    const needle = (q ?? "").trim().toLowerCase();
    return this.db.companies
      .filter((c) => !needle || c.name.toLowerCase().includes(needle))
      .sort((a, b) => cmp(a.name, b.name))
      .map((c) => ({ ...c }));
  }

  requireCompany(id: number): Company {
    const c = this.db.companies.find((x) => x.id === id);
    if (!c) throw notFound("Company", id);
    return c;
  }

  getCompany(id: number): Company {
    return { ...this.requireCompany(id) };
  }

  private nameTaken(name: string, exceptId?: number): boolean {
    const n = name.trim().toLowerCase();
    return this.db.companies.some((c) => c.id !== exceptId && c.name.trim().toLowerCase() === n);
  }

  createCompany(input: CompanyInput): Company {
    const name = limit("The name", blank(input.name), 200);
    if (!name) throw invalid("A company needs a name");
    if (this.nameTaken(name)) throw conflict("A company with that name already exists");
    const company: Company = {
      id: this.nextId("company"),
      name,
      industry: blank(input.industry),
      website: blank(input.website),
      source: blank(input.source),
      notes: blank(input.notes),
      created_at: this.iso(),
    };
    this.db.companies.push(company);
    this.changed();
    return { ...company };
  }

  updateCompany(id: number, patch: Partial<CompanyInput>): Company {
    const c = this.requireCompany(id);
    if (patch.name !== undefined) {
      const name = limit("The name", blank(patch.name), 200);
      if (!name) throw invalid("A company needs a name");
      if (this.nameTaken(name, id)) throw conflict("A company with that name already exists");
      c.name = name;
    }
    for (const k of ["industry", "website", "source", "notes"] as const) if (patch[k] !== undefined) c[k] = blank(patch[k]);
    this.changed();
    return { ...c };
  }

  deleteCompany(id: number) {
    this.requireCompany(id);
    const contactIds = new Set(this.db.contacts.filter((c) => c.company_id === id).map((c) => c.id));
    this.db.companies = this.db.companies.filter((c) => c.id !== id);
    this.db.contacts = this.db.contacts.filter((c) => c.company_id !== id);
    this.db.interactions = this.db.interactions.filter((i) => !contactIds.has(i.contact_id));
    this.db.drafts = this.db.drafts.filter((d) => !contactIds.has(d.contact_id));
    this.changed();
  }

  // ------------------------------------------------------------------ contacts
  requireContact(id: number): ContactRow {
    const c = this.db.contacts.find((x) => x.id === id);
    if (!c) throw notFound("Contact", id);
    return c;
  }

  /** A lead as the screens see it, with its company's name. */
  out(row: ContactRow): Contact {
    const company = this.db.companies.find((c) => c.id === row.company_id);
    return { ...row, channels: [...row.channels], company_name: company?.name ?? "" };
  }

  listContacts(p: { company_id?: number; status?: Status; q?: string } = {}): Contact[] {
    const needle = (p.q ?? "").trim().toLowerCase();
    return this.db.contacts
      .map((row) => this.out(row))
      .filter(
        (c) =>
          (p.company_id === undefined || c.company_id === p.company_id) &&
          (p.status === undefined || c.status === p.status) &&
          (!needle || has([c.name, c.email, c.role, c.remarks, c.company_name], needle)),
      )
      .sort((a, b) => cmp(a.company_name, b.company_name) || cmp(a.name, b.name));
  }

  getContact(id: number): Contact {
    return this.out(this.requireContact(id));
  }

  createContact(input: ContactInput): Contact {
    this.requireCompany(input.company_id);
    const name = limit("The name", blank(input.name), 200);
    const email = checkEmail(blank(input.email)?.toLowerCase() ?? null);
    const linkedin = limit("The LinkedIn link", blank(input.linkedin), 500);
    if (!(name || email || linkedin)) throw invalid("Give the contact a name, an email or a LinkedIn link");
    const status = input.status === undefined ? "not_contacted" : checkStatus(input.status);
    const now = this.iso();
    const row: ContactRow = {
      id: this.nextId("contact"),
      company_id: input.company_id,
      name,
      email,
      linkedin,
      role: limit("The role", blank(input.role), 200),
      status,
      channels: checkChannels(input.channels),
      remarks: blank(input.remarks),
      do_not_contact: false,
      last_contacted_at: status !== "not_contacted" ? now : null,
      next_followup_at: input.next_followup_at ?? null,
      reply_unread: false,
      created_at: now,
      updated_at: now,
    };
    rules.normalise(row);
    this.db.contacts.push(row);
    this.changed();
    return this.out(row);
  }

  updateContact(id: number, patch: ContactPatch): Contact {
    const row = this.requireContact(id);
    const draft: ContactRow = { ...row, channels: [...row.channels] }; // validate first, apply after
    if ("name" in patch) draft.name = limit("The name", blank(patch.name), 200);
    if ("email" in patch) draft.email = checkEmail(blank(patch.email)?.toLowerCase() ?? null);
    if ("linkedin" in patch) draft.linkedin = limit("The LinkedIn link", blank(patch.linkedin), 500);
    if ("role" in patch) draft.role = limit("The role", blank(patch.role), 200);
    if ("remarks" in patch) draft.remarks = blank(patch.remarks);
    if ("status" in patch) draft.status = checkStatus(patch.status);
    if ("do_not_contact" in patch) draft.do_not_contact = Boolean(patch.do_not_contact);
    if ("reply_unread" in patch) draft.reply_unread = Boolean(patch.reply_unread);
    if ("next_followup_at" in patch) draft.next_followup_at = patch.next_followup_at ?? null;
    if (("name" in patch || "email" in patch || "linkedin" in patch) && !(draft.name || draft.email || draft.linkedin)) {
      throw invalid("A contact needs a name, an email or a LinkedIn link");
    }
    if ("channels" in patch) draft.channels = checkChannels(patch.channels);
    if (draft.status === "not_contacted") {
      if ("channels" in patch && draft.channels.length > 0) throw invalid("Channels apply once the contact has been reached");
      draft.channels = [];
    } else if (draft.last_contacted_at === null) {
      draft.last_contacted_at = this.iso();
    }
    draft.updated_at = this.iso();
    Object.assign(row, draft);
    this.changed();
    return this.out(row);
  }

  deleteContact(id: number) {
    this.requireContact(id);
    this.db.contacts = this.db.contacts.filter((c) => c.id !== id);
    this.db.interactions = this.db.interactions.filter((i) => i.contact_id !== id);
    this.db.drafts = this.db.drafts.filter((d) => d.contact_id !== id);
    this.changed();
  }

  // ------------------------------------------------------------------ interactions
  listInteractions(contactId: number): Interaction[] {
    this.requireContact(contactId);
    return this.db.interactions
      .filter((i) => i.contact_id === contactId)
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id - b.id)
      .map(publicInteraction);
  }

  /** Record something on a lead's timeline. `extra` is only for the app's own bookkeeping. */
  addInteraction(
    contactId: number,
    v: {
      type: InteractionType;
      channel?: Channel | null;
      subject?: string | null;
      content?: string | null;
      source?: "manual" | "auto";
      occurred_at: string;
      draft_id?: number | null;
      approved_by?: string | null;
      message_id?: string | null;
      thread_id?: string | null;
    },
  ): InteractionRow {
    const row: InteractionRow = {
      id: this.nextId("interaction"),
      contact_id: contactId,
      type: v.type,
      channel: v.channel ?? null,
      source: v.source ?? "manual",
      subject: v.subject ?? null,
      content: v.content ?? null,
      draft_id: v.draft_id ?? null,
      approved_by: v.approved_by ?? null,
      occurred_at: v.occurred_at,
      message_id: v.message_id ?? null,
      thread_id: v.thread_id ?? null,
    };
    this.db.interactions.push(row);
    return row;
  }

  /** Log what happened. Reaching out or hearing back also updates the lead's status and channels.
   * (Sent emails are logged by the send gate, never here.) */
  logInteraction(contactId: number, b: InteractionInput): Interaction {
    const contact = this.requireContact(contactId);
    if (!INTERACTION_TYPES.includes(b.type)) throw invalid(`Unknown type "${String(b.type)}"`);
    if (b.channel != null && !CHANNELS.includes(b.channel)) throw invalid(`Unknown channel "${String(b.channel)}"`);
    if ((b.type === "outreach" || b.type === "reply") && !b.channel) {
      throw invalid("Say which channel (email, linkedin, discord or personal)");
    }
    if (b.type === "email_sent") throw invalid("Emails are logged automatically when a draft is sent");
    if (b.occurred_at !== undefined && Number.isNaN(new Date(b.occurred_at).getTime())) throw invalid("That date isn't valid");
    const when = b.occurred_at ? new Date(b.occurred_at).toISOString() : this.iso();
    const row = this.addInteraction(contactId, {
      type: b.type,
      channel: b.channel,
      subject: blank(b.subject),
      content: blank(b.content),
      occurred_at: when,
    });
    if (b.type === "outreach") rules.recordOutreach(contact, b.channel!, when);
    else if (b.type === "reply" || b.type === "email_reply") rules.recordReply(contact, b.channel ?? "email", when);
    else if (b.type === "call" || b.type === "meeting") rules.touch(contact, when);
    contact.updated_at = this.iso();
    this.changed();
    return publicInteraction(row);
  }

  // ------------------------------------------------------------------ dashboard
  dashboard(): Dashboard {
    const now = this.now().getTime();
    const cutoff = now - this.db.settings.stale_after_days * 86_400_000;
    const status_counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    for (const c of this.db.contacts) status_counts[c.status] += 1;

    const byLast = (a: Contact, b: Contact) => (a.last_contacted_at ?? "").localeCompare(b.last_contacted_at ?? "");
    const new_replies = this.db.contacts
      .filter((c) => c.reply_unread)
      .map((c) => this.out(c))
      .sort((a, b) => byLast(b, a)); // newest first
    const unread = new Set(new_replies.map((c) => c.id));
    // Reached out, no answer yet, and either a follow-up was scheduled and is due, or it has been
    // quiet too long. Someone with an unread reply is handled in the replies list.
    const needs_followup = this.db.contacts
      .filter(
        (c) =>
          c.status === "contacted" &&
          !c.do_not_contact &&
          !unread.has(c.id) &&
          ((c.next_followup_at !== null && new Date(c.next_followup_at).getTime() <= now) ||
            (c.last_contacted_at !== null && new Date(c.last_contacted_at).getTime() < cutoff)),
      )
      .map((c) => this.out(c))
      .sort(byLast);
    return { total: this.db.contacts.length, status_counts, needs_followup, new_replies };
  }
}

/** The app's own bookkeeping fields (message ids and the like) aren't for the screens. */
export function publicInteraction(row: InteractionRow): Interaction {
  const { message_id, thread_id, ...rest } = row;
  void message_id;
  void thread_id;
  return { ...rest };
}

export { ApiError };
