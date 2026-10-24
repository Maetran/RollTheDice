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

**Implementiert, von Claude geprüft und gezielt getestet:** Die beiden bisher im Previewpool
übersprungenen Sprachfälle erhalten mit `playwright.watten-public.config.js`
einen eigenen lokalen Pool: öffentliche Beta an, Preview-Freigaben aus,
eigener Server, Port und Datenbestand. Der unveränderte Flow prüft
Lobby → Regeln → Anmeldung → Zurück und den expliziten Sprachwechsel bei
widersprechender gespeicherter Sprache. Fehlende öffentliche SSR-Marker werden
zu Fehlern. Die beiden Preview-Konfigurationen sammeln diese Datei nicht mehr.

**Implemented, independently reviewed by Claude and checked with focused tests:** The two previously skipped language cases gain their
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
Freigabe durch die Testkoordination. Claude hat den Pool und die Nachweisprüfungen unabhängig freigegeben.
Der vollständige Nachweis des integrierten Stands bleibt vor dem Push verbindlich.

Complete evidence now requires eight browser pools while the seven complete
check groups stay unchanged. Regressions are prepared for collection, isolated
configuration, ordering, port bounds and rejecting missing or failed public
pools during push validation, status publication and unchanged-merge inheritance.
Old seven-pool receipts are not extended or presented as new evidence. The four
affected Node test files passed **90/90 tests** without skips. The public browser
pool passed **2/2 DE/EN cases**; `test-results/local/run-5gT5gq/summary.json`
correctly records `fullRun=false`. These focused checks ran after the first full
pool ended and the test coordinator authorized them. Claude independently approved the pool and receipt checks. Complete
verification of the integrated tree remains mandatory before pushing.

## Block 3: bestätigter Watten-Regelvertrag / Confirmed Watten bidding contract

Der Owner hat am 24.10.2026 ausdrücklich bestätigt: Eigene Eröffnungsgebote
und spätere eigene Erhöhungen sind nur im eigenen Kartenzug erlaubt. Die
direkte Antwort auf ein offenes gegnerisches Gebot bleibt beim zuständigen
Entscheider und darf ausserhalb seines Kartenzugs erfolgen. Engine, persönliche
Views, CPU-Validierung und Regeln bilden denselben Vertrag ab. Die überholte
Partnerzug-Ausnahme und ihre zusätzliche CPU-Wartelogik sind entfernt; das
private Partnergefühl bleibt erhalten. Speicherformat und Wertung ändern sich
nicht.

On 24 October 2026 the owner explicitly confirmed that opening bids and later
unsolicited raises require the initiator's own card turn. The designated decider
can still immediately respond to an open opposing bid outside their card turn.
Engine, personal views, CPU validation and rules now agree. The obsolete
partner-turn exception and its CPU wait logic are removed; private partner
feedback is preserved. Storage format and scoring remain unchanged.

Die Regressionen waren vor der Korrektur rot. Die gezielten Backendprüfungen
bestanden mit 336 Fällen plus drei CPU-Schedulerfällen. Vier Geberpositionen,
Eröffnung und spätere Vier/Fünf, falsche Akteure, Ablehnung ohne Zustandsänderung
und weiterhin erlaubte direkte Antworten werden geprüft. Der echte mobile
Viererflow in Deutsch und Englisch bestand mit 2/2 Browserfällen und prüft
eigene Gebotsrechte, fehlende Rechte beim wissenden Partner und alle drei
Antwortbuttons beim zuständigen Entscheider. Claude hat den Regelkern, Views,
CPU und Testanpassungen unabhängig geprüft und freigegeben. Seine doppelte
Assertion wurde bereinigt; die Releasepflichten für 4.1.8 sind umgesetzt.

The regressions failed before the fix. Focused backend verification passed
336 cases plus three CPU scheduler cases. Tests cover four dealer positions,
opening and later Four/Five bids, wrong actors, rejection without mutation and
preserved immediate responses. The real mobile four-player flow passed both
German and English browser cases, checking own bidding rights, the informed
partner's lack of rights and all three designated response buttons. Claude
independently approved the rule core, views, CPU and adjusted tests. A duplicate
assertion identified in review was removed; 4.1.8 release metadata is prepared.

## Nachweise und Grenzen / Evidence and limits

Der erste Vollnachweis für 4.1.7 bestand auf `05009ca5`: 582 Tooltests,
3’321 Backendtests mit 85,84 Prozent Branch-Coverage, Produktionsimage und
1’482 Browserfälle (11 konfigurierte Skips). Der unveränderte Merge `28d13393`
wurde nach grüner CI über master ausgerollt; alle vier Hosts meldeten Version
4.1.7 und gesunde Datenbanken. Zwei dieser Browser-Skips werden durch Block 2
zu verbindlichen öffentlichen Tests. Neue Quellen benötigen einen neuen
vollständigen Nachweis; dieser wird beim nächsten Push automatisch erzwungen.

The first complete 4.1.7 proof on `05009ca5` passed 582 tool tests, 3,321 backend
tests with 85.84 percent branch coverage, the production image and 1,482 browser
cases (11 configured skips). Unchanged merge `28d13393` passed CI and was deployed
from master; all four hosts reported 4.1.7 and healthy databases. Block 2 makes
two of those skipped cases mandatory public tests. New source needs a new full
proof, automatically enforced on the next push.

Bestehende SQLite-Datetime-DeprecationWarnings und einzelne ResourceWarnings
bleiben sichtbar. Ihre Ursachen sind in diesem Block nicht vollständig verfolgt;
es wurden weder Warnungen unterdrückt noch Grenzwerte gelockert.

Existing SQLite datetime deprecation warnings and some resource warnings remain
visible. Their causes were not fully traced in this block; warnings were neither
suppressed nor thresholds relaxed.

## Offene Punkte / Open items

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
