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
CPU und Testanpassungen unabhängig geprüft und freigegeben. Die von ihm bemängelte doppelte
Assertion wurde bereinigt; die Releasepflichten für 4.1.8 sind umgesetzt.

The regressions failed before the fix. Focused backend verification passed
336 cases plus three CPU scheduler cases. Tests cover four dealer positions,
opening and later Four/Five bids, wrong actors, rejection without mutation and
preserved immediate responses. The real mobile four-player flow passed both
German and English browser cases, checking own bidding rights, the informed
partner's lack of rights and all three designated response buttons. Claude
independently approved the rule core, views, CPU and adjusted tests. A duplicate
assertion identified in review was removed; 4.1.8 release metadata is prepared.

Der erste vollständige 4.1.8-Backendlauf deckte eine zusätzliche alte
Partnerzug-Fixture in `test_watten_match_evidence.py` auf (ein Fehler,
3’334 bestandene Fälle). Beide Bieter dieser Fixture werden nun direkt aus dem
aktuellen Kartenzug gewählt. Replay-, Zähler-, Neustart-, Persistenz- und
Evidence-Assertions bleiben vollständig erhalten. Alle 28 Tests der Datei
bestehen; Claude hat die Anpassung separat ohne Blocker freigegeben. Dieser
fehlgeschlagene Vollversuch ist kein Liefernachweis und wird vollständig ersetzt.

The first complete 4.1.8 backend run found an additional obsolete partner-turn
fixture in `test_watten_match_evidence.py` (one failure, 3,334 passes). Both bids
now use the current card player. Replay, counters, restart, persistence and
evidence assertions are all preserved. All 28 tests in the file pass; Claude
separately approved the adjustment without blockers. The failed full attempt
is not delivery evidence and requires a new complete run.

## Block 4: eine Weiterleitung beim Zilch-Abmelden / One Zilch sign-out redirect

Ein Browserfehler beim Abmelden zeigte im Trace zwei Dokumentanfragen auf
`/` mit zehn Millisekunden Abstand. Das synchrone Auth-Ereignis löste im
App-Mode den Entzug der Vorschau samt Weiterleitung aus; danach leitete der
Logout-Handler nochmals weiter. Die zweite Navigation brach die erste ab.
Der Logout-Handler ruft jetzt vor dem Abmelden den vorhandenen
`prepareNavigation()`-Schutz auf und behält damit die Navigation. Zielroute,
Sitzungsbeendigung und öffentliche Zugriffsmöglichkeiten bleiben gleich.

A sign-out browser failure showed two document requests to `/` ten milliseconds
apart. The synchronous auth event revoked preview access and redirected;
the logout handler then redirected again, aborting the first navigation.
The handler now invokes existing `prepareNavigation()` before sign-out,
retaining navigation ownership. Destination, session termination and public
access remain unchanged.

Die neue Regression war mit zwei statt einer Weiterleitung rot und besteht
mit dem Fix. Sie führt den echten registrierten Zilch-Handler, das gemeinsame
Logout und den echten App-Mode aus. Öffentlicher und geschützter Modus,
abgebrochene pendente Identitätsanfrage und spätes Auth-Ereignis sind enthalten.
Alle 21 Tests der bestehenden Harness-Datei und die Qualitäts-/Sicherheitsprüfung
bestehen. Claude hat den Zwei-Dateien-Quelldiff unabhängig ohne Blocker
freigegeben. Der bestehende fehlgeschlagene Browserflow wurde nicht abgeschwächt;
für den geänderten Stand ist ein neuer Vollnachweis erforderlich.

The new regression failed with two redirects and passes with the fix. It executes
the actual registered Zilch handler, shared logout and real app-mode controller.
It covers public and gated modes, a cancelled pending identity request and a
late auth event. All 21 tests in the existing harness file and quality/security
checks pass. Claude independently approved the two-file source diff without
blockers. The failing browser flow was not weakened; new source requires a
new complete proof.

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

Claude hat im Abschlussreview zusätzlich den DE/EN-Browserflow und die
Release-Metadaten ohne Blocker freigegeben; die Formulierung «ausstehendes
Gebot / pending bid» wurde zur Abgrenzung von offenem Watten präzisiert.

