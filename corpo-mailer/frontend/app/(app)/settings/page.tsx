"use client";

import { AnimatePresence } from "motion/react";
import { useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useToast } from "@/components/ToastProvider";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Pill, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { app, useApp } from "@/lib/engine/app";
import { DEFAULT_MODELS } from "@/lib/engine/llm";
import type { EventSettings } from "@/lib/engine/model";
import { useAction, useQuery } from "@/lib/hooks";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function AccountCard() {
  const s = useApp();
  const toast = useToast();
  const save = useAction();
  const saving = s.save.state === "saving";
  const status = s.save.state === "error" ? "Not saved yet" : s.save.dirty || saving ? "Saving…" : s.save.last_saved_at ? "Saved to Google Drive" : "Up to date";
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 text-[1.05rem] font-medium text-heading">
        Your account
        <Pill tone={s.save.state === "error" ? "amber" : "green"}>{status}</Pill>
      </h2>
      <p className="text-sm text-body">
        Signed in as <span className="font-mono text-[0.85rem] text-heading">{s.email}</span>. Emails go out from this Gmail account, and your leads are saved in a private file in this account&apos;s Google Drive that only this app can see.
        {s.save.last_saved_at && <> Last saved {fmtDateTime(s.save.last_saved_at)}.</>}
      </p>
      <ErrorNote message={save.error ?? (s.save.state === "error" ? s.save.error : null)} />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={save.busy}
          onClick={async () => {
            if (await save.run(() => app().saveNow())) toast("Saved to Google Drive");
          }}
        >
          {save.busy ? "Saving…" : "Save now"}
        </Button>
        <Button variant="ghost" onClick={() => void app().signOut()}>
          Sign out
        </Button>
      </div>
      <p className="text-xs text-faint">Changes save by themselves a moment after you make them. To remove everything, revoke the app at myaccount.google.com/permissions; its private Drive file goes with it.</p>
    </Card>
  );
}

function BackupCard({ onRestored }: { onRestored: () => void }) {
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const restore = useAction();
  const [pending, setPending] = useState<string | null>(null);
  return (
    <Card className="space-y-3">
      <h2 className="text-[1.05rem] font-medium text-heading">Backups</h2>
      <p className="text-sm text-body">A backup is one file with all your leads, drafts and history. Keep one somewhere safe now and then; you can also export your leads as a CSV from the Leads page.</p>
      <ErrorNote message={restore.error} />
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            download(await api.backup.export(), `corpo-mailer-backup-${new Date().toISOString().slice(0, 10)}.json`);
          }}
        >
          Download a backup
        </Button>
        <Button variant="ghost" onClick={() => file.current?.click()}>
          Restore from a backup…
        </Button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) setPending(await f.text());
          }}
        />
      </div>
      <AnimatePresence>
        {pending !== null && (
          <ConfirmDialog
            title="Replace everything with this backup?"
            confirmLabel="Replace"
            confirmVariant="danger"
            busy={restore.busy}
            onCancel={() => setPending(null)}
            onConfirm={async () => {
              let counts: { companies: number; leads: number } | null = null;
              const ok = await restore.run(async () => {
                counts = await api.backup.restore(pending);
              });
              setPending(null);
              if (ok && counts) {
                const c = counts as { companies: number; leads: number };
                toast(`Restored ${c.leads} leads at ${c.companies} companies`);
                onRestored();
              }
            }}
          >
            <p>Everything you have now (leads, drafts and history) is replaced by what is in the file. Download a backup of the current data first if you might want it.</p>
          </ConfirmDialog>
        )}
      </AnimatePresence>
    </Card>
  );
}

