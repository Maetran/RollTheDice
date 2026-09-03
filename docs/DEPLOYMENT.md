# ZDWA Deployment und Betrieb

Dieses Dokument beschreibt den produktiven Betrieb von **ZDWA – Zock die Wand
an**. Das Repository heisst intern weiterhin `RollTheDice`.

## Produktionsumgebung

| Bereich | Wert |
| --- | --- |
| Öffentliche URL | `https://zockdiewandan.online/` |
| SSH-Ziel | `ssh zdwa` |
| SSH-Benutzer | `manuel` (SSH-Key, passwortloses `sudo` für Docker) |
| Arbeitsverzeichnis | `/home/manuel/RollTheDice` |
| Git-Branch | `master` |
| Container/Service | `rollthedice` |
| Lokaler Container-Port | `8000` |
| Persistente Daten | `/home/manuel/RollTheDice/data` |

Die Anwendung läuft mit Docker Compose hinter einem HTTPS-Reverse-Proxy. Das
Verzeichnis `./data` wird als `/app/data` in den Container eingebunden.

Der dokumentierte Compose-Betrieb startet genau **einen** Uvicorn-Prozess in
einem `rollthedice`-Container. Das ist derzeit eine Plattformvoraussetzung,
nicht nur eine Zilch-Eigenheit: aktive Spiele liegen im Prozessspeicher und der
Zilch-CPU-Runner verwendet zusätzlich eine prozesslokale Task-Registry.
Mehrere Container, Replikate oder Uvicorn-/Gunicorn-Worker dürfen deshalb erst
eingesetzt werden, wenn eine verteilte Zustands- und Lease-Koordination
implementiert und getestet ist.

Die SQLite-Datenbank `data/rollthedice.sqlite3` enthält Benutzerkonten,
Sessions, Schutzereignisse, wartende/laufende sowie vollständige Spiele und Zuordnungen. Die vorhandenen
JSON-Dateien enthalten weiterhin Leaderboards und ältere Statistikdaten. Beide
Speicherarten gehören zu den Produktionsdaten.

Der Checkout gehört `manuel`; `data/` bleibt hingegen `root:root`, weil der
Docker-Prozess die SQLite-Datei inklusive WAL-Dateien mit diesem Mapping
schreibt. Das Deploy-Skript verwendet deshalb nur für Docker und Datenbackups
passwortloses `sudo`.

## Unverhandelbare Datenregeln

`data/` darf bei einem Deployment niemals gelöscht, geleert oder durch lokale
Daten ersetzt werden. Vor jeder Änderung der laufenden Anwendung muss auf dem
Server eine zeitgestempelte Kopie des vollständigen Verzeichnisses entstehen.

SQLite verwendet WAL-Dateien. Deshalb darf `data/` nicht kopiert werden, während
der Container in die Datenbank schreibt. Das Deployment-Skript stoppt den
Container kurz, kopiert das vollständige Verzeichnis und startet ihn sofort
wieder.

Folgende Befehle sind auf Produktion nicht Teil eines Deployments:

```text
docker compose down -v
rm -rf data
git clean -fdx
git reset --hard
```

Ein erfolgreiches Backup sieht so aus:

```text
/home/manuel/RollTheDice/data.backup-YYYYMMDD-HHMMSS
```

Nach einem erfolgreichen Deployment entfernt `scripts/deploy_zdwa.sh`
automatisch ältere Deployment-Backups und behält immer die neuesten fünf. Bei
einem fehlgeschlagenen Rollout findet diese Bereinigung nicht statt. Das
Hilfsskript arbeitet bei einem manuellen Aufruf weiterhin standardmässig als
Trockenlauf; erst `APPLY=1` löscht die zuvor angezeigten Verzeichnisse. Eine
Auslagerung wichtiger Wochen-/Monatsstände auf einen zweiten Speicher bleibt
weiterhin empfohlen.

## Voraussetzungen

Vor einem regulären Rollout müssen folgende Bedingungen erfüllt sein:

- Die Änderung ist auf `master` committed und zu `origin/master` gepusht.
- Relevante Python- und Browsertests sind erfolgreich.
- Der lokale und der produktive Git-Arbeitsbaum enthalten keine unbekannten
  Änderungen.
- Datenmigrationen besitzen eine Alembic-Migration. Die Anwendung aktualisiert
  das Schema beim Start automatisch bis `head`.
- Vor einer Migration das vollständige `data/`-Verzeichnis sichern. Revision
  `20260903_0016` typisiert abgeschlossene Spiele: vorhandene Ergebnisse und
  Tombstones werden zu `zdwa` zurückgefüllt; neue private Zilch-Ergebnisse
  verwenden `zilch`. Ein Downgrade wird absichtlich verweigert, solange
  Zilch-Ergebnisse oder
  -Tombstones vorhanden sind; dann ist ein kompatibles Backup der sichere
  Rückweg.
