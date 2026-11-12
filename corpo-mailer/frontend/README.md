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
| `/companies`, `/companies/[id]` | Companies and their people |
| `/discovery` | Find prospects: the AI suggests lookalike companies, or you paste another hackathon's sponsors page, and each is checked against its real website. Tabs: To review (grouped Verified / Needs your check / Couldn't verify), Snoozed, Rejected, Accepted. Shows the evidence seen, with dates; Accept, Re-check, Snooze, Reject |
| `/drafts` | Every email waiting for review, plus sent history |

## Statuses and channels

Four statuses (colours follow the team's sheet): **Not contacted**, **Contacted** (yellow),
**Responded** (green), **No response** (red). Once someone is contacted you pick **how**: Email,
LinkedIn, Discord and/or Personal (multi-select).

## Who's using it?

There are no accounts and no names: leads aren't assigned to people. Approvals are recorded against
the connected Gmail account (Gmail OAuth sign-in is planned and will supply that identity).

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
