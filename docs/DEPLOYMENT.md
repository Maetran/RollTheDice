# ZDWA Deployment und Betrieb

Dieses Dokument beschreibt den produktiven Betrieb von **ZDWA – Zock die Wand
an**. Das Repository heisst intern weiterhin `RollTheDice`.

Stand 11.10.2026: Die vier Produkt-Hosts laufen mit Cloudflare-Proxy. Die
historische DNS-only-Startphase weiter unten darf nicht mit der inzwischen
eingeführten Origin-Firewall kombiniert werden. Die aktuelle Absicherung,
vertrauenswürdige Besucher-IP-Kette und Rücknahme stehen in
[Cloudflare-Schutz](CLOUDFLARE_PROTECTION.md). Der produktive Container startet
über `app.asgi:create_application --factory --no-proxy-headers`; die äußere
ASGI-Schicht prüft den tatsächlichen Nginx-Peer vor der Besucher-IP-Auflösung.
`FORWARDED_ALLOW_IPS` bleibt auf das aktuelle Docker-Gateway begrenzt.

As of 2026-10-11, all four product hosts use Cloudflare's proxy. Do not combine
the historical DNS-only setup below with the current origin firewall. See
[Cloudflare protection](CLOUDFLARE_PROTECTION.md) for the active ingress policy,
visitor-IP trust chain and rollback. Production starts through
`app.asgi:create_application --factory --no-proxy-headers`; the outer ASGI layer
checks the physical Nginx peer before resolving the visitor IP.
`FORWARDED_ALLOW_IPS` remains restricted to the current Docker gateway.

## Private Watten-Webvorschau / Private Watten web preview

`ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW=0` bleibt der Standard in `.env.example`
und Docker Compose. Nach vollständiger Prüfung und bewusster Releasefreigabe
kann der normale Deploymentweg diesen Schalter auf `1` übernehmen. Er öffnet
ausschliesslich `https://zockdiewandan.online/watten` für das bereits gebundene,
aktive Founder-Konto aus `account_ownerships`. Anzeigename, Adminrolle und
delegierte Ownership ersetzen diese unveränderliche Kontobindung nicht. Eine
fehlende Founder-Bindung oder ein DB-Fehler gewährt keinen Zugriff.

Die gemeinsame Anmeldung und Kontoverwaltung bleiben auf den vorhandenen
Suite-Seiten. Die drei bestehenden Produkt-Hosts dürfen nur dem Founder den
Link auf die Apex-Vorschau zeigen; native Spiel- und Datenrouten akzeptieren
produktiv nur den einzelnen kanonischen Apex-Host. Doppelte oder gemischte
Host-Felder, Lookalikes und Forwarding-Header gewähren keine Berechtigung.
Jede private Seite bleibt `no-store` und `noindex`; Einladungen, Reservierungen
oder frühere Mitgliedschaft erweitern den Vorschau-Empfängerkreis nicht.

Der feste Host `watten.zockdiewandan.online` bleibt auf seiner Holding-Seite
mit gesperrtem Robots-Dokument und fehlender Sitemap. Produktions-Manifeste,
Worker, Installationsicons, Watten-Signup/-Kontomails und Push-Zustellung werden
hiermit nicht geöffnet. Geräte-Metadaten dürfen nur für den Founder gespeichert
werden; die bestehenden drei Push-Zustellprodukte bleiben unverändert. Die
lokalen Vorschauflags sind weiterhin ausschliesslich für lokale Deployments
und lokale Requests wirksam. Zur Rücknahme den Founder-Schalter auf `0` setzen
und den üblichen Container-Neustart ausführen; gespeicherte Partien und XP
werden dadurch nicht gelöscht oder zurückgesetzt.

`ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW` defaults to `0`. After the complete checks
and an explicit release approval, the normal deployment flow may enable only
the existing immutable founder account's private web preview on the production
apex. Shared login and account management stay on the existing suite pages.
Other accounts, administrators and delegated owners gain no access; missing
ownership or database failures fail closed. The three existing product hosts
may expose the founder's link, while native gameplay/data accept only the
canonical apex Host. Forwarded or ambiguous Host values grant nothing.

Private pages remain non-cacheable and non-indexable. The fixed Watten host,
production installation resources, Watten account email/signup context and
push delivery stay closed. Stored-only device metadata does not activate a
delivery product. Local preview flags retain their strict local behavior.
Disabling the founder switch through the ordinary restart flow revokes this
preview without deleting checkpoints or progress; an invitation, reservation
or old membership never grants preview access.

## Entwicklung und Releasebranches

Verbindlicher Lieferweg / Required delivery path: `develop → master → prod`.

`develop` ist der gemeinsame Integrationszweig für die nächste Produktversion.
`master` enthält geprüfte Release-Stände und bleibt die Quelle für produktive
Builds und Deployments. Ein Push auf `develop` startet die bestehende CI;
er veröffentlicht die Anwendung nicht.

1. Neue Arbeit in einem eigenen Worktree auf einem `codex/*`-Branch vom aktuellen
   `origin/develop` beginnen. Feature-PRs haben `develop` als Ziel.
2. Vor der Übergabe `git fetch origin` ausführen und `origin/develop` im eigenen
   Featurebranch integrieren. Fachliche Konflikte lösen, die statischen Assets
   neu bauen und passende Tests ausführen. PRs nacheinander integrieren; bei
   zwischenzeitlich geändertem Zielstand erneut abgleichen und prüfen. Gemeinsame
   Branches nicht per Force-Push überschreiben. Gemeinsame Version,
   Releasehinweise und Alembic-Revisionen abstimmen. Bestehende Zuordnungen in
   `app/version-history.json` niemals umnummerieren oder überschreiben.
3. Den vollständigen Stand lokal prüfen und den Owner-Nachweis veröffentlichen.
   GitHubs schlanker Check **Quality result** muss für den gemeinsamen Stand
   bestehen; er kontrolliert Nachweis und unveränderte Integrationsquellen. Erst
   mit bewusster Releasefreigabe `develop` nach `master` übernehmen, möglichst
   per Fast-forward, sonst per normalem Merge. An dieser Grenze weder squashen
   noch rebasen: referenzierte Commit-SHAs und Release-Tags müssen erhalten bleiben.
