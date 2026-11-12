> **Legacy.** This describes the earlier server version of Corpo Mailer. The current app runs
> entirely in the browser on GitHub Pages; see [`../../README.md`](../../README.md).

# Running it on an always-on server

This puts the **backend** (database, AI, Gmail, reply checking) on a small Linux server that stays up
all the time, so replies are tracked around the clock and you never have to "start" anything. The
website stays on GitHub Pages and talks to it.

```
 https://<you>.github.io/<repo>/        the website (GitHub Pages)
              │  your browser
              ▼
 https://corpo.yourdomain.com           your server:  Caddy (https)  →  backend  →  PostgreSQL
```

Everything runs in Docker. Only ports 80 and 443 (Caddy) face the internet; the backend and the
database are reachable only inside the stack. Only the Google accounts you list can sign in.

## What you need

* **A server**: any small Linux VPS with 1 GB of RAM or more (Ubuntu 22.04 or 24.04 is assumed), and SSH
  access.
* **A domain name** pointing at it. A raw IP address won't do: browsers need https for the website to
  talk to it, and Google won't accept an IP as a sign-in address. A subdomain of a domain you own is
  fine (`corpo.yourdomain.com`), and so is a free name from a service such as DuckDNS.
* The one-time **Google setup** from [`GMAIL_SETUP.md`](GMAIL_SETUP.md) (the redirect address in step 4
  below is the one to give Google), and your OpenRouter key.

## Setup, step by step

### 1. Point your domain at the server

Create an **A record** for the name you chose (say `corpo.yourdomain.com`) with the server's public IP
address. Wait until it resolves (`ping corpo.yourdomain.com` shows the right IP). Caddy can't get a
certificate until this is right.

### 2. Log in and install Docker

```bash
ssh youruser@your-server-ip
```

