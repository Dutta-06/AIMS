# Hosting the website on GitHub Pages

**What gets hosted:** only the website, the screens you click around in. GitHub Pages serves plain
files, so it can't run the backend (the database, the AI, and the Gmail login). **The backend keeps
running on your own computer**, and the website talks to it.

```
 https://<you>.github.io/<repo>/   (public, static: no data, no secrets)
            │  your browser
            ▼
 http://localhost:8000              (your computer: data, Gmail, AI, and the sign-in check)
```

**Where the backend runs:** on your own computer (this page), on an **always-on server** you SSH into
(see [`DEPLOY.md`](DEPLOY.md); best for continuous reply tracking), or in a **GitHub Codespace** with no
install at all (see [`CODESPACES.md`](CODESPACES.md)). Either way the website is told where the backend
is on its sign-in page (**Backend address**), so you never rebuild it when that changes.

## Is it safe that the website is public?

Yes, because the website holds nothing. Anyone can open the page, but all they see is a **Sign in
with Google** button, and the backend they'd need to reach is on *your* computer (it only listens on
`127.0.0.1`).

Who is allowed in is decided by the **backend**, never by the website (a check in a public page could
be read straight out of its code). People sign in with Google; the backend only accepts the accounts
in `ALLOWED_EMAILS`, gives them a signed session that expires after 12 hours (`SESSION_HOURS`), and
refuses every other request except the sign-in steps. Removing someone from `ALLOWED_EMAILS` (and
restarting) cuts them off at once. There is no password to share. Setup:
[`GMAIL_SETUP.md`](GMAIL_SETUP.md).

## One-time setup

1. **Allow your team and the website.** In `backend/.env` add:

   ```
   ALLOWED_EMAILS=you@gmail.com,teammate@dtu.ac.in
   CORS_ORIGINS=["http://localhost:3000","https://<your-github-username>.github.io"]
   ```

   The origin has no path: `https://dutta-06.github.io`, not `.../AIMS/`. Optionally set
   `SESSION_SECRET` to any long random string so a restart doesn't sign you out. Do the Google setup
   in [`GMAIL_SETUP.md`](GMAIL_SETUP.md) (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) and restart the
   backend.

2. **Turn on Pages.** In the GitHub repository: *Settings → Pages → Build and deployment → Source:
   **GitHub Actions***. (A private repository needs a paid GitHub plan for Pages.)

3. **Let the branch deploy.** Pages deployments are limited to protected branches by default. Either
   merge this branch into `main`, or add `corpo-mailer` under *Settings → Environments →
   github-pages → Deployment branches*.

4. **Run the workflow.** Pushing to `main` or `corpo-mailer` (changes under `corpo-mailer/frontend`)
   deploys automatically; you can also run *Corpo Mailer website (GitHub Pages)* by hand from the
   *Actions* tab. The address is shown in the run, normally `https://<user>.github.io/<repo>/`.

## Gmail

Sign in with Google, then open **Settings → Connect Gmail** to connect the mailbox the team sends
from. No mail password goes in any file. The Google redirect goes to the backend on your computer, so
it works the same from the Pages site.

## Every time you use it

1. Start the backend on your computer (`uv run uvicorn app.main:app --host 127.0.0.1 --port 8000`).
2. Open the Pages address and press **Sign in with Google**.

If the backend isn't running, the page says so and has a **Try again** button.

## Good to know

* **Browsers.** Chrome, Edge and Firefox let an https page talk to `http://localhost`. **Safari
  blocks it**, so use one of the others. Chrome may ask for permission to "connect to devices on your
  local network": choose **Allow**.
* **Where it points.** By default the site talks to `http://localhost:8000/api/v1`. To use another
  backend (a Codespace, say), open **Backend address** on the sign-in page and type its address; the
  browser remembers it. (Only a person typing it can change it, never a link.)
* **Never expose the backend to the internet** as it is: it speaks plain http, and anyone who got the
  an allowed Google account could approve and send email from your Gmail. If you ever host it online, put it behind
  https first.
* **Detail pages** use addresses like `/leads/detail/?id=3` (not `/leads/3`), because Pages can only
  serve files that exist.
* **Local development** is unchanged: `npm run dev` in `frontend/` serves at `http://localhost:3000`.
  To preview the exact Pages build, run `NEXT_PUBLIC_BASE_PATH=/<repo> npm run build` and serve `out/`.