4. Den tatsächlich übernommenen `master`-Stand prüfen und über den bestehenden
   Deployablauf ausrollen. Nach erfolgreichem Rollout den ausgelieferten Commit
   als `v<Major.Minor.Patch>` taggen.
5. Einen neuen Release-Merge auf `master` vor der nächsten Versionserhöhung
   zurück nach `develop` führen. Damit archiviert die nächste Version den
   tatsächlichen Deploy-Commit. Ein dringender Hotfix beginnt auf `master`,
   erhält einen Patch-Release und fliesst danach ebenfalls nach `develop` zurück.

**CI-Nachweis für die Releasefreigabe:** Vor dem Push nach `master` muss der
`develop`-Push-Lauf des exakten Commits grün sein:

```bash
gh run list --workflow quality.yml --branch develop --event push --commit "$(git rev-parse origin/develop)"
```

Der `master`-Lauf kontrolliert im Job **Quality result** über die GitHub-API
den tatsächlichen Release-Stand. Ein unveränderter Fast-forward nutzt den
grünen `develop`-Nachweis desselben Commits; ein normaler Release-Merge muss
exakt den geprüften Tree seines `develop`-Elternteils enthalten. Neue Quellen
benötigen einen vollständigen lokalen Nachweis für den tatsächlichen Stand.
Fehlende, rote, veraltete oder unklare Nachweise blockieren den Lauf; GitHub
wiederholt keine schweren Suiten. Für das Deployment zählt das grüne
**Quality result** des tatsächlichen `master`-Stands.

Eine Feature-Integration ist noch kein Release. Versionsmetadaten und der
gemeinsame Hinweis müssen zum geplanten Release passen; parallele Agenten
dürfen nicht unabhängig dieselbe neue Version oder Migrationsrevision vergeben.
Feature-Commits dürfen nur umgeschrieben werden, solange ihre SHAs weder in der
Versionshistorie noch durch Release-Tags gebunden sind.

**Vor jedem Push:** Unmittelbar vorher erneut `git fetch origin` ausführen und
`origin/develop` mit dem zuletzt integrierten und geprüften Stand vergleichen.
Bei Änderungen zuerst zusammenführen, Konflikte lösen, gegebenenfalls Assets
neu bauen und relevante Tests wiederholen; danach erneut prüfen. Normale Pushes
beibehalten: Falls ein anderer Agent den Zielbranch zwischen Prüfung und Push
weiterbewegt, verweigert Git einen nicht mehr möglichen Fast-forward. Dann erneut
abgleichen und prüfen, statt die fremden Commits zu überschreiben.

**Worktrees nach Abschluss:** Nicht mehr benötigte eigene Worktrees aufräumen,
wenn die Arbeit abgeschlossen, vollständig committet und nach frischem Fetch
nachweislich in `origin/develop` enthalten ist. Vorher Änderungen einschliesslich
unversionierter Dateien, detached HEADs und Stashes prüfen; ungesicherte Arbeit
und wichtige ignorierte Dateien ausserhalb des Worktrees sichern. Unmittelbar
vor dem Aufräumen Eigentümer und aktive Chat-/Agentennutzung erneut prüfen.
Hauptcheckout, fremde, aktive, gepinnte und geteilte Worktrees erhalten. Eigene
verwaltete Codex-Worktrees über die wiederherstellbare Archivierung aufräumen;
deren Snapshot enthält keine ignorierten Dateien. Kein erzwungenes Entfernen
und keine pauschale Löschung lokaler oder entfernter Branches.

**English:** Develop features in separate `codex/*` worktrees from current
`origin/develop`, and target feature PRs at `develop`. Before handoff, fetch and
integrate current develop into the feature branch, resolve source conflicts,
rebuild assets and run the relevant tests. Integrate PRs sequentially, repeat
the check when the target changes, and never force-push shared branches.
Coordinate versions,
release notes, migration IDs and generated assets when integrating. A develop
push runs CI without publishing the app. After the combined revision has a complete local verification and passes the
GitHub integration/evidence gate, and the release is approved, promote it to `master` by fast-forward or a normal
merge, preserving referenced commits and release tags. Before pushing `master`,
confirm with the `gh run list` command above that the develop push run of the
exact commit is green. **Quality result** verifies the actual master commit
and its evidence. An unchanged fast-forward reuses the verified develop state;
a normal release merge must have exactly its verified develop parent's tree.
New sources require a complete local verification of the actual revision.
Missing or unclear evidence blocks the gate; GitHub does not repeat the heavy
suites. Verify and deploy the actual master revision, then tag the
successful rollout. Bring release merges
and master hotfixes back into develop before the next version bump, so version
history references the actual deployed revision. An integration alone is not a
release; existing version mappings remain unchanged.
Immediately before every push, fetch again and compare current `origin/develop`
with the integrated, tested revision. If it changed, integrate, resolve conflicts,
rebuild when needed and rerun relevant checks, then check again before pushing.
Keep normal push protection: if the destination advances in the meantime, handle
a rejected push by fetching and integrating again, never by force-pushing.
Once work is complete, committed and confirmed in freshly fetched
`origin/develop`, clean up unused worktrees you own when appropriate. Check
uncommitted and untracked files, detached HEADs and stashes, and save unprotected
work and important ignored files outside the worktree first. Recheck ownership
and active chat/agent usage immediately before cleanup. Preserve the main
checkout and worktrees that are active, pinned, shared or owned by others.
Archive managed Codex worktrees for recovery; ignored files are not included in
their snapshots. Never force removal or delete branches as a blanket cleanup.

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

Vollständige lokale Prüfung vor jedem Push:

```bash
npm run hooks:install
npm run push:checked -- -u origin codex/my-feature
```

Alternativ `npm run verify:local`, danach normal pushen und
`npm run checks:publish` ausführen. Der Prüfer verlangt einen sauberen Commit,
eine frisch integrierte `origin/develop`-Basis und Node22 wie im Workflow. Er
führt Qualität/Sicherheit, Tooltests, Backend mit Coverage, Produktionsbuild
und Offline-Containerprüfung sowie alle Browser-Suiten aus. Vier Haupt-Shards
haben eigene Server, Ports, SQLite-/JSON-Daten und Berichte mit je einem Worker;
die drei Konto-Suiten folgen separat. Chromium, WebKit, Python-Dev-Abhängigkeiten
und ein lokaler Docker-Daemon müssen bereitstehen. Keine fremden vollen Testpools
parallel starten. Details: [Lokale Prüfungen](LOCAL_CHECKS.md).