Install Docker with its official script (read it first if you like: <https://get.docker.com>):

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker $USER
```

Log out and back in so the group change applies, then check:

```bash
docker compose version
```

### 3. Open only the ports you need

```bash
sudo ufw allow OpenSSH
```

```bash
sudo ufw allow 80,443/tcp
```

```bash
sudo ufw allow 443/udp
```

```bash
sudo ufw enable
```

(Also allow ports 80 and 443 in your hosting provider's own firewall if it has one.)

### 4. Get the code and fill in the settings

```bash
sudo git clone -b corpo-mailer https://github.com/Dutta-06/AIMS.git /opt/corpo-mailer
```

```bash
sudo chown -R $USER /opt/corpo-mailer
```

```bash
cd /opt/corpo-mailer/corpo-mailer/deploy
```

```bash
cp .env.example .env
```

```bash
chmod 600 .env
```

Make two random secrets and put them in `.env`:

```bash
openssl rand -hex 24
```

```bash
openssl rand -hex 32
```

Then edit `.env` (`nano .env`) and set, at least:

| Setting | What to put |
| --- | --- |
| `DOMAIN` | `corpo.yourdomain.com` |
| `CORS_ORIGINS` | `["https://<your-github-username>.github.io"]` (no path) |
| `GOOGLE_REDIRECT_URI` | `https://corpo.yourdomain.com/api/v1/auth/google/callback` |
| `DB_PASSWORD` | the first random value (letters and digits only) |
| `SESSION_SECRET` | the second random value |
| `ALLOWED_EMAILS` | the Google accounts that may sign in, comma-separated |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from the Google console |
| `OPENROUTER_API_KEY` | your key |
| `EVENT_PITCH` | real facts about your event |

In the **Google console**, add the same `GOOGLE_REDIRECT_URI` as an *Authorised redirect URI* on your
OAuth client.

### 5. Start it

```bash
docker compose up -d --build
```

The first run builds the backend and, once the domain resolves, Caddy fetches the certificate by
itself. Check it:

```bash
docker compose ps
```

```bash
docker compose logs -f backend
```

(Press Ctrl+C to stop following the log.) Then, from anywhere:

```bash
curl https://corpo.yourdomain.com/health
```

It should answer `{"status":"ok"}`. If the backend refuses to start, its log says exactly which setting
is missing.

### 6. Point the website at it

Open your GitHub Pages site. On the sign-in page, open **Backend address**, type
`https://corpo.yourdomain.com` and press **Use this address**. Then **Sign in with Google**, and go to
**Settings → Connect Gmail** to connect the mailbox the team sends from.

To make it the default for everyone (so nobody has to type it), set a repository variable
`CORPO_API_URL` to `https://corpo.yourdomain.com/api/v1` (*Settings → Secrets and variables → Actions →
Variables*) and re-run the **Corpo Mailer website** workflow.

### 7. Back up the database every night

The database holds your leads and the Gmail connection. Try a backup by hand:

```bash
./backup.sh
```

Then have the server do it daily (the newest 14 are kept in `deploy/backups/`, readable only by you):

```bash
crontab -e
```

and add this line:

```
0 3 * * * /opt/corpo-mailer/corpo-mailer/deploy/backup.sh >> /opt/corpo-mailer/corpo-mailer/deploy/backups/backup.log 2>&1
```

Copy the backups off the server now and then (`scp`), since a backup on the same machine doesn't
protect you if the machine is lost.

## Everyday commands

Run these in `/opt/corpo-mailer/corpo-mailer/deploy`.

| To | Run |
| --- | --- |
| See that it's running | `docker compose ps` |
| Follow the backend's log | `docker compose logs -f backend` |
| Update to the latest code | `git pull` then `docker compose up -d --build` |
| Change a setting | edit `.env`, then `docker compose up -d` |
| Restart | `docker compose restart backend` |
| Stop everything (data is kept) | `docker compose down` |

Updating applies new database changes by itself when the backend starts.

## Restoring a backup

On a fresh server, set it up through step 5, then load the dump into the new database:

```bash
docker compose stop backend
```

```bash
gunzip -c backups/corpo-mailer-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T db psql -U corpo corpo_mailer
```

```bash
docker compose start backend
```

(If the new database already has tables, empty it first: `docker compose down -v` deletes the data
volume, then `docker compose up -d db` and restore before starting the rest.)

## Keeping the server safe

* **SSH keys only.** Put your public key on the server, then turn password logins off
  (`PasswordAuthentication no` in `/etc/ssh/sshd_config`) and restart `ssh`.
* **Automatic security updates**: `sudo apt install unattended-upgrades`.
* **Keep `.env` private** (`chmod 600`). It holds the Google secret, the OpenRouter key and the
  database password. Never commit or share it.
* **Don't publish more ports.** Leave the database and backend unexposed; only Caddy is.
* **Who gets in** is `ALLOWED_EMAILS`. Change it and `docker compose up -d` to add or remove people;
  removing someone signs them out straight away.
* The backups hold the Gmail connection, so treat them like the `.env`.

## If something goes wrong

| You see | What to do |
| --- | --- |
| Caddy can't get a certificate (the log says so) | The domain doesn't point at this server yet, or ports 80/443 are blocked (server or provider firewall). Fix that, then `docker compose restart caddy`. |
| `502 Bad Gateway` | The backend isn't up. `docker compose logs backend` says why. |
| "The backend was NOT started: ALLOWED_EMAILS is empty" (or Google settings) | Fill that value in `.env`, then `docker compose up -d`. |
| The website says "Can't reach the backend" | Wrong **Backend address** on the sign-in page, the server is down, or `CORS_ORIGINS` isn't exactly your Pages origin (no path, no trailing slash). |
| Google `redirect_uri_mismatch` | The redirect address in the Google console must equal `GOOGLE_REDIRECT_URI` exactly. |
| "That Google account isn't allowed" | Add the account to `ALLOWED_EMAILS`, then `docker compose up -d`. |
| Signed out after every restart | Set `SESSION_SECRET` in `.env`. |
