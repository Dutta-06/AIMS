"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, ErrorNote, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { SIGNED_OUT } from "@/lib/auth";
import { errorMessage } from "@/lib/hooks";

type State = { kind: "checking" } | { kind: "ok" } | { kind: "down"; message: string };

/**
 * Nothing in the app is shown until the backend says this browser may use it. The check is only a
 * convenience for the person: the backend refuses every request without a valid token anyway.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "checking" });

  // State is only set from the answer (never synchronously inside the effect).
  const run = useCallback(() => {
    api.auth
      .status()
      .then((s) => {
        if (s.required && !s.authenticated) router.replace("/login");
        else setState({ kind: "ok" });
      })
      .catch((e) => setState({ kind: "down", message: errorMessage(e) }));
  }, [router]);

  const retry = () => {
    setState({ kind: "checking" });
    run();
  };

  useEffect(() => {
    run();
  }, [run]);

  useEffect(() => {
    const out = () => router.replace("/login");
    window.addEventListener(SIGNED_OUT, out);
    return () => window.removeEventListener(SIGNED_OUT, out);
  }, [router]);

  if (state.kind === "ok") return <>{children}</>;
  if (state.kind === "down") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
        <Card className="w-full space-y-3">
          <h1 className="text-lg font-medium text-heading">Can&apos;t reach the backend</h1>
          <p className="text-sm text-body">
            This page is only the interface. Your leads and settings live in the backend you run on your own computer, and it isn&apos;t answering. Start it, then try again.
          </p>
          <ErrorNote message={state.message} />
          <Button variant="primary" onClick={retry}>
            Try again
          </Button>
        </Card>
      </main>
    );
  }
  return <Loading label="Checking sign-in" />;
}