Claude also approved the final DE/EN browser flow and release metadata without
blockers; “pending bid” clarifies the difference from open Watten.

## Offene Punkte / Open items

- **Abdeckung / Coverage:** Die globale Mindestabdeckung liegt bei 60 Prozent,
  ohne Modulgrenzen. Auch bei 85,83 Prozent Gesamtabdeckung fehlen einzelne
  Negativpfade, etwa widersprüchliche gespeicherte Watten-Abschlüsse in
  `watten_runtime.py`. Optionale Screenshot-Capture-Serien sind keine visuelle
  Abnahme im Standardlauf. Dies sind belegte Prüfgrenzen, keine behaupteten
  Implementierungsfehler. / The global coverage floor is 60 percent with no
  per-module minimum. At 85.83 percent overall coverage, some negative paths
  remain unexecuted, such as contradictory stored Watten finishes. Optional
  screenshot capture series are not visual acceptance in the standard run.
  These are proven evidence limits, not claimed implementation defects.


- **Watten-Versionshistorie / Watten release history:** Der History-Endpunkt
  erlaubt Watten derzeit nicht; eine Watten-Oberfläche oder ein vorhandener
  Aufrufer dafür ist nicht angebunden. Versions-Push ist separat unterstützt.
  Daher kein belegter kaputter Bedienpfad und keine neue Historienfunktion in
  diesem Qualitätsblock. Bei späterer Erweiterung muss ein HTTP-Routertest die
  Parameterfreigabe prüfen; direkte Pythonaufrufe erkennen die Literal-Grenze
  nicht. / The history endpoint currently excludes Watten; no Watten history UI
  or existing caller is wired up. Release push is supported separately. This is
  not a demonstrated broken user flow, so no history feature is added here.
  Future coverage must exercise the HTTP router, as direct Python calls cannot
  detect the query parameter's Literal boundary.

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

## Fortsetzung: Audio und sichtbare Abläufe / Follow-up: audio and visible flows

Der Audiorelease **4.2.0** ist über PR #83 als normaler Merge
`a0f61483c13b0ab3941d64a38952cbc501ed7e0c` auf `develop` und `master`
integriert und produktiv geprüft. Sein unveränderter Tree übernimmt den lokalen
Vollnachweis des Source-Commits `77acdbd5`: 606 Node-, 3336 Backend- und
1490 Browserfälle bestanden, neun ausdrücklich optionale Screenshot-Serien
übersprungen, 85,66 Prozent Branch-Coverage. Alle sieben Pflichtgruppen und
acht Browserpools bestanden; kein Retry. Öffentliche Health-/Versionsprüfungen
aller vier Spiele sowie Bytevergleiche der sechs neuen Aufnahmen in beiden
Kartenspielen bestanden. Keine subjektive Hörabnahme oder Prüfung auf einem
physischen iPhone wird daraus abgeleitet.

Audio **4.2.0** reached production through PR #83 and the normal merge above.
The unchanged merge tree inherited the exact source proof: 606 Node, 3336
backend and 1490 browser cases passed, nine explicitly optional screenshot
series skipped, 85.66 percent branch coverage. All seven required groups and
eight browser pools passed without retries. Public health/version and recording
byte checks passed. This does not claim subjective listening approval or a
physical iPhone test.

- **Zilch-Bildmeldung / Zilch screenshot:** Die Kombination 4,1,1,3,3,1 ist als
  aktueller Wurf wertend. Die Reproduktion zeigt korrekt 1000 Punkte bei drei
  gewählten Einsern. Dieselbe sichtbare Anordnung kann nach einem Zilch aber
  aus dem letzten Gesamtwurf stammen: Die Einser waren bereits gehalten,
  nur die übrigen Würfel verloren den Zug. Aktuelle Würfel sind dann null;
  alte Checks und ein leerer Empfehlungsbereich erklären die Verwechslung.
  Das Foto allein beweist den damaligen Serverzustand nicht. Claude prüfte die
  beiden tatsächlichen Bilder und den Quellpfad unabhängig. / As a current
  roll, 4,1,1,3,3,1 scores; the reproduction correctly offers 1000 for three
  selected ones. A retained rack can look identical after a bust of the other
  dice, with previously held ones still checked and no current options. The
  original photo alone does not prove its historical server state. Claude
  independently reviewed both reproduced images and the source path.
