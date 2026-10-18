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
