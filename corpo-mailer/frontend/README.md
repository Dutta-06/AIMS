# Corpo Mailer: frontend

The whole app: a static Next.js site (`output: "export"`) that runs in the browser. Sign-in, storage,
email and replies all go through the signed-in person's Google account; drafting calls OpenRouter.
Setup: [`../docs/GMAIL_SETUP.md`](../docs/GMAIL_SETUP.md) and [`../docs/HOSTING.md`](../docs/HOSTING.md).

```bash
cp .env.example .env.local      # optional: NEXT_PUBLIC_GOOGLE_CLIENT_ID
npm install
npm run dev                     # http://localhost:3000
npm test                        # vitest: the engine (leads, import, drafts, approval gate, replies, Google, saving)
```

## Pages

| Route | What it's for |
| --- | --- |
| `/` | Dashboard: who needs you today (unread replies, overdue follow-ups), counts by status |
| `/leads` | The tracker. **Table** (inline status, channels, remarks) or **Board** by status with drag and drop. Filters, Add lead, Import CSV, Export |
| `/leads/detail?id=` | One lead: edit, write and approve emails and LinkedIn notes, log outreach/replies, thread |
| `/leads/import` | Import a CSV with a preview of exactly what will happen before anything is saved |
| `/companies`, `/companies/detail?id=` | Companies and their people |
| `/drafts` | Every email waiting for review, plus sent history |
| `/settings` | Account and save status, AI keys and models, event wording and the team brief, **Team workspace** (who has access, add a teammate), backup download / restore |

## How it works

```
lib/engine/        the app itself, no UI: core (leads), importer, drafts + approval gate, replies,
                   persistence (debounced Drive saves), app (singleton the UI reads)
lib/engine/google/ Google sign-in (token model), shared Drive file, file picker, Gmail send/read
lib/api.ts         thin facade the pages call
```

* Data is one JSON file, *Corpo Mailer shared data*, in Google Drive, shared by the team (the app has
  only the narrow `drive.file` permission; teammates open it through Google's file picker). A save
  never overwrites: it reads the file, merges this person's changes onto it (`lib/engine/merge.ts`:
  per-record, later edit wins, deletions kept as tombstones, a sent email stays sent), then writes.
  A background check (about every 30 s) brings in teammates' changes. A spare copy is kept in the
  browser until Drive confirms, and nothing is overwritten if the file can't be read.
* Ids come from the clock plus a random part, so two people adding leads at once can't collide.
  Each person's mailbox position is stored under their email in the file.
* **Sending** needs Approve (a hash of recipient, subject and body is recorded) then press-and-hold
  Send (or a confirm dialog for keyboard use). Editing after approval voids it. Before an email goes
  out the sender claims the draft in the shared file and looks once more for a teammate's claim, so
  two people pressing Send together send one email. A send that was interrupted is recovered rather
  than repeated.
* **Replies** are matched by Message-ID / Gmail thread (sender address as fallback); auto-replies and
  your own mail are ignored; bounces mark the lead do-not-contact.
* Browser settings (`corpo.googleClientId`, `corpo.googleApiKey`, `corpo.googleAppId`, `corpo.openrouterKey` (one or several keys, one per line), `corpo.models`, `corpo.workspace.<email>`) live in local storage.

## What the AI is told

Every draft and revision carries a standing **team brief** (Settings: what it is doing and how to
sound), the event facts, and up to three **past messages** as style references. Past messages come
from the archive of everything the team has sent (nothing to maintain): emails that got a reply come
first, then the newest, and a lead's own earlier email is left out (the history already has it). You
can also paste sample messages in Settings. They guide tone and length only; the AI is told never to
reuse names or facts from them.

## Feedback on drafts and LinkedIn notes

Every draft has **Ask for changes**; the AI rewrites it, **Undo** and earlier versions keep your
wording, and a revision clears any approval. A LinkedIn note is 300 characters at most, with Copy and
"I sent it on LinkedIn"; it is never sent from here.

## Build notes

`NEXT_PUBLIC_BASE_PATH` is the `/<repo>` prefix for Pages. `lib/` is un-ignored in `.gitignore`
because the repo's root Python `.gitignore` ignores `lib/`.
