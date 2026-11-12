/**
 * What the screens call. Everything runs in this browser (see lib/engine): the data is kept in the
 * signed-in person's team workspace (one shared Google Drive file), and email goes through their own Gmail. There is no server.
 */
import { app } from "./engine/app";
import type { CompanyInput, ContactInput, ContactPatch, InteractionInput } from "./engine/core";
import { applyPlan, exportCsv, planImport, previewOf } from "./engine/importer";
import { ApiError } from "./engine/errors";
import { parseKeys } from "./engine/llm";
import type { DB, EventSettings } from "./engine/model";
import { normaliseDb } from "./engine/model";
import { invalid } from "./engine/errors";
import type { Channel, Company, Contact, Dashboard, Draft, DraftKind, DraftStatus, ImportPreview, Interaction, ReplyStatus, Status, SyncResult } from "./types";

export { ApiError };
export type { CompanyInput, ContactInput, ContactPatch };

const core = () => app().ready().core;
/** The team's settings and backups are for the admins only. */
const admin = () => {
  if (!app().isAdmin()) throw new ApiError(403, "Only the team admins can do that");
};
const drafts = () => app().ready().drafts;

/** Engine calls are instant and in memory, but the screens expect promises. */
const now = <T>(fn: () => T): Promise<T> => {
  try {
    return Promise.resolve(fn());
  } catch (e) {
    return Promise.reject(e);
  }
};
const guarded = <T>(fn: () => Promise<T>) => app().guarded(fn);

export const api = {
  dashboard: (): Promise<Dashboard> => now(() => core().dashboard()),

  companies: {
    list: (q?: string): Promise<Company[]> => now(() => core().listCompanies(q)),
    get: (id: number): Promise<Company> => now(() => core().getCompany(id)),
    create: (b: CompanyInput): Promise<Company> => now(() => core().createCompany(b)),
    update: (id: number, b: Partial<CompanyInput>): Promise<Company> => now(() => core().updateCompany(id, b)),
    remove: (id: number): Promise<void> => now(() => core().deleteCompany(id)),
  },

  contacts: {
    list: (p: { company_id?: number; status?: Status; q?: string } = {}): Promise<Contact[]> => now(() => core().listContacts(p)),
    get: (id: number): Promise<Contact> => now(() => core().getContact(id)),
    create: (b: ContactInput): Promise<Contact> => now(() => core().createContact(b)),
    update: (id: number, b: ContactPatch): Promise<Contact> => now(() => core().updateContact(id, b)),
    remove: (id: number): Promise<void> => now(() => core().deleteContact(id)),
    interactions: (id: number): Promise<Interaction[]> => now(() => core().listInteractions(id)),
    log: (id: number, b: InteractionInput): Promise<Interaction> => now(() => core().logInteraction(id, b)),
  },

  drafts: {
    list: (p: { status?: DraftStatus; contact_id?: number } = {}): Promise<Draft[]> => now(() => drafts().list(p)),
    generate: (b: { contact_id: number; kind: DraftKind; instructions?: string; channel?: Channel }): Promise<Draft> => drafts().generate(b),
    create: (b: { contact_id: number; subject: string; body: string }): Promise<Draft> => now(() => drafts().create(b)),
    edit: (id: number, b: { subject?: string; body?: string }): Promise<Draft> => now(() => drafts().edit(id, b)),
    revise: (id: number, feedback: string): Promise<Draft> => drafts().revise(id, feedback),
    undo: (id: number): Promise<Draft> => now(() => drafts().undo(id)),
    markSent: (id: number): Promise<Draft> => now(() => drafts().markNoteSent(id)),
    approve: (id: number): Promise<Draft> => drafts().approve(id),
    revoke: (id: number): Promise<Draft> => now(() => drafts().revoke(id)),
    send: (id: number): Promise<Draft> => guarded(() => drafts().send(id)),
  },

  replies: {
    status: (): Promise<ReplyStatus> =>
      now(() => {
        const a = app();
        const mb = core().db.mailbox;
        return { configured: a.state.phase === "ready", polling: true, last_sync_at: mb.last_sync_at, last_error: mb.last_error };
      }),
    sync: (): Promise<SyncResult> => app().syncReplies(),
  },

  import: {
    preview: (csv: string, o: { overwrite: boolean; infer_status: boolean }): Promise<ImportPreview> =>
      now(() => previewOf(planImport(core(), csv, o.overwrite, o.infer_status))),
    commit: (csv: string, o: { overwrite: boolean; infer_status: boolean }): Promise<ImportPreview["summary"]> =>
      now(() => applyPlan(core(), planImport(core(), csv, o.overwrite, o.infer_status))),
    exportCsv: (): Promise<Blob> => now(() => new Blob([exportCsv(core())], { type: "text/csv;charset=utf-8" })),
  },

  settings: {
    get: (): Promise<EventSettings> => now(() => (admin(), { ...core().db.settings })),
    update: (b: Partial<EventSettings>): Promise<EventSettings> =>
      now(() => {
        admin();
        const c = core();
        const s = c.db.settings;
        if (b.event_name !== undefined) s.event_name = b.event_name.trim() || s.event_name;
        if (b.event_pitch !== undefined) s.event_pitch = b.event_pitch;
        if (b.sender_signature !== undefined) s.sender_signature = b.sender_signature;
        if (b.team_brief !== undefined) s.team_brief = b.team_brief;
        if (b.style_examples !== undefined) s.style_examples = b.style_examples;
        if (b.team_ai_keys !== undefined) s.team_ai_keys = parseKeys(b.team_ai_keys).join("\n");
        if (b.from_name !== undefined) s.from_name = b.from_name.trim();
        if (b.stale_after_days !== undefined) {
          if (!Number.isInteger(b.stale_after_days) || b.stale_after_days < 1 || b.stale_after_days > 365) throw invalid("Quiet days must be a whole number from 1 to 365");
          s.stale_after_days = b.stale_after_days;
        }
        c.changed();
        return { ...s };
      }),
  },

  ai: {
    /** Asks the AI a trivial question to check the key and models work. */
    test: (): Promise<string> => app().testAi(),
  },

  /** A full copy of the data as a file (a backup), and putting one back. */
  backup: {
    export: (): Promise<Blob> => now(() => (admin(), new Blob([JSON.stringify(core().db, null, 2)], { type: "application/json" }))),
    restore: (text: string): Promise<{ companies: number; leads: number }> =>
      now(() => {
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          throw invalid("That file isn't a Corpo Mailer backup");
        }
        const o = raw as Partial<DB> | null;
        if (!o || typeof o !== "object" || !Array.isArray(o.companies) || !Array.isArray(o.contacts)) throw invalid("That file isn't a Corpo Mailer backup");
        const db = normaliseDb(o);
        app().restoreBackup(db);
        return { companies: db.companies.length, leads: db.contacts.length };
      }),
  },
};