`push:checked` veröffentlicht nach einem erfolgreichen Push den exakten lokalen
Vollnachweis als Commitstatus **Local verification** über den authentifizierten
Repository-Eigentümer. Der Nachweis bindet Tree, aktuelle Basis und Abschlusszeit,
gilt höchstens24Stunden und wird bei Änderungen erneut verlangt. Der lokale
JSON-Nachweis allein wird von GitHub nicht akzeptiert.

GitHub prüft nur noch die Remote-Integration und diesen Owner-Nachweis im Job
**Quality result**. Der geprüfte PR-Head, der synthetische Merge und normale
Integrations-/Release-Merges müssen denselben Tree besitzen. Basis, Abstammung,
Aussteller und Frische werden über GitHub kontrolliert. Fehlende, fremde, rote,
veraltete oder unklare Nachweise blockieren; neue Quellen müssen zuerst lokal
geprüft werden. Es gibt keine erneuten vollen Backend-, Browser-, Container-,
Lint- oder Tool-Suiten auf GitHub. Feature-Branches laufen einmal über ihren PR,
Pushes nur aufdevelop/master, Tags nie. Überholte Läufe brechen nur innerhalb
desselben PRs/Branches ab.

**English:** Run the complete local verifier before every push; the checked-push
wrapper publishes its result as an owner-issued **Local verification** commit
status. A normal push requires `npm run checks:publish` afterwards. GitHub runs
only **Quality result**, a lightweight remote integration/evidence check binding
the actual commit/tree/base, ancestry, trusted issuer and completion time.
Raw receipt files in a PR are not evidence. Changed sources or missing, stale,
failed or untrusted proof block the gate and require local verification. Full
backend, browser, container, lint and tooling suites run locally only. PRs are
checked once; feature pushes and release tags do not create duplicate runs.
The develop→master→production order and explicit release approval remain.

## Reverse-Proxy-Härtung

Die versionierte Nginx-Konfiguration unter `deploy/nginx/rollthedice.conf`
begrenzt HTTP-Bursts, Request-Grössen und parallele WebSockets pro IP. Ihr
10-MiB-Request-Limit liegt bewusst über dem 8-MiB-Limit für Profilbildquellen,
damit normale PNG- und WebP-Fotos die geprüfte App-Grenze erreichen. Sie reicht
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
dieses allgemeine Installationsskript den Lauf, bis jeder Host von seinem
vorgesehenen Zertifikat abgedeckt ist. Hausdepp verwendet eine eigene
Zertifikatslinie; für die erste Aktivierung gilt der kontrollierte
`scripts/activate_hausdepp.sh`-Ablauf weiter unten. Der alte
`scripts/activate_subdomains.sh`-Ablauf beschreibt ausschließlich die historische
DNS-only-Umstellung von ZDWA/Zilch. Diese
Systemkonfiguration wird nicht bei jedem App-Deployment ungeprüft überschrieben.

Die CSP muss `frame-src 'self' https://challenges.cloudflare.com` erlauben:
`'self'` wird für den ZDWA-Regeldialog mit `/regeln?embed=1` benötigt, die
Cloudflare-Origin weiterhin für Turnstile. `frame-ancestors 'self'` bleibt
erhalten und beschränkt das Einbetten unserer Seiten auf die eigene Origin.
Bei Änderungen dieser Direktiven ist zusätzlich zum App-Deployment
`scripts/install_nginx_config.sh` erforderlich. Danach den tatsächlichen
HTTPS-CSP-Header und den geöffneten Regeldialog prüfen; ein erfolgreicher
Aufruf der Regelseite allein prüft ihre Einbettung noch nicht.

Bei einem manuellen Aufruf werden alte Datenbackups zunächst nur aufgelistet:

```bash
cd /home/manuel/RollTheDice
KEEP=5 scripts/prune_data_backups.sh
```

Nach Kontrolle der Liste kann dieselbe Auswahl mit `APPLY=1` gelöscht werden.

## Subdomains kontrolliert aktivieren

### Hausdepp öffentlich aktivieren / Activate public Hausdepp

**Vorprüfung 16.10.2026:** `hausdepp.zockdiewandan.online` löst bereits über
Cloudflare auf. Das Edge-Zertifikat deckt den Namen ab; vor der Aktivierung
liefert HTTPS jedoch 525, weil Nginx den Hausdepp-SNI noch nicht kennt. Das
bestehende Origin-Zertifikat enthält nur Apex, `www`, `zdwa` und `zilch`.
Öffentliches HTTP erreicht den Origin; ein unbekannter ACME-Pfad liefert 404,
ohne Weiterleitung auf HTTPS. Die folgenden Befehle sind der kontrollierte
Aktivierungsablauf, kein Nachweis eines bereits erfolgten Rollouts.

Hausdepp erhält eine **separate** Let's-Encrypt-Zertifikatslinie unter
`/etc/letsencrypt/live/hausdepp.zockdiewandan.online/`. Das vorhandene
Vier-Host-Zertifikat, Cloudflare-Proxy, Firewall, Cookie-Domain und Datenbestand
bleiben bestehen. Der öffentliche Einstieg ist `/hausdepp`; `/` leitet mit 308
dorthin. Lobby und `/hausdepp/regeln` sind ohne Anmeldung lesbar. Spielen,
Konto, Rangliste und Mitspielerrufe verwenden die gemeinsame Anmeldung.

Vor dem einmaligen normalen Release müssen Commit, CI, zweisprachige
V3-Release-Inhalte und unveränderte persistente Daten geprüft sein. Danach:

```bash
# Lokal aus dem geprüften Checkout: normaler Release mit vorgelagerter TLS-Aktivierung.
ACTIVATE_HAUSDEPP=1 scripts/deploy_zdwa.sh
```

