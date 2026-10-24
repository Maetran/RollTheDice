# Qualitätsaudit aller vier Spiele / Four-game quality audit

Ausgangsbasis / Starting point: `c0770705` (`origin/develop`, 24.10.2026).
Codex koordiniert Quellen, lokale Tests und Releases; Claude prüft unabhängig
die Vorschläge. Kleine Änderungen durchlaufen Review und den vollständigen
lokalen Nachweis vor jedem Push. Keine Spielregel oder neue Funktion wird aus
diesem Audit heraus ohne Owner-Entscheidung eingeführt.

Codex coordinates source changes, local tests and releases; Claude independently
reviews proposals. Small changes require review and complete local verification
before every push. This audit does not authorize new features or rule decisions.

## Geprüfte Bereiche / Reviewed areas

| Bereich / Area | Quellen und Einordnung / Sources and assessment |
| --- | --- |
| Gemeinsame Architektur / Shared architecture | WebSocket-Dispatcher, Sitzübernahme, Abschlusszustellung, Auth-Epochen und verspätete Antworten; getrennte Spieladapter und vertrauenswürdige CPU-Pfade bleiben erhalten. / WebSocket dispatch, seat takeover, terminal delivery, auth epochs and late responses; separate game adapters and trusted CPU paths are retained. |
| ZDWA | Letztes Feld, Abschlusswiederholung, Persistenzfehler, verspätete Befehle vom vorigen Gerät. / Last field, completion retry, persistence failure and delayed commands from a replaced device. |
| Zilch | Schlussrunde ab 10.000 Punkten, Gleichstand, menschliche/CPU-Akteure, Gerätewechsel. / Final round from 10,000 points, ties, human/CPU actors and device takeover. |
| Hausdepp | FIFO-Nachziehen, Nachwerfen und verspätete Ziehpflicht; Socketprüfung unter Spiel-Lock. / FIFO draws, follow-up throws, deferred draw obligations and socket checks under the game lock. |
| Watten | Gebots-/Antwortrechte gegen Owner-Ledger; öffentliche Sprachstrecke und Previewgrenzen. / Bidding/responding rights against the owner ledger; public language navigation and preview boundaries. |
| Tests und Lieferweg / Tests and delivery | Pytest-Collection, sechs `loadfile`-Worker, Branch-Coverage; vier Mainshards und drei Kontopools, in Block 2 um einen öffentlichen Watten-Pool ergänzt; Ownerstatus bindet Commit, Tree, Basis, Umgebung und Alter. / Pytest collection, six loadfile workers, branch coverage; four main shards and three account pools, with a public Watten pool added in block 2; owner status binds commit, tree, base, environment and age. |

Dies ist eine risikobasierte Quellenprüfung, kein Beweis für die Korrektheit
jeder einzelnen Assertion. Die gesamte Testsuite bleibt ein zusätzlicher,
verbindlicher Lauf. Ein grüner Lauf ersetzt keinen fachlichen Vertrag.

This is a risk-based source review, not proof that every assertion is correct.
The complete test suite is a separate mandatory run. Green tests do not replace
an agreed product contract.

## Block 1: bestätigte Korrekturen / Confirmed corrections

1. **Veralteter Spielsocket / Replaced game socket:** ZDWA und Zilch nahmen
   nach einer Sitzübernahme weiterhin bereits empfangene Würfelbefehle des
   vorigen Geräts an. Die neuen Dispatcher-Tests waren vor der Korrektur rot.
   Der Dispatcher prüft nun die aktuelle Socketidentität vor der Bearbeitung
   und erneut nach asynchroner Admin-Lockbereinigung. Abgeräumte Räume behalten
   ihre bisherige Beendigung. Vor der Übernahme angenommene Abschlüsse werden
   weiterhin beiden Geräten zugestellt. / ZDWA and Zilch accepted queued rolls
   from the previous device after seat takeover. New dispatcher tests failed
   before the fix. The dispatcher now checks live socket identity before
   processing and again after asynchronous admin-lock cleanup. Retired rooms
   preserve their existing shutdown; accepted finishes still reach both devices.
2. **Vollständiger Browsernachweis / Complete browser verification:** Der
   verbindliche Runner verweigert `test.only`/`describe.only`, erzwingt null
   Wiederholungen und verbietet Retryüberschreiben per Filter. Echte minimale
   Playwright-CLI-Fälle belegen beide Schutzmechanismen auch bei `CI=1`, ohne
   Produktserver oder Browserfixture. / The required runner rejects focused
   tests, enforces zero retries and prevents filters from overriding that policy.
   Real minimal Playwright CLI cases prove both safeguards with CI enabled,
   without application servers or browser fixtures.

