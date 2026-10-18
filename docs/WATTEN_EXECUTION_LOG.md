# Watten – Ausführungsstand

**Beginn:** 18.10.2026, Europe/Zurich. Codex führt Umsetzung und Integration.
Arbeitszweig: `codex/watten-implementation`, eigener verwalteter Worktree
`/Users/manuel/.codex/worktrees/watten-implementation/RollTheDice`.

## Verbindliche Basis

- Frisch abgerufenes `origin/develop`: `80bc42df17eb5852a5153582b263f6d065138f35`.
- Vollständiger lokaler Planungsstand `2d82eba9c6ca9670e26571f71df1346f86a1cbae`
  per normalem Merge übernommen. Der ältere Remote-Planungsbranch genügt nicht.
- [Übergabe](WATTEN_EXECUTION_HANDOFF.md), sechs Fach-/Retrospektivdokumente,
  AGENTS, Produktlieferung, lokale Prüfungen und Deployment sind die Quellen.
- Alle **81 IDs** aus dem [Umsetzungsplan](WATTEN_IMPLEMENTATION_PLAN.md)
  bleiben verpflichtend. [Statusinventar](WATTEN_FINDINGS_STATUS.json) führt jede
  einzeln; Teilfortschritt bedeutet keine erledigte Watten-Abnahme.
- Ausschliesslich eigene Worktrees ändern; kein Master-/App-Deploy ohne
  gesonderte Releasefreigabe. Infrastrukturauftrag für den festen Wattenhost
  ist erteilt; ein geschlossener HTTPS-Host ist noch keine Spielveröffentlichung.

## Arbeitspakete und Eigentum

| Paket | Zuständigkeit / Dateien | Stand und Abnahme |
| --- | --- | --- |
| Bestehender S25-Spielwechsler-Race | Codex-Mitarbeiter `game_picker_race`, eigener Worktree `watten-picker-race`; `frontend/multigame/app-mode.js`, gezielter Browserfall und daraus gebaute Bundles | Früher zweiter Auth-Refresh gezielt blockiert; Regression schlägt am alten Code fehl. Initiale Bereitschaft sichtbar machen; Quelle und Nachweis vor Übernahme prüfen. Kein Retry als Korrektur. |
| P1 feste Hostgrenze | Codex-Mitarbeiter `p1_contracts`, eigener Worktree `watten-readiness`; `app/product_hosts.py`, `app/watten_readiness.py`, schmale ASGI-Einbindung, `tests/test_watten_readiness.py` | Commit `c323e53` als `beaa32c` übernommen. Quellprüfung durch Lead und unabhängigen Codex-Reviewer ohne handlungsrelevanten Befund. HTTP und WebSocket vor bestehenden Produkten geschlossen; kein ZDWA-Fallback und keine fremde Manifest-/Workeridentität. |
| P1/P8 DNS, Origin, TLS | Codex-Mitarbeiter `infrastructure_audit`, eigener Worktree `watten-infrastructure`; separater geschlossener Nginx-Vhost, Watten-Aktivierungshelfer, gezielte Tests | Quellcommits `cd571dd`/`2577864` als `e4ad21f`/`04f4067` übernommen. Geschlossene Liveaktivierung am 18.10.2026 um 16:30:55 Zurich erfolgreich geprüft; keine App-Veröffentlichung. Details unten. |
| P0 Owner-Entscheidungen | Owner; [Entscheidungsprotokoll](WATTEN_OWNER_DECISIONS.md) | Bestätigt: 2er offen mit normaler oder ladinischer Bestimmung, 3er rotierendes Solo mit beiden Ansagen, 4er blind/ladinisch; Guter/Kritische standardmässig aus. Weli-Kritisch-Ausnahme, Gebotsstillstand und gestrichene Antwortrechte geklärt. Konkrete Deck-/Rollen-/Dreierwertungs-/Weli-Ansagefälle nachgefragt. Abhängige Regeln werden nicht geraten. |
| P1/P7 Integrationsinventar | Codex Lead; [P1-Verträge](WATTEN_P1_CONTRACTS.md) | Quellen geprüft. Host, Konto, Passkeys, PWA, Push und Runtime besitzen unterschiedliche Register; kein einzelnes Register schaltet Watten vollständig frei. |
| P1 native Kontoreise | Codex-Mitarbeiter `p1_contracts`, eigener Worktree `watten-readiness`; dedizierter Router und schmale gemeinsame Kontoerweiterungen | Commit `806eb0b` als `9bda650` übernommen; Lead-Quell-/Bildprüfung und unabhängiger Review. Lokale Vorschau benötigt ausdrückliches Flag plus Loopback-/localhost-Ursprung und Requesthost. Produktionsorigins bleiben geschlossen. Registrierung, Anmeldung, Passkeys, Profil/Sprache/E-Mail/Passwort und Recovery nutzen dasselbe Konto; keine PWA-/Push-/Spielruntime. |
| Private Sicht und CPU-Wissen | Claude Desktop, neue Sitzung `local_a873664f-eae5-45e3-9a6b-e0a10761ab9e`; nur Leseprüfung | Abgeschlossen, keine Änderungen/Tests/Pushs. Codex hat negative Prüfideen in die P1-Verträge übernommen und Aussagen zu blinder Trumpfpflicht, späteren öffentlichen Zuständen und laufendem CPU-Ersatz ausdrücklich eingegrenzt. |

