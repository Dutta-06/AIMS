"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import BackendAddress from "@/components/BackendAddress";
import { Button, Card, ErrorNote, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { saveSession } from "@/lib/auth";
import { errorMessage } from "@/lib/hooks";
import type { AuthStatus } from "@/lib/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

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

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const result = params.get("signin");
  const code = params.get("code");
  const reason = params.get("reason");
  const [status, setStatus] = useState<AuthStatus | null>(null);
  // A failed sign-in comes back as ?signin=error&reason=...; a good one as ?signin=ok&code=...
  const [error, setError] = useState<string | null>(() => (result === "error" ? reason || "Sign-in didn't work" : null));
  const [busy, setBusy] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (result === "ok" && code) {
      // The login code is single use: trade it for a session once, then clean the address bar.
      api.auth
        .exchange(code)
        .then((s) => {
          saveSession(s.token, s.expires_at, s.email);
          router.replace("/");
        })
        .catch((e) => {
          setError(errorMessage(e));
          router.replace("/login/");
        });
      return;
    }
    api.auth
      .status()
      .then((s) => {
        if (s.authenticated) router.replace("/"); // already in (or there is no sign-in to do)
        else setStatus(s);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [result, code, router]);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.auth.start(`${window.location.origin}${BASE}/login/`);
      window.location.href = url; // off to Google; it brings you back here
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const checking = !status && !error && !(result === "ok" && code);
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
      <Card className="w-full space-y-4">
        <div>
          <h1 className="text-[1.6rem] font-medium tracking-[-0.02em] text-heading">Corpo Mailer</h1>
          <p className="mt-1 text-sm text-body">Sign in with the Google account you were given access with.</p>
        </div>

        {result === "ok" && code && !error ? (
          <Loading label="Signing you in" />
        ) : (
          <>
            {status && !status.configured && (
              <p className="rounded-xl border border-hairline bg-white/[0.03] p-3 text-sm text-body">
                Google sign-in isn&apos;t set up on this backend yet. Whoever runs it needs to add the Google client ID and secret (see docs/GMAIL_SETUP.md), and list the allowed accounts in ALLOWED_EMAILS.
              </p>
            )}
            <ErrorNote message={error} />
            <Button variant="primary" className="w-full gap-2.5" disabled={busy || checking || (status ? !status.configured : false)} onClick={signIn}>
              <GoogleMark />
              {busy ? "Opening Google…" : "Sign in with Google"}
            </Button>
          </>
        )}

        <details className="text-sm" open={Boolean(error && /reach/i.test(error))}>
          <summary className="cursor-pointer text-body hover:text-heading">Backend address</summary>
          <div className="pt-3">
            <BackendAddress />
          </div>
        </details>
        <p className="text-xs text-faint">
          This page is only the interface. Google confirms who you are, and the backend decides whether that account may come in. Only your email address is shared with it.
        </p>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LoginInner />
    </Suspense>
  );
}