- **Hausdepp visuell / Hausdepp visual:** Echte lokale CPU-Tische mit drei,
  fünf und sechs Sitzen wurden über vorhandene Browserabläufe aufgenommen;
  Mobiltelefon ab 320 Pixeln, Querformat, Tablet und Desktop. Fünf gefilterte
  Fälle bestanden, darunter DE/EN-Turnierabschluss und ausdrücklich synthetische
  Resultatansichten. Root und Claude prüften sechs repräsentative Bilder.
  Layout-/Deko-Geschmack wurde nicht als Fehler umgebaut. Vollständige Namen
  stehen in den Sitz-ARIA-Labels, der entfernte Stapel besitzt Beschriftung und
  Tooltip, aktive Austritte haben bereits eine bestätigte DE/EN-Abfrage.
  Ein tatsächlich unter dem Resultat hervorschauender zweiter Austrittsknopf
  wird ausgeblendet, sobald sein sichtbarer Ersatz im Resultat montiert ist;
  Tastaturfokus und Rückkehr zur aktiven Runde werden geprüft. / Existing flows
  captured real local CPU tables across phone, landscape, tablet and desktop.
  Five filtered cases passed, including DE/EN tournament completion and
  explicitly synthetic result views. Both reviewers inspected six images.
  Cosmetic preferences were not treated as proven defects. The duplicate exit
  behind the result sheet is hidden only after its visible replacement exists;
  keyboard focus and return to play are covered.

- **ZDWA visuell / ZDWA visual:** 16 repräsentative DE/EN-Aufnahmen aus
  vorhandenen Rendering-/Navigationsfixtures decken 320/440/768/1440 Pixel,
  Start, Entscheidung, Endstand und Dashboard ab. Vier visuelle Driverfälle
  bestanden. Identische Ergebnisdaten belegen einen echten Übersetzungsfehler:
  Whitespace-Normalisierung zog die englischen Rangzeilen zusammen. Nur der
  Enddialog rendert seine übersetzten Ränge jetzt als sichere DOM-Blöcke;
  keine globale Änderung am Übersetzer. Der bestehende DE/EN-Abstands- und
  Navigationsflow wurde rot/grün um getrennte Rangzeilen ergänzt, 2/2 bestanden.
  / Sixteen representative DE/EN captures cover phone, tablet, desktop,
  opening, decisions, results and dashboard through existing fixtures. Four
  visual driver cases passed. Identical payloads proved that English whitespace
  normalization merged final ranks. Only this dialog now uses translated safe
  DOM blocks. Its existing DE/EN spacing/navigation flow went red to green.
- **Watten und Zilch / Watten and Zilch:** Der Sprachstatus bleibt derselbe
  DOM-Knoten und liegt im geöffneten, auf die restliche Fensterhöhe begrenzten
  Watten-Panel. Tastatur-Schließen, Wiederöffnen und Querformat-Resize sind
  geprüft, ohne externe Gespräche oder Mikrofonfreigabe. Ein bereits vorher
  vorhandener 320-Pixel-Würfelüberlauf in Zilch wurde durch identische
  Vorher-/Nachher-Geometrie nachgewiesen und mit begrenzter Größenformel
  korrigiert. Alle sechs Würfel bleiben mit mindestens 44 Pixeln erreichbar.
  16 gezielte Fälle bestanden, einschließlich DE/EN, beiden Zilch-Themen,
  gültiger/alter Würfe, Animationen und unveränderter Tablet-Hilfe. / The same
  voice status node stays inside Watten's open panel, limited to remaining
  viewport height. Keyboard closing, reopening and landscape resize are tested
  without external calls or microphone permission. Identical baseline bounds
  proved a pre-existing 320px Zilch dice overflow; bounded sizing now fits all
  six dice with at least 44px targets. Sixteen focused cases passed across
  languages, themes, valid/retained rolls, animation and tablet guidance.

## Trackingvertrag / Tracking contract

