"use client";

import { useEffect, useState } from "react";
import { Button, Card, ErrorNote } from "@/components/ui";
import { app, useApp } from "@/lib/engine/app";
import { useAction } from "@/lib/hooks";

const LOOK_AGAIN_MS = 10_000;

/**
 * Shown when this Google account hasn't been added to a team workspace yet (or the team has none).
 * Once a teammate adds the account in Settings, the app notices by itself and opens it.
 */
export default function WorkspaceSetup() {
  const s = useApp();
  const create = useAction();
  const look = useAction();
  const [confirmNew, setConfirmNew] = useState(false);

  // A teammate may add this account at any moment: keep looking, so there is nothing to press.
  useEffect(() => {
    const t = setInterval(() => void app().findWorkspace(true), LOOK_AGAIN_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-5 py-10">
      <div className="w-full space-y-4">
        <div>
          <h1 className="text-[1.6rem] font-medium tracking-[-0.02em] text-heading">Waiting to be added to the team</h1>
          <p className="mt-1 text-sm text-body">
            Signed in as <span className="font-mono text-[0.85rem] text-heading">{s.email}</span>. This account hasn&apos;t been added to the team&apos;s dashboard yet.
          </p>
        </div>

        <ErrorNote message={s.error} />

        <Card className="space-y-3">
          <h2 className="text-[1.05rem] font-medium text-heading">Ask a teammate to add you</h2>
          <p className="text-sm text-body">
            Someone already on the team opens <b>Settings → Team workspace</b> and adds <span className="font-mono text-[0.85rem]">{s.email}</span>. This page checks every few seconds and takes you in as soon as that happens. There is nothing else to set up.
          </p>
          <ErrorNote message={look.error} />
          <Button variant="primary" disabled={look.busy} onClick={() => void look.run(() => app().findWorkspace())}>
            {look.busy ? "Checking…" : "Check now"}
          </Button>
        </Card>

        <Card className="space-y-3">
          <h2 className="text-[1.05rem] font-medium text-heading">Is your team starting from scratch?</h2>
          <p className="text-sm text-body">
            Only the <b>first</b> person does this. It creates the team&apos;s shared file in your Google Drive, and then you add everyone else in Settings. If a teammate already has a dashboard, ask them to add you instead, or you&apos;ll end up with two separate ones.
          </p>
          <ErrorNote message={create.error} />
          {confirmNew ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={create.busy} onClick={() => void create.run(() => app().createWorkspace())}>
                {create.busy ? "Creating…" : "Yes, start a new team dashboard"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmNew(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button onClick={() => setConfirmNew(true)}>Start the team workspace</Button>
          )}
        </Card>

        <Button variant="ghost" onClick={() => void app().signOut()}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
