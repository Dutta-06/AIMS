> **Legacy.** This is the earlier server version. The current app runs entirely in the browser
> (see `../README.md`) and does not use this backend.

# Corpo Mailer: backend

Outreach tracker for brAInwave sponsorship. It tracks who the team has contacted, on which channel
and with what result; drafts outreach emails; and sends them, **only after a human approves each one**.

## Run

```bash
cp .env.example .env        # set SMTP_* (and the rest as needed)
uv sync
uv run alembic upgrade head
uv run python main.py       # http://localhost:8000/docs
```

```bash
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

## Database

SQLite by default, so it runs with zero setup. Use PostgreSQL for anything real:

```bash
docker compose up -d db                 # from the repo's corpo-mailer/ folder
# backend/.env
DATABASE_URL=postgresql://corpo:corpo@localhost:5432/corpo_mailer
uv run alembic upgrade head
```

* Any `postgres://` / `postgresql://` URL works (the app switches it to the psycopg 3 driver).
* Schema changes go through Alembic: edit `app/models/`, then
  `uv run alembic revision --autogenerate -m "what changed"`. A test fails if the models and
  migrations drift apart.
* The connection pool pings before use and disables server-side prepared statements, which is
  what hosted poolers such as Supabase's (pgbouncer, transaction mode) require. Hosted Postgres
  usually wants `?sslmode=require` on the URL. I haven't run this against Supabase itself.

Run the test suite against Postgres too (it **drops all tables** in that database, so use a
throwaway one):

```bash
TEST_DATABASE_URL=postgresql://corpo:corpo@localhost:5432/corpo_mailer_test uv run pytest
```

## Who can use it: Google sign-in

There are no passwords and no individual accounts to manage: people sign in with Google, and the
backend checks the account against a list.

* **`ALLOWED_EMAILS`** lists the Google accounts that may use the site (comma-separated, case
  insensitive). When it is set, every API request except the sign-in steps needs a session; when it is
  empty there is no sign-in at all, which is only safe while the backend can be reached from your own
  computer. The list is checked on every request, so removing someone cuts them off at once.
* **Sign-in flow**: `POST /auth/google/start` returns Google's page (it asks for just the email
  address), Google sends the browser to `GET /auth/google/callback`, and the website trades the
  one-time login code in the redirect for a session with `POST /auth/exchange`. The session is a signed
  token naming the account, expiring after `SESSION_HOURS` (12), sent as `Authorization: Bearer ...`. It
  never appears in a web address. `GET /auth/status` says whether sign-in is on, whether Google is
  set up, and who is signed in.
* The callback can't carry a session (it is a redirect from Google), so its **single-use, 10-minute
  `state`** (with PKCE) protects it. The browser is only ever sent back to a website in `CORS_ORIGINS`.
  The sign-in callback and the "Connect Gmail" callback are the same address; the `state` says which.
* Approving a draft records the **signed-in account** as the approver; a name sent in the request is
  ignored. Leads aren't assigned to people.
* The API docs pages (`/docs`, `/redoc`, `/openapi.json`) are switched off when sign-in is on.
* The backend listens on **127.0.0.1 only** (`main.py`). With sign-in on you can run it somewhere
  reachable (a Codespace); with it off, don't expose it: anyone who can reach it could approve and send
  email from your Gmail account.
* Every state-changing request must come from an allowed origin (`CORS_ORIGINS`) **and** carry an
  `X-Corpo-Mailer: 1` header. A website you happen to visit can make your browser send a bare
  `POST /drafts/1/send` to `localhost`; the missing header (and the foreign origin) get it refused.
* Old `APP_PASSWORD` / `SMTP_PASSWORD` / `IMAP_PASSWORD` lines are no longer used; the backend says so
  at startup if it finds them.

## The tracker

A **contact** is the row the team tracks: a person (or a generic inbox) at a company.

| Field | Meaning |
| --- | --- |
| `status` | `not_contacted`, `contacted`, `responded`, `no_response` |
| `channels` | once reached: any of `email`, `linkedin`, `discord`, `personal` (cleared if set back to not contacted) |
| `remarks` | free notes (never quoted in AI drafts) |
| `email` / `linkedin` | at least one of name, email or LinkedIn is required; email is optional |

Reaching out or hearing back updates status and channels through one set of rules
(`app/services/contacts.py`): sending an approved email, or logging an outreach, marks the contact
`contacted` on that channel; logging a reply marks `responded`; nothing ever moves a lead
backwards. A reply *detected* by the mailbox watcher only flags the contact "unread" for a person
to confirm. There is no money anywhere in the data model.

## CSV import and export

`POST /import/preview` then `POST /import/commit` with `{"csv": "<file text>"}` (options:
`overwrite`, `infer_status`); `GET /export.csv` downloads the same layout as the team's sheet
(a `NAME` column in the sheet is skipped; `POINT OF CONTACT` the person, `CONTACT` a LinkedIn link or email).

* **Preview shows exactly what will happen**; commit runs the same plan.
* **Safe to repeat.** People are matched by LinkedIn link, then email, then name within the
  company, and updated instead of duplicated. By default an import only fills blanks and moves a
  status forward; it never overwrites what someone typed in the app. `overwrite` makes the sheet win.