- ZDWA: eine dauerhafte Ergebniszeile pro vollständigem Scorecardabschluss.
  Zilch: ein Terminalresultat; Solo-Abbrüche sind getrennt von regulären
  Abschlüssen zu betrachten. Hausdepp: eine Runde, kein ganzes Turnier.
  Watten: eine Zielpunktepartie, kein einzelner Deal. / Durable result rows mean
  a completed scorecard for ZDWA, a terminal outcome for Zilch (including
  separately classified solo abandonment), one round for Hausdepp and a full
  points match for Watten.
- Gespeicherte Teilnehmersitze enthalten CPUs und sind weder eindeutige Menschen
  noch Spielstarts. Kontostatistiken beruhen auf verknüpften, berechtigten
  menschlichen Sitzen; Gäste und zurückgezogene Sitze haben andere Grenzen.
  Browser-Live-Sitzungen sind getrennt von autoritativen Live-Tischen. / Stored
  seats include CPUs and are not unique people or starts. Account statistics
  use linked eligible human seats. Browser live sessions and authoritative live
  tables are separate metrics.
- Hausdepp und Watten besitzen keinen Browsercollector. Hausdepp-Serveraktionen
  haben keine Browser-Session-ID und keine aktive Besuchszeit. Ihre vorhandenen
  Serverfakten bleiben erhalten; fehlende Besuchsmessung wird konsistent als
  unbekannt statt als gemessene Null gekennzeichnet. / Neither card game has a
  browser collector. Hausdepp server actions have no browser session ID or
  active visit time. Existing server facts remain; absent browser measurement
  is consistently unknown rather than a measured zero.
- Ein vollständiger historischer Start-/Abschluss-Funnel fehlt. Raumerstellung
  ist kein belegter Spielstart; vorhandene Abbruchquellen sind unvollständig
  und dürfen nicht zu einer allgemeinen Abschlussquote kombiniert werden.
  Keine zusätzliche Zugaufzeichnung oder automatische Analyse menschlicher
  Entscheidungen wurde aktiviert. Ein solcher neuer Datenfluss benötigt einen
  separaten Entwurf mit ausdrücklicher Zustimmung, begrenzten Daten und
  Aufbewahrung sowie Abschaltung/Löschung. / A complete historical start/finish
  funnel is absent. Room creation is not a proved game start, and incomplete
  abandonment sources cannot establish an overall completion rate. No new move
  recording or automated analysis of human decisions was enabled; that needs a
  separate consent, minimization, retention and deletion design.

## CPU-Median und Testpflege / CPU median and test maintenance

- **CPU-Median:** Zuerst wird die bisherige, begrenzte Schwierigkeit jedes
  sitzenden menschlichen Kontos berechnet, danach deren Median. Dadurch wird
  etwa Hausdepp mit 0 und 1000 Runden zu 0,775 statt voller Stärke. Bei Watten
  werden die beiden mittleren Profile gemittelt; Stichprobenbudget und alle
  Parameter bleiben begrenzt. Einzelspieler verhalten sich unverändert.
  55 gezielte Tests bestanden, einschließlich Stufengrenzen, Reihenfolge,
  fehlender Erfahrung, aller Profilpaare, Monotonie und Datenbank-Lookup.
  Claude prüfte Formel und tatsächlichen Diff unabhängig. Reale Watten-CPUs
  sind separate `CpuOccupant`-Objekte ohne Konto und nicht in `room.members`.
  / First compute each seated human account's existing bounded difficulty,
  then its median. Hausdepp with 0 and 1000 rounds yields 0.775 rather than
  full strength. Watten averages the middle profiles within existing bounds.
  Single-human behavior is unchanged. Fifty-five focused tests passed; Claude
  independently checked the formulas and actual patch. Real Watten CPU seats
  are separate accountless occupants, not human room members.