## Verifizierter Infrastrukturstand zum Start

- `watten.zockdiewandan.online`: DNS `NXDOMAIN`, HTTPS daher noch nicht erreichbar.
- Cloudflare-Zone ist administrativ erreichbar. Fünf bestehende A-Einträge
  zeigen proxied auf den eigenen Origin; Watten ist noch nicht angelegt.
- Origin über `ssh zdwa`: sauberer produktiver Master `80bc42d`, Backend nur
  auf `127.0.0.1:8000`. Nginx-Syntax gültig; bestehende Warnungen für doppelte
  Port-80-Defaultnamen dokumentieren, nicht ungefragt umbauen.
- Certbot-Timer aktiv. Bestehende Zertifikatslinien für Apex/www/ZDWA/Zilch
  und Hausdepp bleiben erhalten; kein Watten-Zertifikat oder Vhost vorhanden.
- Search Console: Domain-Property `sc-domain:zockdiewandan.online` ausgewählt;
  Einstellungen bestätigen den aktuellen Benutzer als verifizierten Inhaber.
  Keine Sitemap eingereicht; das bleibt von öffentlicher Releasefreigabe und
  erfolgreichem HTTPS-/Canonical-/Sitemap-Smoke abhängig.
- Präzisierung der Liveprüfung: Cloudflare zeigt derzeit **Full (automatic)**,
  nicht bestätigt Full (strict). Die vorhandene zonenweite Einstellung wird
  nicht nebenbei geändert. Die Search-Console-Domain-Property
  `sc-domain:zockdiewandan.online` ist vorhanden; verifizierte Inhaberschaft
  wurde anschliessend direkt bestätigt.

### Abgeschlossene geschlossene Domain-Aktivierung

**Prüfzeit:** 18.10.2026, 14:30:55 UTC / **16:30:55 Europe/Zurich**.
Exakt ein neuer Cloudflare-Eintrag: A `watten` → `217.154.16.72`, Proxied,
TTL Auto; im Dashboard gespeichert und zurückgelesen, über Google- und
Cloudflare-DoH sowie öffentlichen Originaufruf verifiziert. Ein zuvor negativ
abgefragter Macresolver hielt zwischenzeitlich NXDOMAIN im Cache; kein Flush
und keine TLS-Ausnahme. Lead-Gegenprüfung via verifiziertem HTTPS/DoH liefert
`robots.txt` mit HTTP 200, no-store/noindex und exakt `Disallow: /`.

