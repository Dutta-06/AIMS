"use client";

import { AnimatePresence } from "motion/react";
import { useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useToast } from "@/components/ToastProvider";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Pill, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { isAdmin } from "@/lib/engine/admin";
import { app, useApp } from "@/lib/engine/app";
import { DEFAULT_MODELS, parseKeys } from "@/lib/engine/llm";
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
        Signed in as <span className="font-mono text-[0.85rem] text-heading">{s.email}</span>. Emails go out from this Gmail account. Your changes are saved to the team&apos;s shared file in Google Drive, and teammates&apos; changes appear here by themselves.
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
      <p className="text-xs text-faint">Changes save by themselves a moment after you make them. Your AI key and sign-in stay in this browser only; they are never put in the shared file.</p>
    </Card>
  );
}

function WorkspaceCard() {
  const s = useApp();
  const toast = useToast();
  const share = useAction();
  const refresh = useAction();
  const [email, setEmail] = useState("");
  const [leaving, setLeaving] = useState(false);
  const people = useQuery("collaborators", () => app().collaborators());
  const w = s.workspace;
  if (!w) return null;
  return (
    <Card className="space-y-3">
      <h2 className="text-[1.05rem] font-medium text-heading">Team workspace</h2>
      <p className="text-sm text-body">
        Everyone works from the same file in Google Drive:{" "}
        <a className="text-heading underline underline-offset-2" href={`https://drive.google.com/file/d/${encodeURIComponent(w.id)}/view`} target="_blank" rel="noopener noreferrer">
          {w.name}
        </a>
        . Changes from teammates show up here within about half a minute.
      </p>
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-faint">Who has access</p>
        {people.loading ? (
          <p className="text-sm text-faint">Loading…</p>
        ) : people.error || !people.data ? (
          <p className="text-sm text-faint">Couldn&apos;t load the list ({people.error ?? "unknown"}).</p>
        ) : (
          <ul className="space-y-1">
            {people.data.map((p) => (
              <li key={p.email} className="flex items-center gap-2 text-sm text-body">
                <span className="font-mono text-[0.85rem] text-heading">{p.email}</span>
                <Pill tone={p.role === "owner" ? "green" : "amber"}>{p.role === "owner" ? "owner" : "editor"}</Pill>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Field label="Add a teammate (their Google account email)">
        <div className="flex gap-2">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@gmail.com" autoCapitalize="none" />
          <Button
            variant="primary"
            disabled={share.busy || !email.trim()}
            onClick={async () => {
              if (await share.run(() => app().shareWith(email))) {
                toast(`Shared with ${email.trim()}. Google emailed them a link.`);
                setEmail("");
                people.reload();
              }
            }}
          >
            {share.busy ? "Sharing…" : "Share"}
          </Button>
        </div>
      </Field>
      <p className="text-xs text-faint">They also need to be allowed to sign in to the app (Google Cloud → Audience → Test users, unless your project is Internal to your organisation). Then they just open the site and sign in: they land on this same dashboard by themselves, on any device.</p>
      <ErrorNote message={share.error ?? refresh.error} />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={refresh.busy}
          onClick={async () => {
            if (await refresh.run(() => app().refreshShared())) toast("Up to date");
          }}
        >
          {refresh.busy ? "Checking…" : "Check for teammates’ changes"}
        </Button>
        <Button variant="ghost" onClick={() => setLeaving(true)}>
          Use a different workspace
        </Button>
      </div>
      <AnimatePresence>
        {leaving && (
          <ConfirmDialog
            title="Stop using this workspace?"
            confirmLabel="Stop using it"
            confirmVariant="danger"
            onCancel={() => setLeaving(false)}
            onConfirm={async () => {
              setLeaving(false);
              await app().leaveWorkspace();
            }}
          >
            <p>Your changes are saved first. The file stays in Google Drive and nothing is deleted; you&apos;ll be asked to start or choose a workspace again.</p>
          </ConfirmDialog>
        )}
      </AnimatePresence>
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
  const [show, setShow] = useState(false);
  const count = parseKeys(key).length;
  const [teamKeys, setTeamKeys] = useState(() => app().core?.db.settings.team_ai_keys ?? "");
  const teamCount = parseKeys(teamKeys).length;
  const [models, setModels] = useState(() => (app().models().join(", ") === DEFAULT_MODELS.join(", ") ? "" : app().models().join(", ")));
  const test = useAction();
  const [answer, setAnswer] = useState<string | null>(null);
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 text-[1.05rem] font-medium text-heading">
        The AI (OpenRouter)
        {app().openrouterKeyCount() > 0 ? <Pill tone="green">{app().openrouterKeyCount() === 1 ? "Key saved" : `${app().openrouterKeyCount()} keys saved`}</Pill> : <Pill tone="amber">No key yet</Pill>}
      </h2>
      <p className="text-sm text-body">
        Drafts and revisions use OpenRouter&apos;s free models. Paste your key from openrouter.ai/keys. Keys are only ever sent to openrouter.ai. Put the team&apos;s keys (one per line) in <b>Team keys</b> so everyone gets them automatically, or keep one only for this browser in the first box. Requests take turns across all the keys and a rate-limited key hands over to the next. Keys only add up when they belong to different OpenRouter accounts.
      </p>
      <Field label={count > 1 ? `OpenRouter keys (${count}, one per line)` : "OpenRouter key (one per line if you have several)"}>
        <Textarea
          rows={count > 1 || show ? Math.min(Math.max(count, 2), 6) : 2}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-or-…"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="font-mono text-[0.85rem]"
          style={{ WebkitTextSecurity: show ? "none" : "disc" } as React.CSSProperties}
        />
      </Field>
      <Field label={`Team keys (${teamCount} shared, one per line)`}>
        <Textarea
          rows={Math.min(Math.max(teamCount, 2), 6)}
          value={teamKeys}
          onChange={(e) => setTeamKeys(e.target.value)}
          placeholder="sk-or-… (one per teammate)"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="font-mono text-[0.85rem]"
          style={{ WebkitTextSecurity: show ? "none" : "disc" } as React.CSSProperties}
        />
        <span className="mt-1 block text-xs text-faint">Shared with everyone in the workspace through the shared file, so nobody sets keys up again on a new device. Anyone who can open that file can read these keys.</span>
      </Field>
      <button type="button" className="text-xs text-body underline underline-offset-2 hover:text-heading" onClick={() => setShow((v) => !v)}>
        {show ? "Hide the keys" : "Show the keys"}
      </button>
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
          onClick={async () => {
            app().setOpenrouterKey(key);
            app().setModels(models);
            await api.settings.update({ team_ai_keys: teamKeys });
            toast("AI settings saved");
          }}
        >
          Save
        </Button>
        <Button
          disabled={test.busy || (!key.trim() && !teamKeys.trim())}
          onClick={async () => {
            app().setOpenrouterKey(key);
            app().setModels(models);
            await api.settings.update({ team_ai_keys: teamKeys });
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
      <Field label="What the assistant is doing and how to sound (sent with every request)">
        <Textarea rows={5} value={f.team_brief} onChange={set("team_brief")} />
      </Field>
      <Field label="Sample messages you like (optional). Your own sent emails are used automatically; replied-to ones first.">
        <Textarea rows={4} value={f.style_examples} onChange={set("style_examples")} placeholder="Paste an older email or two that worked well. Used for tone and length only." />
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
          if (await action.run(() => api.settings.update({ event_name: f.event_name, event_pitch: f.event_pitch, sender_signature: f.sender_signature, team_brief: f.team_brief, style_examples: f.style_examples, from_name: f.from_name, stale_after_days: Number(f.stale) }))) {
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
  const s = useApp();
  const admin = isAdmin(s.email);
  const { data, error, loading, reload } = useQuery("settings", () => (admin ? api.settings.get() : Promise.resolve(null)));
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={admin ? "Your account, your data, the AI and your event. Everything stays in your own Google account and this browser." : "Your account."}
      />
      <div className="space-y-5">
        <AccountCard />
        {admin ? (
          <>
            <AiCard />
            {loading ? null : error || !data ? <ErrorNote message={error} /> : <EventCard key={JSON.stringify(data)} initial={data} reload={reload} />}
            <WorkspaceCard />
            <BackupCard onRestored={reload} />
          </>
        ) : (
          <p className="text-sm text-faint">The AI, event details, team and backups are managed by the team admins.</p>
        )}
      </div>
    </>
  );
}