- **Warnungen / Warnings:** Der Audiovollnachweis meldete 78.380
  SQLite-Datetime-Deprecations, 64 HTTPX-Cookie-Deprecations und 17 nicht
  geschlossene SQLite-Verbindungen. Die Warnungen wurden nicht unterdrückt.
  Ein strikter Python-3.13.3-Lauf mit Allokationsstapeln und ausdrücklich
  erzwungener Garbage Collection belegte ungeschlossene Verbindungen in elf
  Migrationstestdateien. 18 Kontexte verwenden nun `closing(connection)`
  zusammen mit dem bisherigen Transaktionskontext: Commit/Rollback zuerst,
  Schließen danach. Derselbe strikte Lauf bestand anschließend 11/11 Fälle
  ohne Resource-/Unraisable-Warnung. Die Datetime-Deprecations bleiben sichtbar;
  historische Migrationen und produktive Daten wurden nicht verändert.
  / The audio proof reported 78,380 SQLite datetime deprecations, 64 HTTPX
  cookie deprecations and 17 unclosed connection warnings. None were hidden.
  Allocation traces with forced collection on Python 3.13.3 proved raw
  connection leaks in eleven migration test files. Eighteen contexts now close
  after their existing commit/rollback handling. The identical strict run then
  passed 11/11 with no resource/unraisable warnings. Datetime deprecations remain
  visible; historical migrations and production data were unchanged.
- **Beim Volltest gefunden / Found by the full gate:** Der erste vorbereitete
  4.2.1-Stand bestand 3386 Backendfälle; ein neuer Lognachweis scheiterte nur im
  Gesamtlauf. Ursache war ein produktiver Konfigurationsfehler:
  `fileConfig` in `alembic/env.py` deaktivierte beim Datenbankstart bereits
  importierte Anwendungslogger. Ein echter Upgrade-Subprozess auf leerer
  Tempdatenbank reproduzierte den Fehler. `disable_existing_loggers=False`
  erhält die Logger; derselbe Subprozess prüft nun zusätzlich einen tatsächlich
  ausgegebenen Fehlermarker. Zusammen mit den Erfahrungstests bestanden danach
  21 Fälle. Keine Assertion wurde entfernt. Der fehlgeschlagene Vollablauf
  liefert keinen Nachweis; der fertige neue Commit braucht einen neuen Volltest.
  Die bestehende Root-Handler-Konfiguration wurde nicht umgestaltet.
  / The first prepared 4.2.1 source passed 3386 backend cases but failed a new
  logging assertion only in the full run. Alembic's default `fileConfig`
  disabled already imported application loggers at database startup. A real
  upgrade subprocess on a temporary database reproduced the product defect.
  Explicitly keeping existing loggers enabled fixes it; the same subprocess
  also checks an emitted error marker. Twenty-one focused cases then passed,
  with no assertions removed. The failed full run provides no receipt; the
  finished new commit requires a fresh full gate. Existing root-handler
  configuration was not redesigned. See [Python logging configuration](https://docs.python.org/3.13/library/logging.config.html#logging.config.fileConfig).

- **Konto-Test synchronisiert / Account test synchronized:** Der nächste volle
  4.2.1-Lauf bestand alle 3388 Backendfälle, scheiterte aber an einem alten
  Browser-Rennfall beim Avatar-Upload. Der Trace zeigt: Der Helfer liest das
  geschlossene serverseitige `details`, die asynchrone Konto-Initialisierung
  öffnet es für das temporäre Passwort, dann schließt der geplante native
  Testklick es wieder. Ein isolierter Browsernachweis mit angehaltener echter
  Identitätsanfrage reproduziert genau diese Reihenfolge. Der Helfer wartet
  jetzt auf den vorhandenen Initialisierungsmarker und prüft anschließend den
  offenen Zustand. Derselbe Probeablauf bestand danach 2/2; der echte
  Avatar-Upload behält seinen Service-Worker-Pfad und sämtliche Assertions.
  Keine Wartezeit, Wiederholung, erzwungener Klick oder Produktänderung wurde
  hinzugefügt. Claude hat Ursache und Synchronisierung unabhängig geprüft.
  Auch dieser fehlgeschlagene Vollversuch ist kein Liefernachweis.
  / The next full 4.2.1 run passed all 3388 backend cases but exposed an old
  avatar browser-test race. Its helper reads closed server-rendered details;
  async account initialization opens them for the temporary-password prompt;
  the scheduled native test click then closes them. An isolated browser probe
  holding the real identity request reproduces that exact ordering. The helper
  now waits for the existing initialization marker and asserts the open state.
  The identical probe passed 2/2 afterwards. The real avatar upload retains its
  service-worker path and every assertion. No sleep, retry, forced click or
  product change was added. Claude independently reviewed the cause and
  synchronization. This failed full attempt also provides no delivery receipt.
