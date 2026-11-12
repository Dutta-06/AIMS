# Hosting on GitHub Pages

The app is plain static files, so GitHub Pages is the whole deployment: no server, no database.

1. Do the Google setup in [`GMAIL_SETUP.md`](GMAIL_SETUP.md) and note the client ID.
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. (Recommended) **Settings → Secrets and variables → Actions → Variables**: add `GOOGLE_CLIENT_ID`.
4. Push to `main` (or `corpo-mailer`), or run **Actions → Corpo Mailer website → Run workflow**. The
   workflow lints, type-checks, runs the tests, builds, and publishes
   `https://<user>.github.io/<repo>/`.
5. Open the site, **Sign in with Google**, then in **Settings** paste your OpenRouter key and press
   *Save and test*.

## Is it safe that the site is public?

The site holds no data and no secrets: anyone can open it, but they only see a sign-in button. Your
leads sit in *your* Google Drive and are readable only after signing in as you. The OpenRouter key
stays in the browser's local storage on your computer and is sent only to OpenRouter. Anything that
runs in the browser can be inspected, so use a free-tier key you can rotate.

## Honest limits of a no-server design

* Replies are only noticed while a tab is open.
* No website checking or sponsor discovery (paused on purpose).
* The AI key lives in the browser; clearing site data removes it.
* Free-model quality and availability vary; the app rotates through several and says when all fail.

## Local development

```bash
cd frontend
npm install
npm run dev     # http://localhost:3000 (add this origin in Google Cloud)
npm test        # unit tests
```