- Operatorverzeichnis: `/home/manuel/watten-reservation-20261018T142543Z`,
  ausserhalb des sauberen Produktionscheckouts. Übertragene SHA-256 lokal und
  remote identisch. Quellstand `2577864be96abf3c095e150a3d685b8ca4e74283`.
- Script-SHA-256: `04825f7d10c1df01a53e4b64fb8d193e1d6bd881164d39b2321fda5441c8adc4`.
- Konfigurations-SHA-256: `6a6fa234252a7b272aaa921c102aae86ba2e65e3c10cd1f55120614d2df9932f`.
- Ziel `/etc/nginx/conf.d/watten-reserved.conf` war vorher nicht vorhanden;
  daher keine vorige Watten-Datei/Backup. Bestehende Sites unverändert.
- Separate Zertifikatslinie `watten.zockdiewandan.online`, gültig bis
  **16.01.2027, 13:29:15 UTC**; Hostname und Vertrauenskette geprüft.
  Zertifikatsspezifischer `certbot renew --dry-run` erfolgreich.
- Eigener Hook:
  `/etc/letsencrypt/renewal-hooks/deploy/rollthedice-watten-nginx-reload.sh`.
  Temporärer ACME-Vhost nach Abschluss entfernt. Certbot-Timer weiterhin aktiv.
- Öffentlich und am Origin: `/`, Konto-API, Worker-, Sitemap- und Socketpfad
  liefern 503 mit DE/EN-Hinweis, no-store/noindex, ohne Cookie oder Upstream.
  `robots.txt` liefert 200 und sperrt vollständig. Keine Sitemap eingereicht.
- Alle fünf bisherigen Hosts bleiben gesund (200, ZDWA-Alias 308). Firewall
  und Cloudflare Full/automatic unverändert; direkter Originzugriff bleibt
  gesperrt. Produktions-Git sauber auf `master=80bc42d`, Containerstartzeit
  weiterhin 12:42:16 UTC: **kein App-Deploy oder Containerneustart**.
- Rückweg umfasst ausschliesslich den einen neuen DNS-Eintrag und die eigenen
  Watten-Dateien. Vor Rücknahme Belege erhalten, Nginx prüfen und graceful
  reloaden; bestehende Zertifikate, Hosts, Firewall und Daten erhalten.

Vollständige Livebelege liegen lokal im Infrastruktur-Worktree unter
`test-results/watten-infrastructure-20261018T142543Z/postflight.json` mit Logs
und als Kopie im Operatorverzeichnis. Die ignorierten Belege vor späterer
Worktree-Archivierung separat sichern.

## Prüfungen und Liefergrenzen

Der alte Planungs-Volllauf ist **rot** und kein verwendbarer Nachweis.
Gezielte Entwicklungsprüfungen werden getrennt von der vollständigen Prüfung
auf sauberem fertigem Commit geführt. Vor jedem Push: frischer Fetch,
Develop-Abgleich, `push:checked`; keine zweite Vollsuite neben fremdem Vollpool.

- S25-Gegenlauf: neuer gehaltener-Auth-Test scheitert am alten aktiven Button.
- S25-Fix: gezielter isolierter Browserlauf meldet 14 bestanden und einen
  optionalen Capture-Skip; Lint bestanden. Quelle/Test geprüft und Commit
  `9724351` als `cac1aab` in den Ausführungsbranch übernommen. Globale
  Asset-Fingerprints werden nach Integration aller Pakete synchronisiert.
- Hostgrenze plus Proxy/HTTP-Shell/Navigation: Lead-Gegenlauf nach globaler
  Assetsynchronisierung **41 bestanden, 341 Subtests**. Vor der Synchronisierung
  scheiterten fünf HTTP-Shell-Assertions erwartbar an den noch alten
  Fingerprints; nach Neubau unverändert grün. Keine Wiederholung verdeckt einen
  Produktfehler.
