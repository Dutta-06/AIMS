# Hosting on GitHub Pages

The app is plain static files, so GitHub Pages is the whole deployment: no server, no database.

1. Do the Google setup in [`GMAIL_SETUP.md`](GMAIL_SETUP.md) and note the client ID, API key and project number.
2. In the repo: **Settings → Pages → Source: GitHub Actions**. If the deploy says your branch isn't allowed, add it under **Settings → Environments → github-pages → Deployment branches**, or deploy from `main`.
3. (Recommended) **Settings → Secrets and variables → Actions → Variables**: add `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY` and `GOOGLE_APP_ID`.
4. Push to `main` (or `corpo-mailer`), or run **Actions → Corpo Mailer website → Run workflow**. The
   workflow lints, type-checks, runs the tests, builds, and publishes
   `https://<user>.github.io/<repo>/`.
5. Open the site and **Sign in with Google**. The first person starts the team workspace and shares it
   with teammates (Settings → Team workspace); everyone else chooses that file once. Each person then
   pastes their OpenRouter key(s) in **Settings** and presses *Save and test*.

## Is it safe that the site is public?

The site holds no data and no secrets: anyone can open it, but they only see a sign-in button. Your
leads sit in one Drive file shared only with the people you add, and are readable only after signing in as one of them. The OpenRouter key
stays in the browser's local storage on your computer and is sent only to OpenRouter. Anything that
runs in the browser can be inspected, so use a free-tier key you can rotate.

## Honest limits of a no-server design

* Replies are only noticed while the sender's tab is open.
* Two people editing the same lead at the same second: the later edit wins (everything else merges).
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
