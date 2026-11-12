import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { GoogleAuth, ReauthNeeded, SCOPES } from "./auth";
import type { Gis, KeyValueStore } from "./auth";
import { google } from "./api";
import { DriveStore } from "./drive";
import { buildRaw, encodeWords, GmailApi, oneLine } from "./gmail";
import { pickFile } from "./picker";

// ------------------------------------------------------------------ fakes
type Req = { prompt?: string; hint?: string };
class FakeGis implements Gis {
  requests: Req[] = [];
  inits = 0;
  revoked: string[] = [];
  mode: "ok" | "error" | "cancel" | "blocked" | "silent-fail" | "missing-scope" = "ok";
  counter = 0;
  initTokenClient(c: Parameters<Gis["initTokenClient"]>[0]) {
    this.inits += 1;
    return {
      requestAccessToken: (o?: Req) => {
        this.requests.push(o ?? {});
        queueMicrotask(() => {
          if (this.mode === "cancel") return c.error_callback({ type: "popup_closed" });
          if (this.mode === "blocked") return c.error_callback({ type: "popup_failed_to_open" });
          if (this.mode === "silent-fail" && o?.prompt === "") return c.error_callback({ type: "popup_failed_to_open" });
          if (this.mode === "error") return c.callback({ error: "access_denied", error_description: "The user said no" });
          this.counter += 1;
          c.callback({ access_token: `tok-${this.counter}`, expires_in: 3600, scope: (this.mode === "missing-scope" ? SCOPES.slice(0, 3) : SCOPES).join(" ") });
        });
      },
    };
  }
  hasGrantedAllScopes(r: { scope?: string }, ...scopes: string[]) {
    const got = (r.scope ?? "").split(" ");
    return scopes.every((s) => got.includes(s));
  }
  revoke(token: string) {
    this.revoked.push(token);
  }
}

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let calls: { url: string; init: RequestInit }[];
let routes: [RegExp, Handler][];
const fakeFetch = (async (url: string, init: RequestInit = {}) => {
  calls.push({ url, init });
  const hit = routes.find(([re]) => re.test(url));
  if (!hit) return json({ error: { message: `unrouted ${url}` } }, 599);
  return hit[1](url, init);
}) as unknown as typeof fetch;
const on = (re: RegExp, h: Handler) => routes.unshift([re, h]);
const bearer = (c: { init: RequestInit }) => (c.init.headers as Record<string, string>)?.Authorization;

let now = 1_000_000;
let gis: FakeGis;
let store: ReturnType<typeof memory>;
let auth: GoogleAuth;
let clientId = "client-123.apps.googleusercontent.com";

beforeEach(() => {
  now = 1_000_000;
  gis = new FakeGis();
  store = memory();
  clientId = "client-123.apps.googleusercontent.com";
  calls = [];
  routes = [[/userinfo/, () => json({ email: "Team@Gmail.com", email_verified: true })]];
  auth = new GoogleAuth({ clientId: () => clientId, gis: async () => gis, fetchImpl: fakeFetch, now: () => now, store });
});

const fails = async (p: Promise<unknown>, type: new (...a: never[]) => Error, re?: RegExp) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(type);
  if (re) expect((e as Error).message).toMatch(re);
};

