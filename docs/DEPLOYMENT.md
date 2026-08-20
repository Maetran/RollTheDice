# Deployment

Production runs on the IONOS server reachable through the local SSH alias:

```text
Host zdwa
HostName 217.154.16.72
User root
```

The application is deployed from the GitHub `master` branch and runs with Docker Compose. Runtime data lives in `./data` on the server and is mounted into the container as `/app/data`.

User accounts, sessions, and the complete new game history live in
`data/rollthedice.sqlite3`. The legacy JSON leaderboards remain in place during
the migration period.

Production directory layout on `zdwa`:

```text
/root/
├── RollTheDice/
│   ├── app/
│   ├── data/                 # production leaderboard and stats data
│   ├── tests/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── manifest.webmanifest
│   ├── README.md
│   └── requirements.txt
├── backup_data/
├── backup_data_pull_1756397116/
└── rollthedice-data-backup-20260731-114147.tar.gz
```

The deploy working directory is:

```bash
/root/RollTheDice
```

## Non-Negotiable Data Rule

The leaderboard files in `./data` are production data and must not be deleted, reset, replaced, or overwritten by deploy tooling.

Do not run:

```bash
docker compose down -v
rm -rf data
git clean -fdx
git reset --hard
```

Any deploy must create a timestamped copy of `data/` before changing the running application.

SQLite can use WAL files. Do not copy its directory while the application is
writing. The automated deployment briefly stops the container, copies the full
directory, and starts it again before updating the code.

## Automated Deploy

From a local checkout:

```bash
scripts/deploy_zdwa.sh
```

The script defaults to `/root/RollTheDice`. To override it:

```bash
REMOTE_DIR=/another/path/RollTheDice scripts/deploy_zdwa.sh
```

The script:

- connects to `ssh zdwa`
- uses `/root/RollTheDice` unless `REMOTE_DIR` is provided
- refuses to deploy if the remote worktree has uncommitted changes
- briefly stops the container and copies `data/` to `data.backup-YYYYMMDD-HHMMSS`
- restarts the existing container immediately after the consistent backup
- pulls `origin/master` with `--ff-only`
- rebuilds and restarts the service with `docker compose up -d --build`
- prints `docker compose ps`

## Manual Deploy

Use this only when the script cannot be used:

```bash
ssh zdwa
cd /root/RollTheDice
git status --short --branch
docker compose stop rollthedice
cp -a data "data.backup-$(date +%Y%m%d-%H%M%S)"
docker compose start rollthedice
git fetch origin master
git checkout master
git pull --ff-only origin master
docker compose up -d --build
docker compose ps
```

## First Admin and HTTPS Cookies

Before the first deployment with user accounts, create
`/root/RollTheDice/.env` from `.env.example` and set a temporary bootstrap
username and password. After the account exists, remove
`ROLLTHEDICE_ADMIN_PASSWORD` from `.env`.

For a public HTTPS endpoint set `ROLLTHEDICE_COOKIE_SECURE=1`. The reverse proxy
must forward the original host and protocol (`X-Forwarded-Host` and
`X-Forwarded-Proto`), because mutation and WebSocket origin checks use them.

## Registration Protection

Login failures and registration attempts are rate-limited persistently in the
same SQLite database. No Redis or separate maintenance service is required.

Before enabling public self-registration, create a Cloudflare Turnstile widget
restricted to the public hostname and add both values to `.env`:

```dotenv
ROLLTHEDICE_TURNSTILE_SITE_KEY=...
ROLLTHEDICE_TURNSTILE_SECRET=...
```

Restart with `docker compose up -d --build`. Verify that the challenge appears
in the lobby and that the container is healthy:

```bash
docker compose logs --tail=100 rollthedice
curl -fsS http://127.0.0.1:8000/api/auth/registration-config
```

The response must contain `"turnstile_enabled":true`. Never expose the secret
in HTML or JavaScript; only the site key is returned by the public config API.
If either value is missing, startup fails deliberately instead of providing a
false sense of protection.

## Server Maintenance

If Ubuntu reports `System restart required`, a controlled reboot is acceptable.

Before reboot:

```bash
docker compose ps
systemctl is-enabled docker
```

Then:

```bash
reboot
```

After the server is back:

```bash
ssh zdwa
cd /path/to/RollTheDice
docker compose ps
curl -fsS http://127.0.0.1:8000/ >/dev/null && echo "local app OK"
```

Package updates are acceptable, but take an IONOS snapshot first when possible and avoid combining broad OS upgrades with an app deploy unless SSH is stable.
