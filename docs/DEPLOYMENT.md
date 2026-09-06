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
- Revision `20260903_0017` legt die getrennte Zilch-Achievement-Historie an;
  ihr Downgrade entfernt Auswertungen, Nachweise, Freischaltungen und
  Zustellstatus. Revision `20260904_0018` verknüpft neu verdiente
  ZDWA-Achievements mit ihrem Ursprungsspiel; ihr Downgrade entfernt diese
  Verknüpfung. Revision `20260904_0019` ergänzt das getrennte Zilch-Punkte- und
  Rangsystem sowie den monotonen Community-Meilensteinzähler und den dauerhaften
  Teilnehmer-Ledger. Das Upgrade ignoriert Zilch-Tombstones, rekonstruiert schon
  erreichte Schwellen exakt aus registrierter Evidence und markiert einen
  einmaligen Catalog-Resync für den Anwendungsstart. Dessen interner
  Version-3-Lauf reichert nur
  abgeschlossene, nicht gelöschte Registrierungen aus ihrem exakt per Spiel-ID
  geladenen typed Quellergebnis an; er enumeriert die allgemeine
  `CompletedGame`-Historie nicht und rollt bei Inkonsistenzen atomar zurück.
  Ihr Downgrade entfernt
  Zilch-Community-Zähler, Teilnehmer, Empfänger und deren Freischaltungen.
  Nach produktiven Freischaltungen daher bevorzugt den Code
  vorwärts reparieren. Ist ein Schema-Rückgang unvermeidbar, zuerst den
  bestätigten `data.backup-*`-Stand außerhalb des laufenden `data/` bewahren.
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
her. Sobald die versionierte Datei die Produkt-Subdomains enthält, verweigert
dieses allgemeine Installationsskript den Lauf, bis das Zertifikat beide Namen
abdeckt. Für die erste Umstellung deshalb ausschließlich den kontrollierten
`scripts/activate_subdomains.sh`-Ablauf weiter unten verwenden. Diese
Systemkonfiguration wird nicht bei jedem App-Deployment ungeprüft überschrieben.

Bei einem manuellen Aufruf werden alte Datenbackups zunächst nur aufgelistet:

```bash
cd /home/manuel/RollTheDice
KEEP=5 scripts/prune_data_backups.sh
```

Nach Kontrolle der Liste kann dieselbe Auswahl mit `APPLY=1` gelöscht werden.

## Subdomains kontrolliert aktivieren

Die beiden zusätzlichen Produktnamen zeigen auf dieselbe laufende Anwendung und
dieselbe persistente Datenbank:

| Name | Aufgabe beim Start der Umstellung |
| --- | --- |
| `zockdiewandan.online` | Bleibt als bestehende ZDWA-, PWA- und Anmelde-Origin erreichbar. |
| `www.zockdiewandan.online` | Bleibt als bestehender Alias erreichbar. |
| `zdwa.zockdiewandan.online` | Redirect-only Alias auf die bestehende ZDWA-Apex-Origin. |
| `zilch.zockdiewandan.online` | Eigener öffentlicher Einstieg in Zilch; Kontofunktionen bleiben separat geschützt. |

Die Aktivierung verschiebt keine Daten und startet weder Docker noch Uvicorn
neu. Nginx reicht Apex, `www` und Zilch an denselben einzelnen Container weiter;
der `zdwa`-Alias antwortet mit 308 auf die Apex-Origin. Das Bind-Mount
`/home/manuel/RollTheDice/data:/app/data` bleibt damit unverändert;
Konten, Sessions, aktive Spiele, Resultate, Achievements und Leaderboards liegen
weiterhin im bestehenden Produktionsbestand.

Für die Host-Aufteilung gibt es keine neue Alembic-Revision und keine zweite
Datenbank. Das normale App-Deployment prüft das bestehende Schema wie bisher
idempotent; die anschließende Nginx-/TLS-Aktivierung öffnet oder verändert die
SQLite-Dateien überhaupt nicht.

### Verbindliche Freigabegates

Vor der Aktivierung müssen alle folgenden Punkte erfüllt sein:

1. Auf allen autoritativen Nameservern liefern `zdwa` und `zilch`
   ausschließlich den A-Record `217.154.16.72` mit TTL 3600. Es darf für beide
   Namen kein AAAA-Record mehr existieren. Bei einem Nameserver-Wechsel zählt
   die tatsächlich delegierte Zone, nicht die Ansicht beim alten oder neuen
   Anbieter.
