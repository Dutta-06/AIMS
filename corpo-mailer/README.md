# Corpo Mailer

An outreach **tracker** for brAInwave sponsorship: who was contacted, by which channel, and what
happened. It helps write emails and LinkedIn notes with AI, and sends email only after a person has
approved it. It is not a bulk mailer.

**It runs entirely in the browser on GitHub Pages. There is no server.**

| Need | Where it lives |
| --- | --- |
| Sign-in | Google ("Sign in with Google") |
| Leads and drafts | One file in Google Drive, shared by the team (everyone sees the same dashboard) |
| Sending email, checking replies | Your own Gmail, through the Gmail API |
| AI drafting | OpenRouter free models, called from the browser with a key you paste in Settings |

Start here:

1. [`docs/GMAIL_SETUP.md`](docs/GMAIL_SETUP.md): the one-time Google Cloud setup (about 15 minutes), and how the team shares a workspace.
2. [`docs/HOSTING.md`](docs/HOSTING.md): publish the site on GitHub Pages.
3. [`frontend/README.md`](frontend/README.md): what each screen does, and how to develop.

`backend/`, `deploy/`, `docker-compose.yml` and `docs/legacy-server/` are an earlier server version
(FastAPI + PostgreSQL). The GitHub Pages site does not use them. They are kept for reference and for
anyone who later wants an always-on server (for example to check replies while nobody has the page open).
