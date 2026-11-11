import type { Stage } from "./types";

export const STAGE_LABEL: Record<Stage, string> = {
  prospect: "Prospect",
  contacted: "Contacted",
  replied: "Replied",
  in_discussion: "In discussion",
  proposal_sent: "Proposal sent",
  committed: "Committed",
  paid: "Paid",
  declined: "Declined",
  no_response: "No response",
};

// Stage colours live in CSS variables (--st-*) so they mean the same thing on every screen.
export const STAGE_COLOR: Record<Stage, string> = {
  prospect: "var(--st-prospect)",
  contacted: "var(--st-contacted)",
  replied: "var(--st-replied)",
  in_discussion: "var(--st-in_discussion)",
  proposal_sent: "var(--st-proposal_sent)",
  committed: "var(--st-committed)",
  paid: "var(--st-paid)",
  declined: "var(--st-declined)",
  no_response: "var(--st-no_response)",
};

// Full class names so Tailwind can see them.
export const STAGE_BAR: Record<Stage, string> = {
  prospect: "bg-[var(--st-prospect)]",
  contacted: "bg-[var(--st-contacted)]",
  replied: "bg-[var(--st-replied)]",
  in_discussion: "bg-[var(--st-in_discussion)]",
  proposal_sent: "bg-[var(--st-proposal_sent)]",
  committed: "bg-[var(--st-committed)]",
  paid: "bg-[var(--st-paid)]",
  declined: "bg-[var(--st-declined)]",
  no_response: "bg-[var(--st-no_response)]",
};

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const moneyFmt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const fmtDateTime = (iso: string | null) => (iso ? dateTimeFmt.format(new Date(iso)) : "—");
export const fmtMoney = (n: number | null) => (n == null ? "—" : moneyFmt.format(n));

export function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/** ISO (UTC) -> value for <input type="datetime-local"> in the user's timezone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (value: string): string | null =>
  value ? new Date(value).toISOString() : null;
