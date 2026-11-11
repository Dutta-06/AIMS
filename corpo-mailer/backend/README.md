# Corpo Mailer: backend

Sponsorship outreach CRM for brAInwave. It tracks companies, contacts and deals through a
pipeline, drafts outreach emails, and sends them, **only after a human approves each one**.

## Run

```bash
cp .env.example .env        # set SECRET_KEY, APP_PASSWORD, SMTP_*
uv sync
uv run alembic upgrade head
uv run python main.py       # http://localhost:8000/docs
```

```bash
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

## Auth

One shared password (`APP_PASSWORD`). `POST /api/v1/auth/login` with `{password, name}` returns a
bearer token; `name` is recorded as the approver on every email sent. There are no roles.

## The send rule

Email can only leave through `app/services/drafts.py::send_draft`.

* A draft must be explicitly approved by a logged-in person (`POST /drafts/{id}/approve`).
* Approval is tied to a hash of recipient + subject + body. Editing the draft or the contact's
  email voids the approval.
* Do-not-contact recipients can't be approved or sent to.
* Nothing automated (AI generation, schedulers, reply tracker) has a path to the mailer.
  They can only create drafts, reminders and interactions.

## AI drafting

`POST /api/v1/drafts/generate` `{deal_id, contact_id, kind: intro|followup|thank_you, instructions?}`
asks an LLM (OpenRouter, OpenAI-compatible) for a draft and stores it as an **unapproved** draft.
Set `OPENROUTER_API_KEY`, `LLM_MODELS` (requests rotate round-robin across them, and a failing or
rate-limited model falls through to the next) and `EVENT_PITCH` in `.env`. The prompt tells the model to use only the facts you
give it and to leave `[PLACEHOLDER]`s rather than invent details. Free model names change often,
so run `uv run python scripts/list_free_models.py` to get the exact current IDs.

## Layout

```
app/
  core/        settings, auth
  db/          engine/session, base + UTC datetime type
  models/      SQLAlchemy tables (company, contact, deal, interaction, draft)
  schemas/     request/response models
  services/    business rules (approval gate)
  providers/   outside world (SMTP mailer, OpenRouter LLM; IMAP to come)
  api/routes/  thin HTTP layer
migrations/    Alembic
```

## Not built yet

Reply tracking (IMAP), prospect discovery, templates, CSV import, frontend.
