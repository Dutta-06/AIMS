/** Sending and reading mail through the Gmail API, as the signed-in person. */
import { ApiError } from "../errors";
import type { Mailer } from "../drafts";
import { parseGmailMessage } from "../replies";
import type { GmailMessage, IncomingMessage, MailboxReader } from "../replies";
import type { GoogleAuth } from "./auth";
import { google } from "./api";
import type { Fetcher } from "./api";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_LISTED = 300; // most messages looked at in one check
const PARALLEL = 5;

// ---------------------------------------------------------------- building a message
const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
export const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const utf8 = (s: string) => new TextEncoder().encode(s);

/** Header values must be one line: a line break would let text sneak in extra headers. */
export const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

const ASCII = /^[\x20-\x7E]*$/;

/** RFC 2047 encoded words, for headers that contain non-ASCII text (kept under 75 characters each). */
export function encodeWords(text: string): string {
  const t = oneLine(text);
  if (ASCII.test(t)) return t;
  const words: string[] = [];
  let chunk = "";
  for (const ch of t) {
    if (utf8(chunk + ch).length > 42) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${b64(utf8(w))}?=`).join(" ");
}

const wrap76 = (s: string) => s.match(/.{1,76}/g)?.join("\r\n") ?? "";

export type OutgoingMail = { fromName: string; fromEmail: string; to: string; subject: string; body: string };

/** The raw email (RFC 822), base64url encoded as the Gmail API wants it. */
export function buildRaw(m: OutgoingMail): string {
  const name = oneLine(m.fromName);
  const from = name ? `${ASCII.test(name) ? `"${name.replace(/(["\\])/g, "\\$1")}"` : encodeWords(name)} <${oneLine(m.fromEmail)}>` : oneLine(m.fromEmail);
  const body = m.body.replace(/\r\n|\r|\n/g, "\r\n");
  const text = [
    `From: ${from}`,
    `To: ${oneLine(m.to)}`,
    `Subject: ${encodeWords(m.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(utf8(body))),
  ].join("\r\n");
  return b64url(utf8(text));
}

// ---------------------------------------------------------------- the API
export class GmailApi implements Mailer, MailboxReader {
  constructor(
    private auth: GoogleAuth,
    private fromName: () => string,
    private fetchImpl: Fetcher = (...a) => fetch(...a),
  ) {}

  async send(m: { to: string; subject: string; body: string }): Promise<{ messageId: string | null; threadId: string | null }> {
    const email = this.auth.token?.email;
    if (!email) throw new ApiError(401, "Sign in with Google to send");
    const raw = buildRaw({ fromName: this.fromName(), fromEmail: email, ...m });
    const res = await google(this.auth, `${API}/messages/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raw }) }, this.fetchImpl);
    const sent = (await res.json()) as { id: string; threadId?: string };
    // Gmail may assign its own Message-ID, so read back the real one (replies refer to it).
    let messageId: string | null = null;
    try {
      const meta = await google(this.auth, `${API}/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`, {}, this.fetchImpl);
      const headers = ((await meta.json()) as { payload?: { headers?: { name: string; value: string }[] } }).payload?.headers ?? [];
      messageId = headers.find((h) => h.name.toLowerCase() === "message-id")?.value.trim() ?? null;
    } catch {
      /* the email is sent; matching replies will fall back to the conversation id */
    }
    return { messageId, threadId: sent.threadId ?? null };
  }

  private async listIds(sinceMs: number): Promise<string[]> {
    const ids: string[] = [];
    let page: string | undefined;
    do {
      const q = encodeURIComponent(`in:inbox after:${Math.floor(sinceMs / 1000)}`);
      const res = await google(this.auth, `${API}/messages?q=${q}&maxResults=100${page ? `&pageToken=${page}` : ""}`, {}, this.fetchImpl);
      const body = (await res.json()) as { messages?: { id: string }[]; nextPageToken?: string };
      ids.push(...(body.messages ?? []).map((m) => m.id));
      page = body.nextPageToken;
    } while (page && ids.length < MAX_LISTED);
    return ids.slice(0, MAX_LISTED);
  }

  async fetch({ sinceMs, skipIds }: { sinceMs: number; skipIds: Set<string> }): Promise<IncomingMessage[]> {
    const ids = (await this.listIds(sinceMs)).filter((id) => !skipIds.has(id));
    const out: IncomingMessage[] = [];
    for (let i = 0; i < ids.length; i += PARALLEL) {
      const batch = await Promise.all(
        ids.slice(i, i + PARALLEL).map(async (id) => {
          const res = await google(this.auth, `${API}/messages/${id}?format=full`, {}, this.fetchImpl);
          return parseGmailMessage((await res.json()) as GmailMessage);
        }),
      );
      out.push(...batch);
    }
    return out;
  }
}