2. Auch die öffentlichen Resolver `1.1.1.1`, `8.8.8.8` und `9.9.9.9` liefern
   den neuen A-Record und keinen AAAA-Record. Wegen vorheriger Cache-Einträge
   erst nach Ablauf der alten TTL aktivieren; eine korrekte Provider-Übersicht
   allein reicht dafür nicht.
3. Die Subdomain-Version der Anwendung wurde mit dem normalen Deploy-Skript
   ausgerollt und der Container ist gesund. Dieses App-Deployment erstellt das
   vorgeschriebene konsistente `data.backup-*`. Für die anschließende reine
   Nginx-/Zertifikatsaktivierung ist kein weiterer Live-Copy der SQLite-WAL-
   Dateien zulässig oder erforderlich.
4. Der produktive Container erhält die gemeinsame Cookie-Domain
   `zockdiewandan.online`. Der bestehende Host-Cookie bleibt während der
   Migration als Rückfallpfad erhalten. Origin- und CSRF-Prüfungen bleiben pro
   tatsächlichem Host aktiv. Ein Domain-Cookie wird vom Browser an jede
   Subdomain unterhalb von `zockdiewandan.online` gesendet. Deshalb müssen vor
   der Freigabe alle aktiven DNS-Namen dieser Zone inventarisiert werden: Kein
   Host darf auf fremdes Hosting, einen nicht mehr kontrollierten Dienst oder
   einen übernehmbaren CNAME zeigen. Neue Subdomains dürfen künftig nur auf
   vertrauenswürdiger eigener Infrastruktur betrieben werden. Unbekannte
   HTTPS-Hostnamen weist die mitgelieferte Nginx-Konfiguration bereits beim
   TLS-Handshake ab.
5. Uvicorn vertraut als Forwarded-Header-Quelle exakt dem aktuell beobachteten
   Docker-Gateway, nicht beliebigen Absendern. Das Gateway lässt sich lesen mit:

   ```bash
   sudo -n docker inspect rollthedice \
     --format '{{range .NetworkSettings.Networks}}{{println .Gateway}}{{end}}'
   ```

   Auf der aktuellen Produktion ist dies `172.18.0.1`. Der Wert muss als
   `FORWARDED_ALLOW_IPS` im Container ankommen. Port 8000 bleibt durch die
   produktive, absichtlich nicht eingecheckte `docker-compose.override.yml`
   ausschließlich an `127.0.0.1` gebunden. Diese Override-Datei und ihre
   Ressourcen-/Capability-Härtung niemals durch die versionierte Compose-Datei
   ersetzen oder löschen.
6. Turnstile ist auf Produktion aktiv. Registrierung und Login für Zilch laufen
   absichtlich über die bekannte Apex-Origin; der `zdwa`-Alias leitet ebenfalls
   dorthin weiter. Für diese Umstellung muss daher kein zusätzliches Widget auf
   Zilch gerendert werden. Vor `APPLY=1` muss trotzdem bestätigt werden, dass
   die bestehende Widget-Hostname-Policy Apex (und `www`, falls dort weiterhin
   Registrierung angeboten wird) abdeckt. Das Aktivierungsskript kann diese
   externe Einstellung nicht selbst lesen und verlangt deshalb die bewusste
   Bestätigung `TURNSTILE_HOSTNAMES_CONFIRMED=1`.
7. Zilch läuft in Produktion ausdrücklich mit
   `ROLLTHEDICE_ZILCH_ACCESS_MODE=public`. Damit sind Gäste und aktive Konten
   zugelassen; Gäste bleiben ohne konto-gebundene Historie, Statistik, Awards
   und Ranglistenposition. Das Aktivierungsskript muss denselben erwarteten
   Modus prüfen. Der Modus `preview` und seine optionale Allowlist sind nur ein
   fail-closed Rollback für einen bewusst eingeschränkten Betrieb, nicht der
   Produktionsstandard.

### Cloudflare: schneller Start zunächst DNS-only

Während des laufenden Nameserver-Wechsels werden alle bestehenden A-, MX-,
SPF-, DKIM-, DMARC-, CAA- und sonstigen TXT-Einträge unverändert nach Cloudflare
übernommen. Für die erste Subdomain-Aktivierung bleiben Apex, `www`, `zdwa` und
`zilch` in Cloudflare auf **DNS only** (graue Wolke). Dadurch bleibt
`217.154.16.72` direkt sichtbar, der bestehende Nginx-/Certbot-Ablauf funktioniert
unverändert und Cloudflare greift weder in Cookies, WebSockets noch
Cache-Control ein. Das Aktivierungsskript erwartet absichtlich diese direkte
A-Adresse und würde einen bereits orange geschalteten Proxy ablehnen.