* **Guesses are flagged on the row:** a status inferred from remarks ("mail sent" with a blank
  status), an email lifted out of remarks, an unknown status word, an unreadable contact cell.
  Weak hints ("also Discord", "Mail: someone@x.com") are never treated as outreach.
* Exporting and re-importing is a no-op.

## The send rule

Email can only leave through `app/services/drafts.py::send_draft`.

* A draft must be explicitly approved by a logged-in person (`POST /drafts/{id}/approve`).
* Approval is tied to a hash of recipient + subject + body. Editing the draft or the contact's
  email voids the approval.
* Do-not-contact recipients can't be approved or sent to.
* Nothing automated (AI generation, schedulers, reply tracker) has a path to the mailer.
  They can only create drafts, reminders and interactions.

## AI drafting

`POST /api/v1/drafts/generate` `{contact_id, kind: intro|followup|thank_you, instructions?}`
asks an LLM (OpenRouter, OpenAI-compatible) for a draft and stores it as an **unapproved** draft.
Set `OPENROUTER_API_KEY`, `LLM_MODELS` (requests rotate round-robin across them, and a failing or
rate-limited model falls through to the next) and `EVENT_PITCH` in `.env`. The prompt tells the model to use only the facts you
give it and to leave `[PLACEHOLDER]`s rather than invent details. Free model names change often,
so run `uv run python scripts/list_free_models.py` to get the exact current IDs.

## Reply tracking