Der normale Deploy erstellt zuerst das konsistente vollständige Datenbackup,
aktualisiert den sauberen produktiven Checkout und validiert Version und
Release-Text. Die explizite Aktivierungsoption führt danach den folgenden
Infrastrukturablauf aus, bevor das neue Anwendungsimage startet:

1. `scripts/activate_hausdepp.sh` prüft Nginx, öffentlichen DNS und den aktiven
   `certbot.timer`. Ohne `APPLY=1` bleibt es ein reiner Trockenlauf.
2. Eine gesicherte, temporäre HTTP-Vhost-Datei erlaubt ausschließlich
   `/.well-known/acme-challenge/` aus `/var/lib/letsencrypt`; andere Pfade
   antworten 404. Vorhandene unbekannte Staging-Dateien werden nicht überschrieben.
3. Ein zufälliger Token muss **durch die öffentliche Cloudflare-HTTP-Strecke**
   exakt lesbar sein. Eine HTTPS-Weiterleitung, Challenge-Sperre oder falsche
   Origin-Zuordnung bricht vor dem Zertifikatsantrag ab. Proxy und Firewall
   werden dafür niemals abgeschaltet.
4. Certbot stellt mit `certonly --webroot` ausschließlich das eigene
   Hausdepp-Zertifikat aus. Die bestehenden vier SANs werden nicht ersetzt.
   Der Installationsguard prüft Hostabdeckung; danach werden die permanente
   HTTPS-Konfiguration und der enge HTTP-ACME-Pfad installiert. Die temporäre
   Datei wird vor dem endgültigen Reload entfernt; es gibt keinen doppelten
   Hausdepp-Vhost.
5. Die automatische Erneuerung verwendet denselben dauerhaften Webroot. Der
   Deploy-Hook
   `/etc/letsencrypt/renewal-hooks/deploy/rollthedice-nginx-reload.sh` führt
   zuerst `nginx -t` und anschließend einen Reload aus. Ein eigener
   `certbot renew --dry-run --cert-name hausdepp.zockdiewandan.online` prüft die
   Erneuerung vor Abschluss der Aktivierung.
6. Bei Fehlern werden temporäre Challenge-Dateien entfernt und die bisherige
   Nginx-Datei aus `rollthedice.backup-hausdepp-*` wiederhergestellt und geprüft.
   Ein bereits ausgestelltes separates Zertifikat darf erhalten bleiben;
   Container und Datenbank werden durch den Aktivierungshelfer nicht verändert.

Das neue Image startet anschließend mit den regulären Migrationen. Nach der
lokalen Datenbankbereitschaft führt `scripts/verify_public_release.py` echte,
verifizierte HTTPS-GETs durch: alle drei Produkt-Hosts und der ZDWA-Alias,
öffentliche Lobbys, Hausdepp-Regeln, Canonicals, die exakt zwei öffentlichen
Hausdepp-Sitemap-Einträge, `robots.txt` und isolierte PWA-Metadaten. Dabei müssen
die öffentliche Produktversion und die JS-/CSS-Revisionsparameter der
Hausdepp-Lobby exakt zum ausgecheckten Release passen; ein alter App-Prozess
oder veraltetes Einstieg-HTML darf keine Mitteilung auslösen. **Erst wenn
alle öffentlichen Prüfungen bestehen, gelangt die echte Release-Mitteilung in
die dauerhafte Outbox.** Ein fehlgeschlagener öffentlicher Smoke-Test lässt
Deploy-Marker und Benachrichtigung unangetastet; ein erneuter normaler Lauf
verwendet dieselbe letzte erfolgreiche Vergleichsbasis. Es ist kein stiller
Zwischenrelease erforderlich. Spätere normale Deploys benötigen das
Aktivierungsflag nicht mehr; der öffentliche Gate bleibt aktiv.

Der Helfer kann separat auf dem Origin geprüft werden:

```bash
cd /home/manuel/RollTheDice
scripts/activate_hausdepp.sh               # prüft, verändert nichts
APPLY=1 scripts/activate_hausdepp.sh       # nur für die freigegebene Erstaktivierung
python3 scripts/verify_public_release.py  # nur lesende öffentliche Prüfung nach App-Deploy
```

**English.** Preflight on 2026-10-16 found Hausdepp already proxied through
Cloudflare with a valid edge certificate, but origin TLS returned 525 because
Nginx and its existing four-host certificate did not include Hausdepp. Public
HTTP reaches the origin without an HTTPS redirect for the challenge path.
These instructions describe the controlled activation, not a completed rollout.

Use `ACTIVATE_HAUSDEPP=1 scripts/deploy_zdwa.sh` for the approved first normal
release after CI. The deploy preserves the complete production data backup,
updates the clean checkout, validates version/release notes and activates TLS
before building the new application. The activation helper defaults to a dry
run. With `APPLY=1`, it backs up Nginx, stages a narrow HTTP-only ACME vhost,
proves a random token through public Cloudflare HTTP and obtains a **separate**
webroot certificate for Hausdepp. It never disables the proxy or firewall and
never replaces the existing apex/www/ZDWA/Zilch certificate. Unknown staging
files cause a safe abort. Temporary routing is removed before the permanent
Hausdepp TLS and ACME locations are installed. Failure restores the previous
Nginx configuration and cleans temporary tokens; application data stays intact.

The permanent `/var/lib/letsencrypt` challenge location supports automatic
renewal. The validated Nginx reload hook and a certificate-specific Certbot
renewal dry run are part of activation. After the application becomes healthy,
the public release gate verifies real TLS, all product hosts, anonymous lobby
and rules, canonical search metadata, the exact two-page Hausdepp sitemap and
its isolated PWA. The public product version and the lobby’s JS/CSS asset
revision parameters must exactly match the checked-out release, rejecting an old
application process or stale entry HTML. **Only then** is the real announcement queued. A failed gate
keeps the deployment marker and announcement unchanged; retry the ordinary
release after fixing the cause. Later deploys omit the activation flag but keep
the public gate. The public Hausdepp root redirects to `/hausdepp`; lobby and
rules are anonymous, while playing and personal features require sign-in.

### Bestehende Hosts und ursprüngliche Aktivierung (historisch, DNS-only)

