import type { Channel, Status } from "./types";

// Status colours live in CSS variables (--st-*), taken from the team's sheet: yellow for
// Contacted, green for Responded, red for No response.
export const STATUS_LABEL: Record<Status, string> = {
  not_contacted: "Not contacted",
  contacted: "Contacted",
  responded: "Responded",
  no_response: "No response",
};

export const STATUS_COLOR: Record<Status, string> = {
  not_contacted: "var(--st-not_contacted)",
  contacted: "var(--st-contacted)",
  responded: "var(--st-responded)",
  no_response: "var(--st-no_response)",
};

// Full class names so Tailwind can see them.
export const STATUS_BAR: Record<Status, string> = {
  not_contacted: "bg-[var(--st-not_contacted)]",
  contacted: "bg-[var(--st-contacted)]",
  responded: "bg-[var(--st-responded)]",
  no_response: "bg-[var(--st-no_response)]",
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  discord: "Discord",
  personal: "Personal",
};

/** What to call a lead when they might have no name (a company inbox, say). */
export const contactLabel = (c: { name: string | null; email: string | null; linkedin: string | null }) =>
  c.name ?? c.email ?? c.linkedin ?? "Unnamed contact";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const fmtDateTime = (iso: string | null) => (iso ? dateTimeFmt.format(new Date(iso)) : "—");

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
