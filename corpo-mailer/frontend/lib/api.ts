import type {
  Channel,
  Company,
  Contact,
  Dashboard,
  Draft,
  Enrichment,
  GmailStatus,
  Prospect,
  ProspectState,
  SearchHit,
  DraftKind,
  DraftStatus,
  ImportPreview,
  Interaction,
  InteractionType,
  ReplyStatus,
  Status,
  SyncResult,
} from "./types";

import { getToken, signOut } from "./auth";
import { backendUrl } from "./backend";


export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function detailMessage(body: unknown, fallback: string): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}`.replace(/^: /, ""))
      .join("; ")
      .replace(/^Value error, /, "");
  }
  return fallback;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return {
    ...extra,
    // The backend refuses changes without this (it is what stops other websites from
    // making your browser trigger a send).
    "X-Corpo-Mailer": "1",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${backendUrl()}${path}`, {
      ...init,
      headers: authHeaders(init.body ? { "Content-Type": "application/json" } : {}),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Is the backend running?");
  }
  // A 401 on a normal call means the sign-in ran out (or the password changed): back to sign-in.
  if (res.status === 401 && !path.startsWith("/auth/")) signOut();
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, detailMessage(body, `Request failed (${res.status})`));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });
const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== false) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

export type CompanyInput = Partial<Omit<Company, "id" | "created_at">> & { name: string };
export type ContactInput = {
  company_id: number;
  name?: string | null;
  email?: string | null;
  linkedin?: string | null;
  role?: string | null;
  status?: Status;
  channels?: Channel[];
  remarks?: string | null;
  next_followup_at?: string | null;
};
export type ContactPatch = Partial<
  Omit<ContactInput, "company_id"> & { do_not_contact: boolean; reply_unread: boolean }
>;