Die folgenden DNS-only-Schritte dokumentieren die ursprüngliche Umstellung.
Sie gelten nicht für die heute aktive Cloudflare-Proxy-/Firewall-Konfiguration
und dürfen für Hausdepp nicht verwendet werden.

The DNS-only steps below describe the original migration. They do not apply to
the current Cloudflare proxy/firewall setup and must not be used for Hausdepp.

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
Beide Worker speichern ausschließlich das feste Paket für den ausdrücklich
aktivierten Offline-Modus in Cache Storage. Online-Spielräume, Kontoseiten und
API-Antworten bleiben network-only. So kann weder ein gemeinsamer noch ein
Zilch-spezifischer PWA-Cache eine private Sitzung oder Online-Spielansicht
wiederherstellen. Bei Netzverlust kann nur der anonyme Offline-Einstieg mit
erneuter Bestätigung erscheinen; er übernimmt keine Online-Partie. API-Antworten bleiben
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

### ZDWA-Design

`ROLLTHEDICE_ZDWA_DESIGN` steuert das neue ZDWA-Design 2026. Standard ist
`all`: alle sehen es und können im Konto oder als Gast in der Lobby zum
bisherigen Design wechseln. `owner` zeigt es nur Owner-Konten, jeder andere
Wert, insbesondere `off`, schaltet es für alle ab. Nach dem Ändern in `.env`
den Container neu starten (`docker compose up -d`); ein Code-Deploy ist nicht
nötig. Die gespeicherte Wahl der Konten (`users.zdwa_design`) bleibt dabei
erhalten und gilt wieder, sobald das Design erneut freigegeben ist. Konten, die
entstehen, während das Design nicht für alle freigegeben ist, kennen nur das
bisherige Design und werden nach der Freigabe einmal gefragt. Ein
Code-Rollback auf 2.50.0 startet erst nach `alembic downgrade 20261010_0054`
(siehe `docs/ANALYTICS.md`); der Schalter ist der Rückweg ohne Datenverlust.

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

ZDWA und Zilch verwenden getrennte Service Worker. Beide cachen ausschließlich
die in `OFFLINE_PAGES` und `OFFLINE_ASSETS` aufgeführten anonymen Offline-Seiten
und deren feste Assets. Online-Spielräume, Kontoseiten, Ergebnisse und APIs
werden nicht in Cache Storage gespeichert. Cache-Name und Query-Parameter
werden aus dem Inhalt aller statischen Dateien und Manifeste abgeleitet und
dadurch gemeinsam aktualisiert.

Nach einer Änderung unter `app/static/` oder an einem Manifest:

1. `python3 scripts/sync_static_versions.py` oder `npm run sync:assets` ausführen.
2. Die dabei mechanisch geänderten Referenzen zusammen mit dem Asset committen.
3. Mit `python3 scripts/sync_static_versions.py --check` prüfen. Das Deployment
   bricht bei einem nicht synchronisierten Stand ab.
4. Prüfen, ob neue **öffentliche** Offline-Assets in `OFFLINE_ASSETS` und neue
   anonyme Offline-Einstiege in `OFFLINE_PAGES` aufgenommen werden müssen.
   Daraus entsteht `PRECACHE_URLS`. Online-Zilch-Routen und deren `zilch.js`-/
   `zilch.css`-Bundles gehören nicht in dieses feste Offline-Paket.
5. Nach dem Deployment die öffentliche HTML-Datei sowie `sw.js` und auf der
   Zilch-Origin `zilch-sw.js` kontrollieren.
6. Die Seite in einem bereits verwendeten Browser nochmals laden. Der neue
   Service Worker übernimmt bestehende Tabs unter Umständen erst nach dem ersten
   Reload vollständig.