- Lint und Produktversionsprüfung gegen den tatsächlich ausgelieferten
  Vorgänger `80bc42d` bestehen. Vorbereitete Patchversion `3.10.1`; neue
  historische Zuordnung für 3.10.0 verwendet ausdrücklich den Deploy-Commit,
  nicht einen Zwischencommit. Bestehende Zuordnungen unverändert.
- Infrastruktur: neun gezielte Shell-/Konfigurationstests inklusive 21
  Subtests bestanden. Echte isolierte lokale Nginx-/TLS-/HTTP-01-Prüfung und
  unabhängiges Quellreview ohne bestätigten handlungsrelevanten Befund.
  Eine zunächst vermutete HTTP-Default-Änderung wurde am tatsächlichen
  expliziten IPv4-/IPv6-Default ausgeschlossen und als Preflight abgesichert.
- Native Kontoreise: **106 gezielte Backendtests und sechs Chromium-
  Browserfälle** DE/EN bestanden. Echte virtuelle Passkeysignaturen und
  Browserzeremonien, E-Mail/Recovery mit gemocktem Versand, Logout-401,
  Kontowechsel und BFCache geprüft. Alter Kontowechselfehler wurde am
  gespeicherten Sprachwert von B reproduziert und gezielt korrigiert;
  kein Retry als Ersatz. Pending Mutationen bleiben an Ausgangskonto/CSRF
  und Seitengeneration gebunden. Private DOM-Inhalte werden vor BFCache
  entfernt; Wiederherstellung lädt eine neue Identitätsprüfung.
- Integrierter Lead-Gegenlauf mit Watten-Konto/Host/Passkeys/Infrastruktur,
  Navigation und Version: **45 Tests, 386 Subtests bestanden**. Lint grün;
  unabhängige Nachprüfung der BFCache-/Mutationskorrekturen ohne Restbefund.
- Lead hat die 320×844-DE- und 568×320-EN-Screenshots visuell geprüft;
  schmale Überschrift/Sprachwahl passen, normales vertikales Scrollen bleibt
  möglich. Keine physische Geräte-/PWA-Abnahme daraus ableiten.
- Generated-Konflikte beim Kontomerge: 49 Asset-/Fingerprintkonflikte,
  HTML/Manifeste nach Normalisierung der Hashwerte identisch. Quellen
  konfliktfrei zusammengeführt, alle Bundles/Fingerprints gemeinsam neu gebaut;
  Spielwechslerkorrektur bleibt in der Quelle enthalten.
- Noch kein neuer vollständiger Pushnachweis, Push, PR, Develop-Merge,
  App-Deploy oder physischer Gerätenachweis.
- Erster vollständiger Lauf auf `efa2200` am 18.10.: Qualität und Tools
  bestanden; Backend **1387 bestanden, zwei fehlgeschlagen**, Coverage 84,37 %.
  Beide Fehler betreffen die alte pauschale HTML-Erwartung an ZDWA-Icons und
  `shell.js` für die zwei neuen eigenständigen Watten-Kontovorlagen. Der
  korrigierte Vertrag prüft deren eigene Module/CSS und schliesst fremde
  Spiel-/PWA-Identität ausdrücklich aus. Originalbericht unverändert unter
  `test-results/local-checks/efa2200df65a-1792334979297-9f652902/` erhalten.
  Dieser rote Lauf ist kein Pushnachweis; vollständige Wiederprüfung nötig.
- Zweiter Vollauf auf `d7977a3`: Qualität, Tools, **1389 Backendtests**,
  Produktionsimage, Containerprüfung, alle vier Haupt-Browserteile und drei
  Konto-/Passkeyteile sowie Diffprüfung bestanden. Der abschliessende frische
  Vergleich verweigerte den Push, weil Develop inzwischen auf `42ba267`
  weitergeführt wurde. Kein gültiger Vollnachweis/Push daraus abgeleitet.