- Statische Assets sind mit `scripts/sync_static_versions.py --check` synchronisiert.

Empfohlene lokale Prüfung:

```bash
pytest --cov --cov-report=term-missing
ruff check .
bandit -q -r app scripts -c pyproject.toml
vulture app scripts tests --min-confidence 80
pip-audit -r requirements-dev.txt --progress-spinner off
npm run test:browser
python3 scripts/sync_static_versions.py --check
git diff --check
git status --short
```

## Reverse-Proxy-Härtung

Die versionierte Nginx-Konfiguration unter `deploy/nginx/rollthedice.conf`
begrenzt HTTP-Bursts, Request-Grössen und parallele WebSockets pro IP. Sie reicht
für WebSockets außerdem die echte Client-IP an Uvicorn weiter und setzt eine
Content-Security-Policy.

Nach manueller Prüfung wird sie auf dem Produktionsserver aus dem Repository
installiert:

```bash
cd /home/manuel/RollTheDice
scripts/install_nginx_config.sh
```

Das Skript legt zuerst eine zeitgestempelte Sicherung der bisherigen
Konfiguration an, führt `nginx -t` aus und stellt sie bei einem Fehler wieder
her. Diese Systemkonfiguration wird nicht bei jedem App-Deployment ungeprüft
überschrieben.

Bei einem manuellen Aufruf werden alte Datenbackups zunächst nur aufgelistet:

```bash
cd /home/manuel/RollTheDice
KEEP=5 scripts/prune_data_backups.sh
```

Nach Kontrolle der Liste kann dieselbe Auswahl mit `APPLY=1` gelöscht werden.

## Standard-Deployment

Der reguläre und bevorzugte Weg ist:

```bash
scripts/deploy_zdwa.sh
```

Das Skript führt auf `ssh zdwa` folgende Schritte aus:

1. Wechsel nach `/home/manuel/RollTheDice`.
2. Abbruch, falls der produktive Git-Arbeitsbaum verändert ist.
3. Kurzer Stopp des Containers für ein konsistentes `data`-Backup.
4. Sofortiger Neustart des bestehenden Containers nach dem Backup.
5. Fast-forward-only-Update von `origin/master`.
6. Prüfung der inhaltsbasierten Asset-/Service-Worker-Version.
7. Neubau und Neustart mit `docker compose up -d --build`.
8. Ausgabe des Containerstatus und Readiness-Prüfung mit Retries.
9. Nach erfolgreicher Readiness-Prüfung automatische Bereinigung auf die fünf
   neuesten `data.backup-*`-Verzeichnisse.

Das Ziel kann bei Bedarf überschrieben werden:

```bash
REMOTE=zdwa REMOTE_DIR=/home/manuel/RollTheDice BRANCH=master scripts/deploy_zdwa.sh
```

`REMOTE_DIR=auto` sucht nach einem Checkout mit dem erwarteten GitHub-Remote.
Für Produktion ist der explizite Standardpfad vorzuziehen.

## Verifikation nach dem Rollout

Ein Deployment ist erst abgeschlossen, wenn Container, lokale Anwendung und
öffentliche URL geprüft wurden:

```bash
ssh zdwa 'cd /home/manuel/RollTheDice && sudo -n docker compose ps'

ssh zdwa 'curl --retry 15 --retry-delay 2 --retry-connrefused --retry-all-errors \
  -fsS http://127.0.0.1:8000/api/health >/dev/null && echo "local app and database ready"'

curl --retry 8 --retry-delay 2 --retry-connrefused \
  -fsS https://zockdiewandan.online/ >/dev/null && echo "public app OK"
```

Der Container muss `Up (healthy)` sein. `/api/health` antwortet erst erfolgreich,
wenn der Server gestartet und das Datenbankschema vollständig migriert ist. Bei Problemen liefern die letzten Logs meist den
schnellsten Befund:

```bash
ssh zdwa 'cd /home/manuel/RollTheDice && sudo -n docker compose logs --tail=150 rollthedice'
```

Das Deployment-Skript und der Docker-Healthcheck berücksichtigen die Startzeit
mit Retries beziehungsweise einer Startperiode. Ein Fehlschlag nach Ablauf
dieser Frist ist ein echter Rollout-Fehler; dann Logs und Migrationsstand prüfen.

Bei Datenbankänderungen zusätzlich den Migrationsstand prüfen:

```bash
ssh zdwa 'cd /home/manuel/RollTheDice && sudo -n docker compose exec rollthedice alembic current'
```

## Service Worker und statische Assets