// ------------------------------------------------------------------ signing in
describe("signing in with Google", () => {
  it("asks for exactly the permissions the app uses, in one go, with the account chooser", async () => {
    const t = await auth.signIn();
    expect(gis.requests).toEqual([{ prompt: "select_account" }]);
    expect(SCOPES).toEqual(["openid", "email", "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"]);
    expect(t).toEqual({ access_token: "tok-1", expires_at: now + 3_600_000, email: "team@gmail.com" });
    expect(bearer(calls[0])).toBe("Bearer tok-1"); // asked Google who it is, with the new token
  });

  it("never asks for broader Gmail access than reading and sending", () => {
    expect(SCOPES.join(" ")).not.toContain("https://mail.google.com/");
    expect(SCOPES.some((s) => s.endsWith("gmail.modify") || s.endsWith("gmail.compose"))).toBe(false);
  });

  it("needs a client ID, and says so", async () => {
    clientId = "  ";
    await fails(auth.signIn(), ApiError, /client ID/);
    expect(gis.inits).toBe(0);
  });

  it("refuses a sign-in where some permissions were unticked", async () => {
    gis.mode = "missing-scope";
    await fails(auth.signIn(), ApiError, /every permission/);
    expect(auth.token).toBeNull();
  });

  it.each([
    ["cancel", /cancelled/],
    ["blocked", /blocked Google's window/],
    ["error", /said no/],
  ] as const)("explains a failed sign-in (%s)", async (mode, re) => {
    gis.mode = mode;
    await fails(auth.signIn(), ApiError, re);
    expect(auth.token).toBeNull();
  });

  it("refuses an unverified email address", async () => {
    routes = [[/userinfo/, () => json({ email: "x@y.com", email_verified: false })]];
    await fails(auth.signIn(), ApiError, /confirm an email/);
    expect(auth.token).toBeNull();
  });

  it("two clicks at once make one request", async () => {
    const [a, b] = await Promise.all([auth.signIn(), auth.signIn()]);
    expect(a).toBe(b);
    expect(gis.requests).toHaveLength(1);
  });
});

describe("keeping the sign-in fresh", () => {
  it("hands back the same token while it is good", async () => {
    await auth.signIn();
    now += 3_000_000; // 50 minutes
    expect(await auth.ensure()).toBe("tok-1");
    expect(gis.requests).toHaveLength(1);
  });

  it("renews silently, for the same account, a minute before it runs out", async () => {
    await auth.signIn();
    now += 3_600_000 - 30_000;
    expect(await auth.ensure()).toBe("tok-2");
    expect(gis.requests[1]).toEqual({ prompt: "", hint: "team@gmail.com" });
  });

  it("when Google needs a click, asks the person to press Continue", async () => {
    await auth.signIn();
    gis.mode = "silent-fail";
    now += 3_600_000;
    await fails(auth.ensure(), ReauthNeeded, /Continue/);
    gis.mode = "ok";
    const t = await auth.renew(); // the click
    expect(gis.requests[gis.requests.length - 1]).toEqual({ prompt: "select_account", hint: "team@gmail.com" });
    expect(await auth.ensure()).toBe(t.access_token);
  });

  it("without a sign-in there is nothing to renew", async () => {
    await fails(auth.ensure(), ReauthNeeded, /Sign in/);
  });

  it("an invalidated token is treated as expired", async () => {
    await auth.signIn();
    auth.invalidate();
    expect(auth.valid).toBe(false);
    expect(await auth.ensure()).toBe("tok-2");
  });

  it("remembers a sign-in across a reload of the tab while it is still valid, and not after", async () => {
    await auth.signIn();
    const again = new GoogleAuth({ clientId: () => clientId, gis: async () => gis, fetchImpl: fakeFetch, now: () => now, store });
    expect(again.restore()?.email).toBe("team@gmail.com");
    now += 3_600_000;
    const later = new GoogleAuth({ clientId: () => clientId, gis: async () => gis, fetchImpl: fakeFetch, now: () => now, store });
    expect(later.restore()).toBeNull();
  });

  it("tells listeners when the sign-in changes", async () => {
    let n = 0;
    auth.subscribe(() => (n += 1));
    await auth.signIn();
    await auth.signOut();
    expect(n).toBe(2);
  });

  it("signing out revokes the token and forgets it", async () => {
    await auth.signIn();
    await auth.signOut();
    expect(gis.revoked).toEqual(["tok-1"]);
    expect([auth.token, store.data.size]).toEqual([null, 0]);
  });
});

// ------------------------------------------------------------------ calling Google
describe("calling Google's APIs", () => {
  beforeEach(async () => {
    await auth.signIn();
    calls = [];
  });

  it("sends the person's token", async () => {
    on(/example\.com/, () => json({ ok: true }));
    await google(auth, "https://example.com/x", {}, fakeFetch);
    expect(bearer(calls[0])).toBe("Bearer tok-1");
  });

  it("a rejected token is renewed once and the request retried", async () => {
    let n = 0;
    on(/example\.com/, (_u, init) => (n++ === 0 ? json({}, 401) : json({ token: (init.headers as Record<string, string>).Authorization })));
    const res = await google(auth, "https://example.com/x", {}, fakeFetch);
    expect(await res.json()).toEqual({ token: "Bearer tok-2" });
  });

  it("a token rejected twice asks the person to renew", async () => {
    on(/example\.com/, () => json({}, 401));
    await fails(google(auth, "https://example.com/x", {}, fakeFetch), ReauthNeeded);
  });

  it.each([
    [403, { error: { message: "Request had insufficient authentication scopes." } }, 403, /sign out and sign in again/i],
    [403, { error: { message: "Rate Limit Exceeded" } }, 429, /limiting requests/],
    [429, {}, 429, /limiting requests/],
    [503, {}, 502, /error \(503\)/],
    [404, { error: { message: "not there" } }, 404, /not there/],
  ])("explains a %s from Google", async (code, body, status, re) => {
    on(/example\.com/, () => json(body, code));
    const e = (await google(auth, "https://example.com/x", {}, fakeFetch).catch((x) => x)) as ApiError;
    expect([e.status, e.message]).toEqual([status, expect.stringMatching(re)]);
  });

  it("a dropped connection is a plain message", async () => {
    const down = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    const e = (await google(auth, "https://example.com/x", {}, down).catch((x) => x)) as ApiError;
    expect([e.status, e.message]).toEqual([0, expect.stringMatching(/Couldn't reach Google/)]);
  });
});

// ------------------------------------------------------------------ Drive
describe("Google Drive storage", () => {
  beforeEach(async () => {
    await auth.signIn();
    calls = [];
  });
  const drive = () => new DriveStore(auth, fakeFetch);

  it("asks for a file's version and name by id (nothing else in the Drive)", async () => {
    on(/drive\/v3\/files\/f1\?fields=/, () => json({ id: "f1", name: "Shared", modifiedTime: "t", version: "7" }));
    expect(await drive().meta("f1")).toEqual({ id: "f1", name: "Shared", modifiedTime: "t", version: "7" });
    const url = decodeURIComponent(calls[0].url);
    expect(url).toContain("fields=id,name,modifiedTime,version");
    expect(url).not.toContain("q=");
  });

  it("reads the file's text", async () => {
    on(/files\/f1\?alt=media/, () => new Response('{"a":1}'));
    expect(await drive().read("f1")).toBe('{"a":1}');
  });

  it("creates a normal, shareable file (not in a hidden folder) with the data in it", async () => {
    on(/upload\/drive\/v3\/files\?uploadType=multipart/, () => json({ id: "new", modifiedTime: "t", version: "1" }));
    expect(await drive().create("Shared", '{"hello":"wörld"}')).toEqual({ id: "new", modifiedTime: "t", version: "1" });
    const body = String(calls[0].init.body);
    expect(body).not.toContain("appDataFolder");
    expect(body).toContain('"name":"Shared"');
    expect(body).toContain('{"hello":"wörld"}');
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toMatch(/^multipart\/related; boundary=/);
  });

  it("updates the file in place", async () => {
    on(/upload\/drive\/v3\/files\/f1/, () => json({ id: "f1", modifiedTime: "t2", version: "2" }));
    expect((await drive().update("f1", '{"b":2}')).version).toBe("2");
    expect([calls[0].init.method, calls[0].init.body]).toEqual(["PATCH", '{"b":2}']);
  });

  it("shares with a teammate as an editor, by email", async () => {
    on(/files\/f1\/permissions/, () => json({ id: "p1" }));
    await drive().share("f1", "ben@gmail.com");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ type: "user", role: "writer", emailAddress: "ben@gmail.com" });
  });

  it("lists who can edit, people only", async () => {
    on(/files\/f1\/permissions/, () =>
      json({ permissions: [{ emailAddress: "Ann@Gmail.com", displayName: "Ann", role: "owner", type: "user" }, { role: "reader", type: "anyone" }, { emailAddress: "g@x.com", role: "writer", type: "group" }] }),
    );
    expect(await drive().collaborators("f1")).toEqual([{ email: "ann@gmail.com", name: "Ann", role: "owner" }]);
  });

  it("reports a file that is gone or not shared as an error with its status", async () => {
    on(/files\/f1\?fields=/, () => json({ error: { message: "File not found: f1." } }, 404));
    const e = (await drive().meta("f1").catch((x) => x)) as ApiError;
    expect(e.status).toBe(404);
  });
});

// ------------------------------------------------------------------ building an email
const unb64url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
const decodeRaw = (raw: string) => {
  const text = new TextDecoder().decode(Uint8Array.from(unb64url(raw), (c) => c.charCodeAt(0)));
  const [head, ...rest] = text.split("\r\n\r\n");
  const headers: Record<string, string> = {};
  for (const line of head.split("\r\n")) headers[line.slice(0, line.indexOf(":"))] = line.slice(line.indexOf(":") + 2);
  const bodyText = new TextDecoder().decode(Uint8Array.from(atob(rest.join("\r\n\r\n").replace(/\r\n/g, "")), (c) => c.charCodeAt(0)));
  return { headers, body: bodyText };
};
const decodeWords = (s: string) => s.replace(/=\?UTF-8\?B\?([^?]+)\?=(?:\s+(?==\?UTF-8))?/g, (_m, b) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0))));

