# Corpo Mailer: frontend

Next.js (App Router) interface for the Corpo Mailer backend: an outreach tracker for brAInwave
sponsorship. There is no login; see the backend README for how the app is protected instead.

```bash
cp .env.example .env.local      # NEXT_PUBLIC_API_URL -> the backend, including /api/v1
npm install
npm run dev                     # http://localhost:3000
```

## Pages

| Route | What it's for |
| --- | --- |
| `/` | Dashboard: who needs you today (unread replies, overdue follow-ups), counts by status |
| `/leads` | The tracker. **Table** (inline status, channels and remarks, like the spreadsheet) or **Board** by status with drag and drop. Filters for status and search; Add lead; Import CSV; Export |
| `/leads/[id]` | One lead: edit everything, write and approve emails, log outreach/replies on any channel, thread |
| `/leads/import` | Import a CSV with a preview of exactly what will happen before anything is saved |
| `/companies`, `/companies/[id]` | Companies and their people. A company page has "Check their website": finds a missing website and public inboxes (with sources), and saves only what you tick |
| `/discovery` | Find prospects: the AI suggests lookalike companies, you paste another hackathon's sponsors page, or you search the web for sponsor pages and tick the right ones, and each is checked against its real website. Tabs: To review (grouped Verified / Needs your check / Couldn't verify), Snoozed, Rejected, Accepted. Shows the evidence seen, with dates; Accept, Re-check, Snooze, Reject |
| `/drafts` | Every email waiting for review, plus sent history |

## Statuses and channels

Four statuses (colours follow the team's sheet): **Not contacted**, **Contacted** (yellow),
**Responded** (green), **No response** (red). Once someone is contacted you pick **how**: Email,
LinkedIn, Discord and/or Personal (multi-select).

## Who's using it?

There is one shared team password (checked by the backend) and no individual accounts or names: leads aren't assigned to people. Approvals are recorded against
the connected Gmail account (one shared app-password login; there is no per-person sign-in).

## Sending

Approve and Send are separate steps; Send is a press-and-hold (or an explicit confirm dialog
naming the recipient for keyboard, screen-reader and reduced-motion users). The backend enforces
the same rules, so these controls are the interface, not the safeguard.

## Layout

```
app/(app)/   all pages (wrapped by components/Shell.tsx)
components/  Shell, DraftCard, HoldToSend, leads/ (Board, AddLead, StatusPicker), ui primitives
lib/         api client (adds the X-Corpo-Mailer header), types, hooks, formatting
```

`lib/` is un-ignored in `.gitignore` because the repo's root Python `.gitignore` ignores `lib/`.

## Feedback on drafts and LinkedIn notes

Every draft card has **Ask for changes**: describe what to change in plain words (or tap a quick
option like "Make it shorter") and the AI rewrites it. **Undo last change** and **Show earlier
versions** keep your wording safe. A revision clears any approval, so you read it and approve again.
On a lead, "Write a message" has an **Email** or **LinkedIn note** switch. A LinkedIn note is short
(300 characters, with a counter), has **Copy note** and **I sent it on LinkedIn** buttons, and is
never sent from here.

## Static export and GitHub Pages

The site is built as plain static files (`output: "export"`) so it can be hosted on GitHub Pages; see
[`../docs/HOSTING.md`](../docs/HOSTING.md). Because of that, detail pages take their id from the
query string (`/leads/detail?id=3`, `/companies/detail?id=3`), and the CSV export is fetched with the
sign-in token instead of being a plain link. `NEXT_PUBLIC_BASE_PATH` (the `/<repo>` prefix) and
`NEXT_PUBLIC_API_URL` are build-time settings.
