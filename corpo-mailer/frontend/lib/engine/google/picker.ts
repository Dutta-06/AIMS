/**
 * Google's file picker: how a teammate says "this is the shared file" so the app is allowed to open
 * it (the narrow Drive permission only covers files the person picks here).
 */
import type { GoogleAuth } from "./auth";
import { ApiError } from "../errors";

export type PickerConfig = { apiKey: string; appId: string };
export type Picked = { id: string; name: string };

type PickerDoc = { id: string; name: string };
type PickerResult = { action: string; docs?: PickerDoc[] };

/** The slice of Google's picker library we use, so tests can stand in for it. */
export interface PickerApi {
  show(o: { token: string; apiKey: string; appId: string; onResult: (r: PickerResult) => void }): void;
}

declare global {
  interface Window {
    gapi?: { load(name: string, cb: () => void): void };
    google?: unknown;
  }
}

export function loadPicker(): Promise<PickerApi> {
  const w = window as unknown as { gapi?: { load(n: string, cb: () => void): void } };
  const make = (): PickerApi => ({
    show: ({ token, apiKey, appId, onResult }) => {
      const g = (window as unknown as { google: { picker: Record<string, any> } }).google.picker; // eslint-disable-line @typescript-eslint/no-explicit-any
      const view = new g.DocsView(g.ViewId.DOCS).setIncludeFolders(false).setMimeTypes("application/json");
      new g.PickerBuilder().setOAuthToken(token).setDeveloperKey(apiKey).setAppId(appId).addView(view).setTitle("Choose the shared Corpo Mailer file").setCallback(onResult).build().setVisible(true);
    },
  });
  const ready = () =>
    new Promise<PickerApi>((resolve, reject) => {
      if (!w.gapi) return reject(new ApiError(0, "Google's file picker didn't start"));
      w.gapi.load("picker", () => resolve(make()));
    });
  if (w.gapi) return ready();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onload = () => ready().then(resolve, reject);
    s.onerror = () => reject(new ApiError(0, "Couldn't load Google's file picker. Check your connection (or an ad blocker) and try again"));
    document.head.appendChild(s);
  });
}

/** Show the picker; resolves with the chosen file, or null if the person closed it. */
export async function pickFile(auth: GoogleAuth, cfg: PickerConfig, load: () => Promise<PickerApi> = loadPicker): Promise<Picked | null> {
  if (!cfg.apiKey || !cfg.appId) throw new ApiError(409, "The file picker needs a Google API key and project number. See docs/GMAIL_SETUP.md, step 4.");
  const [api, token] = await Promise.all([load(), auth.ensure()]);
  return new Promise((resolve, reject) => {
    try {
      api.show({
        token,
        apiKey: cfg.apiKey,
        appId: cfg.appId,
        onResult: (r) => {
          if (r.action === "picked" && r.docs?.[0]) resolve({ id: r.docs[0].id, name: r.docs[0].name });
          else if (r.action === "cancel") resolve(null);
        },
      });
    } catch (e) {
      reject(e);
    }
  });
}
