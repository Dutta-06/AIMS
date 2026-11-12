# Hosting the website on GitHub Pages

**What gets hosted:** only the website, the screens you click around in. GitHub Pages serves plain
files, so it can't run the backend (the database, the AI, and the Gmail login). **The backend keeps
running on your own computer**, and the website talks to it.

```
 https://<you>.github.io/<repo>/   (public, static: no data, no secrets)
            │  your browser
            ▼
 http://localhost:8000              (your computer: data, Gmail, AI, and the password check)
```

## Is it safe that the website is public?

Yes, because the website holds nothing. Anyone can open the page, but all they see is a sign-in box,
and the backend they'd need to reach is on *your* computer (it only listens on `127.0.0.1`).

The password is checked by the **backend**, never by the website: a password check in a public page
could be read straight out of its code. Without a valid sign-in the backend refuses every request
except signing in. After 5 wrong passwords in 10 minutes it makes you wait a minute between tries.
Sign-ins expire after 12 hours (`SESSION_HOURS`), and changing `APP_PASSWORD` signs everyone out.

There is still one shared password, not per-person accounts.

## One-time setup

1. **Backend password.** In `backend/.env` add:

   ```
   APP_PASSWORD=choose-a-long-passphrase
   CORS_ORIGINS=["http://localhost:3000","https://<your-github-username>.github.io"]
   ```

   The origin has no path: `https://dutta-06.github.io`, not `.../AIMS/`. Optionally set
   `SESSION_SECRET` to any long random string so a restart doesn't sign you out. Restart the backend.

2. **Turn on Pages.** In the GitHub repository: *Settings → Pages → Build and deployment → Source:
   **GitHub Actions***. (A private repository needs a paid GitHub plan for Pages.)

3. **Let the branch deploy.** Pages deployments are limited to protected branches by default. Either
   merge this branch into `main`, or add `corpo-mailer` under *Settings → Environments →
   github-pages → Deployment branches*.

4. **Run the workflow.** Pushing to `main` or `corpo-mailer` (changes under `corpo-mailer/frontend`)
   deploys automatically; you can also run *Corpo Mailer website (GitHub Pages)* by hand from the
   *Actions* tab. The address is shown in the run, normally `https://<user>.github.io/<repo>/`.

## Gmail

In the app, open **Settings → Connect Gmail** (one-time Google setup:
[`GMAIL_SETUP.md`](GMAIL_SETUP.md)). No mail password goes in any file. The Google redirect goes to the
backend on your computer, so it works the same from the Pages site.

## Every time you use it

1. Start the backend on your computer (`uv run uvicorn app.main:app --host 127.0.0.1 --port 8000`).
2. Open the Pages address and sign in with the team password.

If the backend isn't running, the page says so and has a **Try again** button.

## Good to know

* **Browsers.** Chrome, Edge and Firefox let an https page talk to `http://localhost`. **Safari
  blocks it**, so use one of the others. Chrome may ask for permission to "connect to devices on your
  local network": choose **Allow**.
* **Where it points.** The build uses `http://localhost:8000/api/v1`. To point it elsewhere, set a
  repository variable `CORPO_API_URL` (*Settings → Secrets and variables → Actions → Variables*) and
  re-run the workflow.
* **Never expose the backend to the internet** as it is: it speaks plain http, and anyone who got the
  password could approve and send email from your Gmail. If you ever host it online, put it behind
  https first.
* **Detail pages** use addresses like `/leads/detail/?id=3` (not `/leads/3`), because Pages can only
  serve files that exist.
* **Local development** is unchanged: `npm run dev` in `frontend/` serves at `http://localhost:3000`.
  To preview the exact Pages build, run `NEXT_PUBLIC_BASE_PATH=/<repo> npm run build` and serve `out/`.