DNS-only kann unmittelbar nach erfolgreicher NS-Delegation und konsistenten
Antworten der öffentlichen Resolver ausgerollt werden. Der orange Cloudflare-
Proxy ist ein separates Folgeinkrement: davor müssen mindestens Full (strict),
WebSocket-Unterstützung, die vertrauenswürdige Wiederherstellung der echten
Client-IP sowie Cache-Bypässe für `/api/`, Auth-, WebSocket- und personalisierte
HTML-Routen geprüft sein. Versionierte statische Assets dürfen weiterhin gemäß
den vom Origin gelieferten Cache-Headern zwischengespeichert werden.

### PWA, laufende Spiele und bestehende Logins

Service Worker, Cache Storage, Local Storage und Session Storage sind an eine
Browser-Origin gebunden. Eine installierte PWA von
`https://zockdiewandan.online` kann deshalb nicht automatisch auf eine
Subdomain umziehen. Die Apex-Origin bleibt erreichbar und wird während dieser
Umstellung nicht umgeleitet; bestehende PWA-Installationen, offene Tabs,
Host-Cookies und lokale Resume-Tokens funktionieren dort weiter.

Die Zilch-Subdomain liefert weiterhin weder den root-gescopten ZDWA-Service-
Worker noch dessen Manifest aus. Stattdessen hat sie mit
`/zilch-manifest.webmanifest` und `/zilch-sw.js` eine eigene, isolierte PWA.
Der Zilch-Worker ist bewusst network-only und verwendet keinen Cache Storage:
So kann weder ein gemeinsamer noch ein Zilch-spezifischer PWA-Cache eine
private Sitzung oder Spielansicht wiederherstellen. API-Antworten bleiben
`no-store`; Räume, Konto, Historie, persönliche Statistik, Ergebnisse und
Spielerprofile erhalten `X-Robots-Tag: noindex, nofollow`. Nur die öffentliche
Zilch-Lobby `/` und `/regeln` sind auf der Zilch-Origin indexierbar, mit
eigenem Canonical, `robots.txt` und Sitemap. Der Installationshinweis wird bei
einem Schließen sieben Tage lang unterdrückt, aber bei einer neuen Asset-Version
sofort erneut angeboten; ein Worker-Update zeigt einen separaten
Aktualisieren-Hinweis.

Der Wechsel bleibt auch aus einer installierten Zilch-PWA heraus im
Standalone-Fenster: Er führt auf den privaten, `noindex` gesetzten
same-origin-Pfad `/zdwa`. Dieser finite Bridge-Pfad liefert nur ZDWA-Dokumente
und behält den Zilch-Manifest-/Worker-Kontext; er ist kein weiterer öffentlicher
Einstieg und darf weder in Sitemap noch in Canonicals aufgenommen werden.
Normale Browser wechseln weiterhin zur kanonischen ZDWA-Apex-Origin.

Die gemeinsame, `Secure`, `HttpOnly` und `SameSite=Lax` gesetzte Session wird
beim kontrollierten Handoff aus einem gültigen Apex-Login übernommen. Nutzer,
die die Apex-Seite noch nicht mit der neuen Version besucht haben, werden zur
Anmeldung beziehungsweise Promotion über die bekannte Origin geführt. Die
SQLite-Sitzung selbst bleibt dieselbe. Anonyme Spieler- und Resume-Tokens im
Local Storage lassen sich dagegen nicht sicher zwischen Origins kopieren;
deshalb darf die Apex-Origin während laufender Partien nicht erzwungen auf eine
Subdomain umgeleitet werden.

Ein reiner `nginx reload` ist graceful und lässt bestehende Worker und
Verbindungen auslaufen. Das vorausgehende App-Deployment ersetzt dagegen den
einzelnen Uvicorn-Container kurz: WebSockets verbinden sich neu, persistierte
aktive Spiele werden aus SQLite geladen und pausieren bis zur Rückkehr der
Teilnehmer. Diesen Schritt möglichst in ein ruhiges Zeitfenster legen. Die
nachfolgende Subdomain-/Zertifikatsaktivierung verursacht keinen weiteren
Container- oder Datenbankneustart.

### Dry Run und Aktivierung

`scripts/activate_subdomains.sh` arbeitet nur auf dem Produktionshost und ist
standardmäßig strikt nicht schreibend. Der Dry Run validiert DNS und TTL,
Container-Health, das persistente Bind-Mount, Loopback-Portbindung, den exakt
vertrauten Proxy, Cookie-Domain, Zilch-Modus, PWA-Isolation, Nginx-Syntax und die
ausstehende Konfigurationsdifferenz. Zusätzlich muss ein aktiver
`certbot.timer` oder der Certbot-Cronjob vorhanden sein:

```bash
ssh zdwa 'cd /home/manuel/RollTheDice && scripts/activate_subdomains.sh'
```

Erst nach manueller Kontrolle der vollständigen Cookie-Trust-Zone und der
Turnstile-Hostname-Policy darf dieselbe geprüfte Version schreiben:

```bash
ssh zdwa 'cd /home/manuel/RollTheDice && \
  COOKIE_TRUST_ZONE_CONFIRMED=1 \
  TURNSTILE_HOSTNAMES_CONFIRMED=1 \
  APPLY=1 scripts/activate_subdomains.sh'
```

Das Skript führt in dieser Reihenfolge aus:

1. Zeitgestempelte Sicherung der aktiven Nginx-Site im selben Verzeichnis.
2. Installation der versionierten Konfiguration, `nginx -t` und graceful
   Reload. Bei einem Fehler wird die Sicherung automatisch zurückgespielt.
3. Erweiterung der bestehenden Certbot-Lineage `zockdiewandan.online` um alle
   vier SAN-Namen mit `certbot certonly --nginx --expand`. Der bestehende
   Zertifikatspfad in Nginx ändert sich dadurch nicht.
4. Erneutes `nginx -t`, Reload sowie lokale SNI-Prüfung von Zertifikat,
   `/api/health` und allen vorgeschriebenen Security-Headern für jeden Host.
5. Einen echten Certbot-Erneuerungstest mit
   `certbot renew --dry-run --cert-name zockdiewandan.online`. Erst wenn auch
   dieser erfolgreich ist, meldet das Skript die Aktivierung als abgeschlossen.

Die serverlokale CSP steht im selben Nginx-Kontext wie HSTS,
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` und
`Permissions-Policy`. Das ist notwendig, weil ein eigenes `add_header` in
einem Server-Block die gleichnamige Vererbung aus `conf.d/security.conf`
vollständig beendet.

Nach erfolgreicher Aktivierung zusätzlich von einem externen Rechner prüfen:

```bash
for host_name in zockdiewandan.online www.zockdiewandan.online \
  zilch.zockdiewandan.online; do
  curl -fsS "https://${host_name}/api/health" >/dev/null
  curl -sS -D - -o /dev/null "https://${host_name}/api/health"
done

curl -sS -D - -o /dev/null \
  'https://zdwa.zockdiewandan.online/api/health?alias-check=1'
# Erwartet: 308 und Location:
# https://zockdiewandan.online/api/health?alias-check=1

openssl s_client -connect zdwa.zockdiewandan.online:443 \
  -servername zdwa.zockdiewandan.online </dev/null 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
```

Danach in echten Browsern mindestens Anmeldung, Abmeldung, ZDWA-Erstellung,
Zilch-Handoff, HTTP-API, WebSocket-Reconnect und die bereits installierte
Apex-PWA testen. Die Turnstile-Registrierung nur mit einem bewusst vorgesehenen
Testkonto prüfen.

### Infrastruktur-Rollback

Ein erfolgreicher Lauf gibt den exakten Pfad seiner Nginx-Sicherung und einen
fertigen Rollback-Befehl aus. Vor dem Rückweg wieder trocken prüfen und genau
diesen Pfad einsetzen:

```bash
ssh zdwa 'cd /home/manuel/RollTheDice && \
  ACTION=rollback \
  BACKUP=/etc/nginx/sites-available/rollthedice.backup-subdomains-YYYYMMDD-HHMMSS \
  scripts/activate_subdomains.sh'
