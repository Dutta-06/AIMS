"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, ErrorNote, Field, Input, Loading } from "@/components/ui";
import { app, useApp } from "@/lib/engine/app";

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-4 w-4">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const s = useApp();
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void app().init();
  }, []);
  useEffect(() => {
    if (s.phase === "ready" || s.phase === "needs_workspace") router.replace("/");
  }, [s.phase, router]);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      if (clientId.trim()) app().setClientId(clientId);
      await app().signIn(); // the effect above moves on once the data is open
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in didn't work");
      setBusy(false);
    }
  }

  if (!s.booted || s.phase === "ready" || s.phase === "loading" || s.phase === "needs_workspace") return <Loading label={s.phase === "loading" ? "Opening your data" : "Loading"} />;

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
      <Card className="w-full space-y-4">
        <div>
          <h1 className="text-[1.6rem] font-medium tracking-[-0.02em] text-heading">Corpo Mailer</h1>
          <p className="mt-1 text-sm text-body">Sign in with Google. The team shares one workspace file in Google Drive, and your emails go from your own Gmail.</p>
        </div>

        {!s.client_id_set && (
          <Field label="Google client ID (one-time setup)">
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" autoCapitalize="none" spellCheck={false} className="font-mono text-[0.8rem]" />
            <span className="mt-1 block text-xs text-faint">Created once in Google Cloud, see docs/GMAIL_SETUP.md. It isn&apos;t a secret.</span>
          </Field>
        )}
        <ErrorNote message={error ?? s.error} />
        <Button variant="primary" className="w-full gap-2.5" disabled={busy || (!s.client_id_set && !clientId.trim())} onClick={signIn}>
          <GoogleMark />
          {busy ? "Waiting for Google…" : "Sign in with Google"}
        </Button>

        <details className="text-sm">
          <summary className="cursor-pointer text-body hover:text-heading">What it asks Google for</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-body">
            <li>Your email address, to know who you are.</li>
            <li>Google Drive, to find and update the team&apos;s one shared workspace file (Google words this as access to your Drive; the app only ever touches that file).</li>
            <li>Sending email as you, only when you approve and send a draft.</li>
            <li>Reading your inbox, only to spot replies. It never changes, moves or deletes mail.</li>
          </ul>
          <p className="mt-2 text-xs text-faint">There is no server: this page talks to Google (and to OpenRouter for the AI) directly from your browser.</p>
        </details>
      </Card>
    </main>
  );
}
