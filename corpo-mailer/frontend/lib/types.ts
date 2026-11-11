export const STAGES = [
  "prospect",
  "contacted",
  "replied",
  "in_discussion",
  "proposal_sent",
  "committed",
  "paid",
  "declined",
  "no_response",
] as const;
export type Stage = (typeof STAGES)[number];

export const CLOSED_STAGES: readonly Stage[] = ["paid", "declined", "no_response"];

export type Company = {
  id: number;
  name: string;
  industry: string | null;
  website: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
};

export type Contact = {
  id: number;
  company_id: number;
  name: string;
  email: string;
  role: string | null;
  linkedin: string | null;
  do_not_contact: boolean;
  created_at: string;
};

export type Deal = {
  id: number;
  company_id: number;
  stage: Stage;
  owner: string | null;
  target_amount: number | null;
  committed_amount: number | null;
  next_followup_at: string | null;
  last_contacted_at: string | null;
  notes: string | null;
  created_at: string;
};

export type InteractionType = "email_sent" | "email_reply" | "call" | "meeting" | "note";

export type Interaction = {
  id: number;
  deal_id: number;
  contact_id: number | null;
  type: InteractionType;
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
  deal_id: number;
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
  stage_counts: Record<Stage, number>;
  followups_due: Deal[];
  stale: Deal[];
};
