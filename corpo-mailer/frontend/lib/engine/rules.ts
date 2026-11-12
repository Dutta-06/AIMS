import type { Channel } from "../types";
import type { ContactRow } from "./model";

/** The rules for how outreach moves a lead's status and channels. Everything that records contact
 * (manual logging, the send gate, the reply tracker) goes through here so they agree. */

export function addChannel(c: ContactRow, channel: Channel) {
  if (!c.channels.includes(channel)) c.channels = [...c.channels, channel];
}

/** Channels only mean something once someone has been contacted. */
export function normalise(c: ContactRow) {
  if (c.status === "not_contacted") c.channels = [];
}

const later = (when: string, current: string | null) => current === null || new Date(when) > new Date(current);

/** We reached out. Never moves a lead backwards (a responded lead stays responded). */
export function recordOutreach(c: ContactRow, channel: Channel, when: string) {
  if (c.status === "not_contacted") c.status = "contacted";
  addChannel(c, channel);
  if (later(when, c.last_contacted_at)) c.last_contacted_at = when;
}

/** They answered: responded, and the reply is no longer "unread". */
export function recordReply(c: ContactRow, channel: Channel, when: string) {
  c.status = "responded";
  c.reply_unread = false;
  addChannel(c, channel);
  if (later(when, c.last_contacted_at)) c.last_contacted_at = when;
}

/** Note that we were in touch (a call, a meeting) without changing status. */
export function touch(c: ContactRow, when: string) {
  if (later(when, c.last_contacted_at)) c.last_contacted_at = when;
}