Claude bestätigte den Runner und verlangte beim Socketfix ausdrücklich die
Ausnahme für bereits abgeräumte Räume sowie präzisere Fehlerassertions. Beides
ist umgesetzt. Die Quellenreviews und lokalen Berichte liegen im eigenen
Worktree unter `test-results/quality-audit/`; Vollnachweise unter
`test-results/local-checks/` und im gemeinsamen Git-Metadatenverzeichnis.

Claude approved the runner and required preserving retired-room shutdown and
more precise error assertions for the socket fix. Both are implemented. Local
review reports reside in this worktree's `test-results/quality-audit/`; complete
verification reports live under `test-results/local-checks/` and shared Git metadata.

## Block 2: öffentlicher Watten-Browserpool / Public Watten browser pool

**Implementiert und gezielt geprüft; Vollnachweis ausstehend:** Die beiden bisher im Previewpool
übersprungenen Sprachfälle erhalten mit `playwright.watten-public.config.js`
einen eigenen lokalen Pool: öffentliche Beta an, Preview-Freigaben aus,
eigener Server, Port und Datenbestand. Der unveränderte Flow prüft
Lobby → Regeln → Anmeldung → Zurück und den expliziten Sprachwechsel bei
widersprechender gespeicherter Sprache. Fehlende öffentliche SSR-Marker werden
zu Fehlern. Die beiden Preview-Konfigurationen sammeln diese Datei nicht mehr.

**Implemented and checked with focused tests; full verification pending:** The two previously skipped language cases gain their
own local pool with public beta enabled, preview access disabled and an isolated
server, port and data. The existing flow checks lobby → rules → sign-in → back
and explicit language switching against a conflicting saved language. Missing
public SSR markers fail; both preview configurations exclude this file.

Der Vollnachweis verlangt nun acht Browserteilgruppen, während die sieben
vollständigen Prüfgruppen unverändert bleiben. Regressionen sind vorbereitet
für Collection, isolierte Konfiguration, Reihenfolge, Portgrenzen sowie die
Ablehnung fehlender oder fehlgeschlagener öffentlicher Pools beim Push,
Status-Publishing und bei der Übernahme durch einen unveränderten Merge.
Alte Sieben-Pool-Belege werden nicht erweitert oder als neuer Nachweis ausgegeben.
Die vier betroffenen Node-Testdateien bestanden mit **90/90 Tests**, ohne Skips.
Der öffentliche Browserpool bestand mit **2/2 DE/EN-Fällen**; der Bericht unter
`test-results/local/run-5gT5gq/summary.json` weist korrekt `fullRun=false` aus.
Die gezielten Prüfungen liefen erst nach Ende des ersten Vollpools und nach
Freigabe durch die Testkoordination. Unabhängiges Review und vollständiger
Nachweis für diesen Block stehen noch aus.

Complete evidence now requires eight browser pools while the seven complete
check groups stay unchanged. Regressions are prepared for collection, isolated
configuration, ordering, port bounds and rejecting missing or failed public
pools during push validation, status publication and unchanged-merge inheritance.
Old seven-pool receipts are not extended or presented as new evidence. The four
affected Node test files passed **90/90 tests** without skips. The public browser
pool passed **2/2 DE/EN cases**; `test-results/local/run-5gT5gq/summary.json`
correctly records `fullRun=false`. These focused checks ran after the first full
pool ended and the test coordinator authorized them. Independent review and
complete verification for this block remain pending.

## Offene Punkte / Open items

- **Watten-Regelvertrag / Watten rule contract:** Das Owner-Ledger bindet das
  eigene Eröffnungsgebot an den eigenen Kartenzug; Engine und mehrere Tests
  erlauben dem wissenden Entscheider im blinden Vierer ein Gebot im Partnerzug.
  Kein automatischer Fix: zuerst Owner-Entscheidung, dann Vertrag, Code und Tests
  gemeinsam abgleichen. / The ledger limits opening bids to the player's own
  card turn; engine and several tests allow the informed decider to bid during
  their partner's turn in blind four-player games. This needs an owner decision.
- **Auth-Randfälle / Auth edge cases:** Der vermutete Selbst-Deadlock in
  `loadAuth` wurde nach Prüfung aller Epochenänderungen verworfen. Ein älterer
  erfolgreicher Lookup kann einen bereits laufenden neueren Lookup übernehmen;
  dafür wäre zusätzliche Regression sinnvoll. Das Fehlerverhalten einer älteren
  fehlgeschlagenen Antwort wird ohne Produktentscheidung nicht geändert. / The
  suspected loadAuth self-deadlock was rejected after checking every epoch update.
  Additional regression coverage for joining a newer lookup is useful; stale
  error-response behavior is left unchanged pending a product decision.
- **Legacy / Legacy:** Keine pauschalen Löschungen. Die separate Watten-Config
  ist weiterhin als manueller Prüfweg dokumentiert; Legacy-Datenimporte und
  Migrationshistorie sind kein belegter toter Code. / No blanket deletions: the
  Watten config remains a documented manual path; legacy data imports and
  migration history are not proven dead code.
