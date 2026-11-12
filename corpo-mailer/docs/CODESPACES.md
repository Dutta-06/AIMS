# Running the backend in a GitHub Codespace

The website lives on GitHub Pages. GitHub Pages can only serve static files, so the **backend** (the
database, the AI, and Gmail) runs somewhere else. Here, that is a **GitHub Codespace**: a small cloud
computer that GitHub gives you. The website is told where the backend is by typing its address on the
sign-in page, so a new Codespace never needs a rebuild.

```
 https://<you>.github.io/<repo>/        the website (public, static, holds nothing)
              │  your browser
              ▼
 https://<codespace>-8000.app.github.dev   the backend in your Codespace (only allowed Google accounts)
```

Because a Codespace backend can be reached from the internet, it **refuses to start unless it knows
who may use it** (`ALLOWED_EMAILS`), only lets those Google accounts in ("Sign in with Google"), and
has its API docs pages switched off. Everything goes over https.

## One-time setup

### 1. Add your secrets (so nothing sensitive goes in a file)

Open <https://github.com/settings/codespaces> → **New secret**, and add each one with **Repository
access** set to this repository:

| Secret | What for |
| --- | --- |
| `ALLOWED_EMAILS` | **Required.** The Google accounts that may use the site, comma-separated, e.g. `you@gmail.com,teammate@dtu.ac.in`. |
| `OPENROUTER_API_KEY` | The AI drafts. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **Required to sign in** and to connect Gmail (add after step 5). |
| `SESSION_SECRET` | Optional: any long random text, so a restart doesn't sign you out. |
| `EVENT_PITCH` | Optional: facts about your event that the AI may use. |

### 2. Put the website on GitHub Pages

Follow steps 2-4 of [`HOSTING.md`](HOSTING.md) (Settings → Pages → *GitHub Actions*; allow the branch;
run the **Corpo Mailer website** workflow). You'll get an address like
`https://<you>.github.io/<repo>/`.

### 3. Create the Codespace

On the repository page: **Code → Codespaces → ⋯ → New with options**, then choose

* **Branch:** `corpo-mailer`
* **Dev container configuration:** *Corpo Mailer backend*

and **Create codespace**. When it finishes starting, the terminal prints something like:

```
Backend address (type this on the sign-in page of the website):
    https://<codespace>-8000.app.github.dev
Google redirect address (add this in the Google Cloud console):
    https://<codespace>-8000.app.github.dev/api/v1/auth/google/callback
```

If instead it says "nobody is listed as allowed", add the `ALLOWED_EMAILS` secret (step 1) and restart
the Codespace.

### 4. Make port 8000 public

In the Codespace, open the **Ports** tab, right-click port **8000 → Port Visibility → Public**. (The
website runs on a different address than the backend, so it can't reach a private port. The backend is
still protected: only allowed Google accounts can sign in.)

If the website later can't reach the backend, open the backend address once in a browser tab, click
**Continue** if GitHub shows a "development port" notice, then try again.

### 5. Set up Google (sign-in and Gmail)

Follow [`GMAIL_SETUP.md`](GMAIL_SETUP.md), with one difference: use the **Google redirect address
printed in step 3** (the `https://….app.github.dev/api/v1/auth/google/callback` one), not the `localhost`
one. Then add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Codespaces secrets and restart the
Codespace.

## Using it

1. Open your Pages website. On the sign-in page, open **Backend address**, paste the backend address
   from step 3, and press **Use this address**. (Your browser remembers it.)
2. Press **Sign in with Google** and choose an allowed account.
3. Go to **Settings → Connect Gmail** to connect the mailbox the team sends from.
4. Try it safely first: add yourself as a lead, write a draft, approve it, hold to send, and check
   your own inbox.

## Every day

* Open <https://github.com/codespaces> and resume your Codespace. The backend starts by itself and
  prints the addresses again. The address stays the same for that Codespace, so the website still
  knows it. Check the port is still **Public** (step 4).
* Keep the Codespace running while you work.

## Good to know

* **Codespaces stop when idle** (30 minutes by default; you can raise it under
  *Settings → Codespaces → Default idle timeout*). While it is stopped nothing can send or check
  replies. Keep the Codespace tab open while you work. Free accounts get a monthly allowance of
  Codespace hours (check GitHub's current limits).
* **A new Codespace has a new address.** If you ever create another one, paste its new backend address
  on the sign-in page and update the redirect address in Google.
* **Your data lives inside the Codespace** (a SQLite file). Deleting the Codespace deletes it, and
  GitHub removes Codespaces that sit unused for a while. Use **Leads → Export** to keep a CSV backup.
  For something durable, make a free PostgreSQL database (Neon, Supabase) and add its connection
  string as a `DATABASE_URL` secret.
* **Only the listed accounts get in.** Anyone else who finds the address sees only the sign-in page,
  and Google's "isn't allowed" message if they try. To add or remove a person, change the
  `ALLOWED_EMAILS` secret and restart the Codespace.
* **Run the website from the Codespace instead?** `cd corpo-mailer/frontend && npm ci && npm run dev`,
  then open the forwarded port 3000 (its address is already allowed). The sign-in page works the same.

## If something goes wrong

| You see | What to do |
| --- | --- |
| "Can't reach the backend" | The Codespace is stopped (resume it), port 8000 isn't Public, or the backend address on the sign-in page is old. |
| The page can't reach it but the Codespace is running | Open the backend address in a tab once and click **Continue**; check the port is **Public**. |
| "The backend was NOT started: nobody is listed as allowed" | Add the `ALLOWED_EMAILS` secret, then restart the Codespace. |
| Google `redirect_uri_mismatch` | The redirect address in Google must be exactly the one the Codespace printed. |
| Signed out after a restart | Set the `SESSION_SECRET` secret so sign-ins survive restarts. |
| "That Google account isn't allowed" | Add the account to `ALLOWED_EMAILS` and restart the Codespace. |
