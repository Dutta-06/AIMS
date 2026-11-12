# Google setup (one time)

Corpo Mailer signs you in with Google and uses two Google services as **you**: Drive (to keep the
team's shared workspace file) and Gmail (to send, and to read replies). One person does this setup
for the whole team, in about 10 minutes. No password or secret is stored anywhere: the one value
below, the client ID, is a public identifier.

## 1. Create the project and turn on two APIs

1. Open <https://console.cloud.google.com> and **create a project** ("Corpo Mailer").
2. **APIs & Services → Library**: enable **Google Drive API** and **Gmail API**.

## 2. Consent screen

**APIs & Services → OAuth consent screen** (newer consoles: *Google Auth platform*). Fill in the app
name and a support email, then choose:

* **Internal**: if everyone uses Google Workspace accounts from one organisation (for example
  `@dtu.ac.in`) and the project was created inside that organisation. No test-user list, no warning
  screens, no verification, no expiry: anyone with an address in the organisation can sign in. This
  is the smoothest option if your whole team has organisation addresses.
* **External**: for ordinary `@gmail.com` accounts. Leave it in **Testing** and add **every person
  who will sign in** under **Test users** (up to 100; add more any time). Google shows an
  "unverified app" warning (press *Advanced → Continue*); in Testing mode sign-ins last 7 days
  before Google asks again.

Add these **scopes** (Data access / Scopes) if the console asks. The app requests only these:

| Scope | Why |
| --- | --- |
| `openid`, `email` | Know which account is signed in |
| `…/auth/drive` | Find, open and update the team's one shared workspace file, and add teammates to it. Google words this as access to your Drive; the app only ever touches that file. (A narrower permission exists, but then every teammate would have to pick the file by hand on every device.) |
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

## 4. Give the site the client ID

In the GitHub repo: **Settings → Secrets and variables → Actions → Variables → New repository
variable** named `GOOGLE_CLIENT_ID` with the client ID from step 3, then re-run the Pages workflow.
(It isn't a secret, so a repository *variable* is right. If you skip it, the login screen lets each
person paste it; it's remembered in that browser.)

## How the team uses it

1. **The first person** signs in and presses **Start the team workspace**. That creates a file called
   *Corpo Mailer shared data* in their Drive.
2. In **Settings → Team workspace** they add each teammate's Google email. Google emails the
   teammate a link to the file.
3. **Each teammate** just opens the site and signs in with that email. They land on the same
   dashboard by themselves, on any browser or device, with nothing to choose or set up. If they
   signed in a moment before being added, the page keeps checking and takes them in as soon as they
   are.
4. Everyone's changes merge into the same file. Changes from teammates appear within about 30 seconds,
   or press *Check for teammates' changes*.

If the consent screen is **External**, a teammate must also be listed under **Test users** (step 2)
before Google lets them sign in at all.

## Who can change the settings

Everyone on the team can use the dashboard. In **Settings** they only see **Your account**; the AI
keys, event details, team list and backups are for the admins, which are `odwitiyo.dutta@gmail.com`
and `aims@dtu.ac.in`. To change who the admins are, set a repository variable `ADMIN_EMAILS`
(comma separated) next to `GOOGLE_CLIENT_ID` and re-run the Pages workflow. This hides the controls
in the app; it is not a lock on the data itself (anyone you share the Drive file with as an editor
could still change it in Drive).

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