Zilchs Online-Spiele bleiben eine autorisierungsgebundene Public Beta. Der
Service Worker lädt Online-Seiten per Netzwerk und precacht weder die
persönliche Shell noch `zilch.js` oder `zilch.css`. Erst die serverseitige Konto-
und Zugriffsprüfung liefert geschützte Inhalte. Schlägt die Verbindung fehl,
darf der Worker ausschließlich den getrennten, anonymen Offline-Einstieg
anzeigen. Dieser verlangt eine ausdrückliche Aktivierung, zeigt keine alten
Kontodaten und führt keine Online-Partie fort. Nach Logout oder einem
Policy-Wechsel darf kein persönlicher Zilch-Inhalt aus einem Cache erscheinen.
Lokale Spielergebnisse werden auch bei wiederkehrender Verbindung niemals
hochgeladen.

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
ROLLTHEDICE_ZILCH_CPU_DELAY_SECONDS=1.25
```

Bei positiver Taktung bleiben Würfe mindestens 1,8 Sekunden, ein entschiedener
Startwurf mindestens 1,5 Sekunden und ein Zilch-Übergang mindestens 1,9 Sekunden
vor der nächsten CPU-Aktion lesbar. Die Pausen werden nicht addiert. Der
explizite Wert `0` deaktiviert diese Präsentationspausen für Testbetrieb.

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

### Periodische Push- und Installationshinweise

ZDWA, Zilch und Hausdepp initialisieren den gemeinsamen Push-Hinweis nur in
der Lobby. Aktuelle Geräte mit mindestens einer aktivierten Kategorie bleiben
ruhig; ein fehlendes Gerät darf trotz Abos auf anderen Geräten nachfragen.
`POST /api/web-push/opt-in-prompt` akzeptiert optional `{"device_missing": true}`
und `X-Push-Expected-Account-Id`. Die Geräteangabe reserviert ausschliesslich
den eigenen Dialog. Sie registriert kein Abo und aktiviert keine Kategorie.
Anmeldung, CSRF, aktives Konto und der atomare kontoweite 14-Tage-Abstand gelten
weiterhin. Legacy-Aufrufe ohne Angabe behalten ihre bisherige Auswahl.
Browserberechtigung `denied` und fehlgeschlagene Geräteprüfungen bleiben still.

Die PWA-Hinweise vergleichen die Produktversion aus `app/version.json`, die
beim Static-Build in den gemeinsamen Shellcode eingebettet wird. Nach jeder
Versionsänderung `npm run build:static` ausführen. Ein neuer Release darf die
Installationsfrage erneut anbieten; innerhalb derselben Version pausiert
Schliessen oder native Ablehnung für sieben Tage. Installierte Appfenster und
bekannte Installationen derselben Version werden ausgenommen. Ohne natives
Installationsereignis gibt es auf iPhone/iPad einen manuellen Hinweis gemäss
[Apple](https://support.apple.com/guide/iphone/iphea86e5236/ios). Die native
Abfrage benötigt weiter einen Klick; siehe [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event).
Hinweise erscheinen nur in Lobbys, warten auf offene Dialoge und überlagern
weder einander noch die native Installationsabfrage. Installationsstatus ist
browserabhängig; eine Deinstallation ist nicht überall direkt erkennbar.

All three public games use the same14-day account-wide Push invitation cadence.
A missing current device may be invited even when another device is active.
The prompt is consent-neutral. Installation offers use the product version,
respect the seven-day same-release snooze and offer manual iOS instructions.
Neither offer interrupts a table or another dialog. Build static assets after
bumping the product version.

### Geräteanmeldung und Abgleich

`GET /api/web-push/subscription` liefert kontoweite Kategorien und `viewer_id`;
`subscribed` belegt ausdrücklich kein Abo des aktuellen Browsers. Der Client
prüft den lokalen aktiven Worker mit Scope und liest dessen Push-Subscription.
`POST /api/web-push/subscription/check` prüft den vollständigen Subscription-
Body (Endpoint, beide Schlüssel und expliziter `product_context`) für das
angemeldete Konto. Das Ergebnis `device_subscribed` ist gerätebezogen; die
Antwort ist `no-store`. Der Check verlangt Anmeldung und CSRF, schreibt weder
Abos noch Einwilligungen und gibt keine fremden Abo-Daten zurück.

Die bewusste Geräteanmeldung sendet den Kontext des tatsächlich gewählten
Workers. Hausdepp erlaubt keinen Ersatz durch einen anderen Worker. Ein älterer
Client ohne expliziten Kontexthinweis behält für denselben Endpoint und Besitzer
die vorhandene öffentliche Spielzuordnung; ein Host-Fallback darf sie nicht
überschreiben. Der neue Client kann Fehlzuordnungen ausdrücklich reparieren. Check und
Anmeldung senden `X-Push-Expected-Account-Id`; ein inzwischen gewechseltes
Konto wird mit 409 abgewiesen. Bei identischen Schlüsseln, Konto und Kontext
bleiben Abo-Zeitstempel unverändert, damit ein erneutes Anmelden ausstehende
Release-Zustellungen nicht entwertet. Echte Änderungen invalidieren ältere
Snapshots weiterhin. Fehlende oder abgelaufene Abos werden nur nach bewusstem
Klick erneuert, damit ein kontoweiter Opt-out nicht rückgängig gemacht wird.

The account status and the current device status are distinct. The read-only,
authenticated CSRF-protected check compares the endpoint, both keys, account
and actual worker context. It never registers devices or changes consent.
Explicit registration repairs stale bindings, preserves category choices and
keeps identical registrations idempotent. Expected-account guards reject
account switches; opt-out and frozen release audiences remain authoritative.

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
  "summary_en": "New: lobby chat",
  "player_notes": {
    "de": {
      "title": "Zusammen spielen, gemeinsam plaudern",
      "changes": ["Der neue Lobby-Chat verbindet ZDWA und Zilch. Du findest ihn oberhalb der Bestenlisten; im Konto kannst du ihn ausschalten."]
    },
    "en": {
      "title": "Play together, chat together",
      "changes": ["The new lobby chat connects ZDWA and Zilch. Find it above the leaderboards; you can turn it off in your account."]
    }
  }
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

### Spielerfreundliche Release Notes

`app/release-notice.json` ist die gemeinsame Quelle für Push und In-App-Meldung;
`CHANGELOG.md` ist die ergänzende, ausführlichere GitHub-Historie. Pro sichtbarem
Release beide pflegen. Die App rendert nur Klartext, kein Markdown oder HTML.

- `player_notes.de` und `.en` enthalten je einen `title` (1–100 Zeichen) und
  `changes` (1–8 Stichpunkte, je 1–300 Zeichen). Beide Sprachen haben gleich
  viele Punkte. Normalerweise reichen 2–4 kurze Punkte: Was ist neu, was bringt
  es den Spielern, wo finden sie es? Keine internen Implementierungsdetails.
- Mit einem kurzen einleitenden Satz beginnen; Änderungen danach nach
  betroffener Suite-Komponente benennen: `ALLGEMEIN:`, `ZDWA:`, `ZILCH:`,
  `HAUSDEPP:` usw. Nur betroffene Bereiche aufnehmen, vollständig DE/EN.
  `games` bezeichnet weiterhin die tatsächlich betroffenen Spiele.
- Die einmalige Einführung bündelt zusätzlich die jüngsten Änderungen zu Chat,
  Allowlist und Push. Diesen Rückblick nicht in spätere Meldungen kopieren.
- `npm run lint` validiert die aktuellen Metadaten; der Deploy validiert sie
  erneut. Backend-Releases ohne neue Notiz erhalten automatisch einen kurzen
  Stabilitätshinweis auch für die In-App-Anzeige.
- Erst der erfolgreiche Deploy-Hook speichert `player_notes_json` unveränderlich
  in `push_releases`, auch ohne Push-Abonnenten. Eine spätere JSON-Änderung
  verändert keine veröffentlichten Texte; ein erneuter Deploy derselben
  Git-Revision erzeugt keinen neuen Eintrag.
- `GET /api/releases` liefert die letzten zehn zum Spiel passenden Releases,
  lokalisiert und mit dem Quittierungsstatus des angemeldeten Kontos. Die
  Antworten werden nicht gecacht. Gäste können öffentliche Spielhinweise lesen;
  bestehende Zilch-Zugangsprüfungen gelten weiterhin.
- Die App zeigt nur den neuesten unbestätigten Hinweis in Lobby oder Konto,
  nicht in Spielräumen und nicht über einem anderen Dialog. Ein nötiger
  Passwortwechsel hat Vorrang. Offene Seiten prüfen einmal pro Minute bzw. bei
  Rückkehr in den Vordergrund auf neue Hinweise.
- **Verstanden** speichert je Konto und Git-Revision eine dauerhafte,
  idempotente Quittierung in `release_acknowledgements`. Der POST verlangt
  Anmeldung, CSRF und die erwartete Konto-ID; ein Kontowechsel während des
  Speicherns kann keinen Hinweis für die falsche Person quittieren. Gäste
  speichern lokal im jeweiligen Browser/Origin, bei blockiertem Speicher nur
  für den aktuellen Seitenbesuch. **Später** und Escape quittieren nicht.
- Die Kontohistorie bleibt unabhängig von Quittierungen einsehbar; ältere
  Releases lösen keine Popup-Kaskade aus. In-App-Meldungen sind unabhängig von
  allen Push-Einwilligungen und lösen selbst keinen Push aus.

Migration `20260906_0029` ergänzt die optionale Notizspalte und die
Quittierungstabelle. Bestehende Push-Texte bleiben als kurze Historieneinträge
erhalten, werden aber nicht rückwirkend als Popup angekündigt. Das Upgrade
ändert keine Konten, Push-Einwilligungen oder vorgemerkten Empfänger. Ein
Downgrade entfernt die ausführlichen Texte und Quittierungen; davor ein
konsistentes Datenbackup sichern, ansonsten bevorzugt vorwärts reparieren.

### Profilbilder und Live-Startmeldungen

Die Migrationen `20260906_0030` und `20260906_0031` legen jeweils additive,
rückfallfähige Strukturen an: `user_avatars` enthält genau ein bereinigtes WebP
pro Konto, die neue Konto-Einstellung `friend_activity_enabled` ist standardmäßig
aktiv. Vor dem Deployment muss das Datenbackup erfolgreich sein; die Migration
verändert keine vorhandenen Nutzerdaten.

Der Upload akzeptiert nur JPEG, PNG und WebP bis 8 MB und 4’096 × 4’096 Pixel.
Der Server bestimmt das erlaubte Format ausschließlich aus den Magic Bytes; die
von Browsern oder PWAs gelieferte Medienart ist nur Hinweis und darf davon
abweichen. Er decodiert das Bild vollständig mit einer Pixel- und
Text-Metadaten-Grenze und baut daraus ein neues
256 × 256-WebP (höchstens 64 KB) ohne Originaldaten oder Metadaten. Es werden
weder Base64 noch die hochgeladene Datei gespeichert. `/api/avatars/{id}` liefert
`nosniff`, CSP, Same-Site-Resource-Policy, ETag und Noindex-Header; fehlende oder
deaktivierte Konten erhalten nur das feste Standardbild.

Live-Startmeldungen nutzen einen eigenen WebSocket und werden nicht persistiert
oder als Push zugestellt. Beim tatsächlichen Start einer öffentlichen,
zuschauerfähigen Partie prüft der Server für jeden bereits verbundenen Empfänger
erneut dessen Konto, Opt-out, private Auswahl, Spielzugang und Zuschauerstatus.
Die Ereignisse laufen nach 60 Sekunden ab; Teilnehmer, geschützte und private
Räume erhalten keine Meldung. Echte Push-Geräte nicht manuell mit diesen
Meldungen testen.

### Private Einladungsauswahl

`game_invite_push_audience` ist standardmäßig `all`. Mit `allowlist` erhalten
Konten nur Einladungen von den in `push_invite_allowed_senders` gespeicherten
Absender-IDs. Über ein Spielerprofil in ZDWA oder Zilch werden bis zu 100 aktive
Konten hinzugefügt; die Kontoeinstellung zeigt die Liste mit einzelnen
Entfernen-Aktionen. Freie Namenseingabe ist in der Oberfläche nicht mehr nötig.
Eine leere Allowlist sperrt im Modus `allowlist` alle Einladungen. Es zählt
der authentifizierte Auslöser, nicht ein anderer Spieler am Tisch.

Die Liste ist privat, gerichtet und spiel-/geräteübergreifend. Sie gilt nicht
für Erinnerungen und Versionshinweise; die bisherigen Einladungslimits bleiben
unverändert. Das ist die Grundlage einer späteren Friendlist, noch kein System
für gegenseitige Freundschaftsanfragen. Alte Clients können ihre bisherigen
Push-Schalter weiter speichern, ohne neue Einstellungen zurückzusetzen.

`GET /api/web-push/allowlist` liefert ausschließlich die eigene Liste ohne
Cache. `PUT /api/web-push/allowlist` ändert nur den Filter; `PUT` und `DELETE`
auf `/api/web-push/allowlist/{sender_user_id}` bearbeiten genau eine Mitgliedschaft.
Schreibzugriffe verlangen Anmeldung, CSRF und die erwartete `viewer_id`.
SQLite-Schreibreservierung vor dem Zählen schützt auch parallele Hinzufügungen
vor Überschreiten des Limits oder verlorenen Einträgen. Erneutes Hinzufügen und
Entfernen sind idempotent. Deaktivierte Mitglieder bleiben zum Entfernen sichtbar,
können aber nicht neu hinzugefügt werden.

Diese Änderung benötigt keine Migration. Bestehende Konto-IDs, Filter und
Einwilligungen bleiben erhalten. Die Liste ist auch ohne eingerichtetes Push
bearbeitbar und aktiviert niemals selbst eine Push-Kategorie. Für ältere PWA-
Clients bleibt der bisherige Namenslisten-Parameter kompatibel; neue Clients
senden beim Speichern der Push-Schalter keine komplette Liste mehr zurück.

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

## E-Mail-Konten und Passkeys

Der Code enthält E-Mail-Registrierung, Adressbestätigung, angeforderten
Passwort-Reset und WebAuthn-Passkeys. Die Konfigurationsvorlagen aktivieren
nichts automatisch. Passkeys und Fairplay sind bereits produktiv. Für den
freigegebenen vollständigen Konto-/E-Mail-Rollout vom 12.09.2026 ist nach
Versand- und Funktionsabnahme die folgende Produktionskonfiguration ausgewählt;
die Deployment-Bestätigung steht im
[Sicherheitsreview](ACCOUNT_SECURITY_REVIEW_2026-09-12.md):

```dotenv
ROLLTHEDICE_EMAIL_ENABLED=1
ROLLTHEDICE_EMAIL_FROM=noreply@zockdiewandan.online
ROLLTHEDICE_PASSKEYS_ENABLED=1
ROLLTHEDICE_WEBAUTHN_RP_ID=zockdiewandan.online
ROLLTHEDICE_WEBAUTHN_RP_NAME=Zock die Wand an
```

Ab Version 2.47.0 können beide Landingpages passkey-only Konten ohne Passwort
erstellen. Den Passkey-Schalter nach deren Erstellung eingeschaltet lassen;
ein Abschalten verhindert die Anmeldung dieser Konten, solange sie kein
Backup-Passwort eingerichtet haben. Das optionale Backup lässt sich in den
Kontoeinstellungen mit einem vorhandenen Passkey bestätigen. Die additive
Migration `20261005_0053` speichert kurzlebige Registrierungs-Challenges und den
kontoweiten Siebentage-Rhythmus der Einrichtungshinweise.

**English:** From 2.47.0, both landing pages can create passkey-only accounts.
Keep passkeys enabled once these accounts exist: disabling them prevents
sign-in unless a backup password has been set. Players can set that optional
backup in account settings by confirming with a passkey. Additive migration
`20261005_0053` stores short-lived signup challenges and the account-wide
seven-day reminder cadence.

`ROLLTHEDICE_RESEND_API_KEY` ist bereits sicher in der serverseitigen `.env`
hinterlegt und wird hier nicht abgebildet. Der Schlüssel hat nur Versandrechte
für die verifizierte Domain `zockdiewandan.online`. SPF, DKIM und DMARC wurden
öffentlich geprüft. Der Absender benötigt kein Postfach, Empfang, Weiterleitung
oder Betreiber-CC.
Der konkrete DNS-Bestand, die Null-MX-Korrektur für die Absenderdomain und die
Prüfung vor Aktivierung stehen im [Versandprotokoll](MAIL_SETUP_2026-09-12.md).
Ein isolierter Prozess auf dem Produktionsserver hat Registrierungs- und
Reset-Mails erfolgreich an Resends simulierte Empfänger eingeliefert. Der
Adapter muss seinen expliziten Anwendungs-User-Agent senden; ohne ihn trat beim
Preflight `403 / 1010` auf. Zusätzlich bestätigte der Nutzer den Eingang echter
Registrierungs- und Reset-Testmails aus dem finalen Adapter. Sie waren als
Versandtest gekennzeichnet und enthielten keine aktiven Kontolinks. Empfangene
Mailheader wurden nicht ausgelesen; DNS und Provider-Domainprüfung sind
bestätigt. Den geprüften Adapter nach erfolgreichen Backend- und Browsertests
mit der Zielkonfiguration ausrollen.
Danach Gesundheit und `registration.email_enabled=true` in `/api/auth/me`
für beide Spiele kontrollieren. Der API-Key gehört ausschließlich in das
Produktions-Secret. Die Anwendung versendet Registrierungs-/Adressbestätigungen,
angeforderte Passwort-Resets und eine Bestätigung nach einem Reset.

Bei ausgeschaltetem E-Mail-Feature bleibt die vorhandene Registrierung mit
Benutzername und Passwort nutzbar. Angenommene Mailanfragen werden nach der
HTTP-Antwort versandt; ein Neustart vor dem Versand kann eine Wiederholung
erfordern. Recovery widerruft alle Sitzungen, Passkeys und offene
Adressänderungen. Vorhandene Passkeys können danach neu eingerichtet werden.

Passkeys dürfen erst mit den festen HTTPS-Origins aktiviert werden. Die RP-ID
muss genau dem Hostnamen von `ROLLTHEDICE_SITE_ORIGIN` entsprechen; Zilch darf
nur als kontrollierte Subdomain desselben Hosts erscheinen. V3 ergänzt den
festen Ursprung `https://hausdepp.zockdiewandan.online` ausschliesslich, wenn
dieser Host zur konfigurierten RP-ID gehört. Lokale Zwei-Origin-Konfigurationen
bleiben unverändert; es gibt keine frei konfigurierbare zusätzliche Originliste.
Die gemeinsame Anmeldung unter `/zilch/anmelden?return_to=/hausdepp...` bleibt
auf dem Hausdepp-Ursprung, damit auch installierte PWAs ihre sichere
WebAuthn-Anmeldung ohne fremdes Browserfenster verwenden.

