export const STATUSES = ["not_contacted", "contacted", "responded", "no_response"] as const;
export type Status = (typeof STATUSES)[number];

export const CHANNELS = ["email", "linkedin", "discord", "personal"] as const;
export type Channel = (typeof CHANNELS)[number];

export type Company = {
  id: number;
  name: string;
  industry: string | null;
  website: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
};

/** A lead: one person (or generic inbox) at a company, and where outreach to them stands. */
export type Contact = {
  id: number;
  company_id: number;
  company_name: string;
  name: string | null;
  email: string | null;
  linkedin: string | null;
  role: string | null;
  status: Status;
  channels: Channel[];
  remarks: string | null;
  do_not_contact: boolean;
  last_contacted_at: string | null;
  next_followup_at: string | null;
  reply_unread: boolean;
  created_at: string;
  updated_at: string;
};

export type InteractionType =
  | "email_sent"
  | "email_reply"
  | "outreach"
  | "reply"
  | "call"
  | "meeting"
  | "note";

export type Interaction = {
  id: number;
  contact_id: number;
  type: InteractionType;
  channel: Channel | null;
  source: "manual" | "auto";
  subject: string | null;
  content: string | null;
  draft_id: number | null;
  approved_by: string | null;
  occurred_at: string;
};

export type DraftStatus = "draft" | "approved" | "sending" | "sent";
export type DraftKind = "intro" | "followup" | "thank_you";

export type Draft = {
  id: number;
  contact_id: number;
  subject: string;
  body: string;
  status: DraftStatus;
  generated_by_ai: boolean;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type Dashboard = {
  total: number;
  status_counts: Record<Status, number>;
  needs_followup: Contact[];
  new_replies: Contact[];
};

export type SyncResult = {
  fetched: number;
  replies: number;
  bounces: number;
  ignored: number;
  unmatched: number;
};

export type ReplyStatus = {
  configured: boolean;
  polling: boolean;
  last_sync_at: string | null;
  last_error: string | null;
};

export type ImportRow = {
  line: number;
  action: "create" | "update" | "unchanged" | "skip";
  company: string;
  company_new: boolean;
  name: string | null;
  status: Status;
  channels: Channel[];
  warnings: string[];
  reason: string | null;
  changes: string[];
};

export type ImportPreview = {
  summary: { rows: number; create: number; update: number; unchanged: number; skip: number; new_companies: number };
  rows: ImportRow[];
  truncated: boolean;
  columns: Record<string, string>;
  ignored_columns: string[];
};

export type ProspectState = "new" | "accepted" | "rejected" | "snoozed";
export type Verdict = "unverified" | "verified" | "needs_check" | "failed";

export type Evidence = {
  url: string;
  title: string;
  kind: string;
  snippet: string;
  fetched_at: string | null;
  last_modified: string | null;
  signal: boolean;
};

export type Enrichment = {
  company_id: number;
  website: string | null;
  website_is_new: boolean;
  verdict: Verdict;
  verdict_note: string;
  evidence: Evidence[];
  emails: { email: string; source_url: string; already_tracked: boolean }[];
  linkedin_search_url: string;
  checked_at: string;
};

export type Prospect = {
  id: number;
  name: string;
  website: string | null;
  domain: string | null;
  industry: string | null;
  why: string | null;
  source: string | null;
  state: ProspectState;
  verdict: Verdict;
  verdict_note: string | null;
  checked_at: string | null;
  expires_at: string | null;
  snoozed_until: string | null;
  stale: boolean;
  evidence: Evidence[];
  emails: { email: string; source_url: string }[];
  linkedin_search_url: string;
  company_id: number | null;
  created_at: string;
};