function AiCard() {
  const s = useApp();
  void s; // re-render when settings change
  const toast = useToast();
  const [key, setKey] = useState(() => app().openrouterKey());
  const [models, setModels] = useState(() => (app().models().join(", ") === DEFAULT_MODELS.join(", ") ? "" : app().models().join(", ")));
  const test = useAction();
  const [answer, setAnswer] = useState<string | null>(null);
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 text-[1.05rem] font-medium text-heading">
        The AI (OpenRouter)
        {app().openrouterKey() ? <Pill tone="green">Key saved</Pill> : <Pill tone="amber">No key yet</Pill>}
      </h2>
      <p className="text-sm text-body">Drafts and revisions use OpenRouter&apos;s free models. Paste your key from openrouter.ai/keys. It is kept in this browser only and is sent to openrouter.ai and nowhere else (it is not saved to your Drive).</p>
      <Field label="OpenRouter key">
        <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-…" autoComplete="off" spellCheck={false} className="font-mono text-[0.85rem]" />
      </Field>
      <details className="text-sm">
        <summary className="cursor-pointer text-body hover:text-heading">Choose the models (advanced)</summary>
        <div className="pt-2">
          <Field label="Models, comma-separated (empty = the four free defaults, rotated)">
            <Input value={models} onChange={(e) => setModels(e.target.value)} placeholder={DEFAULT_MODELS.join(", ")} spellCheck={false} className="font-mono text-[0.78rem]" />
          </Field>
        </div>
      </details>
      <ErrorNote message={test.error} />
      {answer && <p className="text-sm text-ok">The AI answered: “{answer}”. It works.</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => {
            app().setOpenrouterKey(key);
            app().setModels(models);
            toast("AI settings saved");
          }}
        >
          Save
        </Button>
        <Button
          disabled={test.busy || !key.trim()}
          onClick={async () => {
            app().setOpenrouterKey(key);
            app().setModels(models);
            setAnswer(null);
            let r = "";
            if (await test.run(async () => (r = await api.ai.test()))) setAnswer(r);
          }}
        >
          {test.busy ? "Testing…" : "Save and test"}
        </Button>
      </div>
    </Card>
  );
}

function EventCard({ initial, reload }: { initial: EventSettings; reload: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ ...initial, stale: String(initial.stale_after_days) });
  const action = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card className="space-y-3">
      <h2 className="text-[1.05rem] font-medium text-heading">Your event</h2>
      <p className="text-sm text-body">These are the only facts the AI may use about your event. It is told never to invent anything beyond them, so make them accurate.</p>
      <Field label="Event name">
        <Input value={f.event_name} onChange={set("event_name")} />
      </Field>
      <Field label="About the event (dates, venue, audience, what sponsors get)">
        <Textarea rows={5} value={f.event_pitch} onChange={set("event_pitch")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sender name on emails">
          <Input value={f.from_name} onChange={set("from_name")} />
        </Field>
        <Field label="Follow up after (quiet days)">
          <Input type="number" min={1} max={365} value={f.stale} onChange={set("stale")} />
        </Field>
      </div>
      <Field label="Signature added to emails (optional)">
        <Textarea rows={3} value={f.sender_signature} onChange={set("sender_signature")} />
      </Field>
      <ErrorNote message={action.error} />
      <Button
        variant="primary"
        disabled={action.busy}
        onClick={async () => {
          if (await action.run(() => api.settings.update({ event_name: f.event_name, event_pitch: f.event_pitch, sender_signature: f.sender_signature, from_name: f.from_name, stale_after_days: Number(f.stale) }))) {
            toast("Saved");
            reload();
          }
        }}
      >
        {action.busy ? "Saving…" : "Save event details"}
      </Button>
    </Card>
  );
}

export default function SettingsPage() {
  const { data, error, loading, reload } = useQuery("settings", () => api.settings.get());
  return (
    <>
      <PageHeader title="Settings" subtitle="Your account, your data, the AI and your event. Everything stays in your own Google account and this browser." />
      <div className="space-y-5">
        <AccountCard />
        <AiCard />
        {loading ? null : error || !data ? <ErrorNote message={error} /> : <EventCard key={JSON.stringify(data)} initial={data} reload={reload} />}
        <BackupCard onRestored={reload} />
      </div>
    </>
  );
}
