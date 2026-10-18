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
| P1/P8 DNS, Origin, TLS | Codex-Mitarbeiter `infrastructure_audit`, eigener Worktree; separater geschlossener Nginx-Vhost, Watten-Aktivierungshelfer, gezielte Tests | Liveprüfung erfolgt; prüfbare Aktivierung wird vorbereitet. Bestehende Vhosts, Proxy, Firewall, Zertifikate und App bleiben erhalten. |
| P0 Owner-Entscheidungen | Owner; Codex protokolliert verbindliche Antworten | Drei gebündelte Fragen im Ausführungs-Chat gestellt. Profile/Kritische/Weli, Zugabe/Bieten/Gestrichen sowie Informations-/Komfortumfang offen. Abhängige Regelengine nicht begonnen. |
| P1/P7 Integrationsinventar | Codex Lead; [P1-Verträge](WATTEN_P1_CONTRACTS.md) | Quellen geprüft. Host, Konto, Passkeys, PWA, Push und Runtime besitzen unterschiedliche Register; kein einzelnes Register schaltet Watten vollständig frei. |
| P1 native Kontoreise, separates Folgepaket | Codex-Mitarbeiter `p1_contracts`, eigener Worktree `watten-readiness`; dedizierter Router und schmale gemeinsame Kontoerweiterungen | Begonnen. Lokale Entwicklungsvorschau benötigt ausdrückliches Flag und Loopback-/localhost-Ursprung sowie Requesthost; echte Produktionsorigins bleiben geschlossen. Keine PWA-/Push-/Spielruntime durch diesen Kontoteil. |
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
- Noch kein neuer vollständiger Pushnachweis, Push, PR, Develop-Merge,
  App-Deploy oder physischer Gerätenachweis.

## Claude und Übernahmefähigkeit

Liveanzeige am Start: **97 % Sitzung / 82 % Woche**. Angezeigter Sitzungsreset
17:20, Wochenreset Freitag 20:00. Das ist eine Momentaufnahme.
Die angefragten Heartbeats werden vom Planungs-Chat eingerichtet, hier keine
Duplikate anlegen. Vor neuen Paketen Quoten und aktive Aufgabe erneut prüfen;
bei Limit sofort selbst weiterarbeiten. Kein Kauf zusätzlicher Nutzung.

## Nächster unabhängiger Schritt

Fertige Pakete quellenprüfen, in diesem Branch normal übernehmen, Assets
gemeinsam neu synchronisieren und lokale Prüfungen ausführen. Danach native
Watten-Konto-/Recovery-/Passkey-/PWA-Routen als zusammenhängende P1-Lieferung
implementieren. Regelabhängige Teile warten auf tatsächliche P0-Antworten.

**English:** Implementation has started in an isolated develop-based worktree
with the complete local handoff merged. All 81 findings remain in scope.
The initial packages fix the existing picker race and establish closed host,
route and infrastructure boundaries while rule decisions remain open. Local
checks, integration, infrastructure activation, public app deployment and
physical-device acceptance are separate evidence stages.
