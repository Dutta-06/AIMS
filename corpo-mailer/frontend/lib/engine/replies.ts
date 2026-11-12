/**
 * Turn incoming mail into CRM events. Nothing here can send email.
 *
 * For each new message in the inbox:
 *  - ours, or an out-of-office auto-reply  -> ignored
 *  - a delivery failure                    -> noted on the lead; a permanent one marks the lead
 *                                             do-not-contact (stop mailing dead addresses)
 *  - a reply from a prospect               -> logged on their timeline and flagged unread
 * The status is left for a person to confirm.
 */
import type { SyncResult } from "../types";
import type { Core } from "./core";
import type { ContactRow, InteractionRow } from "./model";

export type IncomingMessage = {
  id: string; // Gmail's id for it
  thread_id: string | null;
  message_id: string; // the email's own Message-ID header
  from_email: string;
  subject: string;
  body: string; // plain text with the quoted earlier thread removed
  sent_at: string; // ISO
  in_reply_to: string[]; // In-Reply-To + References
  is_auto_reply: boolean;
  is_bounce: boolean;
  raw_text: string; // kept for bounce parsing only
};

export interface MailboxReader {
  /** New inbox messages since `sinceMs`, skipping Gmail ids already handled (`skipIds`). */
  fetch(args: { sinceMs: number; skipIds: Set<string> }): Promise<IncomingMessage[]>;
}

export class MailboxError extends Error {}

const MAX_BODY_CHARS = 4000;
const MSGID = /<[^<>\s]+>/g;
const LOOKBACK_DAYS = 14;
const OVERLAP_MS = 60 * 60 * 1000; // look a little further back each time; duplicates are filtered
const PROCESSED_KEPT = 3000;

// ---------------------------------------------------------------- parsing (pure)
const QUOTE_MARKERS = [/^On .{5,200}wrote:\s*$/i, /^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}/i, /^From:\s.+/i, /^_{5,}\s*$/];

/** Keep what the person wrote; drop the quoted thread below it. */
export function stripQuoted(text: string): string {
  const kept: string[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (line.trimStart().startsWith(">")) continue; // inline quoting
    if (QUOTE_MARKERS.some((m) => m.test(line.trim()))) break; // "On <date>, X wrote:" starts the quoted original
    kept.push(line);
  }
  return kept.join("\n").trim().slice(0, MAX_BODY_CHARS);
}

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
export type GmailMessage = { id: string; threadId?: string; internalDate?: string; payload?: GmailPart };