export const api = {
  dashboard: () => request<Dashboard>("/dashboard"),

  companies: {
    list: (q?: string) => request<Company[]>(`/companies${qs({ q })}`),
    get: (id: number) => request<Company>(`/companies/${id}`),
    create: (b: CompanyInput) => request<Company>("/companies", { method: "POST", ...json(b) }),
    update: (id: number, b: Partial<CompanyInput>) =>
      request<Company>(`/companies/${id}`, { method: "PATCH", ...json(b) }),
    remove: (id: number) => request<void>(`/companies/${id}`, { method: "DELETE" }),
  },

  contacts: {
    list: (p: { company_id?: number; status?: Status; q?: string } = {}) =>
      request<Contact[]>(`/contacts${qs(p)}`),
    get: (id: number) => request<Contact>(`/contacts/${id}`),
    create: (b: ContactInput) => request<Contact>("/contacts", { method: "POST", ...json(b) }),
    update: (id: number, b: ContactPatch) =>
      request<Contact>(`/contacts/${id}`, { method: "PATCH", ...json(b) }),
    remove: (id: number) => request<void>(`/contacts/${id}`, { method: "DELETE" }),
    interactions: (id: number) => request<Interaction[]>(`/contacts/${id}/interactions`),
    log: (
      id: number,
      b: { type: InteractionType; channel?: Channel | null; subject?: string; content?: string },
    ) => request<Interaction>(`/contacts/${id}/interactions`, { method: "POST", ...json(b) }),
  },

  discovery: {
    list: (state: ProspectState | "all" = "new") => request<Prospect[]>(`/discovery${qs({ state })}`),
    suggest: (b: { count: number; focus?: string }) =>
      request<{ added: Prospect[]; skipped_duplicates: number }>("/discovery/suggest", { method: "POST", ...json(b) }),
    enrich: (companyId: number) => request<Enrichment>(`/discovery/enrich/${companyId}`, { method: "POST" }),
    applyEnrichment: (companyId: number, b: { set_website: boolean; emails: string[] }) =>
      request<{ website_set: boolean; contacts_added: number; skipped: string[] }>(
        `/discovery/enrich/${companyId}/apply`,
        { method: "POST", ...json(b) },
      ),
    search: (query: string) => request<SearchHit[]>("/discovery/search", { method: "POST", ...json({ query }) }),
    fromPage: (url: string) =>
      request<{ added: Prospect[]; skipped_duplicates: number; found: number }>("/discovery/from-page", {
        method: "POST",
        ...json({ url }),
      }),
    verify: (id: number, website?: string) =>
      request<Prospect>(`/discovery/${id}/verify`, { method: "POST", ...json(website ? { website } : {}) }),
    accept: (id: number) =>
      request<{ company_id: number; prospect: Prospect }>(`/discovery/${id}/accept`, { method: "POST" }),
    reject: (id: number) => request<Prospect>(`/discovery/${id}/reject`, { method: "POST" }),
    snooze: (id: number, days = 30) =>
      request<Prospect>(`/discovery/${id}/snooze`, { method: "POST", ...json({ days }) }),
  },

  drafts: {
    list: (p: { status?: DraftStatus; contact_id?: number } = {}) => request<Draft[]>(`/drafts${qs(p)}`),
    generate: (b: { contact_id: number; kind: DraftKind; instructions?: string; channel?: Channel }) =>
      request<Draft>("/drafts/generate", { method: "POST", ...json(b) }),
    create: (b: { contact_id: number; subject: string; body: string }) =>
      request<Draft>("/drafts", { method: "POST", ...json(b) }),
    edit: (id: number, b: { subject?: string; body?: string }) =>
      request<Draft>(`/drafts/${id}`, { method: "PATCH", ...json(b) }),
    revise: (id: number, feedback: string) =>
      request<Draft>(`/drafts/${id}/revise`, { method: "POST", ...json({ feedback }) }),
    undo: (id: number) => request<Draft>(`/drafts/${id}/undo`, { method: "POST" }),
    markSent: (id: number) => request<Draft>(`/drafts/${id}/mark-sent`, { method: "POST" }),
    approve: (id: number) => request<Draft>(`/drafts/${id}/approve`, { method: "POST" }),
    revoke: (id: number) => request<Draft>(`/drafts/${id}/revoke`, { method: "POST" }),
    send: (id: number) => request<Draft>(`/drafts/${id}/send`, { method: "POST" }),
  },

  replies: {
    status: () => request<ReplyStatus>("/replies/status"),
    sync: () => request<SyncResult>("/replies/sync", { method: "POST" }),
  },

  import: {
    preview: (csv: string, o: { overwrite: boolean; infer_status: boolean }) =>
      request<ImportPreview>("/import/preview", { method: "POST", ...json({ csv, ...o }) }),
    commit: (csv: string, o: { overwrite: boolean; infer_status: boolean }) =>
      request<ImportPreview["summary"]>("/import/commit", { method: "POST", ...json({ csv, ...o }) }),
    /** The file needs the sign-in token, so it can't be a plain link: fetch it, then save it. */
    exportCsv: async (): Promise<Blob> => {
      let res: Response;
      try {
        res = await fetch(`${backendUrl()}/export.csv`, { headers: authHeaders() });
      } catch {
        throw new ApiError(0, "Can't reach the server. Is the backend running?");
      }
      if (res.status === 401) signOut();
      if (!res.ok) throw new ApiError(res.status, `Export failed (${res.status})`);
      return res.blob();
    },
  },

  gmail: {
    status: () => request<GmailStatus>("/gmail/status"),
    connect: (returnTo: string) =>
      request<{ url: string }>("/gmail/connect", { method: "POST", ...json({ return_to: returnTo }) }),
    disconnect: () => request<{ disconnected: boolean }>("/gmail/disconnect", { method: "POST" }),
  },

  auth: {
    status: () => request<{ required: boolean; authenticated: boolean }>("/auth/status"),
    login: (password: string) =>
      request<{ token: string; expires_at: number }>("/auth/login", { method: "POST", ...json({ password }) }),
  },
};