The backend watches the sending mailbox over IMAP (read-only: it never marks, moves or deletes
mail) as the Gmail account connected in **Settings → Connect Gmail** (enable IMAP in Gmail's settings).
It checks every `IMAP_POLL_SECONDS`, and `POST /api/v1/replies/sync` (the
dashboard's "Check for replies" button) checks immediately.

For each new message:

| It is | What happens |
| --- | --- |
| A reply to an email we sent | Logged on that contact's timeline as an `email_reply` (auto-detected) and the contact is flagged **unread**. The status is **not** changed; a person confirms "Responded". |
| A bounce | Noted on the contact's timeline. A permanent failure (5.x.x) marks the contact do-not-contact so we stop mailing a dead address. |
| An out-of-office / auto-reply, or mail from our own address | Ignored |
| Mail from anyone we haven't emailed | Left alone |

**Matching.** A reply is tied to its contact by the `In-Reply-To`/`References` headers against the
Message-ID we stored when sending. If that fails (some providers rewrite the Message-ID on SMTP),
it falls back to "the sender is a contact we've emailed", and says so in the log entry. Bounces
are matched by the failed recipient address, not by Message-ID.

**Safe to repeat.** Each message is stored once (unique Message-ID) and a per-folder cursor
(`UIDVALIDITY` + last UID) is kept, so re-polling, a reset cursor, or several workers can't
create duplicates. Tests cover this with a fake mailbox and with a local server speaking the
IMAP protocol; they have **not** been run against Gmail itself.

## Layout

```
app/
  core/        settings, request guard (no login)
  db/          engine/session, base + UTC datetime type
  models/      SQLAlchemy tables (company, contact, interaction, draft)
  schemas/     request/response models
  services/    business rules (approval gate, outreach rules, CSV import, reply sync)
  providers/   outside world (SMTP mailer, OpenRouter LLM, IMAP reader)
  api/routes/  thin HTTP layer
migrations/    Alembic
```

## Not built yet

Prospect discovery, templates, CSV import.

## Prospect discovery

`POST /discovery/suggest` asks the models for companies similar to the ones already tracked.
They arrive **unverified**. `POST /discovery/{id}/verify` then opens the company's own website and
records what is really there; nothing the model says is believed until that happens.

* **A prospect is `verified`** only if the site is live, the page is actually about that company,
  and it mentions sponsorship, students, universities, campuses or hackathons, with the year not
  stale. It is **`needs_check`** when the site is live but a person must judge (no signal found, old
  dates, forwards to another domain, blocks bots or robots.txt) and **`failed`** when it can't be
  confirmed (dead, not found, a different company). "Verified" never means "they will say yes".
* **Evidence**: every page read is stored with its URL, a snippet, the date it was fetched and the
  page's own last-modified date. Verdicts **expire** after `PROSPECT_RECHECK_DAYS` (30); a stale
  one can't be accepted until re-checked.
* **No model reads web pages.** Verification is plain code, so instructions hidden in a page do
  nothing. Pages are fetched by `providers/web.py` (public http/https only, DNS-checked on every
  redirect, size/time capped, robots.txt obeyed). Only the company's own pages are followed.
* **Emails are never invented.** Only generic inboxes (info@, partnerships@, ...) written on the
  company's own site are kept, each with the page it came from. People are found by opening a
  LinkedIn people-search link in your own browser; LinkedIn is never scraped.
* **Accept** (verified or needs_check, not stale) creates the company and leads from those public
  inboxes (or a "General contact" lead). The model's reasoning is never copied into notes.
  **Reject** is remembered so it isn't suggested again; **Snooze** hides it for N days.

**From a sponsor page** (`POST /discovery/from-page {"url": ...}`): give it a page that lists
sponsors (say, another hackathon's). It takes the links to *other* websites, naming each from the
link text or logo alt text (falling back to the domain), and skips the page's own site, social
networks, code hosts and event platforms, plus anything already tracked or suggested. This is plain
code, not a model. The names are guesses, so each candidate still goes through the live-web
verification above. At most 60 are taken per page.

**Enriching a tracked company** (`POST /discovery/enrich/{company_id}`): reads the company's own
website (or, if it has none, asks the model for the official domain) and reports what is missing:
the website, public generic inboxes and the pages seen, with dates. It saves nothing. A website
the model guessed is only proposed if the page it points to really is that company. Saving is a
separate call (`.../apply` with `set_website` and chosen `emails`) that checks the site *again* and
only saves what it still shows, so nothing sent by a browser is trusted; inboxes already tracked
are skipped, and an existing website is never overwritten.

**Search the web** (`POST /discovery/search {"query": ...}`): needs `SEARCH_API_KEY` (a Brave Search
API key; the free tier is enough). It returns *pages* (results from the past year, at most two per
site, no social networks) for a person to pick, and saves and fetches nothing. The picked pages go
through the sponsor-page extractor above, then verification. Search results are never trusted as
facts and only the query you type leaves your machine. Without a key the endpoint answers with how
to set one up and the rest of discovery works as normal.

Nothing in discovery can send a message.

## Giving feedback on drafts, and LinkedIn notes

A draft has a **channel**: `email` (sent from here after approval) or `linkedin` (a connection note).

* **Feedback** (`POST /drafts/{id}/revise {"feedback": "shorter, mention demo day"}`): the model
  rewrites the draft from the current text plus the feedback, under the same facts-only rules.
  The previous version is kept in `history` (the last 20), and `POST /drafts/{id}/undo` goes back
  one step. A revision **voids any approval**: the new words must be read and approved again.
  Sent drafts can't be revised, and a revision can only change text; like generating, it has no
  access to the mailer.
* **LinkedIn notes** (`POST /drafts/generate` with `"channel": "linkedin"`): short, no subject or
  signature, held to LinkedIn's 300-character cap (the model is asked again if it overruns, and the
  note is refused rather than cut mid-sentence). They need no email address. Corpo Mailer **never
  sends** them: you copy the note into LinkedIn yourself and press "I sent it"
  (`POST /drafts/{id}/mark-sent`), which logs the outreach and marks the lead Contacted by LinkedIn.
* **The gate is unchanged**: a note can't be approved or emailed, and an email can't be marked
  sent by hand, so the only way an email goes out is still approve, then Send.

## Connecting Gmail (OAuth)

The easy way to give the app a mailbox. After the one-time Google setup in
[`../docs/GMAIL_SETUP.md`](../docs/GMAIL_SETUP.md) (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), a
signed-in person presses **Connect Gmail** in Settings.

* `GET /gmail/status`, `POST /gmail/connect` (returns Google's consent URL), `GET /auth/google/callback`
  (where Google sends the browser back, shared with sign-in), `POST /gmail/disconnect` (also revokes at Google).
* The backend does the token exchange (the client secret never leaves it) with PKCE and a
  **single-use, 10-minute `state`**. The callback can't carry a sign-in token (Google redirects the
  browser to it), so that `state` is what protects it; connecting itself needs the sign-in. The
  browser is only ever sent back to a website listed in `CORS_ORIGINS`.
* The refresh token is stored in the `gmail_connection` table and never returned by any endpoint.
* Sending (SMTP) and reading replies (IMAP) are the same code as before, logging in with an OAuth
  access token (XOAUTH2) instead of a password. Scope: `https://mail.google.com/`, which is what
  Gmail requires for that. If a refresh fails permanently the connection is marked *needs
  reconnecting* (the Settings page says so) and sending and reply tracking stop until it is reconnected.
  There is no mail-password fallback.
* Approvals are recorded against the connected account.

## Running in a GitHub Codespace

`.devcontainer/corpo-mailer/devcontainer.json` and `scripts/codespace-start.sh` set up and start the
backend in a Codespace, take secrets (`ALLOWED_EMAILS`, `OPENROUTER_API_KEY`, ...) from Codespaces
secrets, work out the Codespace's address for the Google redirect and CORS, and refuse to start
without `ALLOWED_EMAILS`. With sign-in on, the API docs pages (`/docs`, `/redoc`, `/openapi.json`) are
disabled. See [`../docs/legacy-server/CODESPACES.md`](../docs/CODESPACES.md).

## Running on an always-on server

`backend/Dockerfile` and `entrypoint.sh`, with `../deploy/docker-compose.yml` (backend + PostgreSQL +
Caddy for automatic https), run it on a VPS you SSH into. The entrypoint refuses to start without
`ALLOWED_EMAILS` and the Google client settings, applies database migrations, then starts the server
behind Caddy. See [`../docs/legacy-server/DEPLOY.md`](../docs/DEPLOY.md).
