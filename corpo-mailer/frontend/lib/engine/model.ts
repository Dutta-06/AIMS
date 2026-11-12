import type { Channel, Company, Contact, DraftKind, DraftStatus, Interaction, Revision, Status } from "../types";

/** A lead as stored (`company_name` is worked out when it is read). */
export type ContactRow = Omit<Contact, "company_name">;

export type InteractionRow = Interaction & {
  /** RFC 5322 Message-ID of a sent email; replies are matched against it. */
  message_id: string | null;
  /** Gmail's id for the conversation the email started. */
  thread_id: string | null;
};

export type DraftRow = {
  id: number;
  contact_id: number;
  channel: Channel;
  subject: string;
  body: string;
  status: DraftStatus;
  generated_by_ai: boolean;
  /** Fingerprint of recipient + subject + body at approval; any later edit voids the approval. */
  approved_hash: string | null;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
  history: Revision[];
};

export type MailboxState = {
  last_sync_at: string | null;
  last_error: string | null;
  /** Mail newer than this (epoch ms) has been looked at. */
  synced_until: number | null;
  /** Gmail message ids already handled, so nothing is logged twice. */
  processed: string[];
};

export type EventSettings = {
  event_name: string;
  event_pitch: string;
  sender_signature: string;
  from_name: string;
  stale_after_days: number;
};

/** Everything the app remembers. Saved as one JSON file in the person's own Google Drive. */
export type DB = {
  version: 1;
  seq: { company: number; contact: number; interaction: number; draft: number };
  companies: Company[];
  contacts: ContactRow[];
  interactions: InteractionRow[];
  drafts: DraftRow[];
  mailbox: MailboxState;
  settings: EventSettings;
};

export const DEFAULT_SETTINGS: EventSettings = {
  event_name: "brAInwave 3",
  event_pitch:
    "brAInwave 3 is a hackathon hosted at Delhi Technological University (DTU). We are looking for corporate sponsors.",
  sender_signature: "",
  from_name: "brAInwave Team",
  stale_after_days: 7,
};

export function emptyDb(): DB {
  return {
    version: 1,
    seq: { company: 0, contact: 0, interaction: 0, draft: 0 },
    companies: [],
    contacts: [],
    interactions: [],
    drafts: [],
    mailbox: { last_sync_at: null, last_error: null, synced_until: null, processed: [] },
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Make sure a loaded file has every field this version expects (older files, hand edits). */
export function normaliseDb(raw: unknown): DB {
  const base = emptyDb();
  const r = (raw ?? {}) as Partial<DB>;
  return {
    version: 1,
    seq: { ...base.seq, ...(r.seq ?? {}) },
    companies: r.companies ?? [],
    contacts: r.contacts ?? [],
    interactions: r.interactions ?? [],
    drafts: r.drafts ?? [],
    mailbox: { ...base.mailbox, ...(r.mailbox ?? {}) },
    settings: { ...base.settings, ...(r.settings ?? {}) },
  };
}

export type { Channel, DraftKind, Status };