- `origin/develop=42ba267` regulär integriert; Quelländerungen der dortigen
  Hausdepp-Tischfunktionen erhalten. 58 generierte/Metadatenkonflikte aufgelöst,
  echte HTML-Inhalte vor Fingerprintnormalisierung verglichen und Bundles aus
  den zusammengeführten Quellen vollständig neu gebaut. Weil Develop bereits
  3.11.0 führt, ist diese Korrektur nun **3.11.1**, keine erfundene veröffentlichte
  3.10.1. Bestehende historische Zuordnungen unverändert; neuer Vorgängerbeleg
  3.11.0 zeigt auf `42ba267`. Erneuter vollständiger Integrationsnachweis folgt.
- Fertige lokale PWA-Grundlage `b5d6e40`/`5e8cc3f` inzwischen als
  `36e258b`/`a1bbfe5` integriert: DE/EN-Manifeste, eigene Icons, enger
  netzwerkbasierter Worker und explizite Aktualisierung. 22 gezielte HTTP-
  Tests/Lint, **17 Konto-/echte-Worker-Browserfälle plus 19 Suite-Isolationen**
  im isolierten Autoren-Worktree bestanden, ohne automatische Wiederholungen.
  Unabhängiges Review fand und schloss die Identitätsdrift bei blockiertem
  Session Storage und späterer Navigation. Erste rote Browserartefakte bleiben
  erhalten: alte Request-Mocks wurden vom echten Worker umgangen, ein Test
  teilte versehentlich dieselbe Besucher-IP mit einem früheren Ratellimitfall.
  Nur Mock-/Besucherisolation korrigiert, keine echten Schutzgrenzen gelockert.
  Nach Zusammenführen Quellen/Assets neu gebaut; Root-Vollnachweis steht aus.

## Claude und Übernahmefähigkeit

Liveanzeige am Start: **97 % Sitzung / 82 % Woche**. Angezeigter Sitzungsreset
17:20, Wochenreset Freitag 20:00. Das ist eine Momentaufnahme.
Die angefragten Heartbeats werden vom Planungs-Chat eingerichtet, hier keine
Duplikate anlegen. Vor neuen Paketen Quoten und aktive Aufgabe erneut prüfen;
bei Limit sofort selbst weiterarbeiten. Kein Kauf zusätzlicher Nutzung.

Owner-Nachtrag während der Umsetzung: Claude nun **98 % Sitzung**, höchstens
eine Mini-Aufgabe bis zum Reset. Codex gibt bis 17:20 keine weitere Aufgabe;
der kleine Leseauftrag ist abgeschlossen. Beim Wakeup Sitzung **und**
Wochenlimit live prüfen, bevor ein neues abgegrenztes Paket startet.

Weiterer Owner-Auftrag: Nach dem Reset Claude stärker für sinnvolle,
überprüfbare Umsetzungspakete einsetzen und sein nutzbares Kontingent soweit
möglich ausschöpfen, um das ebenfalls knappe Codex-Kontingent zu schonen.
Beide bestehenden Heartbeats im Ausführungs-Chat wurden entsprechend
aktualisiert; Zeitplan und Zuordnung bleiben erhalten, kein Duplikat.
Keine künstlichen Verbrauchsaufträge, Zusatzkäufe oder Tarifänderungen.
Codex bleibt für Review, Integration und nahtlose Übernahme zuständig.

Owner hat den Arbeitsstart anschliessend ausdrücklich auf **17:15** vorgezogen.
Live vor Vergabe: 98 % Sitzung / 83 % Woche. Auftrag um 17:15:30 über die
vorhandene Claude-Code-Sitzung tatsächlich gestartet, eigener vorbereiteter
Worktree `watten-deal-engine`, Branch `codex/watten-deal-engine`, Basis
`dfe2071`, nur neue `app/watten_play.py` und `tests/test_watten_play.py`.
Aufgabe: reine Karten-/Stichübergänge nach bestätigter Ansage; keine Runtime,
API, UI, schweren Tests oder Pushes. Begrenzter Auftrag und Übernahmevertrag
stehen dort in `docs/WATTEN_ENGINE_HANDOFF.md`. Nach dem echten Sitzungslimit
zeigt die Oberfläche nach Reset bereits eine laufende Wiederaufnahme; keinen
doppelten Auftrag senden. Einmaliger Wakeup als erfüllt pausiert, laufende
Quotenbeobachtung bleibt aktiv. Aktueller feiner Übergabestand zusätzlich
ignoriert unter `test-results/watten-coordination/claude-status.json`.

