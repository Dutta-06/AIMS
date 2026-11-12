"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button, Card, ErrorNote, Loading } from "@/components/ui";
import { app, useApp } from "@/lib/engine/app";

/**
 * Nothing in the app is shown until this browser is signed in with Google and the person's data has
 * been opened from their own Drive.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const s = useApp();

  useEffect(() => {
    void app().init();
  }, []);

  useEffect(() => {
    if (s.booted && s.phase === "signed_out") router.replace("/login");
  }, [s.booted, s.phase, router]);

  if (s.phase === "ready") return <>{children}</>;
  if (s.phase === "error" && s.booted) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
        <Card className="w-full space-y-3">
          <h1 className="text-lg font-medium text-heading">Couldn&apos;t open your data</h1>
          <p className="text-sm text-body">Your leads are kept in a private file in your own Google Drive. It couldn&apos;t be opened just now, and nothing was changed.</p>
          <ErrorNote message={s.error} />
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void app().retry().catch(() => {})}>
              Try again
            </Button>
            <Button variant="ghost" onClick={() => void app().signOut()}>
              Sign out
            </Button>
          </div>
        </Card>
      </main>
    );
  }
  return <Loading label={s.booted && s.phase === "signed_out" ? "Taking you to sign-in" : "Opening your data"} />;
}