export function b64urlDecode(data: string): string {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const header = (p: GmailPart | undefined, name: string): string => p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

function walk(part: GmailPart | undefined, visit: (p: GmailPart) => void) {
  if (!part) return;
  visit(part);
  part.parts?.forEach((p) => walk(p, visit));
}

function textBody(root: GmailPart | undefined): string {
  let plain = "";
  let html = "";
  walk(root, (p) => {
    if (!p.body?.data || p.filename) return; // skip attachments
    if (p.mimeType === "text/plain" && !plain) plain = b64urlDecode(p.body.data);
    else if (p.mimeType === "text/html" && !html) html = b64urlDecode(p.body.data);
  });
  if (plain) return plain;
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function everyText(root: GmailPart | undefined): string {
  const out: string[] = [];
  walk(root, (p) => {
    if (p.body?.data && /^(text|message)\//.test(p.mimeType ?? "")) out.push(b64urlDecode(p.body.data));
  });
  return out.join("\n");
}

function isBounce(root: GmailPart | undefined, from: string, subject: string): boolean {
  const local = from.split("@")[0].toLowerCase();
  if (local === "mailer-daemon" || local === "postmaster") return true;
  const type = header(root, "Content-Type");
  if (/multipart\/report/i.test(root?.mimeType ?? type)) return /report-type\s*=\s*"?delivery-status/i.test(type);
  return /^(undeliver|delivery status notification|mail delivery failed)/i.test(subject);
}

function isAutoReply(root: GmailPart | undefined, subject: string): boolean {
  const auto = header(root, "Auto-Submitted").trim().toLowerCase();
  if (auto && auto !== "no") return true;
  if (["auto_reply", "bulk", "junk"].includes(header(root, "Precedence").trim().toLowerCase())) return true;
  if (header(root, "X-Autoreply") || header(root, "X-Autorespond")) return true;
  return /^(automatic reply|auto[- ]?reply|out of office)/i.test(subject);
}

/** "Name <addr@x.com>" -> addr@x.com (lower-case) */
export function addressOf(value: string): string {
  const angle = /<([^<>]+)>/.exec(value);
  return (angle ? angle[1] : value).trim().replace(/^"|"$/g, "").toLowerCase();
}

export function parseGmailMessage(m: GmailMessage): IncomingMessage {
  const root = m.payload;
  const from = addressOf(header(root, "From"));
  const subject = header(root, "Subject").split(/\s+/).filter(Boolean).join(" ");
  const when = m.internalDate ? new Date(Number(m.internalDate)) : new Date(header(root, "Date"));
  const bounce = isBounce(root, from, subject);
  const ids = header(root, "Message-ID").match(MSGID) ?? [];
  return {
    id: m.id,
    thread_id: m.threadId ?? null,
    message_id: ids[0] ?? `<gmail-${m.id}@no-message-id>`,
    from_email: from,
    subject,
    body: stripQuoted(textBody(root)),
    sent_at: (Number.isNaN(when.getTime()) ? new Date() : when).toISOString(),
    in_reply_to: [...(header(root, "In-Reply-To").match(MSGID) ?? []), ...(header(root, "References").match(MSGID) ?? [])],
    is_auto_reply: isAutoReply(root, subject),
    is_bounce: bounce,
    raw_text: bounce ? everyText(root) : "",
  };
}

// ---------------------------------------------------------------- the sync
const FINAL_RECIPIENT = /(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+)>?/gi;
const STATUS = /^Status:\s*(\d)\.\d+\.\d+/im;
const ANY_EMAIL = /[\p{L}\p{N}_.+'-]+@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+/gu;

const byEmail = (core: Core, email: string): ContactRow | undefined => core.db.contacts.find((c) => c.email?.toLowerCase() === email.toLowerCase());

const emailsSentTo = (core: Core, contactId: number): InteractionRow[] =>
  core.db.interactions.filter((i) => i.contact_id === contactId && i.type === "email_sent").sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

function matchReply(core: Core, msg: IncomingMessage): { contact: ContactRow; byThread: boolean } | null {
  // Best evidence: it answers an email we sent (by Message-ID or by Gmail's conversation id).
  const sent = core.db.interactions
    .filter((i) => i.type === "email_sent" && ((i.message_id && msg.in_reply_to.includes(i.message_id)) || (i.thread_id && msg.thread_id === i.thread_id)))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
  if (sent) {
    const original = core.db.contacts.find((c) => c.id === sent.contact_id);
    if (original) {
      // A colleague may answer on their behalf: credit whoever's address it came from.
      const colleague = core.db.contacts.find((c) => c.company_id === original.company_id && c.email?.toLowerCase() === msg.from_email);
      return { contact: colleague ?? original, byThread: true };
    }
  }
  // Fallback: the sender is a lead we emailed.
  const contact = byEmail(core, msg.from_email);
  return contact && emailsSentTo(core, contact.id).length ? { contact, byThread: false } : null;
}

function handleBounce(core: Core, msg: IncomingMessage): boolean {
  const text = msg.raw_text || msg.body;
  const named = [...text.matchAll(FINAL_RECIPIENT)].map((m) => m[1].toLowerCase());
  const failed = named.length ? named : (text.match(ANY_EMAIL) ?? []).map((e) => e.toLowerCase());
  const contact = failed.map((e) => byEmail(core, e)).find(Boolean);
  if (!contact || emailsSentTo(core, contact.id).length === 0) return false;
  const permanent = STATUS.exec(text)?.[1] === "5";
  if (permanent) contact.do_not_contact = true; // safe direction: it only ever stops us mailing them
  core.addInteraction(contact.id, {
    type: "note",
    source: "auto",
    subject: `Delivery failed: ${contact.email}`,
    content: "The email bounced" + (permanent ? " permanently; contact marked do-not-contact." : " (temporary)."),
    message_id: msg.message_id,
    occurred_at: msg.sent_at,
  });
  return true;
}

function handleReply(core: Core, msg: IncomingMessage, own: Set<string>): "reply" | "unmatched" | "ignored" {
  if (own.has(msg.from_email) || msg.is_auto_reply) return "ignored";
  const m = matchReply(core, msg);
  if (!m) return "unmatched";
  const note = m.byThread ? "" : "\n\n(Matched by the sender's address, not the email thread.)";
  core.addInteraction(m.contact.id, {
    type: "email_reply",
    channel: "email",
    source: "auto",
    subject: msg.subject,
    content: (msg.body || "(no text)") + note,
    message_id: msg.message_id,
    occurred_at: msg.sent_at,
  });
  // Flag it for a person. The status is not changed automatically: they confirm "Responded".
  m.contact.reply_unread = true;
  if (m.contact.last_contacted_at === null || new Date(msg.sent_at) > new Date(m.contact.last_contacted_at)) m.contact.last_contacted_at = msg.sent_at;
  return "reply";
}

export async function syncReplies(core: Core, reader: MailboxReader, ownAddress: string | null): Promise<SyncResult> {
  let mb = core.db.mailbox;
  const startedAt = core.now().getTime();
  const sinceMs = mb.synced_until === null ? startedAt - LOOKBACK_DAYS * 86_400_000 : mb.synced_until - OVERLAP_MS;
  let messages: IncomingMessage[];
  try {
    messages = await reader.fetch({ sinceMs, skipIds: new Set(mb.processed) });
  } catch (e) {
    mb.last_error = e instanceof Error ? e.message : "The inbox couldn't be read";
    core.changed();
    throw e;
  }
  mb = core.db.mailbox; // a teammate's save may have been merged in while the inbox was being read
  const own = new Set(ownAddress ? [ownAddress.toLowerCase()] : []);
  const seen = new Set(core.db.interactions.map((i) => i.message_id).filter((x): x is string => !!x));
  const result: SyncResult = { fetched: 0, replies: 0, bounces: 0, ignored: 0, unmatched: 0 };

  for (const msg of [...messages].sort((a, b) => a.sent_at.localeCompare(b.sent_at))) {
    result.fetched += 1;
    mb.processed.push(msg.id);
    if (seen.has(msg.message_id)) {
      result.ignored += 1; // already processed (e.g. the overlap between two checks)
      continue;
    }
    seen.add(msg.message_id);
    if (msg.is_bounce) {
      if (handleBounce(core, msg)) result.bounces += 1;
      else result.ignored += 1;
      continue;
    }
    const outcome = handleReply(core, msg, own);
    if (outcome === "reply") result.replies += 1;
    else if (outcome === "unmatched") result.unmatched += 1;
    else result.ignored += 1;
  }
  mb.processed = mb.processed.slice(-PROCESSED_KEPT);
  mb.synced_until = startedAt;
  mb.last_sync_at = core.iso();
  mb.last_error = null;
  core.changed();
  return result;
}
