# ZDWA Deployment und Betrieb

Dieses Dokument beschreibt den produktiven Betrieb von **ZDWA – Zock die Wand
an**. Das Repository heisst intern weiterhin `RollTheDice`.

## Produktionsumgebung

| Bereich | Wert |
| --- | --- |
| Öffentliche URL | `https://zockdiewandan.online/` |
| SSH-Ziel | `ssh zdwa` |
| Arbeitsverzeichnis | `/root/RollTheDice` |
| Git-Branch | `master` |
| Container/Service | `rollthedice` |
| Lokaler Container-Port | `8000` |
| Persistente Daten | `/root/RollTheDice/data` |

Die Anwendung läuft mit Docker Compose hinter einem HTTPS-Reverse-Proxy. Das
Verzeichnis `./data` wird als `/app/data` in den Container eingebunden.

Die SQLite-Datenbank `data/rollthedice.sqlite3` enthält Benutzerkonten,
Sessions, Schutzereignisse, vollständige Spiele und Zuordnungen. Die vorhandenen
JSON-Dateien enthalten weiterhin Leaderboards und ältere Statistikdaten. Beide
Speicherarten gehören zu den Produktionsdaten.

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
/root/RollTheDice/data.backup-YYYYMMDD-HHMMSS
```

Backups werden nicht automatisch gelöscht. Ihre Aufbewahrung und eine allfällige
Auslagerung auf einen zweiten Speicher müssen bewusst organisiert werden.

## Voraussetzungen

Vor einem regulären Rollout müssen folgende Bedingungen erfüllt sein:

- Die Änderung ist auf `master` committed und zu `origin/master` gepusht.
- Relevante Python- und Browsertests sind erfolgreich.
- Der lokale und der produktive Git-Arbeitsbaum enthalten keine unbekannten
  Änderungen.
- Datenmigrationen besitzen eine Alembic-Migration. Die Anwendung aktualisiert
  das Schema beim Start automatisch bis `head`.
- Änderungen an statischen Assets berücksichtigen die Cache-Regeln weiter unten.

Empfohlene lokale Prüfung:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
npm run test:browser
git diff --check
git status --short
```

## Standard-Deployment

Der reguläre und bevorzugte Weg ist:

```bash
scripts/deploy_zdwa.sh
```

Das Skript führt auf `ssh zdwa` folgende Schritte aus:

1. Wechsel nach `/root/RollTheDice`.
2. Abbruch, falls der produktive Git-Arbeitsbaum verändert ist.
3. Kurzer Stopp des Containers für ein konsistentes `data`-Backup.
4. Sofortiger Neustart des bestehenden Containers nach dem Backup.
5. Fast-forward-only-Update von `origin/master`.
6. Neubau und Neustart mit `docker compose up -d --build`.
7. Ausgabe des Containerstatus und einmaliger lokaler HTTP-Check.

Das Ziel kann bei Bedarf überschrieben werden:

```bash
REMOTE=zdwa REMOTE_DIR=/root/RollTheDice BRANCH=master scripts/deploy_zdwa.sh
```

`REMOTE_DIR=auto` sucht nach einem Checkout mit dem erwarteten GitHub-Remote.
Für Produktion ist der explizite Standardpfad vorzuziehen.

## Verifikation nach dem Rollout

Ein Deployment ist erst abgeschlossen, wenn Container, lokale Anwendung und
öffentliche URL geprüft wurden:

```bash
ssh zdwa 'cd /root/RollTheDice && docker compose ps'

ssh zdwa 'curl --retry 12 --retry-delay 2 --retry-connrefused \
  -fsS http://127.0.0.1:8000/ >/dev/null && echo "local app OK"'

curl --retry 8 --retry-delay 2 --retry-connrefused \
  -fsS https://zockdiewandan.online/ >/dev/null && echo "public app OK"
```

Der Container muss `Up` sein. Bei Problemen liefern die letzten Logs meist den
schnellsten Befund:

```bash
ssh zdwa 'cd /root/RollTheDice && docker compose logs --tail=150 rollthedice'
```

Der einmalige Health-Check am Ende des Deployment-Skripts kann direkt nach dem
Containerstart mit `Empty reply from server` fehlschlagen, obwohl Uvicorn wenige
Sekunden später bereit ist. In diesem Fall zuerst den Check mit den obigen
Retries wiederholen und die Logs prüfen. Ein fehlgeschlagener Erst-Check allein
ist noch kein Grund für eine Datenwiederherstellung.

Bei Datenbankänderungen zusätzlich den Migrationsstand prüfen:

```bash
ssh zdwa 'cd /root/RollTheDice && docker compose exec rollthedice alembic current'
```

## Service Worker und statische Assets

ZDWA verwendet einen Service Worker mit Cache-First-Strategie für statische
Dateien. Ohne neue Versionsnummer können Browser nach einem Deployment weiterhin
alte CSS- oder JavaScript-Dateien verwenden.

Bei einer Änderung an einem gecachten Asset:

1. `CACHE_VERSION` in `app/static/sw.js` erhöhen.
2. Den Versionsparameter des geänderten Imports erhöhen, beispielsweise
   `style.css?v=82` zu `style.css?v=83`.
3. Prüfen, ob das Asset in `PRECACHE_URLS` enthalten sein muss.
4. Nach dem Deployment die öffentliche HTML-Datei, das Asset und `sw.js`
   kontrollieren.
5. Die Seite in einem bereits verwendeten Browser nochmals laden. Der neue
   Service Worker übernimmt bestehende Tabs unter Umständen erst nach dem ersten
   Reload vollständig.

Beispielprüfung:

```bash
curl -fsS https://zockdiewandan.online/static/sw.js | grep CACHE_VERSION
curl -fsS 'https://zockdiewandan.online/static/style.css?v=VERSION' >/dev/null
```

## Konfiguration und Geheimnisse

Die Produktionskonfiguration liegt in `/root/RollTheDice/.env` und wird nicht in
Git gespeichert.

Für HTTPS muss gesetzt sein:

```dotenv
ROLLTHEDICE_COOKIE_SECURE=1
```

Der Reverse-Proxy muss den ursprünglichen Host und das Protokoll weitergeben,
insbesondere `X-Forwarded-Host` und `X-Forwarded-Proto`. Diese Werte werden für
Origin-Prüfungen bei schreibenden Requests und WebSockets benötigt.

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
curl --retry 12 --retry-delay 2 --retry-connrefused \
  -fsS http://127.0.0.1:8000/ >/dev/null
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
cd /root/RollTheDice
docker compose ps
systemctl is-enabled docker
```

Nach dem Neustart:

```bash
ssh zdwa
cd /root/RollTheDice
docker compose ps
curl --retry 12 --retry-delay 2 --retry-connrefused \
  -fsS http://127.0.0.1:8000/ >/dev/null && echo "local app OK"
```

Breite Betriebssystem-Upgrades nicht mit einem Anwendungsdeployment verbinden.
Vor umfangreichen Serveränderungen nach Möglichkeit zusätzlich einen
IONOS-Snapshot erstellen.