## Nächster unabhängiger Schritt

Das integrierte P1-/Race-/Infrastrukturpaket wird auf sauberem Commit mit dem
vollständigen lokalen Ablauf geprüft und per überprüfbarem PR gegen Develop
übergeben. Der exakte Vollnachweis entsteht in den ignorierten lokalen
Prüfberichten und dem veröffentlichten Owner-Status; dieser vorbereitende
Logeintrag behauptet ihn nicht vorab. Parallel können reine Karten-/Regel-
Grundlagen in einem weiteren eigenen Worktree beginnen. Offene Profilteile
bleiben ausdrücklich gesperrt; PWA/Push/Suite-Runtime und P2–P8 sind weiterhin
umzusetzen, keine Watten-Gesamtabnahme.

**English:** Implementation has started in an isolated develop-based worktree
with the complete local handoff merged. All 81 findings remain in scope.
The initial packages fix the existing picker race and establish closed host,
route and infrastructure boundaries while rule decisions remain open. Local
checks, integration, infrastructure activation, public app deployment and
physical-device acceptance are separate evidence stages.

## Weiterer Develop-Abgleich

Vor dem erneuten Vollauf wurde nach Ende des fremden Vollpools auch
`origin/develop=766bcb3` (Hausdepp-Sammelreihen/Erfolge) regulär integriert.
Aktueller vorbereiteter Patch ist daher **3.12.1** nach 3.12.0; 3.11.1 wurde
nicht ausgeliefert und nicht als historische Version erfunden. Alle alten
Zuordnungen bleiben unverändert, der neue 3.12.0-Eintrag zeigt auf `766bcb3`.
PWA-Quellen sind inzwischen im gleichen Einstiegspaket enthalten; neuer
vollständiger Nachweis wird erst für diesen zusammengeführten Stand erzeugt.

Der erste integrierte PWA-Lauf auf `b6046e2` bestand Qualität und Tools;
Backend meldete **1430 bestanden, einen Fehler** bei der fehlenden ausdrücklichen
technischen Inventarzuordnung der drei neuen PWA-Ressourcen. Die drei Einträge
verweisen jetzt auf bestehende HTTP- und echte Worker-Browserprüfungen;
Dokument-/Zugangsprüfung wird nicht umgangen. Originalbeleg bleibt unter
`test-results/local-checks/b6046e24f168-1792337859380-126315df/` erhalten.


## 18.10.2026 – P1 vollständig geprüft und nach develop integriert