ZDWA verwendet einen Service Worker mit Cache-First-Strategie für statische
Dateien. Cache-Name und Query-Parameter werden aus dem Inhalt aller statischen
Dateien und Manifeste abgeleitet und dadurch gemeinsam aktualisiert.

Nach einer Änderung unter `app/static/` oder an einem Manifest:

1. `python3 scripts/sync_static_versions.py` oder `npm run sync:assets` ausführen.
2. Die dabei mechanisch geänderten Referenzen zusammen mit dem Asset committen.
3. Mit `python3 scripts/sync_static_versions.py --check` prüfen. Das Deployment
   bricht bei einem nicht synchronisierten Stand ab.
4. Prüfen, ob neue **öffentliche** Offline-Assets in `PRECACHE_URLS`
   aufgenommen werden müssen. Geschützte Zilch-Routen und ihre Zilch-JS/CSS-
   Bundles gehören absichtlich nicht in den globalen Precache.
5. Nach dem Deployment die öffentliche HTML-Datei und `sw.js` kontrollieren.
6. Die Seite in einem bereits verwendeten Browser nochmals laden. Der neue
   Service Worker übernimmt bestehende Tabs unter Umständen erst nach dem ersten
   Reload vollständig.

Zilch ist eine autorisierungsgebundene private Vorschau. Der Service Worker
behandelt `/zilch` und alle Unterrouten deshalb ausschließlich per Netzwerk und
precacht weder die geschützte Shell noch `zilch.js` oder `zilch.css`. Erst eine
erfolgreiche serverseitige Preview-Prüfung liefert die Shell, die ihre
versionierten Bundles bei Bedarf lädt. Dieses Verhalten darf bei PWA- oder
Cache-Änderungen nicht in eine Offline-Fallback-Ansicht abgeschwächt werden:
nach Logout oder einem Policy-Wechsel darf kein alter privater Zilch-Inhalt
sichtbar bleiben.

Beispielprüfung:

```bash
curl -fsS https://zockdiewandan.online/static/sw.js | grep CACHE_VERSION
curl -fsS https://zockdiewandan.online/spiel/test | grep 'style.css?v='
```

## Konfiguration und Geheimnisse

Die Produktionskonfiguration liegt in `/home/manuel/RollTheDice/.env` und wird nicht in
Git gespeichert.

Für HTTPS muss gesetzt sein:

```dotenv
ROLLTHEDICE_COOKIE_SECURE=1
```

Der Reverse-Proxy muss den ursprünglichen Host und das Protokoll weitergeben,
insbesondere `X-Forwarded-Host` und `X-Forwarded-Proto`. Diese Werte werden für
Origin-Prüfungen bei schreibenden Requests und WebSockets benötigt.

### Private Zilch-Vorschau

Zilch ist weder eine öffentliche Produktfunktion noch ein zweites Admin-System.
Der sichere Standard ist ausschließlich die bestehende Admin-Identität mit
normalisiertem Username `mani` und `is_admin=true`. Für einen ausdrücklich
privaten Zwei-Browser-Test kann
`ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES` eine kommagetrennte Liste normalisierter
zusätzlicher Accountnamen enthalten. Diese Nutzer erhalten nur Zilch-
Preview-Zugang und keine Adminrechte. Die Variable in der normalen Produktion
leer lassen; nie Passwörter oder andere Geheimnisse darin hinterlegen.

Die zentrale Server-Policy schützt die Zilch-Shell, alle privaten Zilch-Routen,
APIs und WebSockets. `/static/zilch.html` ist kein direkter Einstieg,
Zilch-Seiten bleiben `noindex` und gehören nicht in die Sitemap. Das Verbergen
des App-Switches im Browser ist kein Ersatz für diese Prüfung.

Compose reicht die Allowlist und die rein sichtbare CPU-Denkpause explizit in
den Container durch. Die CPU-Pause bleibt auf 0 bis 5 Sekunden begrenzt und
ändert nie Würfelwahrscheinlichkeiten oder Wertung:

```dotenv
ROLLTHEDICE_ZILCH_CPU_DELAY_SECONDS=0.55
```

### Erster Administrator

Nur für die erstmalige Erstellung eines Administrators werden folgende Werte
benötigt:

```dotenv
ROLLTHEDICE_ADMIN_USERNAME=Admin
ROLLTHEDICE_ADMIN_PASSWORD=ein-langes-temporaeres-passwort
```

Nach der erfolgreichen Kontoerstellung muss
`ROLLTHEDICE_ADMIN_PASSWORD` wieder aus `.env` entfernt und der Container neu
erstellt werden. Es existiert kein Standardpasswort.

### Registrierungsschutz

Öffentliche Selbstregistrierung sollte mit Cloudflare Turnstile geschützt sein:

```dotenv
ROLLTHEDICE_TURNSTILE_SITE_KEY=...
ROLLTHEDICE_TURNSTILE_SECRET=...
```

Beide Werte müssen gemeinsam gesetzt oder gemeinsam leer sein. Eine
Teilkonfiguration führt absichtlich zu einem Startfehler. Der Secret Key darf
niemals in HTML, JavaScript, Logs oder Dokumentation erscheinen.

Prüfung:

```bash
curl -fsS https://zockdiewandan.online/api/auth/registration-config
```

Die produktive Antwort muss bei aktivem Schutz
`"turnstile_enabled":true` enthalten und darf nur den Site Key offenlegen.

## Manuelles Deployment

Nur verwenden, wenn das Skript selbst nicht ausgeführt werden kann. Die
Reihenfolge darf wegen SQLite/WAL nicht verkürzt werden:

```bash
ssh zdwa
cd /home/manuel/RollTheDice
git status --short --branch

docker compose stop rollthedice
cp -a data "data.backup-$(date +%Y%m%d-%H%M%S)"
docker compose start rollthedice

git fetch origin master
git checkout master
git pull --ff-only origin master
python3 scripts/sync_static_versions.py --check
docker compose up -d --build

docker compose ps
curl --retry 15 --retry-delay 2 --retry-connrefused --retry-all-errors \
  -fsS http://127.0.0.1:8000/api/health >/dev/null
```

Wenn `git status --short` Änderungen zeigt, nicht weitermachen. Zuerst klären,
wem die Änderungen gehören und ob sie gesichert werden müssen.

## Rollback

### Reiner Codefehler

Wenn Daten und Schema intakt sind, wird der fehlerhafte Commit lokal mit
`git revert` rückgängig gemacht, getestet, auf `master` gepusht und mit dem
normalen Skript erneut ausgerollt. Dadurch bleibt die Historie nachvollziehbar
und das Deployment erstellt nochmals ein aktuelles Datenbackup.

Alembic-Downgrades passieren nicht automatisch. Vor einem Rollback über eine
Schemaänderung muss geprüft werden, ob der ältere Code mit dem bereits
aktualisierten Schema kompatibel ist.

Für Revision `20260903_0016` gilt zusätzlich: Ein Downgrade ist nur mit
ZDWA-only Ergebnissen möglich. Sobald eine private Zilch-Ergebniszeile oder ein
Zilch-Tombstone existiert, bricht die Migration kontrolliert ab und erhält die
Daten. In diesem Fall nicht manuell Spalten oder Ergebnisse löschen, sondern
den Code vorwärts reparieren oder ein passendes `data.backup-*` wiederherstellen.

### Beschädigte Produktionsdaten

Eine Datenwiederherstellung ist ein separater Notfallvorgang und nicht Teil eines
normalen Code-Rollbacks. Vorher müssen Ursache, gewünschter Backup-Zeitpunkt und
der akzeptierte Datenverlust seit diesem Zeitpunkt feststehen.

Grundprinzip:

1. Anwendung stoppen.
2. Den aktuellen beschädigten Stand unter einem neuen Namen erhalten.
3. Das ausgewählte `data.backup-*` als neues `data/` kopieren.
4. Anwendung starten und Migrationen, Login, Leaderboards und ein bekanntes
   Spiel prüfen.

Produktionsdaten nie ohne explizite Freigabe und einen bestätigten Backup-Pfad
wiederherstellen.

## Löschen ungültiger Spiele

Ungültige abgeschlossene Spiele werden ausschliesslich über die Administration
gelöscht. Dabei verschwinden Snapshot, Teilnehmer, Zuordnungen und
Leaderboard-Einträge; Profile und Rankings werden aus den verbleibenden
Datenbankzeilen neu berechnet.

Ein Tombstone mit Spiel-ID, Metadaten, Zeitpunkt, Administrator und Begründung
bleibt erhalten. Er verhindert, dass ein gelöschtes Legacy-Spiel beim nächsten
Start erneut importiert wird. Das letzte vollständige Wiederherstellungsmedium
ist deshalb ein Produktionsbackup von vor der Löschung.

## Serverwartung

Vor einem kontrollierten Neustart:

```bash
ssh zdwa
cd /home/manuel/RollTheDice
docker compose ps
systemctl is-enabled docker
```

Nach dem Neustart:

```bash
ssh zdwa
cd /home/manuel/RollTheDice
docker compose ps
curl --retry 12 --retry-delay 2 --retry-connrefused \
  -fsS http://127.0.0.1:8000/ >/dev/null && echo "local app OK"
```

Breite Betriebssystem-Upgrades nicht mit einem Anwendungsdeployment verbinden.
Vor umfangreichen Serveränderungen nach Möglichkeit zusätzlich einen
IONOS-Snapshot erstellen.