describe("building an email", () => {
  const mail = { fromName: "brAInwave Team", fromEmail: "team@gmail.com", to: "raj@acme.com", subject: "Sponsor brAInwave 3", body: "Hello Raj,\nSee you soon." };

  it("has the right headers and a body that decodes back exactly", () => {
    const { headers, body } = decodeRaw(buildRaw(mail));
    expect(headers).toMatchObject({ From: '"brAInwave Team" <team@gmail.com>', To: "raj@acme.com", Subject: "Sponsor brAInwave 3", "MIME-Version": "1.0", "Content-Transfer-Encoding": "base64" });
    expect(headers["Content-Type"]).toContain("text/plain");
    expect(body).toBe("Hello Raj,\r\nSee you soon.");
  });

  it("carries non-English text in the subject, sender name and body", () => {
    const { headers, body } = decodeRaw(buildRaw({ ...mail, fromName: "ब्रेनवेव टीम", subject: "नमस्ते — Sponsor ✓ " + "x".repeat(60), body: "धन्यवाद 🙏" }));
    expect(decodeWords(headers.Subject)).toBe("नमस्ते — Sponsor ✓ " + "x".repeat(60));
    expect(decodeWords(headers.From)).toBe("ब्रेनवेव टीम <team@gmail.com>");
    expect(body).toBe("धन्यवाद 🙏");
    for (const w of headers.Subject.split(" ")) expect(w.length).toBeLessThanOrEqual(75); // each encoded word stays short
  });

  it("can't be tricked into adding headers through line breaks", () => {
    const { headers } = decodeRaw(buildRaw({ ...mail, subject: "Hi\r\nBcc: evil@x.com", to: "raj@acme.com\r\nBcc: evil@x.com", fromName: "Team\r\nX-Evil: 1" }));
    expect(Object.keys(headers)).toEqual(["From", "To", "Subject", "MIME-Version", "Content-Type", "Content-Transfer-Encoding"]);
    expect(headers.Subject).toBe("Hi Bcc: evil@x.com");
    expect(oneLine("a\r\nb\nc\rd")).toBe("a b c d");
  });

  it("escapes quotes in the sender name and copes with no name", () => {
    expect(decodeRaw(buildRaw({ ...mail, fromName: 'The "Best" Team' })).headers.From).toBe('"The \\"Best\\" Team" <team@gmail.com>');
    expect(decodeRaw(buildRaw({ ...mail, fromName: "  " })).headers.From).toBe("team@gmail.com");
  });

  it("uses URL-safe encoding with no padding", () => {
    expect(buildRaw(mail)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("leaves plain ASCII headers alone", () => {
    expect(encodeWords("Plain subject")).toBe("Plain subject");
  });
});

// ------------------------------------------------------------------ Gmail
describe("the Gmail API", () => {
  let gmail: GmailApi;
  beforeEach(async () => {
    await auth.signIn();
    calls = [];
    gmail = new GmailApi(auth, () => "brAInwave Team", fakeFetch);
  });

  it("sends an email as the signed-in person and returns the ids replies will carry", async () => {
    on(/messages\/send/, () => json({ id: "g99", threadId: "th9" }));
    on(/messages\/g99\?format=metadata/, () => json({ payload: { headers: [{ name: "Message-ID", value: " <real-id@mail.gmail.com> " }] } }));
    const r = await gmail.send({ to: "raj@acme.com", subject: "Hi", body: "Hello" });
    expect(r).toEqual({ messageId: "<real-id@mail.gmail.com>", threadId: "th9" });
    const sent = calls.find((c) => /messages\/send/.test(c.url))!;
    expect(sent.init.method).toBe("POST");
    const { headers } = decodeRaw(JSON.parse(String(sent.init.body)).raw);
    expect(headers.From).toBe('"brAInwave Team" <team@gmail.com>');
    expect(headers.To).toBe("raj@acme.com");
  });

  it("still reports the send if reading back the Message-ID fails", async () => {
    on(/messages\/send/, () => json({ id: "g99", threadId: "th9" }));
    on(/messages\/g99\?format=metadata/, () => json({}, 500));
    expect(await gmail.send({ to: "a@b.com", subject: "s", body: "b" })).toEqual({ messageId: null, threadId: "th9" });
  });

  it("a failed send is an error, not a silent success", async () => {
    on(/messages\/send/, () => json({ error: { message: "Invalid to header" } }, 400));
    await fails(gmail.send({ to: "a@b.com", subject: "s", body: "b" }), ApiError, /Invalid to header/);
  });

  it("won't send when nobody is signed in", async () => {
    await auth.signOut();
    await fails(gmail.send({ to: "a@b.com", subject: "s", body: "b" }), ApiError, /Sign in/);
  });

  it("lists new inbox mail since a time, skips what it has seen, and reads the rest in full", async () => {
    on(/messages\?q=/, (url) => {
      const page = new URL(url).searchParams.get("pageToken");
      return page ? json({ messages: [{ id: "c" }] }) : json({ messages: [{ id: "a" }, { id: "b" }], nextPageToken: "p2" });
    });
    const text = (id: string) => ({ id, threadId: "t", internalDate: "1773392400000", payload: { headers: [{ name: "From", value: "Raj <raj@acme.com>" }, { name: "Message-ID", value: `<${id}@x>` }], mimeType: "text/plain", body: { data: btoa("hi") } } });
    on(/messages\/[abc]\?format=full/, (url) => json(text(url.match(/messages\/(\w)\?/)![1])));
    const got = await gmail.fetch({ sinceMs: 1_773_000_000_000, skipIds: new Set(["b"]) });
    expect(got.map((m) => m.id)).toEqual(["a", "c"]);
    const q = decodeURIComponent(calls.find((c) => /messages\?q=/.test(c.url))!.url);
    expect(q).toContain("in:inbox after:1773000000");
    expect(calls.some((c) => /messages\/b\?/.test(c.url))).toBe(false); // never fetched
  });

  it("looks at no more than 300 messages in one check", async () => {
    on(/messages\?q=/, () => json({ messages: Array.from({ length: 130 }, (_, i) => ({ id: `m${i}` })), nextPageToken: "more" })); // 3 pages = 390, more than the cap
    on(/messages\/m\d+\?format=full/, (url) => json({ id: url.match(/messages\/(m\d+)\?/)![1], payload: { headers: [] } }));
    expect(await gmail.fetch({ sinceMs: 0, skipIds: new Set() })).toHaveLength(300);
  });
});

// ------------------------------------------------------------------ the file picker
describe("choosing the shared file", () => {
  const cfg = { apiKey: "key-1", appId: "123456" };
  const fakePicker = (result: { action: string; docs?: { id: string; name: string }[] }) => {
    const seen: { token: string; apiKey: string; appId: string }[] = [];
    return {
      seen,
      load: async () => ({
        show: (o: { token: string; apiKey: string; appId: string; onResult: (r: typeof result) => void }) => {
          seen.push({ token: o.token, apiKey: o.apiKey, appId: o.appId });
          o.onResult(result);
        },
      }),
    };
  };

  it("returns the file the person picked, using their sign-in and the configured key", async () => {
    await auth.signIn();
    const p = fakePicker({ action: "picked", docs: [{ id: "f9", name: "Corpo Mailer shared data" }] });
    expect(await pickFile(auth, cfg, p.load)).toEqual({ id: "f9", name: "Corpo Mailer shared data" });
    expect(p.seen[0]).toMatchObject({ apiKey: "key-1", appId: "123456", token: expect.stringMatching(/^tok-/) });
  });

  it("returns null when the person closes it", async () => {
    await auth.signIn();
    expect(await pickFile(auth, cfg, fakePicker({ action: "cancel" }).load)).toBeNull();
  });

  it("says what is missing if the API key or project number isn't set", async () => {
    await auth.signIn();
    const e = (await pickFile(auth, { apiKey: "", appId: "1" }, fakePicker({ action: "cancel" }).load).catch((x) => x)) as ApiError;
    expect([e.status, e.message]).toEqual([409, expect.stringMatching(/API key and project number/)]);
  });
});