Der fertige P1-Stand `6c0924b859133ec1894b67cc52ef0f0c76425e48` bestand den
vollständigen lokalen Pushprüfer auf Basis
`766bcb3f0aa21593673b0f47112caa15e17856b3`: Qualität/Sicherheit, Tools,
**1431 Backendtests**, Produktionsimage/Container-Smoke und alle sieben
Browsergruppen (vier Hauptshards, Username, Passkeys, Hausdepp-Passkeys) grün.
Beleg: `test-results/local-checks/6c0924b85913-1792338340226-df354d3b/`;
Browserlauf 15:48:18–15:58:14 UTC / 17:48:18–17:58:14 Europe/Zurich.
Der geprüfte Stand wurde gepusht, [PR #52](https://github.com/Maetran/RollTheDice/pull/52)
normal als `da66185aa77a784cabc09a97d9e471eea6603aba` nach `develop` gemergt.
Erster Merge-Elternteil ist exakt die geprüfte Basis `766bcb3`, der Merge-Tree
ist identisch zum geprüften `6c0924b`; der schlanke Integrations-CI-Nachweis ist
grün. Das ist eine Develop-Integration, **kein App-Deploy**. Der geschlossene
Watten-Vhost und die gesonderte öffentliche Releasefreigabe bleiben erhalten.

## 18.10.2026 – integrierte reine P2/P3-Grundlage

Aktueller Quellstand ist `272cfdb48d1256374acf054b1862d6075f22937c` auf
`codex/watten-engine-core`. Die [Quellenübersicht](WATTEN_ENGINE.md) beschreibt
Karten/Vergleich, Bieten/Punkte, Karten-/Stichübergänge, Phasen, Raum/Rezept und
getrennte private Speicher-/Spielersichten. Noch keine Spieladapter-, Spiel-API-,
Datenbank-, Socket- oder Spieloberflächenanbindung; keine vollständige P2/P3-Abnahme.

- Karten/Regeln: Autorstand `b432b8b`, initial 28 gezielte serielle Tests;
  nach tatsächlicher Show-Bindung `dfe2071` zusammen mit Bieten 77 Tests
  (29 Karten/Regeln + 48 Bieten). Integriert als `99bea55` und `5b59d02`.
- Bieten/Punkte: Autorstand `9545edf`, 48 gezielte serielle Tests;
  unabhängige Quellenprüfung, integriert als `c3275fa`.
- Karten-/Stichübergänge: Claude `06aab43`, unabhängig vom Lead mit
  **85** Tests in `tests/test_watten_play.py` seriell geprüft; gezieltes Ruff
  und unabhängige Quellenprüfung. Integriert als `664cf71`.
- Raum/Rezept: Claude `bce2853`, Review fand fehlende Mitglieder-Kapazitätsgrenze
  beim Wiederherstellen; Korrektur `9bb783c`, integriert als `1299d9d`/`f0c17a5`.
  Leadnachweis: **157 gezielte serielle P2/P3-Integrationstests**; dies ist kein
  ausschliesslicher Raumtest-Zähler und kein neuer Vollnachweis.
- Phasen/private Sichten: `aca3bc3`, 53 gezielte serielle Tests laut Autor,
  dazu gezieltes Ruff/Bandit/Vulture und unabhängige Quellenprüfung;
  integriert als `272cfdb`. Reviewkorrekturen: offene ladinische Ansage einmalig
  zustellen; ACK-Aufbewahrung pro Akteur isolieren, damit private Rückmeldungen
  keine fremden ACKs verdrängen. Konten sind positive Integer, keine Bool-Aliase.

Diese kleinen Nachweise ersetzen **nicht** den nächsten vollständigen lokalen
Prüflauf für den fertigen, committeten Engine-PR inklusive Metadaten. Dieser
Vollnachweis steht noch aus. Alle 81 Befunde bleiben verpflichtend; nur konkrete
reine Grundlagen werden als Teilfortschritt erfasst. S25 bleibt unverändert:
der bestehende Picker-Race ist behoben, Watten-spezifische Oberflächenabnahme offen.

Offene Runtime-Abnahme: Transaktion/Sperre, Berechtigung nach Sperrwartezeit,
Socketentmachtung, dauerhafte atomare Punkte-/Zustandsbuchung und richtiger
privater Fanout. Einmalige offene Ansagen brauchen eine atomare dauerhafte
Zustellung bis zum ersten Empfang jedes berechtigten Empfängers. Ein Absturz
zwischen Commit und Broadcast darf C/D nicht ohne jemals erhaltene Ansage lassen;
das erlaubt weder erneutes Einschauen noch eine dauerhafte Referenz bei Option AUS.

Die nächste Claude-Aufgabe ist durch den gesperrten Mac blockiert; der Owner
wurde um Entsperren gebeten. Keine Umgehung der Sperre. Die Backend-Runtime-Arbeit
erfolgt separat; Produktionsspiel und öffentliche Einreichung bleiben geschlossen.
