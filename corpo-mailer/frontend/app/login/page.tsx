"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { saveSession } from "@/lib/auth";
import { errorMessage } from "@/lib/hooks";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to sign in to (no password set), or already signed in: go straight to the app.
  useEffect(() => {
    api.auth
      .status()
      .then((s) => s.authenticated && router.replace("/"))
      .catch((e) => setError(errorMessage(e)));
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.login(password);
      saveSession(r.token, r.expires_at);
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
      <Card className="w-full space-y-4">
        <div>
          <h1 className="text-[1.6rem] font-medium tracking-[-0.02em] text-heading">Corpo Mailer</h1>
          <p className="mt-1 text-sm text-body">Enter the team password to continue.</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Password">
            <Input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} className="h-11" />
          </Field>
          <ErrorNote message={error} />
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !password}>
            {busy ? "Checking…" : "Sign in"}
          </Button>
        </form>
        <p className="text-xs text-faint">
          This page is only the interface. The password is checked by the backend on your computer, and nothing is stored here but a sign-in that expires.
        </p>
      </Card>
    </main>
  );
}