**English:** The RP ID must remain the configured site hostname. V3 adds only
the fixed `https://hausdepp.zockdiewandan.online` origin when that hostname is
a child of the configured RP. Local two-origin setups remain unchanged; no
arbitrary extra-origin list is accepted. Hausdepp serves shared sign-in on its
own origin, preserving native passkey login inside its installed PWA.

Vor der Freigabe auf
einem vorgesehenen Testkonto Registrierung, Anmeldung, Entfernen und Passwort-
Fallback testen. Keine Versions-Pushes, Testmails oder Versuche gegen echte
Spielerkonten auslösen.

## Manuelles Deployment

Beide Apps verwenden dieselbe Produktversion aus `app/version.json`. Vor dem
Commit der nächsten Änderung mit `scripts/product_versions.py bump major|minor|patch`
und den Parametern `--summary-de`/`--summary-en` erhöhen: Der Befehl archiviert
den bisherigen `HEAD` als Vorgängerversion. Danach Changelog und Release-Notiz
pflegen. Der Deploy prüft die Versionsfolge auch bei einem stillen Rollout;
ein erneuter Deploy desselben Commits benötigt keine neue Nummer. Nach einem
erfolgreichen Rollout den ausgelieferten Commit als `v<Major.Minor.Patch>` taggen.

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
python3 scripts/product_versions.py check --previous "$previous_revision"
# Set SILENT_RELEASE=1 only for an explicitly silent rollout.
if [[ "${SILENT_RELEASE:-0}" == "1" ]]; then
  release_notice='{"skip":true}'
else
  release_notice="$(python3 scripts/prepare_release_notice.py --previous "$previous_revision")"
fi
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
Auch diese Korrektur erhält eine neue Patch-Version; frühere Versionsnummern
werden weder wiederverwendet noch umgeschrieben.

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
