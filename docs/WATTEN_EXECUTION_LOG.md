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

## 18.10.2026 – reine Engine integriert, nächste Runtime und CPU-Aufgabe

Der fertige Commit `fe6bc46dafa4d4acb1a9d4e7b25dbdf2805f3432` bestand alle
sieben vorgeschriebenen lokalen Prüfgruppen auf Basis
`da66185aa77a784cabc09a97d9e471eea6603aba`: Qualität/Sicherheit, Tools,
**1803 Backendtests, 85.00 % Coverage**, Image/Produktionscontainer, vier
Haupt-Browserteile plus drei Kontosuiten und Diff. Beleg:
`test-results/local-checks/fe6bc46dafa4-1792339856260-3e4d3b35/`.
Der geprüfte Stand wurde mit veröffentlichtem Owner-Status über
[PR #53](https://github.com/Maetran/RollTheDice/pull/53) normal als
`8d914e1bd4f21e304400e1b73d4690527f654018` nach `develop` übernommen.
Erster Elternteil ist exakt die geprüfte Basis, der Merge-Tree entspricht
exakt `fe6bc46`; PR- und anschliessende Integrations-CI sind grün.
Kein App-Deploy und keine öffentliche Spielabnahme sind damit verbunden.
Präzisierung des früheren kleinen Raum-Nachweises: **157** Tests ausschliesslich
in `tests/test_watten_room.py` und `tests/test_watten_recipe.py`, ohne Biettests.

Der Desktop-Blocker wurde für die Folgearbeit aufgelöst, indem die bereits
installierte offizielle Claude-Code-Kommandozeile mit ihrer bestehenden
`claude.ai`-Pro-Anmeldung verwendet wird. Keine Bildschirmsperre, Zugangsdaten
oder Kontoeinstellungen wurden verändert. Die tatsächliche CLI-Quotenmeldung
beim CPU-Start zeigte 17 % Sitzung / 85 % Woche; Zusatznutzung ist ausdrücklich
deaktiviert (`overageEnabled=false`, `isUsingOverage=false`). Die Werte sind
Startmomentaufnahmen. Der Owner hat den Mac inzwischen als entsperrt gemeldet;
der laufende CLI-Auftrag wird dadurch nicht doppelt im Desktop gestartet.

Claude bearbeitet im eigenen Worktree `watten-cpu-policy`, Branch
`codex/watten-cpu-policy`, den begrenzten Auftrag aus
`docs/WATTEN_CPU_HANDOFF.md`: vier eigene neue CPU-/Gedächtnisdateien, nur
persönlich erlaubte Beobachtungen, keine realen fremden Hände oder Stockdaten,
keine Runtime-/UI-Überschreibung oder schweren Prüfpools. CLI-Sitzung
`7e795ad8-574c-4b3e-b935-fcb625153e48`, Start-Commit `4402c36`;
feiner Livezustand und Protokollpfad stehen ignoriert in der Koordinationsdatei.
Die vorhandene 15-Minuten-Beobachtung wurde um diesen überprüfbaren CLI-Weg
ergänzt; der erfüllte einmalige Wakeup bleibt pausiert.

Neu bestätigt: Beim bewussten Verlassen einer laufenden Viererpartie wartet
die Partie auf die Rückkehr des Spielers. Der separate Runtime-Autor setzt
die dauerhafte Abwesenheit, Pause und frisch kontogebundene Wiederaufnahme
mit eigener Lebenszyklusversion konsistent für 2/3/4 um. Sitz, Hand, Ansage,
offenes Gebot und Punkte bleiben erhalten; kein CPU-Ersatz, Forfeit oder
Abbruch wird erfunden. Wiederkehr gibt kein erneutes Einschauen frei.
Diese neue Runtime-Änderung hat noch keinen Integrations-Vollnachweis.

## 18.10.2026 – lokale native Runtime, Prüfung vor nächstem PR

Auf `codex/watten-runtime-integration`, Basis `8d914e1`, wurden die getrennt
verfassten Runtime-Commits `9d6c87c`, `314fcfa`, `934efe0` und `c55ad80`
als `3f5b034`, `58a9abd`, `5b136e3` und `184ff77` integriert. Sie verbinden
Raum/Engine mit bestehenden Konten, eigenen HTTP-/Socketpfaden, explizitem
Speicherformat und einer atomaren Ergebnis-/Checkpointtransaktion. Die eigene
lokale Spielvorschau bleibt durch Flag, konfigurierten lokalen Ursprung und
strikten Requesthost begrenzt; der feste Produktionshost bleibt geschlossen.
CPU-Ausführung ist ausdrücklich noch nicht verfügbar.

Unabhängiger Lifecycle-Review schloss drei konkrete Fehler nach Korrektur:
veraltete Wiederaufnahme einer früheren Abwesenheit, wiederholtes Leave mit
Trennung einer neuen Verbindung und private Zustellung nach einem Logout
während eines wartenden Broadcasts. Der breitere Review fand zusätzlich
eine asymmetrische Speichergrössengrenze, unvollständige generische Löschung
eines terminalen Wattenresultats und einen fehlerhaften Fallback beschädigter
nativer Checkpoints in den Legacy-Lader. Die Korrekturen behalten strikte
Schemata, erhalten beschädigte Zeilen und sperren die noch nicht atomar
ausgearbeitete Resultatlöschung ausdrücklich. Der finale breite Quellreview
hat `c55ad80` ohne weitere handlungsrelevante Befunde freigegeben. Er umfasst
keinen echten PostgreSQL-Serverlauf oder eine öffentliche Produktfreigabe.

Lead-Gegenlauf: **37 Tests** in `tests/test_watten_runtime.py` und
`tests/test_watten_results_migration.py`, seriell `-n 0`, **11.95 Sekunden**.
Die Fälle umfassen echte HTTP/WebSocket/SQLite-Partien aller drei Spielerzahlen,
Neustart, doppelte Finalisierung, fehlgeschlagene Transaktion mit korrektem Retry,
Pause/offenes Gebot, mehrere Abwesenheiten, veraltete Befehle und entzogene
private Zustellung. `npm run lint` bestand vor der letzten kleinen
Laderkorrektur; der vollständige Nachweis für den finalen Commit steht noch aus.
Vorbereitete interne Patchversion ist 3.12.3; 3.12.2 verweist auf den echten
Develop-Merge `8d914e1`, bestehende ältere Zuordnungen bleiben erhalten.

Claude bearbeitet inzwischen zusätzlich die eigene menschliche Spieloberfläche
im wiederverwendeten, sauberen eigenen Worktree `watten-pwa` auf
`codex/watten-ui`. Der alte PWA-Branch und ignorierte Belege bleiben erhalten.
Ein frischer offizieller CLI-Auftrag besitzt nur fünf Watten-Frontendmodule,
CSS, zwei HTML-Seiten, Übersetzungen und einen Browserfall. Root besitzt
Backend-Seiten, Build/Testkonfiguration und Integration; ein Codex-Mitarbeiter
schreibt disjunkte Seiten-/Navigationsprüfungen. Keine doppelte CPU-Aufgabe.
Aktuelle Quotenwerte und Prozessbelege bleiben in der ignorierten Koordination.
Automatisch abgewiesene CPU-Testbefehle hatten nicht die enge freigegebene
Schreibweise; sie gelten nicht als ausgeführt und werden nicht umgangen.

**English:** Local native runtime source and 37 focused transport/storage tests
are integrated on the next feature branch. The broad final audit and exact
full-check receipt remain pending. Claude separately implements bounded CPU and
human UI packages; production and full Watten acceptance remain closed. All81
findings remain required, including progression, suite services and device QA.

## 18.10.2026 – native Runtime nach develop integriert

`598af7ac376bffa78b2cfb008a02ffa1fd5e978e` bestand auf Basis `8d914e1`
alle sieben vollständigen lokalen Prüfgruppen: Qualität/Sicherheit, Tools,
**1’840 Backendtests, 84.87 % Coverage**, Produktionsimage/Container,
vier Haupt-Browserteile und drei Kontosuiten sowie Diff. Beleg:
`test-results/local-checks/598af7ac376b-1792342778581-3160f590/`.
Owner-Status und PR-CI grün; [PR #54](https://github.com/Maetran/RollTheDice/pull/54)
wurde normal als `f6e0e89185d8aa862335b773adeff1c3bc021dd9` übernommen.
Erster Elternteil ist exakt `8d914e1`, der Merge-Tree entspricht dem geprüften
`598af7a`; anschliessende Integrations-CI ebenfalls grün. Kein App-Deploy.
Nächste Integration auf `codex/watten-game-integration` ab `origin/develop=f6e0e89`.

Claudes erstes CPU-Paket `42ccf4c` ist ausdrücklich **nicht abgenommen**:
Lead-Ruff/Bandit/Vulture grün, erster tatsächlicher Testlauf **5 fehlgeschlagen,
62 bestanden, 3.92 Sekunden**. Vier Fälle betreffen freiwilliges endloses
Aufbieten bei bereits partieentscheidendem Einsatz, ein Fall unnötiges Opfern
eines Schlags. Unabhängige Reviews bestätigten zusätzlich zwei strikte
Gedächtnis-/DTO-Prüflücken. Eine eigene neue Claude-Aufgabe korrigiert nur diese
vier Dateien; Tests führt Root aus. Drei fehlende Profilkombinationen werden
vor der endgültigen CPU-Abnahme ebenfalls geprüft. Der getrennte Runner bleibt
bis zur bestätigten Policy ausdrücklich ohne freigegebenes Autoplay.

## 18.10.2026 – lokale Spieloberfläche und CPU zusammengeführt

Claudes offizielle CLI-Aufträge endeten am Sitzungslimit. Es wurde kein
Overage verwendet. Root übernahm die tatsächliche Prüfung und Korrektur der
CPU-Policy sowie des ungetesteten Oberflächen-Checkpoints. Die zuvor genannten
CPU-Befunde sind geschlossen: freiwillige Aufbietschleifen bei bereits
partieentscheidendem Einsatz, unnötiges Opfern in sicher verlorenen Stichen,
unzulässig rekonstruiertes Blindwissen und zu früh sichtbare Karten. Alle zwölf
Profile sind in den gezielten Tests enthalten. Die kleine Paarmessung liefert
keinen allgemeinen Spielstärkenachweis; breitere Kalibrierung bleibt offen.

Der native CPU-Runner speichert erlaubtes Gedächtnis vor dem Schliessen des
Einschaufensters und verwirft alte Fristen bei Pause, Zustandsersatz oder neuer
Gelegenheit. Fehlerhafte Speicherung installiert keinen Spielzug und startet
keine Wiederholungsschleife. Root-Gegenlauf über Policy, Gedächtnis, Runner,
native Runtime und Resultmigration: **157 Tests bestanden, 17.96 Sekunden**.

Die DE/EN-Oberfläche ist in `1a98ec8` integriert: öffentliche lokale Lobby und
Regeln, manuelle Sitze/Viererteams, CPU-Platzwahl und -Entfernung, absichtlicher
Start, Bieten, Einschauen, persönliche Referenz und Partnerberatung. Routen
verlangen beide lokalen Preview-Flags, sichere Rückwege und Noindex/No-store.
Die Hand wird erst nach erfolgreichem Bilddekodieren verbunden. Frische
Anmeldung vor jeder neuen Verbindung und ein serverseitig unter derselben
Sperre geprüftes `expected_account_id` verhindern fremde Kontobindung. Ein
verlorenes Leave-ACK führt zu einer lesenden Klärung, keiner neuen Aufnahme.

**13 isolierte Browserfälle bestanden in 45.8 Sekunden**:
`test-results/browser/watten/integrated-game-1/`. Echte Zwei-/Drei-/Vierertische,
Zweierabschluss mit offenem Gebot/Pause/ausdrücklicher Rückkehr, private
Dreierberatung, blinde Einschauerrollen, alle CPU-Sitzanzahlen und ein
dauerhafter Zweierabschluss gegen CPU sind enthalten. Weitere Fälle prüfen
Kontowechsel während verzögerter Bilddekodierung, explizite Persisted-Page-
Ereignisbehandlung, verlorenes Leave-ACK und frische gegenüber alten Taps.
Mobile Geometrie ist bei 320×568, 568×320, 667×375 und 768×700 geprüft; der
gefundene schmale Querformatüberlauf wurde in der Quellgeometrie behoben.
Persisted-Page-Ereignisse sind kein Nachweis physischer BFCache-Eignung oder
einer echten Telefoninstallation. Unabhängiger Quellenreview von `1a98ec8`
bestätigt die fünf früheren UI-Befundgruppen als geschlossen, ohne Geräteabnahme.

Seiten-, Konto-, Navigations- und Evidenzgegenlauf: **85 Tests, 196 Subtests,
4.61 Sekunden**. Der strikte öffentliche Evidenzadapter ist unabhängig geprüft;
v1-Resultate bleiben unverändert, unbekannte Profil-/Start-/Bietdaten UNKNOWN.
Ein zusätzlicher reiner Draft-Katalog bietet 22 Titel und 27 DE/EN-Ziele mit
10 XP je gültiger Partie und höchstens 2’110 einmaligen XP. Das ist eine
überprüfbare Kalibrierung, keine dauerhafte Vergabe oder Produktionsfreigabe.
Journal, Kontoseiten, Verlauf/Ranglisten und weitere Suite-Dienste folgen weiter.

Vorbereitete interne Funktionsversion ist 3.13.0. Die neu archivierte 3.12.3
verweist auf ihren tatsächlich geprüften Develop-Merge `f6e0e89`; bestehende
Zuordnungen wurden nicht verändert. Der exakte vollständige Nachweis für diese
neue Integration steht noch aus. Keine App-Veröffentlichung, kein Master-Merge,
keine Watten-Gesamtabnahme; alle 81 Findings bleiben im Umfang.

**English:** Native UI and personal CPU automation are now integrated locally.
Thirteen isolated browser cases and focused backend checks passed. Physical
devices, broader strength calibration, progression persistence/account views,
suite services and the new complete verification receipt remain outstanding.

Der erste Vollversuch auf `2d50dfc` bestand Qualität und 94 Tooltests, hielt
aber im Backend bei zwei veralteten Shell-Inventaren an: neue Watten-Spiel-
und Regelvorlagen wurden noch als ZDWA-Standardvorlagen geprüft. 2’056 weitere
Backendtests bestanden bei 85.33 % Coverage. Die Register führen jetzt die
zwei eigenen deferred Controller-/Stylesheet-Vorlagen ausdrücklich auf;
echte gerenderte Seiten prüfen zusätzlich beide Watten-Icons und schliessen
fremde Spiel-Icons aus. Gegenlauf: **27 Tests, 103 Subtests, 2.95 Sekunden**.
Der fehlgeschlagene Lauf ist kein Vollnachweis; nach dem neuen Commit wird
der vollständige Ablauf erneut ausgeführt.

Der zweite Vollversuch auf `17d769c` bestand Qualität, Tools, **2’058
Backendtests bei 85.33 % Coverage**, Produktionsimage und Containerprüfung.
Sechs von sieben Browserteilen bestanden. Der übrige Teil traf eine geteilte
Hausdepp-Testkonto-Voreinstellung: Das echte isolierte Admin-Konto stand auf
Englisch, die Überraschungs-Fixture setzte bei jedem Laden wieder Deutsch in
Local Storage. Die absichtliche Kontosprachsynchronisierung lud dadurch immer
neu, bevor der reale erste WebSocket-Spielstand ankam. Ein lesender Blick in
genau die Wegwerf-Datenbank bestätigte `Admin/en`; keine Produktionsdaten.
Die Fixture setzt nun vor dem Seitenstart auch die eigene Kontosprache. Eine
gezielt auf Englisch vorbereitete Regression und alle acht Zwei-Client-Effekte
bestanden: **9 Fälle, 17.9 Sekunden**, ohne Retries. Beleg:
`test-results/browser/watten/hdd-language-isolation/`. Dies bleibt ein
gezielter Gegenlauf; der neue Commit braucht weiterhin einen Vollnachweis.


## Spieltisch und CPUs nach develop integriert; lokales P6 wächst

PR #55 ist normal nach develop integriert: Source
`cdbbdb141b18fcc3b5da6ec8493a0b79aa1f44cb`, getestete Basis
`f6e0e89185d8aa862335b773adeff1c3bc021dd9`, Merge
`782972bcec9e53a741e43ddb561cf32a4d614dc6`. Der vollständige lokale
Prüfablauf bestand alle sieben Gruppen: 2058 Backendtests, 85.34% Coverage,
alle sieben Browserteile sowie Qualität/Tools/Container. Source-Ownerstatus,
PR-CI und Develop-CI grün. Unveränderter Merge-Tree durch den vorhandenen
Nachweisvertrag verifiziert; derselbe Quellenbeleg wurde übernommen.
Kein Master-/App-/Produktionsdeploy.

Der separate Konto-Branch verbindet die Draft-Journale 0067/0068, native
atomare Finalisierung, akzeptierte Gebotszählung, private Historie, Erfolge,
22 Wirtshaustitel, nachvollziehbare Ranglisten und Erfolgsfeed. Leser erzeugen
keine Vergaben. Historische unbekannte Ansagen/Gebote bleiben unbekannt.
Quellberechtigung und tatsächlicher eigener Beitrag werden vor aktuellen
Erfolgslabels geprüft; zukünftige Kataloge bleiben generisch archiviert bei
erhaltenen ursprünglichen XP. Beschädigte Journale oder Anzeigegrenzen
werden geschlossen abgelehnt. Titelprojektion hat keine DB-I/O, nur einen
privaten begrenzten Cache, der erst nach Commit installiert wird.

Sechs neue reale Konto-Browserfälle bestehen in 16.7 Sekunden: DE/EN-Ende
zu Konto/Verlauf/gefilterter Rangliste, explizite globale Bestätigung,
Initialfehler mit Wiederholung, überholte Ranglistenfehler, Kontowechsel
zwischen Identität und privatem Request sowie Match-Bestätigung/Reload bei
älterer ungesehener Partie. 320×568, 568×320 und 768×700 ohne Seitenscrollen.
Der erste Kontowechseltest hatte eine eigene fehlerhafte Interception-Freigabe;
der korrigierte Ablauf verwendet den tatsächlich gewechselten Cookiekontext.
Ein parallel zu einem Asset-Neubau gestarteter gezielter HTTP-Shell-Test
sah zwei unterschiedliche Assetstände; seine 16 Fälle bestehen nach stabilem
Build. Dies ist kein neuer vollständiger P6-Prüfnachweis.

Standalone CPU-Benchmark mit realem Policybudget24 und acht Seeds:
608/608 gepaarte Gaben über alle zwölf Profile, 11583 gültige Enginebefehle,
keine Fehler; Policy484 gegen Baseline124 Gabensiege. Karten-/Gebotslatenz
p50 1.1327ms, p95 3.4855ms. Die Baseline spielt erste erlaubte Karte, bietet
nie und hält immer. Synthetische, abhängige Gaben beweisen keine menschliche
Spielstärke oder Elo. Voller Bericht ignoriert gesichert unter
`test-results/watten-cpu-benchmark/run-20261018-default608.json`, SHA256
`4390ae5be880c1ecd824d735586590bdd1bcf4e384260e60e36e004209b23aac`.

Alle 81 Erkenntnisse bleiben verbindlich. Native Favoriten/Schutzwahl und
Folgetischreise werden separat ergänzt; Kommunikationsgrenze für freie
Nachrichten/Emojis bei gestrichen ist konkret beim Owner nachgefragt.
Physische Geräte, öffentliche PWA/SEO-Veröffentlichung und vollständige
Produktabnahme bleiben offen.

### P6/Favoriten – gezielter integrierter Stand vor Vollprüfung

Alle **23** isolierten Watten-Browserfälle bestehen in 1.2 Minuten unter
`test-results/browser/watten/account-favorites-cpu-final/`: die bisherigen
13 Spielreisen, acht Fortschritts-/Fehler-/Archiv-/Feedfälle und zwei
DE/EN-Favoritenreisen. Favoriten behalten CPU-Wünsche und Passwortschutz;
Anwenden leert das Passwort, ein neuer Tisch verlangt frisches Passwort oder
ausdrückliche Abwahl. Keine automatische Erstellung oder Startaktion.
Der Browserfahrer wartet jetzt nach «Nächste Gabe» auf die bestätigte neue
Gaben-ID. Der erste Zweier-CPU-Versuch hatte denselben Button zweimal angefragt,
während die nächste Gabe bereits lief; der Trace belegt beide Klicks. Der
Fahrer erzwingt nun eine erste Zweipunktegabe und prüft diesen Übergang immer.
Ein früherer eigener Favoritentest klickte die unsichtbare Checkbox statt
ihrer sichtbaren Beschriftung; nur der Testselektor wurde korrigiert.

Eigene alte Resultate ohne XP-Journal geben ein leeres Abschluss-Belohnungspanel
zurück, weiterhin ohne Backfill. Fremde Resultate bleiben unerreichbar. Sieben
native Fortschritts-HTTP-Fälle bestanden; Favoritenautorisierung wird nach
asynchronem Body/Worker erneut geprüft. Zwei echte Session-Widerrufe während
des Body-Reads lassen beide Kontofavoriten unverändert; 22 native HTTP-Tests
des Favoritenpakets bestanden. Quellreview und kleine Regressionen ersetzen
keinen Vollnachweis. Dieser folgt auf dem sauberen committeten Stand.

Owner bestätigt am 18.10.2026: Freier Chat und öffentliche Emojis bleiben
auch gestrichen während der Gabe erlaubt; Kartenhinweise bleiben verboten.
Die frühere offene Planformulierung wurde durch diese Entscheidung ersetzt.
Folgetisch-Backend/UI bleiben separat, bis ihre atomare Zwei-Checkpoint- und
Neustart-/CPU-/Stale-Writer-Prüfung und die Browserreise integriert sind.


### P6 integriert, P7 Folgetische und Kommunikation gezielt geprüft

PR #56 ist normal nach `develop` integriert: Source
`f3d50e235a0632806171225ee500892cb09535d2`, geprüfte Basis
`782972bcec9e53a741e43ddb561cf32a4d614dc6`, Merge
`a92258b628445a1ee88a0fe1afd18b1bf6c0acc8`. Alle sieben lokalen Prüfgruppen
bestanden, 2268 Backendtests und 85.75% Coverage, sämtliche Browser-/Kontoteile.
Source-Ownerstatus, PR-CI und Develop-CI grün. Merge-Tree exakt gleich Source;
zulässige Nachweisübernahme geprüft. Kein Master-/Produktionsdeploy.

P7 liegt separat auf `codex/watten-follow-up`. Die native Folgetischautorität
verknüpft zwei Checkpoints atomar und verwendet den Source-Link als dauerhafte
Identität. Stale Writer dürfen ihn nicht löschen; CPU-Memories sind vollständig.
Neue Kommandonamen, Antwortverlust und Neustart erzeugen keinen zweiten Tisch
und keine erneute Wertung. Eigene terminale/wartende Checkpoints können nach
Registry-Retirement gelesen werden. Laufende Recovery gehört zum vollständigen
Prozessstart samt CPU-Koordinator. Unabhängiges Review fand die zunächst fehlende
Expected-Account-Prüfung vor Recovery und die laufende Target-Installation beim
Retry; beide sind mit eigenen Regressionen korrigiert. Weitere Quellbefunde
blieben aus. Der Source-Chatcache bleibt bei Folgetischinstallation erhalten,
steht aber weiterhin nicht im Checkpoint.

Die eigene Sitzreservierung lässt sich nach bewusstem Beitritt freigeben,
ohne Sitz, Team, Start oder Wartefrist zu ändern. Zwei native Fälle prüfen
Replay nach Antwortverlust/Neustart, Rejoin, fremdes Accountfeld und veraltete
Room-Revision. Vier echte Menschen beenden eine offene Partie, geben alle
Reservierungen frei und wählen andere Teams vor manuellem Start: ein isolierter
Browserfall besteht in 8.7 Sekunden. DE/EN-Folgetischfälle mit absichtlich
verlorener HTTP-Antwort bestehen, ohne zweite Erstellung oder veränderte XP.

Tischchat und zwölf Emojis sind separate öffentliche Frames für aktuell
zugelassene Menschen/Zuschauer. 100 aktuelle Nachrichten und begrenzte
Accountkanäle sind nur flüchtig, kein Neustartverlauf. Frische Authentifizierung,
Moderation, 5/30-Rate und Wiederholungen ohne zweites Ereignis verändern keine
Engine, Ablaufzeit, Checkpoints oder XP. 52 integrierte Backendfälle bestanden
in 17.06 Sekunden. Drei reale Browserfälle bestehen in 29.8 Sekunden:
DE/EN-Gebotsstillstand, identische Handknoten, verlorene Chatbestätigung mit
identischer Wiederholung, Emoji, 320×568/568×320-Entwurf, explizite geschützte
Zuschauerzulassung und strikt öffentliche Eventfelder.

Gemeinsamer Lobbychat ergänzt Migration0070 nach0069, erhält eingefrorene
Empfängerkreise/Fremdschlüssel und lehnt ein verlustbehaftetes Downgrade ab.
Lokale Gates liegen vor Auth-/Historyzugriff; fremde Produktionssockets sehen
keine Wattenereignisse. Watten erhält ausschliesslich öffentliche Felder.
23 neue/bestehende native Fälle bestehen in 10.06 Sekunden. Zwei reale
DE/EN-Browserfälle bestehen in 5.7 Sekunden: ausdrückliches Öffnen und Opt-in,
späterer Beitritt ohne fremden Altverlauf, Reload des eigenen Verlaufs,
Hausdepp-Dialog samt Produktlabel, deaktivierter Empfänger ohne nachträgliches
Nachliefern, kleine Ansichten und synchrones Pagehide. Vier Bildschirmbilder
wurden tatsächlich visuell geprüft. PostgreSQL-DDL wurde kompiliert, keine
laufende PostgreSQL-Konkurrenzabnahme behauptet.

Die neuen Tests hatten anfänglich eigene Annahmefehler: Ansage-ACKs müssen vor
einem Chat-only-Messintervall abgeschlossen sein; ungeschützte Zuschauerlinks
melden direkt an; eine erfolgreiche Folgetischerstellung navigiert selbst.
Diese Fahrer wurden an das tatsächliche Verhalten angepasst. Ein isolierter
Vierer-API-Baselineversuch endete mit Socket-Hangup ohne Serverfehlerprotokoll;
der unveränderte Fall bestand auf eigenem neuen Port. Keine pauschalen Retries
oder Produktlimitänderungen. Ein neuer vollständiger P7-Nachweis steht noch aus.

Tischdeko ist noch im eigenen Autorenpaket. Freunde/Startmeldungen laufen im
separaten Backendpaket; Push/Worker, Reminder, Tour, Einladungsautorität,
Monitoring und physische Geräteabnahme bleiben ausdrücklich offen. Alle81 IDs
bleiben verbindlich. Claude erreicht laut Owner-Screenshot100% Sitzung/92%
Woche; vor Reset22:20 Europe/Zurich keine neue Anfrage. Codex zuletzt70%
Wochenverbrauch,30% verfügbar. Restbudget wird für konkrete Pakete vorbereitet.


### P7 Deko – gezielter Abschluss vor Vollprüfung

Autorenquelle de40ce777d208be2180ae5b48807a2939cc596a4 als2cef118
integriert; bestehende Lobby-/API-Imports und alle DE/EN-Kataloge bei den
Quellkonflikten erhalten. Unabhängiges Review schloss den frisch eintreffenden
Pointer-Tap nach Drag ohne Compatibilityclick; eigener Regressionstest. Acht
vorhandene Atlas-Gegenstände, ganze geschützte64px-Fläche, reservierte Hand,
Deko-Ecke, Konsum/Refill/Spill/Wischen, Tastatur/Drag und vollständiger Cleanup.
Keine Backend-, CPU-, Storage- oder Spielkommandowirkung.

Zwei reale Browserfälle DE/EN bestehen in8.7s, einmal Reduced Motion, einmal
normale Spilldarstellung: wartender Tisch zu laufender Partie, Getränke leer
und nachgefüllt, Chips gegessen, Pfütze aufgewischt, Rotation320×568/568×320,
Drag in Handbereich abgewiesen, gleiche Handknoten/Enginegelegenheit/null
Spielkommandos, Socialdialog versteckt Deko und Pagehide leert den Tisch.
Zwei Bildschirmbilder tatsächlich visuell geprüft.67 integrierte Nodefälle
für Deko/Lobby/Social/Rematch/API bestanden in113.9ms. Diese gezielten Belege
ersetzen den folgenden vollständigen Nachweis nicht.


### Native Spieltag-Erfassung – vorbereitetes Suite-Paket

Akzeptierte menschliche Schlag-/Farbansagen, Karten, Gebote und Antworten
schreiben den monotonen kontoweiten Zürcher Spieltag in derselben Transaktion
wie den nativen Checkpoint. Frische Session und gebundener Transport bleiben
Voraussetzung. Joins, Sitz-/Startaktionen, Einschauen, Delivery-ACKs,
Partnergefühl, CPU-Persistenz und Befehlsreplays zählen nicht. Fehlgeschlagene
Commits verändern weder Checkpoint noch Spieltag. Eigene gespeicherte
Wattenresultate ergänzen die bestehende historische Reminder-Eligibility,
ohne Resultate über die geschlossenen gemeinsamen Produkt-APIs freizugeben.

Neun neue gezielte Fälle plus die aktualisierte native Resultgrenze bestehen
(**10 Tests, 7.17 s**); Runtime und bestehende Reminder anschliessend **48 Tests
plus vier Unterfälle, 31.87 s**. Ruff und Bandit mit Repository-Konfiguration
grün. Unabhängiger Quellreview ohne bestätigten Befund. Kein Versand,
Worker-/Frontendfreigabe, Vollnachweis oder öffentlicher Release daraus.

Accepted human calls, cards and bidding decisions now record the account play
day atomically with the checkpoint. Replay, inspection, advice and CPU paths
remain excluded. Independent review and focused regressions passed; native
push delivery and complete product acceptance remain open.


### P7 Folgetische/Kommunikation/Deko nach Develop integriert

PR #57 ist normal nach `develop` gemergt: Source
`ca548e4c255fa43fa9e9bb1e370413691811f96e`, Basis
`a92258b628445a1ee88a0fe1afd18b1bf6c0acc8`, Merge
`a31e13ae2bc5ef2c8e0d791d6aff0b8adfaf8dac`. Merge-Eltern und gleicher Tree
`2cb3de1ea81cd30391223bca4baa8c61f38153e1` wurden geprüft. Der unveränderte
Integrationsstand übernimmt den echten vollständigen Source-Nachweis;
PR- und Develop-CI sind grün. Version3.15.0 ist damit integriert.

Der erste Vollbrowserlauf scheiterte an Chromium-Signal11 beim Anlegen des
Testcontexts vor dem deutschen Hausdepp-PWA-Testkörper. Alle anderen sechs
Browserteile bestanden; kein gültiger Nachweis oder Push daraus. Der zweite
vollständige Lauf auf exakt denselben sauberen Quellen bestand sämtliche
sieben Gruppen, **2’352 Backendtests bei85.91% Coverage**, Produktionsimage,
Container sowie alle sieben isolierten Browser-/Kontoteile. Nachweis:
`test-results/local-checks/ca548e4c255f-1792352629866-65e965ec/`.
Kein Master-/Produktionsrelease oder physischer Gerätenachweis.

### Nächste Suite-Dienste – gemeinsame Backendbasis, Oberflächen offen

Auf dem separaten Integrationszweig sind geprüfte Grundlagen für persönliche
Einladungen0073, Freunde/Startmeldungen, Tourzustand0071, gespeicherte
Gerätekontexte0072, Monitoring und Spieltage zusammengeführt. Persönlich
angenommene Einladungen erlauben wie vom Owner bestätigt Zugriff auf genau
diesen geschützten Folgetisch ohne Passwort; sie nehmen keinen Sitz und
starten keine Partie.22 neue Einladungsfälle plus75 verwandte Prüfungen
bestanden unabhängig. Alle Pakete wurden separat quellengeprüft.

Die erste gemeinsame Backendrunde bestand97 Fälle und fand einen veralteten
Test-Stub: der simulierte Start-Speicherfehler akzeptierte den neuen optionalen
Spieltagparameter nicht. Der Stub prüft nun ausdrücklich `human_actor=None`
beim Start; der betroffene Fall plus neun Spieltagfälle bestehen erneut
(10Tests,8.76s). Keine Produktumgehung und kein Vollnachweis daraus.

Der Monitoringreview fand eine falsche Vorperioden-Trafficabdeckung aus einem
alten ZDWA-Event. Regression zunächst rot, Korrektur1701dee6 mit48Tests plus
284Unterfällen grün, erneuter unabhängiger Review sauber. Fehlende native
Trafficdaten bleiben ausdrücklich nicht gemessen; echte Ergebnisvergleiche
bleiben erhalten. Menschenzahlen zählen frisch authentifizierte Konten über
Geräte/Tische einmal; historische Teilnahmen sind ausdrücklich Sitze inkl.CPU.

Der vorbereitete native Worker04d1914 validiert Push-Payload und Klickziel
getrennt, nutzt feste Wattenicons, keine CacheStorage und keine fremden oder
anderen laufenden Spielfenster.10 echte Handler-VM-Tests unterNode22 bestanden
unabhängig erneut;17 PWA-/Gerätekontextfälle plus acht Unterfälle grün.
Watten bleibt in allen tatsächlichen Versand-/Claim-/Empfängerpfaden gesperrt.
Eine gespeicherte Registrierung ist kein Zustellungsversprechen.

Freunde-/Auswahl-, Einladungs-, Tour- und Monitoringoberflächen sowie die
vollständige Push-/Empfängerkette sind weiterhin offen. Die separate Claude-
Arbeitsbasis und ein präziser Frontendauftrag liegen bereit; vor22:20Uhr gibt
es keinen neuen Claude-Aufruf. Keine Zusatznutzung, Schlüssel oder Umgehung.
Alle81 Findings bleiben erforderlich; Teilgrundlagen schliessen keine Abnahme.

PR57 passed the complete same-source rerun and is merged into develop with
matching source/merge trees and green CI. The following suite backends and
validated worker remain local groundwork: their native interfaces, actual
notification delivery and physical-device acceptance are still open.


### Gemeinsame Suite-Backendprüfung mit dauerhaft gesperrtem Spielerruf

Der vorbereitete allgemeine Spielerruf besitzt jetzt eine eigene additive
0074-Claimtabelle und atomare600s-Tisch-/60s-Kontosperren. Nur tatsächlich
sitzende Menschen in einem gespeicherten öffentlichen Warteraum mit echter
unreservierter Admission-/Sitzkapazität erfüllen die Eligibility. Die native
HTTP-Route endet weiterhin ausdrücklich mit503 vor Claim/Versand.

Die gemeinsame Runde fand eine reale SQLite-Read-zu-Write-Sperre im Zwei-
Thread-Claim. Eine frische SQLite-Transaktion reserviert nun den Writer vor
Snapshot/Savepoint; PG-Locks, JSON-CAS, Timeout und Retryzahl bleiben erhalten.
Die deterministische Regression war vorher rot;18 koordinierte Writerduelle
bestanden danach. Bereits laufende Caller-Transaktionen bleiben unter dessen
Kontrolle. Frischer Caller und Caller mit vorhandener Useränderung behalten
jeweils den äusseren Rollbackschutz; beide Varianten unabhängig erneut grün.

Der kombinierte Stand aus Touren, Freunden, Einladungen, Gerätekontext,
Monitoring, Spieltagen, Ruf-Claims, PWA und bestehendem WebPush besteht
**139 Tests plus11 Unterfälle in41.67s**. Nach dem reinen Testzusatz bestanden
beide Rollbackvarianten separat erneut. Ruff/Bandit grün; Logs unter
`test-results/watten-suite-services/`. Das sind gezielte Backendbelege,
kein neuer vollständiger Pushnachweis. Noch kein PR oder Versand für dieses
Folgepaket. Claude-Frontendarbeit nutzt eine separate saubere Arbeitsbasis.

The composed suite backends passed139 focused tests and11 subtests after a
reproduced SQLite concurrency fix; both fresh/existing transaction rollback
cases remain tested. General Watten push is still unavailable. Native UI,
full push verification and physical acceptance remain pending.

### Erste private Owner-Webvorschau, 18.10.2026

Der Owner hat den privaten Rollout der ersten zusammenhängenden Version nach
vollständigen Prüfungen ausdrücklich freigegeben. `ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW`
bleibt standardmässig0 und erlaubt produktiv nur dem aktiven, dauerhaft
gebundenen Founder die Apex-Webvorschau. Weitere Owner/Admins, Mitglieder,
Gäste und angenommene Einladungen erhalten keinen Zugriff. Die vorhandenen
drei Suite-Hosts dürfen nur diesem Konto den Apex-Link anzeigen; native Daten
und Spiel-WS akzeptieren nur den kanonischen Apex. Fester Watten-Host, PWA,
Mailkontext und Push-Zustellung bleiben gesperrt. Kontoansichten verwenden
auf Prod die bestehenden Suite-Flows. Private Dokumente und Fehler sind
`no-store/noindex`, Top-Level-/User-Capability stammen aus derselben Prüfung.

CPU-Timer prüfen den tatsächlich gespeicherten, strikt restaurierten Quellstand
gegen RAM und bestätigen vor dem Commit erneut die Founder-Autorität. Source-
Lock/SQLite-Writerreservierung gehen der Kontosperre voraus; ein anderer
DB-Writer, Flagentzug oder False-CAS verhindert Installation, Broadcast und
Ergebnis-/Fortschrittsvergabe. Alle zwölf lokalen Profile bleiben separat
verfügbar. Die unabhängige Quellenprüfung schloss einen doppelten Auth-Lookup
und die Bereinigungsreihenfolge eines alten Lobby-Sockets vor Abschluss.

Claudes erstes neues Frontendpaket lieferte native Freundesmeldungen und
private Zustimmungs-/Auswahleinstellungen. Zwei reproduzierte Ressourcen-
regressionen wurden anschliessend begrenzt: höchstens100 Suchtreffer im
Seitenfenster und20 auf Auth wartende Meldungen. Beide neuen Fälle waren
vorher rot. Das reparierte Paar besteht29 tatsächliche Node-Verhaltenstests.
Die Startmeldung ist am laufenden Tisch Text; nur die Lobby bietet bewusstes
Zuschauen. Auswahl und Meldungen erweitern keinen Spielzug oder Kartenblick.

Unabhängige Root-Belege auf dem zusammengesetzten Stand:65 gezielte
Founder-/CPU-/Aktivitätsfälle;53 Route-/Readiness-/Kontofälle plus346 Unterfälle;
13 private Picker- und26 Lobby-Nodefälle. Drei echte Browser-Journeys belegen
DE/EN-Kontoeinstellungen sowie live gestartete Partien bei unverändertem
Pending-Bid/Hand-DOM. Drei weitere Browserfälle prüfen den privaten Picker
in320x568 und568x320, Kontoentzug und späte Aktivitätsantworten. Screenshots
wurden visuell gelesen. Die alten Chooser-Tests bestehen20 Fälle; drei schon
vorhandene optionale Aufnahmetests bleiben übersprungen. Die erste private
Picker-Probe hatte drei reine Fixturefehler: ihr isolierter Admin hatte keine
Zilch-Freigabe. Die explizit markierte öffentliche Zilch-UI-Projektion wie in
den bestehenden Tests korrigiert dies, ohne die echten APIs freizugeben.

Diese Belege ersetzen keinen vollständigen Pushnachweis. Der finale3.16-
Commit benötigt vor Push/Integration weiterhin alle sieben Pflichtgruppen,
grüne CI und danach den freigegebenen privaten Weg `develop → master → prod`.
Native Tour-/Einladungs-/Monitoring-Oberflächen und physische Geräteabnahme
bleiben eigene offene Arbeiten; Claude arbeitet bereits im nächsten getrennten
Tourpaket. Es gab bis zu diesem Quellenstand keinen neuen Prodrollout oder
echten Watten-Pushversand.

The owner approved a conditional first private production web preview for the
immutable founder only, after complete verification. Composed targeted tests,
six new real browser journeys and visual screenshots cover the account-bound
picker, CPU commit authority and native friends UI. Two resource regressions
were reproduced and fixed; one test fixture needed the explicitly labelled
public Zilch projection. Complete exact-commit verification, CI and the private
release still follow. The fixed Watten host, PWA, mail and push remain closed;
remaining native services interfaces and physical acceptance are still open.
