"use client";

import { useState } from "react";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";
import { app, useApp } from "@/lib/engine/app";
import { useAction } from "@/lib/hooks";

/**
 * Shown once, after signing in, until this person is using the team's shared file: either they start
 * it (the first person) or they pick the one a teammate shared with them.
 */
export default function WorkspaceSetup() {
  const s = useApp();
  const create = useAction();
  const join = useAction();
  const [apiKey, setApiKey] = useState("");
  const [appId, setAppId] = useState("");

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-5 py-10">
      <div className="w-full space-y-4">
        <div>
          <h1 className="text-[1.6rem] font-medium tracking-[-0.02em] text-heading">Set up your team&apos;s workspace</h1>
          <p className="mt-1 text-sm text-body">
            Everyone works from <b>one shared file in Google Drive</b>, so the whole team sees the same leads, drafts and history. Signed in as <span className="font-mono text-[0.85rem] text-heading">{s.email}</span>.
          </p>
        </div>

        <ErrorNote message={s.error} />

        <Card className="space-y-3">
          <h2 className="text-[1.05rem] font-medium text-heading">My team already has one</h2>
          <p className="text-sm text-body">
            Ask a teammate to open <b>Settings → Team workspace</b> and add <span className="font-mono text-[0.85rem]">{s.email}</span>. Google emails you a link. Then choose the file here.
          </p>
          {!s.picker_ready && (
            <div className="space-y-2 rounded-xl border border-hairline p-3">
              <p className="text-xs text-faint">The file picker needs two values from the Google Cloud setup (docs/GMAIL_SETUP.md, step 4). They aren&apos;t secret. Your team lead can set them once for everyone, or paste them here.</p>
              <Field label="Google API key">
                <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AIza…" autoCapitalize="none" spellCheck={false} className="font-mono text-[0.8rem]" />
              </Field>
              <Field label="Project number">
                <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="123456789012" inputMode="numeric" className="font-mono text-[0.8rem]" />
              </Field>
            </div>
          )}
          <ErrorNote message={join.error} />
          <Button
            variant="primary"
            disabled={join.busy || (!s.picker_ready && (!apiKey.trim() || !appId.trim()))}
            onClick={() =>
              void join.run(async () => {
                if (!s.picker_ready) app().setPickerConfig(apiKey, appId);
                await app().joinWorkspace();
              })
            }
          >
            {join.busy ? "Opening…" : "Choose the shared file"}
          </Button>
        </Card>

        <Card className="space-y-3">
          <h2 className="text-[1.05rem] font-medium text-heading">I&apos;m the first one</h2>
          <p className="text-sm text-body">
            Creates a file called <i>Corpo Mailer shared data</i> in your Google Drive. Then you add your teammates in <b>Settings</b>. Only start one if nobody on the team has yet, or you&apos;ll end up with two separate workspaces.
          </p>
          <ErrorNote message={create.error} />
          <Button disabled={create.busy} onClick={() => void create.run(() => app().createWorkspace())}>
            {create.busy ? "Creating…" : "Start the team workspace"}
          </Button>
        </Card>

        <Button variant="ghost" onClick={() => void app().signOut()}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
