# Deployment

Production runs on the IONOS server reachable through the local SSH alias:

```text
Host zdwa
HostName 217.154.16.72
User root
```

The application is deployed from the GitHub `master` branch and runs with Docker Compose. Runtime data lives in `./data` on the server and is mounted into the container as `/app/data`.

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
- copies `data/` to `data.backup-YYYYMMDD-HHMMSS`
- pulls `origin/master` with `--ff-only`
- rebuilds and restarts the service with `docker compose up -d --build`
- prints `docker compose ps`

## Manual Deploy

Use this only when the script cannot be used:

```bash
ssh zdwa
cd /root/RollTheDice
git status --short --branch
cp -a data "data.backup-$(date +%Y%m%d-%H%M%S)"
git fetch origin master
git checkout master
git pull --ff-only origin master
docker compose up -d --build
docker compose ps
```

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
