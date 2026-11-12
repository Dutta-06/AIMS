# Google setup (one time)

Corpo Mailer signs you in with Google and uses three Google services as **you**: Drive (to keep the
team's shared workspace file), Gmail (to send, and to read replies) and Google's file picker (so a
teammate can open the shared file). One person does this setup for the whole team, in about 15
minutes. No password or secret is stored anywhere: the values below are public identifiers.

## 1. Create the project and turn on three APIs

1. Open <https://console.cloud.google.com> and **create a project** ("Corpo Mailer").
2. **APIs & Services → Library**: enable **Google Drive API**, **Gmail API** and **Google Picker API**.

## 2. Consent screen

**APIs & Services → OAuth consent screen** (newer consoles: *Google Auth platform*). Fill in the app
name and a support email, then choose:

* **Internal**: if everyone uses Google Workspace accounts from one organisation (a university or
  company address). No warning screens, no verification, no expiry.
* **External**: for ordinary `@gmail.com` accounts. Leave it in **Testing** and add **every person
  who will sign in** under **Test users** (up to 100; add more any time). Google shows an
  "unverified app" warning (press *Advanced → Continue*); in Testing mode sign-ins last 7 days
  before Google asks again.

Add these **scopes** (Data access / Scopes) if the console asks. The app requests only these:

| Scope | Why |
| --- | --- |
| `openid`, `email` | Know which account is signed in |
| `…/auth/drive.file` | Only the shared workspace file: the one the app creates, or the one you choose in the picker. Nothing else in your Drive |
| `…/auth/gmail.send` | Send an email you approved |
| `…/auth/gmail.readonly` | Notice replies to emails you sent |

## 3. Create the client ID

**Credentials → Create credentials → OAuth client ID → Web application.** Under **Authorised
JavaScript origins** add (no trailing slash, no path):

```
https://<your-github-username>.github.io
http://localhost:3000
```

There is no redirect URI and no client secret. Copy the **Client ID** (`…apps.googleusercontent.com`).

## 4. Create the file-picker key

Teammates open the shared file through Google's file picker, which needs an API key and your
project's number.

1. **Credentials → Create credentials → API key.** Open it and set:
   * *Application restrictions*: **Websites**, then add `https://<your-github-username>.github.io/*`
     and `http://localhost:3000/*`.
   * *API restrictions*: **Restrict key → Google Picker API**.
2. Copy the key (`AIza…`). Find the **Project number** (digits only) on the Cloud console's
   dashboard, or under *IAM & Admin → Settings*.

## 5. Give the site these values

In the GitHub repo: **Settings → Secrets and variables → Actions → Variables → New repository
variable**, three of them, then re-run the Pages workflow:

| Variable | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | the client ID from step 3 |
| `GOOGLE_API_KEY` | the key from step 4 |
| `GOOGLE_APP_ID` | the project number from step 4 |

(They are not secrets, so repository *variables* are right. If you skip them, the login and join
screens let each person paste the values; they're remembered in that browser.)

## How the team uses it

1. **The first person** signs in and presses **Start the team workspace**. That creates a file called
   *Corpo Mailer shared data* in their Drive.
2. In **Settings → Team workspace** they add each teammate's Google email. Google emails the
   teammate a link to the file.
3. **Each teammate** signs in, then presses **Choose the shared file** and picks it, **once**. After
   that, on any new browser or device they just sign in: the app finds the file by itself (Google
   remembers which file the account has opened with this app), so there is no setup to repeat.
4. Everyone's changes merge into the same file. Changes from teammates appear within about 30 seconds,
   or press *Check for teammates' changes*.

## What to expect

* **Different records never clash.** If two people edit the *same* lead at the same time, the later
  edit wins. Deleted leads stay deleted. A sent email stays sent.
* **Sending:** each email goes out from the Gmail account of the person who presses Send, only after
  someone presses **Approve**. If two people press Send on the same draft together, only one email
  goes and the other is told. (Best effort: it relies on two browsers noticing each other within about
  a second.)
* **Replies** are noticed in the browser of the person who sent the email, every 5 minutes while that
  page is open, and show up on the shared dashboard for everyone. A closed tab checks nothing.
* **AI keys:** in **Settings → Team keys**, one person pastes everyone's OpenRouter keys, one per
  line. They are saved in the shared file, so every teammate and every new device has them without
  any setup. Requests take turns across the keys, and a rate-limited key hands over to the next.
  **Anyone who can open the shared file can read those keys**, so only share the file with people you
  trust with them. A person can also keep a key just for their own browser (the first box). Keys from
  the *same* OpenRouter account share one free allowance and gain nothing.
* The sign-in lasts about an hour; the app renews it quietly, and if Google needs you, a banner says
  **Continue** and nothing is lost.
* **Sign out** revokes the access and clears the data from that browser. The shared file stays in Drive.
