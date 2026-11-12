# Google setup: sign-in and Gmail

Corpo Mailer uses Google for two things, with **one** one-time setup:

1. **Signing in to the website.** People press **Sign in with Google**. Only the Google accounts you
   list can come in. There is no password to share or remember. Signing in asks Google for just your
   email address.
2. **Connecting the mailbox the team sends from.** In **Settings → Connect Gmail**, a signed-in
   person connects the Gmail account the emails are sent from and replies are read from. It can be a
   different account from the one they signed in with. No mail password goes in any file.

Google makes the *app* register once. That takes about 10 minutes, and one person does it for the
whole team.

## One-time setup in Google Cloud

1. Open <https://console.cloud.google.com> and **create a project** (call it "Corpo Mailer").

2. Open **APIs & Services → OAuth consent screen** (newer consoles call it *Google Auth platform*).
   Fill in the app name and a support email, then choose who it is for:

   * **Internal**: pick this if the Google accounts are Google Workspace accounts (for example a
     university or company address) and you can create projects in that organisation. Everyone in the
     organisation can reach the sign-in screen (your allow-list still decides who gets in), and there
     are no warning screens, no weekly expiry and no verification.
   * **External**: for ordinary `@gmail.com` accounts. Add **every person who will sign in, and the
     mailbox account**, under **Test users** (up to 100). Google only lets test users through.

3. Under **Credentials → Create credentials → OAuth client ID**, choose **Web application** and add
   this exactly as an **Authorised redirect URI**:

   ```
   http://localhost:8000/api/v1/auth/google/callback
   ```

   (If the backend runs in a Codespace, use the address the Codespace prints instead; see
   [`CODESPACES.md`](CODESPACES.md). It is also shown, with a Copy button, on the sign-in and
   Settings pages when setup isn't finished.) Create it, then copy the **Client ID** and
   **Client secret**.

4. In the backend's settings (`backend/.env`, or Codespaces secrets), add them, and list who may use
   the site, then restart the backend:

   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ALLOWED_EMAILS=you@gmail.com,teammate@dtu.ac.in
   ```

5. Open the website and press **Sign in with Google**. Then go to **Settings → Connect Gmail** to
   connect the mailbox. If Google says the app is unverified, choose **Advanced → Go to Corpo
   Mailer**: it is your own app.

To add or remove a person later, change `ALLOWED_EMAILS` and restart the backend. Removing someone
signs them out straight away.

## What each permission is, and why

| When | Permission | Why |
| --- | --- | --- |
| Signing in | your **email address** only (`openid email`) | To check you are on the allowed list. Nothing else about you is requested or stored. |
| Connecting the mailbox | access to the **mailbox** (`https://mail.google.com/`) | It is the one permission Gmail requires for sending *and* reading mail over SMTP/IMAP with a sign-in instead of a password. |

* A signed-in person who never connects Gmail never gives mailbox access.
* Once connected, the app only **sends emails a person has approved** and **reads the inbox to match
  replies**. It opens the inbox read-only: it never marks mail read, moves or deletes it.
* The long-lived mailbox token is stored **only in the backend's database**. It is never sent to the
  browser and never put in GitHub.
* Remove it any time: **Disconnect** in Settings (this also revokes it at Google), or
  <https://myaccount.google.com/permissions>.

## Good to know

* **Sessions last 12 hours** (`SESSION_HOURS`); after that you press Sign in with Google again, which is
  one click. These are the backend's own sessions, separate from Google's.
* **External apps in "Testing" may need the *mailbox* reconnecting about every 7 days.** Google limits
  long-lived access for apps that are not published. The Settings page then says *Needs reconnecting*;
  press **Reconnect**. An *Internal* app has no such limit, and an External app can be set to *In
  production* (the unverified-app warning stays, and Google caps unverified apps at 100 users). Google
  changes these rules from time to time, so check the consent screen page if it behaves differently.
* **One mailbox at a time.** Connecting another replaces it.
* **No `ALLOWED_EMAILS`?** Then there is no sign-in at all, which is only safe while the backend runs
  on your own computer. Any backend that others can reach must list its allowed accounts.

## If something goes wrong

| You see | Likely cause |
| --- | --- |
| `redirect_uri_mismatch` at Google | The redirect URI in the Google console must match the one the app shows exactly (`http`, `localhost`, port 8000, path `/api/v1/auth/google/callback`). |
| "Access blocked" or "not a test user" | An External app in Testing: add the address under **Test users** on the consent screen. |
| "That Google account isn't allowed to use this site" | The account isn't in `ALLOWED_EMAILS` (or the backend wasn't restarted after adding it). |
| "Google sign-in isn't set up on this backend yet" | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are missing, or the backend wasn't restarted. |
| "Google didn't give a lasting sign-in" (when connecting Gmail) | Remove Corpo Mailer at <https://myaccount.google.com/permissions> and connect again. |
| An admin message about third-party apps | A Workspace administrator is blocking it. Ask them to allow the app, or use an *Internal* app in that organisation. |
| *Needs reconnecting* | The mailbox connection expired or was revoked. Press **Reconnect**. |
