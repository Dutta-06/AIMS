# Connecting Gmail

Corpo Mailer sends the emails you approve, and spots replies, through a Gmail account you connect
with one click: **Settings → Connect Gmail → choose the account → Allow.** No mail password goes in
any file.

Google makes the *app* register once, so there is a one-time setup (about 10 minutes, done by one
person for the whole team). After that, anyone just presses **Connect Gmail**.

## One-time setup in Google Cloud

1. Open <https://console.cloud.google.com> and **create a project** (call it "Corpo Mailer").

2. Open **APIs & Services → OAuth consent screen** (newer consoles call it *Google Auth platform*).
   Fill in the app name and a support email, then choose who it is for:

   * **Internal**: pick this if the Gmail account is a Google Workspace account (for example a
     university or company address) and you can create projects in that organisation. Only people
     in the organisation can connect, and there are no warning screens, no weekly expiry and no
     verification.
   * **External**: for an ordinary `@gmail.com` account. Add your address under **Test users**.

3. Under **Credentials → Create credentials → OAuth client ID**, choose **Web application** and add
   this exactly as an **Authorised redirect URI**:

   ```
   http://localhost:8000/api/v1/gmail/callback
   ```

   (It is shown, with a Copy button, on the app's Settings page too.) Create it, then copy the
   **Client ID** and **Client secret**.

4. In `backend/.env` add them and restart the backend:

   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```

5. Open the app → **Settings → Connect Gmail**. If Google says the app is unverified, choose
   **Advanced → Go to Corpo Mailer**: it is your own app. Approve the permission.

If the website is hosted on GitHub Pages, nothing changes: the redirect still goes to the backend on
your computer, which then sends your browser back to the website.

## What permission it asks for, and why

It asks for access to the mailbox (`https://mail.google.com/`). That is a broad permission, but it
is the one Gmail requires for sending *and* reading mail over SMTP/IMAP with a sign-in instead of a
password, which lets the already-tested sending and reply code be used unchanged.

* The app only **sends emails a person has approved** and **reads the inbox to match replies**. It
  opens the inbox read-only: it never marks mail read, moves or deletes it.
* The long-lived token is stored **only in the backend's database on your computer**. It is never
  sent to the browser and never put in GitHub.
* You can remove it any time: **Disconnect** in Settings (this also revokes it at Google), or
  <https://myaccount.google.com/permissions>.

## Good to know

* **External apps in "Testing" may need reconnecting about every 7 days.** Google limits sign-ins
  for apps that are not published. When that happens the Settings page says *Needs reconnecting*;
  press **Reconnect** (one click, nothing is lost). To avoid it, an *Internal* app has no such limit,
  and for an External app you can set the publishing status to *In production* (the unverified-app
  warning stays, and Google caps unverified apps at 100 users). Google changes these rules from time
  to time, so check the consent screen page if it behaves differently.
* **Only one account is connected at a time.** Connecting another replaces it.
* **The app password still works** as a fallback if you set `SMTP_USER` / `SMTP_PASSWORD` and have
  not connected an account. A connected account takes priority.

## If something goes wrong

| You see | Likely cause |
| --- | --- |
| `redirect_uri_mismatch` at Google | The redirect URI in the Google console must match the one on the Settings page exactly (http, `localhost`, port 8000). |
| "Access blocked" or "not a test user" | An External app in Testing: add your address under **Test users** on the consent screen. |
| "Google didn't give a lasting sign-in" | Remove Corpo Mailer at <https://myaccount.google.com/permissions> and connect again. |
| "Gmail sign-in isn't set up yet" | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are missing from `backend/.env`, or the backend wasn't restarted. |
| An admin message about third-party apps | A Workspace administrator is blocking it. Ask them to allow the app, or use an *Internal* app in that organisation. |
| *Needs reconnecting* | The connection expired or was revoked. Press **Reconnect**. |
