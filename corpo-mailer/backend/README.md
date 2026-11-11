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

## No login

There are no accounts or passwords. Instead:

* The backend listens on **127.0.0.1 only** (`main.py`). Don't expose it to a network or the
  internet: anyone who can reach it can approve and send email from your Gmail account.
* Every state-changing request must come from an allowed origin (`CORS_ORIGINS`) **and** carry an
  `X-Corpo-Mailer: 1` header. A website you happen to visit can make your browser send a bare
  `POST /drafts/1/send` to `localhost`; the missing header (and the foreign origin) get it refused.
* There is no "who is logged in" and leads aren't assigned to people. Approving a draft records
  the connected Gmail account (`SMTP_USER`) as the approver; any name sent in the request is ignored.
  (Gmail OAuth is planned to supply the identity.)

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
mail). Set `SMTP_USER`/`SMTP_PASSWORD` (the Gmail app password also works for IMAP; enable IMAP in
Gmail's settings). It checks every `IMAP_POLL_SECONDS`, and `POST /api/v1/replies/sync` (the
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