```

Erst danach mit `APPLY=1` ausführen. Das Skript legt vor dem Rückweg nochmals
eine Sicherung der aktuellen Site an, prüft Nginx und lädt ihn graceful neu.
Die um die beiden SANs erweiterte Certbot-Lineage darf bestehen bleiben: Sie ist
weiterhin für Apex und `www` gültig und verändert weder Routing noch Daten. Ein
Nginx-Rollback darf niemals mit einem Datenbank-Rollback, `docker compose down
-v`, dem Löschen der produktiven Override-Datei oder dem Entfernen von
`data/` verbunden werden.

Bleibt der Fehler in der Anwendung statt in Nginx oder TLS, gilt zusätzlich der
normale Code-Rollback weiter unten. Wegen bestehender Apex-Host-Cookies bleibt
die Anmeldung dort rückfallfähig; neu auf einer Subdomain begonnene Browser-
Sessions müssen nach einem vollständigen Code-Rollback gegebenenfalls erneut
auf Apex angemeldet werden. Persistierte Konten und Spielergebnisse bleiben
erhalten.

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
Dateien; Zilch verwendet einen separaten network-only Worker. Cache-Name und
Query-Parameter werden aus dem Inhalt aller statischen Dateien und Manifeste
abgeleitet und dadurch gemeinsam aktualisiert.

Nach einer Änderung unter `app/static/` oder an einem Manifest:

1. `python3 scripts/sync_static_versions.py` oder `npm run sync:assets` ausführen.
2. Die dabei mechanisch geänderten Referenzen zusammen mit dem Asset committen.
3. Mit `python3 scripts/sync_static_versions.py --check` prüfen. Das Deployment
   bricht bei einem nicht synchronisierten Stand ab.
4. Prüfen, ob neue **öffentliche** Offline-Assets in `PRECACHE_URLS`
   aufgenommen werden müssen. Geschützte Zilch-Routen und ihre Zilch-JS/CSS-
   Bundles gehören absichtlich nicht in den globalen Precache.
5. Nach dem Deployment die öffentliche HTML-Datei sowie `sw.js` und auf der
   Zilch-Origin `zilch-sw.js` kontrollieren.
6. Die Seite in einem bereits verwendeten Browser nochmals laden. Der neue
   Service Worker übernimmt bestehende Tabs unter Umständen erst nach dem ersten
   Reload vollständig.

Zilch ist eine autorisierungsgebundene Public Beta. Der Service Worker
behandelt `/zilch` und alle Unterrouten deshalb ausschließlich per Netzwerk und
precacht weder die geschützte Shell noch `zilch.js` oder `zilch.css`. Erst eine
erfolgreiche serverseitige Konto- und Zugriffsprüfung liefert die Shell, die ihre
versionierten Bundles bei Bedarf lädt. Dieses Verhalten darf bei PWA- oder
Cache-Änderungen nicht in eine Offline-Fallback-Ansicht abgeschwächt werden:
nach Logout oder einem Policy-Wechsel darf kein alter persönlicher Zilch-Inhalt
sichtbar bleiben.

Beispielprüfung:

```bash
curl -fsS https://zockdiewandan.online/static/sw.js | grep CACHE_VERSION
curl -fsS https://zockdiewandan.online/spiel/test | grep 'style.css?v='
curl -fsS https://zilch.zockdiewandan.online/zilch-sw.js | grep CACHE_VERSION
```

## Konfiguration und Geheimnisse

Die Produktionskonfiguration liegt in `/home/manuel/RollTheDice/.env` und wird nicht in
Git gespeichert.

Für HTTPS muss gesetzt sein:

```dotenv
ROLLTHEDICE_COOKIE_SECURE=1
```

Vor dem App-Deployment für die Produkt-Hosts müssen zusätzlich diese
nicht-geheimen Werte in derselben Produktionsdatei stehen:

```dotenv
ROLLTHEDICE_COOKIE_DOMAIN=zockdiewandan.online
ROLLTHEDICE_SITE_ORIGIN=https://zockdiewandan.online
ROLLTHEDICE_ZILCH_ORIGIN=https://zilch.zockdiewandan.online
FORWARDED_ALLOW_IPS=172.18.0.1
```

`FORWARDED_ALLOW_IPS` muss stets dem unmittelbar zuvor per Docker-Inspect
ermittelten Bridge-Gateway entsprechen. Das Aktivierungsskript verweigert den
Lauf, wenn einer dieser Werte fehlt oder abweicht.

Der Reverse-Proxy muss den ursprünglichen Host und das Protokoll weitergeben,
insbesondere `X-Forwarded-Host` und `X-Forwarded-Proto`. Diese Werte werden für
Origin-Prüfungen bei schreibenden Requests und WebSockets benötigt.

### Öffentliches Zilch

Zilch ist für Gäste und alle aktiven, angemeldeten Konten verfügbar und bleibt
vom Admin-System getrennt. Produktion setzt zwingend:

```dotenv
ROLLTHEDICE_ZILCH_ACCESS_MODE=public
```

Dieser Wert erlaubt Gastspiel ohne konto-gebundene Persistenz: Session, CSRF,
WebSocket-Origin-Prüfung, Raumcodes und alle übrigen Zilch-Regeln bleiben aktiv.
Die persönliche Historie listet nur Partien des angemeldeten Kontos;
Ergebnisdetails sind auf verknüpfte Konto-Teilnehmer beschränkt und antworten
anderen Konten mit einem nicht unterscheidbaren 404. Gast-Solo/CPU-Hosts erhalten
eine lokale Zufallsberechtigung, deren Hash allein dauerhaft gespeichert wird.
HTTP-Projektionen geben keine internen `user_id`-Werte aus.

Der Modus `preview` ist ausschließlich ein fail-closed Betriebsrollback. Nur in
diesem Modus kann `ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES` eine kommagetrennte Liste
normalisierter zusätzlicher Testkonten enthalten. Das verleiht keine
Adminrechte; `mani` bleibt in diesem Rückfallmodus zusätzlich an die Adminrolle
gebunden. Die Allowlist in normaler Produktion leer lassen und nie Passwörter
oder andere Geheimnisse darin hinterlegen.

Die zentrale Server-Policy schützt alle personalisierten Zilch-Routen, APIs
und WebSockets. `/static/zilch.html` ist kein direkter Einstieg. Die öffentliche
Lobby `/` und `/regeln` der Zilch-Origin sind die einzigen registrierten
SEO-Dokumente; Räume, Konto, Historie, persönliche Statistik, Ergebnisse,
Bestenlisten-Ansichten und Spielerprofile bleiben `noindex`. Das Verbergen des
App-Switches im Browser ist kein Ersatz für diese Prüfung.

Compose reicht die Allowlist und die rein sichtbare CPU-Denkpause explizit in
den Container durch. Die CPU-Pause bleibt auf 0 bis 5 Sekunden begrenzt und
ändert nie Würfelwahrscheinlichkeiten oder Wertung:

```dotenv
ROLLTHEDICE_ZILCH_CPU_DELAY_SECONDS=0.9
```

Gäste dürfen Zilch spielen, aber keine konto-gebundene Historie, persönliche
Statistik, Awards oder Ranglistenposition erhalten. Die SEO-Grenze ist deshalb
nicht die Anmeldung, sondern die Art der Seite: nur stabile öffentliche
Einführungs- und Regelseiten stehen in `app/site_seo.py`; alle persönlichen,
kurzlebigen oder dynamischen Ansichten bleiben `noindex`.

### Web Push

Wartende öffentliche Räume können per bewusstem Klick andere Konten einladen.
Empfang ist standardmäßig aus und benötigt zusätzlich die Browser-Berechtigung.
Der persistierte Konto-Cooldown erlaubt einen Versuch pro 60 Sekunden über beide
Spiele hinweg, zusätzlich gilt pro Raum ein Versandabstand von zehn Minuten.
Revision `20260906_0025` speichert den Konto-Cooldown; `0024` enthält die
Abonnements und Moderationsflags, `0022`/`0023` die Chat-Einstellungen und die
nach drei Tagen automatisch gelöschte, empfängergebundene Lobby-Historie.

Diese drei Werte müssen gemeinsam gesetzt oder gemeinsam leer bleiben:

```dotenv
ROLLTHEDICE_WEB_PUSH_VAPID_PUBLIC_KEY=<Base64url-P-256-Public-Key>
ROLLTHEDICE_WEB_PUSH_VAPID_PRIVATE_KEY=<Base64url-DER-Private-Key>
ROLLTHEDICE_WEB_PUSH_VAPID_SUBJECT=https://zockdiewandan.online
```

Auf einem Host mit Python und `cryptography` erzeugt der folgende einmalige
Aufruf die Schlüssel direkt in der vorhandenen `.env` und sichert den Altstand
mit Dateimodus 0600, ohne Schlüssel auszugeben:

```bash
python3 scripts/configure_web_push.py --env-file .env \
  --subject https://zockdiewandan.online
