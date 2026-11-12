/** Calls to Google's APIs with the signed-in person's token. */
import { ApiError } from "../errors";
import type { GoogleAuth } from "./auth";
import { ReauthNeeded } from "./auth";

export type Fetcher = typeof fetch;

/** One Google API request. A 401 means the token is stale: renew once and retry. */
export async function google(auth: GoogleAuth, url: string, init: RequestInit = {}, fetchImpl: Fetcher = fetch, retried = false): Promise<Response> {
  const token = await auth.ensure();
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiError(0, "Couldn't reach Google. Check your connection");
  }
  if (res.status === 401) {
    auth.invalidate();
    if (!retried) return google(auth, url, init, fetchImpl, true);
    throw new ReauthNeeded();
  }
  if (res.ok) return res;
  let detail = "";
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
  } catch {
    /* no details */
  }
  if (res.status === 403 && /insufficient|scope|permission/i.test(detail)) {
    throw new ApiError(403, "Google didn't give Corpo Mailer a permission it needs. Sign out and sign in again, leaving every box ticked.");
  }
  if (res.status === 403 && /rate|quota/i.test(detail)) throw new ApiError(429, "Google is limiting requests right now. Try again in a minute.");
  if (res.status === 429) throw new ApiError(429, "Google is limiting requests right now. Try again in a minute.");
  throw new ApiError(res.status >= 500 ? 502 : res.status, `Google answered with an error (${res.status})${detail ? `: ${detail}` : ""}`);
}
