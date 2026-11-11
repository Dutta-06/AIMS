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

// Full class names so Tailwind can see them.
export const STAGE_TONE: Record<Stage, string> = {
  prospect: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  contacted: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  replied: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  in_discussion: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  proposal_sent: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  committed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  paid: "bg-green-600/20 text-green-800 dark:text-green-300",
  declined: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  no_response: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

export const STAGE_BAR: Record<Stage, string> = {
  prospect: "bg-slate-400",
  contacted: "bg-sky-500",
  replied: "bg-cyan-500",
  in_discussion: "bg-indigo-500",
  proposal_sent: "bg-violet-500",
  committed: "bg-emerald-500",
  paid: "bg-green-600",
  declined: "bg-rose-500",
  no_response: "bg-amber-500",
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
