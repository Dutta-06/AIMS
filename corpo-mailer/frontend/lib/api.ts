import { clearOnUnauthorized } from "./session";
import { getToken } from "./auth";
import type {
  Company,
  Contact,
  Dashboard,
  Deal,
  Draft,
  DraftKind,
  DraftStatus,
  Interaction,
  InteractionType,
  Stage,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

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
      .join("; ");
  }
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Is the backend running?");
  }
  if (res.status === 401) clearOnUnauthorized();
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, detailMessage(body, `Request failed (${res.status})`));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });
const qs = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

export type CompanyInput = Partial<Omit<Company, "id" | "created_at">> & { name: string };
export type ContactInput = { company_id: number; name: string; email: string; role?: string };
export type DealPatch = Partial<
  Pick<
    Deal,
    "stage" | "owner" | "target_amount" | "committed_amount" | "next_followup_at" | "notes"
  >
>;

export const api = {
  login: (password: string, name: string) =>
    request<{ access_token: string }>("/auth/login", { method: "POST", ...json({ password, name }) }),
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
    list: (company_id?: number) => request<Contact[]>(`/contacts${qs({ company_id })}`),
    create: (b: ContactInput) => request<Contact>("/contacts", { method: "POST", ...json(b) }),
    update: (id: number, b: Partial<Pick<Contact, "name" | "email" | "role" | "do_not_contact">>) =>
      request<Contact>(`/contacts/${id}`, { method: "PATCH", ...json(b) }),
    remove: (id: number) => request<void>(`/contacts/${id}`, { method: "DELETE" }),
  },
  deals: {
    list: (p: { stage?: Stage; company_id?: number } = {}) => request<Deal[]>(`/deals${qs(p)}`),
    get: (id: number) => request<Deal>(`/deals/${id}`),
    create: (b: { company_id: number; target_amount?: number }) =>
      request<Deal>("/deals", { method: "POST", ...json(b) }),
    update: (id: number, b: DealPatch) =>
      request<Deal>(`/deals/${id}`, { method: "PATCH", ...json(b) }),
    remove: (id: number) => request<void>(`/deals/${id}`, { method: "DELETE" }),
    interactions: (id: number) => request<Interaction[]>(`/deals/${id}/interactions`),
    logInteraction: (
      id: number,
      b: { type: InteractionType; contact_id?: number | null; subject?: string; content?: string },
    ) => request<Interaction>(`/deals/${id}/interactions`, { method: "POST", ...json(b) }),
  },
  drafts: {
    list: (p: { status?: DraftStatus; deal_id?: number } = {}) =>
      request<Draft[]>(`/drafts${qs(p)}`),
    generate: (b: { deal_id: number; contact_id: number; kind: DraftKind; instructions?: string }) =>
      request<Draft>("/drafts/generate", { method: "POST", ...json(b) }),
    create: (b: { deal_id: number; contact_id: number; subject: string; body: string }) =>
      request<Draft>("/drafts", { method: "POST", ...json(b) }),
    edit: (id: number, b: { subject?: string; body?: string }) =>
      request<Draft>(`/drafts/${id}`, { method: "PATCH", ...json(b) }),
    approve: (id: number) => request<Draft>(`/drafts/${id}/approve`, { method: "POST" }),
    revoke: (id: number) => request<Draft>(`/drafts/${id}/revoke`, { method: "POST" }),
    send: (id: number) => request<Draft>(`/drafts/${id}/send`, { method: "POST" }),
  },
};
