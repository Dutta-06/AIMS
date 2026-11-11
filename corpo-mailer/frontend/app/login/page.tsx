"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { getToken, setToken, subscribeToken } from "@/lib/auth";
import { useAction } from "@/lib/hooks";

export default function LoginPage() {
  const router = useRouter();
  const token = useSyncExternalStore(subscribeToken, getToken, () => undefined);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (token) router.replace("/");
  }, [token, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      const res = await api.login(password, name.trim());
      setToken(res.access_token);
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Corpo Mailer</h1>
          <p className="mt-1 text-sm text-muted">Sign in with the team password.</p>
        </div>
        <Field label="Your name (recorded when you approve emails)">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <Field label="Team password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorNote message={error} />
        <Button type="submit" variant="primary" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