```

Vollständige bestehende Konfiguration bleibt unverändert; eine Teilkonfiguration
wird nicht überschrieben. Anschließend regulär deployen, damit Compose die Werte
übernimmt. Schlüssel geschützt in `.env` ablegen und nie bei regulären
Rollouts rotieren: bestehende Abonnements sind an den Public Key gebunden.
Private Keys und Push-Endpoints gehören weder in Git noch in Logs. Vor Änderungen
an `.env` eine nur für den Besitzer lesbare Kopie sichern. Compose übergibt alle
drei Werte. Die Erreichbarkeit der Push-Dienste von Apple, Google und Mozilla
muss für ausgehende HTTPS-Anfragen gewährleistet sein. Abgelaufene Endpoints
(HTTP 404/410) werden automatisch entfernt; Opt-out löscht alle Abonnements
des Kontos. Ein Versandversuch bestätigt nur die Annahme durch den Push-Dienst,
nicht die Anzeige auf einem Gerät. Keine Testeinladung an echte Konten senden.

Tägliche Spielerinnerungen (Revisionen `20260906_0026` und `20260906_0027`)
sind separat und standardmäßig **nicht** aktiviert. Der Lifespan-Scheduler
prüft minütlich zwischen **17:00 und 21:00 Europe/Zurich**. Ein stabiler Hash
aus Konto-ID und Datum bestimmt eine neue pseudozufällige Minute pro Tag;
Neustarts und mehrere Scheduler ändern den Termin nicht. Verpasste Termine
können noch innerhalb des Fensters bedient werden, niemals ab 21 Uhr oder am
nächsten Tag. Die frühere feste Stundenkonfiguration entfällt.

Erinnert wird nur, wenn das Konto an diesem Schweizer Kalendertag in **keinem**
der beiden Spiele gespielt hat. Akzeptierte menschliche Würfe (einschließlich
Zilch-Entscheidungswurf) und Wertungen speichern dafür nur das letzte Spieldatum.
Login, Beitritt, Chat, Zuschauen, CPU-Aktionen und abgewiesene Befehle zählen
nicht. Vorhandene abgeschlossene Partien werden zusätzlich abgefragt, damit auch
vor diesem Rollout beendete Spiele desselben Tages berücksichtigt werden.

Vor dem Versand werden Tagesreservierung und Textzähler atomar persistiert.
Neustarts, Versandfehler und Opt-in-Wechsel erzeugen keinen zweiten Versuch am
selben Tag. Opt-in, Kontoaktivierung, Abonnement und Spielaktivität werden vor
jedem weiteren Gerät erneut geprüft. Beim Push-Dienst beträgt die Lebensdauer
höchstens eine Stunde, begrenzt auf die verbleibende Zeit bis 21 Uhr; wann ein
Betriebssystem eine bereits zugestellte Meldung anzeigt, ist nicht steuerbar.
Der Container benötigt die Zeitzonendaten für `Europe/Zurich` inklusive Sommerzeit.

Je Spiel rotieren 32 DE/EN-Textpaare anhand tatsächlicher Versandversuche, nicht
verstrichener Tage. Bei unveränderten Produkt-Abonnements wiederholt sich ein
Text erst nach einem vollständigen Umlauf. Sind beide Spiele angemeldet,
wechseln sie sich ab; nur die Geräte des ausgewählten Spiels erhalten die
Erinnerung. Manuelle Mitspieler-Einladungen bleiben unabhängig von Uhrzeit und
Spielaktivität, mit ihren bestehenden separaten Flood-Limits.

Es gibt keinen öffentlichen Trigger-Endpunkt für den Scheduler. In Tests Versand
und Uhrzeit mocken, niemals einen Test-Batch gegen produktive Empfänger starten.

### Versionshinweise nach Deployments

Revision `20260906_0028` ergänzt separat aktivierbare Versionshinweise
(`release_push_enabled`, Standard **aus**) und eine private Absender-Allowlist.
Bestehende Push-Einwilligungen werden nicht auf die neue Kategorie erweitert.

`scripts/deploy_zdwa.sh` veröffentlicht erst **nach erfolgreichem Build und
Healthcheck** die neue Git-Revision in einer dauerhaften Outbox. Ein
Serverneustart allein veröffentlicht nichts. Ein Scheduler leert alle 30 Sekunden
bis zu 50 vorgemerkte Konten. Ein Konto wird vor jedem externen Versand atomar
für die Revision reserviert: erneute Deployments, parallele Scheduler und
Neustarts lösen keinen zweiten Versuch aus. Auch bei Versandfehlern wird diese
Reservierung nicht zurückgesetzt; Push bleibt eine Best-Effort-Zustellung.

Für sichtbare Änderungen eine **neue, geprüfte** Meldung in
`app/release-notice.json` committen, z. B.:

```json
{
  "kind": "usability",
  "games": ["zdwa", "zilch"],
  "summary_de": "Jetzt neu: Chat in der Lobby",
  "summary_en": "New: lobby chat"
}
```

Die Kurztexte müssen beide vorhanden sein, dürfen keine Zeilenumbrüche enthalten
und höchstens 140 Zeichen lang sein. `games` grenzt ein produktspezifisches
Release ein. Die Revision liefert Git; sie gehört nicht in die JSON-Datei.
Frontend-, HTML-, CSS- oder Manifest-Änderungen ohne aktualisierte Usability-Notiz
stoppen den Deploy vor dem Build. Bei reinen Backend-Änderungen ohne neue Notiz
wird automatisch **„Verbesserungen an der Stabilität“ / „Stability improvements“**
verwendet, niemals ein alter Feature-Text. Reine Änderungen an Dokumentation,
Tests oder Betriebsskripten senden keine Meldung. Backend-Änderungen mit sichtbarer
Wirkung brauchen ebenfalls einen bewusst formulierten Usability-Hinweis.

Der private Git-Marker `rollthedice-last-deployed` enthält die letzte erfolgreich
ausgerollte Revision. Er wird beim ersten Aufruf aus dem bisherigen Checkout
initialisiert und erst nach erfolgreicher Veröffentlichung fortgeschrieben.
So funktioniert ein erneuter Versuch auch dann, wenn ein fehlgeschlagener Build
bereits neuen Code ausgecheckt hat. Den Marker nicht für Testsendungen verändern.

Bei Veröffentlichung werden nur aktive, berechtigte und ausdrücklich angemeldete
Konten samt damaliger Geräte vorgemerkt. Spätere Opt-ins und neue Geräte bekommen
keine alten Meldungen. Bei gemeinsamen Releases wird das zuletzt angemeldete,
betroffene Produkt gewählt, nicht je ein Push aus beiden PWAs. Dessen damalige
Geräte erhalten den kurzen Text in der aktuellen Kontosprache. Vor jedem Gerät
werden Konto, Einwilligung, Eigentümer des Abonnements und Spielzugang erneut
geprüft. Die Outbox und die TTL beim Push-Dienst begrenzen die Zustellung auf
höchstens 24 Stunden nach Veröffentlichung. Ein Klick öffnet die passende Lobby.
Bereits erfolgtes Spielen und die Einladungsauswahl beeinflussen Versionshinweise
nicht; der globale Push-Opt-out schaltet auch diese Kategorie aus.

### Private Einladungsauswahl

`game_invite_push_audience` ist standardmäßig `all`. Mit `allowlist` erhalten
Konten nur Einladungen von den in `push_invite_allowed_senders` gespeicherten
Absender-IDs. Die Kontoeinstellung akzeptiert bis zu 100 aktive, bestehende
Benutzernamen, normalisiert und dedupliziert sie und verwirft unbekannte oder
eigene Namen atomar. Eine leere Allowlist sperrt alle Einladungen. Es zählt
der authentifizierte Auslöser, nicht ein anderer Spieler am Tisch.

Die Liste ist privat, gerichtet und spiel-/geräteübergreifend. Sie gilt nicht
für Erinnerungen und Versionshinweise; die bisherigen Einladungslimits bleiben
unverändert. Das ist die Grundlage einer späteren Friendlist, noch kein System
für gegenseitige Freundschaftsanfragen. Alte Clients können ihre bisherigen
Push-Schalter weiter speichern, ohne neue Einstellungen zurückzusetzen.

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

# Persist the comparison base before pulling; preserve it on retries.
set -euo pipefail
deployment_marker="$(git rev-parse --git-path rollthedice-last-deployed)"
test -s "$deployment_marker" || git rev-parse HEAD > "$deployment_marker"
previous_revision="$(< "$deployment_marker")"

docker compose stop rollthedice
cp -a data "data.backup-$(date +%Y%m%d-%H%M%S)"
docker compose start rollthedice

git fetch origin master
git checkout master
git pull --ff-only origin master
python3 scripts/sync_static_versions.py --check
release_notice="$(python3 scripts/prepare_release_notice.py --previous "$previous_revision")"
docker compose up -d --build

docker compose ps
curl --retry 15 --retry-delay 2 --retry-connrefused --retry-all-errors \
  -fsS http://127.0.0.1:8000/api/health >/dev/null

# Run only if the build AND health check succeeded.
printf '%s\n' "$release_notice" | docker compose exec -T rollthedice python -m app.release_push
git rev-parse HEAD > "$deployment_marker"
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

Ein Downgrade über `20260903_0017` löscht die gesamte getrennte
Zilch-Achievement-Historie. Ein Downgrade über `20260904_0018` behält die
ZDWA-Freischaltungen, entfernt aber ihre Zuordnung zum Ursprungsspiel. Ein
Downgrade über `20260904_0019` entfernt den Zilch-Community-Zähler, eingefrorene
Empfängerlisten, den Teilnehmer-Ledger und die zugehörigen Community-
Freischaltungen. Persönliche Zilch-Freischaltungen und deren Zustellbestätigungen
bleiben erhalten. Diese Schritte deshalb nur nach bestätigtem Backup und
bewusster Entscheidung über diesen Datenverlust ausführen.

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
