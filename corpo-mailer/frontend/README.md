# Corpo Mailer: frontend

Next.js (App Router) dashboard for the Corpo Mailer backend.

```bash
cp .env.example .env.local      # NEXT_PUBLIC_API_URL -> the backend, including /api/v1
npm install
npm run dev                     # http://localhost:3000
```

## Pages

| Route | What it's for |
| --- | --- |
| `/` | Dashboard: follow-ups due, deals gone quiet, emails awaiting review, committed ₹ |
| `/pipeline` | Board of deals by stage; change a stage from the card |
| `/companies`, `/companies/[id]` | Add and edit companies, contacts (incl. do-not-contact), deals |
| `/deals/[id]` | Deal details, AI draft generation, email review, interaction timeline |
| `/drafts` | Queue of every email waiting for review, plus sent history |
| `/login` | Shared team password; your name is recorded as the approver |

## Sending

Approve and Send are separate clicks, and Send asks you to confirm the exact recipient. The
backend enforces the same rule, so these buttons are the interface, not the safeguard.

## Layout

```
app/(app)/   authenticated pages (wrapped by components/Shell.tsx)
app/login/   sign in
components/  Shell (nav + auth guard), DraftCard, ui primitives
lib/         api client, auth token store, hooks, formatting
```

`lib/` is un-ignored in `.gitignore` because the repo's root Python `.gitignore` ignores `lib/`.
