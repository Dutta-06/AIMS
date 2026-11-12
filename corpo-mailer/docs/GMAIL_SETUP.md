# Google setup (one time)

Corpo Mailer signs you in with Google and uses three Google services as **you**: Drive (to keep the
leads), and Gmail (to send, and to read replies). Google makes every app register once. One person
does this for the whole team, in about 10 minutes. No password or secret is stored anywhere: only a
public **client ID** is needed.

## 1. Create the project and turn on the two APIs

1. Open <https://console.cloud.google.com> and **create a project** ("Corpo Mailer").
2. **APIs & Services → Library**: enable **Google Drive API** and **Gmail API**.

## 2. Consent screen

**APIs & Services → OAuth consent screen** (newer consoles: *Google Auth platform*). Fill in the app
name and a support email, then choose:

* **Internal**: if everyone uses Google Workspace accounts from one organisation (a university or
  company address). No warning screens, no verification, no expiry.
* **External**: for ordinary `@gmail.com` accounts. Leave it in **Testing** and add every person who
  will sign in under **Test users** (up to 100). Google shows an "unverified app" warning (press
  *Advanced → Continue*); in Testing mode sign-ins last 7 days before Google asks again.

Add these **scopes** (Data access / Scopes) if the console asks. The app requests only these:

| Scope | Why |
| --- | --- |
| `openid`, `email` | Know which account is signed in |
| `…/auth/drive.appdata` | Read and write only this app's hidden Drive folder (not your other files) |
| `…/auth/gmail.send` | Send an approved email |
| `…/auth/gmail.readonly` | Notice replies to emails you sent |

## 3. Create the client ID

**Credentials → Create credentials → OAuth client ID → Web application.** Under **Authorised
JavaScript origins** add (no trailing slash, no path):

```
https://<your-github-username>.github.io
http://localhost:3000
```

There is no redirect URI and no client secret. Copy the **Client ID** (`…apps.googleusercontent.com`).

## 4. Give the site the client ID

Either:

* In the GitHub repo: **Settings → Secrets and variables → Actions → Variables → New repository
  variable** named `GOOGLE_CLIENT_ID` with the client ID, then re-run the Pages workflow; or
* Skip that, open the site, and paste the client ID into the box on the login page (it is remembered
  in that browser).

## What to expect

* Each person signs in with their own Google account; their leads live in **their own** Drive. To
  share one set of leads, everyone signs in with the same shared Google account (for example a
  team mailbox) and uses it for Gmail too.
* The sign-in lasts about an hour. The app renews it quietly; if Google needs you, a banner says
  **Continue** and nothing is lost.
* Replies are checked every 5 minutes **while the page is open**, and when you press *Check for
  replies*. Closed tab = no checking.
* Email goes out from the signed-in Gmail account, only after **Approve**, then a press-and-hold on
  **Send**.
* Sign out revokes the access and clears the data from that browser. The leads stay in Drive.
