"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useToast } from "@/components/ToastProvider";
import { Button, Card, ErrorNote, Loading, PageHeader, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useAction, useQuery } from "@/lib/hooks";
import type { AuthStatus, GmailStatus } from "@/lib/types";
import { AnimatePresence } from "motion/react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function Setup({ redirectUri }: { redirectUri: string }) {
  const toast = useToast();
  return (
    <div className="space-y-3 text-sm text-body">
      <p className="text-heading">One-time setup in Google (about 10 minutes, done once for the whole team)</p>
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>
          In <span className="text-heading">console.cloud.google.com</span>, create a project and open <span className="text-heading">APIs &amp; Services → OAuth consent screen</span>. Choose <span className="text-heading">Internal</span> if you use a university or company Google account; otherwise <span className="text-heading">External</span> and add each person&apos;s address as a test user.
        </li>
        <li>
          Under <span className="text-heading">Credentials → Create credentials → OAuth client ID</span>, pick <span className="text-heading">Web application</span> and add this as an authorised redirect URI:
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-white/[0.06] px-2 py-1 font-mono text-xs text-heading">{redirectUri}</code>
            <Button
              small
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(redirectUri);
                  toast("Copied");
                } catch {
                  toast("Couldn't copy. Select it and copy by hand", "error");
                }
              }}
            >
              Copy
            </Button>
          </span>
        </li>
        <li>
          Put the client ID and secret in the backend&apos;s settings as <span className="font-mono text-xs text-heading">GOOGLE_CLIENT_ID</span> and <span className="font-mono text-xs text-heading">GOOGLE_CLIENT_SECRET</span>, restart the backend and reload this page.
        </li>
      </ol>
      <p className="text-xs text-faint">Full walkthrough: docs/GMAIL_SETUP.md in the repository.</p>
    </div>
  );
}

function AccessCard({ a }: { a: AuthStatus }) {
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 text-[1.05rem] font-medium text-heading">
        Who can use this site
        {a.required ? <Pill tone="green">Google sign-in</Pill> : <Pill tone="amber">No sign-in</Pill>}
      </h2>
      {a.required ? (
        <>
          <p className="text-sm text-body">
            Only these Google accounts can sign in. You are signed in as <span className="font-mono text-[0.85rem] text-heading">{a.email}</span>.
          </p>
          <ul className="space-y-1 text-sm">
            {a.allowed.map((e) => (
              <li key={e} className="font-mono text-[0.85rem] text-heading">
                {e}
                {e === a.email && <span className="ml-2 font-sans text-xs text-faint">you</span>}
              </li>
            ))}
          </ul>
          <p className="text-xs text-faint">To add or remove someone, change ALLOWED_EMAILS on the backend and restart it. Removing someone signs them out straight away.</p>
        </>
      ) : (
        <p className="text-sm text-body">
          No accounts are listed on the backend, so there is no sign-in: anyone who can reach it can use it. That is only fine while it runs on your own computer. To require Google sign-in, list the allowed accounts in ALLOWED_EMAILS.
        </p>
      )}
    </Card>
  );
}

function GmailCard({ s, reload }: { s: GmailStatus; reload: () => void }) {
  const toast = useToast();
  const connect = useAction();
  const disconnect = useAction();
  const [confirming, setConfirming] = useState(false);

  const start = () =>
    connect.run(async () => {
      const back = `${window.location.origin}${BASE}/settings/`;
      const { url } = await api.gmail.connect(back);
      window.location.href = url; // off to Google; it brings you back here
    });

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[1.05rem] font-medium text-heading">
            Gmail
            {s.connected ? <Pill tone="green">Connected</Pill> : s.needs_reconnect ? <Pill tone="amber">Needs reconnecting</Pill> : <Pill>Not connected</Pill>}
          </h2>
          <p className="mt-0.5 text-sm text-body">
            The mailbox the team sends from and checks for replies. It can be a different account from the one you signed in with. Nothing is ever sent without your approval.
          </p>
        </div>
        {s.configured && (
          <div className="flex gap-2">
            <Button variant="primary" disabled={connect.busy} onClick={start}>
              {connect.busy ? "Opening Google…" : s.connected || s.needs_reconnect ? "Reconnect" : "Connect Gmail"}
            </Button>
            {s.connected && (
              <Button variant="danger" disabled={disconnect.busy} onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            )}
          </div>
        )}
      </div>

      {s.connected && (
        <p className="text-sm text-body">
          Sending and checking replies as <span className="font-mono text-[0.85rem] text-heading">{s.email}</span>
          {s.connected_at ? <> · connected {fmtDateTime(s.connected_at)}</> : null}
        </p>
      )}
      {s.needs_reconnect && (
        <p className="text-sm text-body">
          The connection to <span className="font-mono text-[0.85rem] text-heading">{s.email}</span> stopped working{s.last_error ? `: ${s.last_error}` : ""}. Press Reconnect and approve again. Nothing was lost.
        </p>
      )}
      {!s.configured && <Setup redirectUri={s.redirect_uri} />}
      <ErrorNote message={connect.error ?? disconnect.error} />

      <AnimatePresence>
        {confirming && (
          <ConfirmDialog
            title={`Disconnect ${s.email}?`}
            confirmLabel="Disconnect"
            confirmVariant="danger"
            busy={disconnect.busy}
            onCancel={() => setConfirming(false)}
            onConfirm={async () => {
              if (await disconnect.run(() => api.gmail.disconnect())) {
                setConfirming(false);
                toast("Gmail disconnected");
                reload();
              }
            }}
          >
            <p>Sending and reply tracking stop until you connect again. Access is also removed at Google.</p>
          </ConfirmDialog>
        )}
      </AnimatePresence>
    </Card>
  );
}

function SettingsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const handled = useRef(false);
  const { data, error, loading, reload } = useQuery("settings:all", async () => {
    const [gmail, access] = await Promise.all([api.gmail.status(), api.auth.status()]);
    return { gmail, access };
  });

  // Google sends you back here with ?gmail=connected or ?gmail=error&reason=... Show it once, then
  // tidy the address bar.
  const result = params.get("gmail");
  const reason = params.get("reason");
  const [notice] = useState<string | null>(() =>
    result && result !== "connected" ? reason || "Gmail wasn't connected" : null,
  );
  useEffect(() => {
    if (!result || handled.current) return;
    handled.current = true;
    if (result === "connected") toast("Gmail connected");
    router.replace("/settings/");
    reload();
  }, [result, router, toast, reload]);

  return (
    <>
      <PageHeader title="Settings" subtitle="Connections the app uses. Everything here stays on the backend you run." />
      {notice && (
        <div className="mb-4">
          <ErrorNote message={notice} />
        </div>
      )}
      {loading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote message={error} />
      ) : (
        <div className="space-y-5">
          <AccessCard a={data.access} />
          <GmailCard s={data.gmail} reload={reload} />
        </div>
      )}
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SettingsInner />
    </Suspense>
  );
}
