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

- ZDWA: eine dauerhafte Ergebniszeile pro vollständig abgeschlossener Partie;
  mehrere individuelle oder Teamtafeln zählen dabei nicht als weitere Partien.
  Zilch: ein Terminalresultat; Solo-Abbrüche sind getrennt von regulären
  Abschlüssen zu betrachten. Hausdepp: eine Runde, kein ganzes Turnier.
  Watten: eine Zielpunktepartie, kein einzelner Deal. / Durable result rows mean
  one completed ZDWA match (possibly with several individual/team boards), a terminal outcome for Zilch (including
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

## Fortsetzung 4.3: CPU, mit getrennter Layoutprüfung / CPU with separate layout review

Der erste vollständige 4.3.0-Lauf auf `d7914a2c` bestand 607 Tooltests,
3525 Backendfälle, Image und Smoke-Test. Sieben Browserpools bestanden;
ein Hausdepp-Ausstiegstest bestätigte noch während des echten CPU-Abhebens.
Der Server lehnte den veralteten Stand korrekt ab. Der Test wartet nun vor
seiner letzten Bestätigung auf das tatsächliche menschliche Entscheidungsfenster
ohne offene Nachwurf-/Nachziehpflicht und auf den aktivierten Button. Er prüft
die genaue gesendete Version; alle bisherigen Ausstiegs-, Audio- und
Erfolgsassertions bleiben erhalten. Die beiden echten DE/EN-Fälle und alle
43 bestehenden UI-Vertragstests bestanden. Claude prüfte die Synchronisierung
unabhängig. Der fehlgeschlagene Vollversuch liefert keinen Nachweis und wird
durch einen frischen vollständigen Lauf auf dem neuen Commit ersetzt.

The first complete 4.3.0 attempt on `d7914a2c` passed 607 tool tests,
3525 backend cases, the image and smoke test. Seven browser pools passed;
one Hausdepp departure test confirmed while a real CPU was still lifting
the stock. The server correctly rejected the stale state. Before its final
confirmation the test now waits for the real human decision window without
an outstanding follow-up throw or refill and for the enabled button. It asserts
the exact sent version and retains all departure, audio and achievement checks.
Both real DE/EN cases and all 43 existing UI contract tests passed. Claude
independently reviewed the synchronization. This failed full attempt provides
no receipt and requires a fresh complete run on the new commit.

Der fertige 4.2.1-Stand `b8b8760a` bestand anschließend den vollständigen
lokalen Nachweis: 606 Node-, 3388 Backend- und 1498 Browserfälle, neun
optionale Capture-Serien, 85,71 Prozent Branch-Coverage, alle acht Browserpools
ohne Retry sowie Produktionsimage und Smoke-Test. Der unveränderte normale
Merge `800e157d` wurde über `develop → master` ausgeliefert; alle vier Hosts
und zehn öffentliche Asset-Bytevergleiche wurden geprüft. Der Nachweis und
die unabhängigen Reviews sind zusätzlich außerhalb von Playwrights
bereinigbaren Ausgabeordnern gesichert.

The finished 4.2.1 source `b8b8760a` subsequently passed complete local
verification: 606 Node, 3388 backend and 1498 browser cases, nine optional
capture series, 85.71 percent branch coverage, all eight browser pools without
retries, plus the production image and smoke test. Its unchanged normal merge
`800e157d` reached production through develop and master. Public checks covered
all four hosts and ten exact asset comparisons. Proof and independent reviews
are also backed up outside Playwright's cleaned output directories.

- **Hausdepp:** Eine begrenzte, flüchtige CPU-Erinnerung verarbeitet nur
  aufeinanderfolgende persönliche Views mit öffentlich beobachteten Aktionen.
  Sie liest keine fremde Hand; bei Beobachtungslücken, Runden-/Besetzungswechsel
  oder Fehlern wird sie verworfen. Nur eine vollständig öffentlich bekannte
  gegnerische Hand erlaubt die neue Endduell-Ausnahme: Eine höhere Einzelkarte
  kann ein bekanntes Paar zum Aufnehmen zwingen, wenn die restlichen eigenen
  Karten danach nachweisbar ausreichen. Priorität für einen bereits sicheren
  direkten Abschluss und bisherige Schwierigkeit bleiben erhalten. 1470
  akzeptierte Engine-Sequenzen mit zwei aktiven Spielern und verschiedenen
  bereits fertigen Sitzen prüfen Kartenbestand und Abschluss. Vier echte
  asynchrone CPU-Läufe prüfen den Weg von öffentlichem Aufnehmen bis zur
  späteren Blockkarte. / A bounded transient memory observes consecutive
  personal views and public actions only. It never reads an opponent's hand
  and resets on gaps, round/roster changes or errors. A completely public known
  opponent hand enables one narrow end-duel exception: a higher single card
  can force a known pair to pick up when the remaining cards prove the finish.
  An already guaranteed direct finish and existing difficulty keep priority.
  Tests cover 1470 accepted engine sequences and four real asynchronous CPU
  runs from public pickup to the later blocking play.
- **Zilch:** Erfahrung ist weiterhin ein Näherungswert aus abgeschlossenen
  Spielen, keine Könnensmessung. Neue angemeldete CPU-Partien ab zehn gültigen
  eigenen Abschlüssen speichern eine private Strategieversion. Gastpartien,
  alte Spielstände und unbekannte Versionen behalten die bisherige Strategie.
  Die Ausnahme gilt nur für den exakt validierten zweiten Wurf mit 200 Punkten,
  vier freien Würfeln, einer Eins und einer Fünf sowie ausreichendem Abstand zum
  Ziel: In sechs von neun Stil-/Rückstandszellen bleibt nur die Eins liegen.
  Exakte Ganzzug-Rechnung belegt dort höheren erwarteten Bankwert und weniger
  Zugverluste. 9000 echte Roll-/Hold-/Bank-Fälle stimmen mit dem Rechenkern
  überein; 180 vollständige Vergleichspaare enthalten nur 19 tatsächliche
  Abweichungen und keinen veränderten Matchscore. Das belegt keine höhere
  Match-Siegquote. Die gepagte historische Validierung schließt früh nach zehn
  Treffern, hat aber kein hartes Gesamtlimit bei vielen ungültigen Datensätzen.
  / Experience remains a completed-game proxy, not measured skill. New signed-in
  CPU games with ten valid owned completions persist a private policy version.
  Guests, old states and unknown versions keep the baseline. The exception
  requires the exact validated second-roll 200-point/four-free-dice state with
  one one, one five and enough distance from the target. In six of nine
  style/score-gap cells the CPU retains only the one. Exact whole-turn analysis
  proves higher expected bank and lower turn-loss risk there. Nine thousand
  real roll/hold/bank cases match the analysis; 180 complete paired matches
  contain only 19 actual overrides and no changed match score. No match-win-rate
  improvement is claimed. Paged history validation closes after ten valid
  results but has no hard total scan cap for unusually dirty histories.
- **Watten-CPU, widerlegter Verdacht / Rejected suspicion:** Frische öffentliche
  Erinnerung ohne Stichhistorie zählt beim vierten Stich zwei statt drei
  vorangegangene Gewinner. Die vorhandene Taktik unterscheidet aber nur null,
  eins und mindestens zwei. Sechs echte Engine-Fälle mit/ohne Historie für
  Stich zwei bis vier belegen gleiches taktisches Verhalten und akzeptierte
  Entscheidungen. Das Stichprobenbudget war bereits korrekt mit der
  Erfahrungsstufe verbunden; direkte Gegenangebote bleiben beim bezeichneten
  Entscheider erlaubt. Keine Produktkorrektur aus diesen Verdachtsfällen.
  Ein separater Lauf mit allen vier Stufen bestand 608 tatsächliche
  Eröffnungsdeals und 11.250 akzeptierte Befehle ohne Fehler oder Schrittlimit.
  Der einfache Vergleichsgegner belegt keine monotone Spielstärke und keine
  menschliche Siegquote. / Fresh public memory without trick history remembers
  two rather than three previous winners at trick four. Existing tactics only
  distinguish zero, one and at least two. Six real engine cases prove equivalent
  choices with/without history at tricks two through four. Sample budgets were
  already wired to experience, and designated immediate counteroffers are legal.
  These suspicions require no product fix. All four tiers completed 608 real
  opening deals and 11,250 accepted commands without error or step exhaustion.
  The simple baseline opponent proves neither monotonic strength nor human
  win rate.
- **Dauerhafter CPU-Vertrag / Persistent CPU evidence:** Ein zusätzlicher
  deterministischer Test berechnet alle neun Zilch-Zellen gegen die tatsächliche
  Baseline neu und vergleicht die belegte Freigabemenge mit den sechs Runtime-
  Zellen sowie echten Entscheidungen aus legal aufgebauten Würfen. Damit wird
  eine spätere Änderung der Baseline nicht still mit alter Taktikbegründung
  kombiniert. Der integrierte gezielte CPU-Lauf bestand 170 Fälle in elf
  Sekunden. / An additional deterministic test recomputes all nine Zilch cells
  against the actual baseline and compares the justified set with the six
  runtime cells and real decisions from legally constructed rolls. A future
  baseline change cannot silently retain stale tactical evidence. The integrated
  focused CPU run passed 170 cases in eleven seconds.
- **Watten-Ansagen, separater Folgeschritt / Watten calls, separate follow-up:**
  **Nicht in 4.3.0 enthalten / Not included in 4.3.0.** Die unabhängige visuelle
  Prüfung dieses Blocks läuft weiter; der CPU-Release übernimmt keine noch
  ungeprüfte Zwischenlösung. / Independent visual review continues; the CPU
  release does not include an unverified intermediate layout.
   Der eigene untere Hinweis lag auf kleinen
  Hochkantansichten unter dem Gebotsstand; mit Referenzkarte konnte auch die
  Ansage eines Mitspielers verdeckt werden. Die vorhandene Layoutberechnung
  sucht für die eigene Ansage freien Platz oberhalb des tatsächlich gewachsenen
  Bedienbereichs. Andere Ansagen ersetzen vorübergehend den Text ihrer bereits
  vorhandenen Rollenreihe am zugehörigen Platz; sie brauchen keinen zusätzlichen
  schwebenden Bereich zwischen Fächer und Gebot.
  Feed, Sichtrechte, 5,2-Sekunden-Lebensdauer und Quittierung bleiben unverändert.
  Tatsächliche DE/EN-Screenshots und sechs Browserfälle prüfen zwei/vier Sitze,
  Referenzkarte, Gebote, Partnerhinweis, Rotation und Ausscheiden der Ansagen.
  Auch Nichtansager und echtes Gegenbieten mit Partnerentscheidung sind Teil
  der Prüfung. Ein früherer grüner Own-only-Test wurde nach visueller
  Entdeckung des Peerfehlers ausdrücklich verschärft. / Own calls could sit below the stake
  on small portrait screens; the reference card could also obscure a peer's
  call. Existing layout fitting now finds room for the own call above the
  measured controls. Peer calls temporarily replace their existing seat-role
  text rather than seeking more floating space between fans and bidding.
  Delivery, privacy, 5.2-second lifetime and acknowledgements stay unchanged.
  Actual DE/EN screenshots and six browser cases cover two/four seats, reference,
  bidding, partner advice, rotation and retirement, including non-callers and
  real counterbids with partner response. An earlier green own-only check was
  strengthened after actual visual inspection exposed the peer case.
  Claudes anschließende Bildprüfung fand zusätzlich eine falsche räumliche
  Zuordnung trotz überdeckungsfreier Rechtecke. Die eigene Ansage erhält nun
  zuerst den niedrigsten mittigen Platz. Für die übrigen Ansagen ersetzt die
  feste Rollenreihe die räumlich missverständliche Verschiebung. Reale enge
  Gegenbieten-Zustände widerlegten auch die Zwischenlösung mit Seitenoffset.
  Die Fälle wurden nicht ausgeklammert und keine Kollisionstoleranz erhöht.
  / Claude's subsequent image review also found misleading seat placement
  despite non-overlapping rectangles. The own call now gets the lowest centred
  slot first; peer role rows replace misleading floating shifts. Real crowded
  counterbid states also disproved the intermediate side-offset approach.
  Those cases were retained without increasing collision tolerances.
- **Prüfartefakte / Test artifacts:** Direkte Playwright-Aufrufe erhalten pro
  Pool einen eigenen Standard-Ausgabeordner. Ein echter CLI-Test belegt, dass
  Playwright den eigenen alten Inhalt entfernt, aber fremde Pool- und
  Vollnachweise erhält. Explizite Pfade und der verbindliche Vollrunner bleiben
  unverändert. / Direct Playwright calls default to separate per-pool output
  directories. A real CLI test proves that cleanup removes its own stale
  artifacts while preserving another pool and full-verification evidence.
  Explicit output paths and the required full runner are unchanged.

Für die neuen Quellen ist ein neuer vollständiger Nachweis vor dem Push
verbindlich. Das abschließende Login-Sicherheitsaudit folgt auf diesen Block;
ein erfolgreicher Funktionstest ist keine Sicherheitsfreigabe.

New sources require fresh complete local verification before pushing. The
final login security audit follows this block; passing functional tests is
not a security clearance.

### Anmeldesicherheit und private Kontoansichten / Sign-in security and private account views

**Deutsch**
Die Prüfung blieb auf die belegten Sitzungs-, Anmelde- und Kontoansichtspfade begrenzt.
Produktionskonfiguration, Secure-Cookies und Cookie-Domain, Passkey-Einstellungen,
HTTP-Header sowie die Bindung an `127.0.0.1` wurden ausschließlich lesend geprüft.
Im geprüften Umfang wurde kein Anmelde-Bypass belegt.

- **F1:** Erfolgreiches Abmelden setzt den gemeinsamen Browser-Cookie für 30 Tage
  auf einen leeren, geschützten Wert. Dadurch können ältere Host-Cookies keine
  Browsersitzung wiederherstellen; die aktuelle Serversitzung wird weiterhin widerrufen.
  Unbekannte ältere Datenbank-Bearer bleiben bis zu ihrem absoluten Ablauf gültig.
  Dies ist keine pauschale Abmeldung anderer Browser oder aller Geräte.
- **F2:** Atomare Reservierungen laufender Passwortprüfungen schützen die bestehende
  Grenze von fünf Versuchen in 15 Minuten anhand IP und Anmeldekennung auch bei
  Konkurrenz. Andere Anmeldeverfahren bleiben unverändert.
- **F3:** Ein fehlgeschlagenes Zilch-Abmelden zeigt einen Fehler und erlaubt einen
  erneuten Versuch. HTTP 401 bedeutet bereits abgemeldet; 403, 503 und Netzwerkfehler
  bleiben Fehler. Der erfolgreiche Vorgang besitzt genau eine Weiterleitung.
- **F4:** ZDWA und Zilch entfernen private Konto-Inhalte und persönliche Kopfzeilen
  vor Navigation und bei `pagehide`. Ein erkannter Kontowechsel lädt ein frisches
  Dokument; verspätete Antworten dürfen die vorherige Ansicht nicht wiederherstellen.

Gezielt bestanden: 35 Node-Tests, fünf Browserfälle und ein HTTP-Test mit vier
Modus-/Host-Unterfällen. Die Fremdtab-Fälle nutzen echte lokale Abmeldungen und
Kontowechsel sowie den ausdrücklich ausgelösten bestehenden `focus`-Handler.
Die Restore-Prüfung verwendet synthetische `pagehide`-/`pageshow.persisted`-Ereignisse;
sie belegt keinen tatsächlichen BFCache-Treffer und keine native Fokuszustellung.
Claude meldete im unabhängigen Review für den abschließenden Quelldiff **NO BLOCKERS**; dies war
Quellenreview. Ein neues globales `must_change_password`-Gate oder eine Änderung der
Kontorichtlinien wurde nicht eingeführt. Vollnachweis und Auslieferung werden separat
belegt; die begrenzte Prüfung ist keine umfassende Sicherheitsgarantie.

**English**
The review was limited to the evidenced session, sign-in and account-view paths.
Production configuration, secure cookies and their domain, passkey settings,
HTTP headers and the `127.0.0.1` binding were inspected read-only.
No sign-in bypass was established within the reviewed scope.

- **F1:** Successful sign-out retains an empty protected shared browser cookie for
  30 days, suppressing older host-cookie fallback while revoking the current session.
  Unknown older database bearer tokens remain valid until their absolute expiry;
  this does not sign out every browser or device.
- **F2:** Atomic reservations for pending password checks preserve the existing
  five-attempt/15-minute limit using IP and sign-in identifier under concurrency.
  Other sign-in methods are unchanged.
- **F3:** Failed Zilch sign-out displays an error and permits retry. HTTP 401 means
  already signed out; 403, 503 and network failures remain errors. Success owns one redirect.
- **F4:** ZDWA and Zilch clear private account content and personal headers before
  navigation and on `pagehide`; a detected identity change loads a fresh document.
  Late replies cannot restore the previous viewer's account view.

Focused evidence: 35 Node tests, five browser cases and one HTTP test with four
mode/host subcases passed. Cross-tab cases use real local sign-outs/account switches
and explicitly dispatch the existing `focus` handler. Restore coverage uses synthetic
`pagehide`/`pageshow.persisted` events, not a proven real BFCache hit or native focus delivery.
Claude independently reported **NO BLOCKERS** for the final source diff in a source-only review.
No new global `must_change_password` gate or account-policy change was introduced.
Integrated verification and delivery are recorded separately; this bounded review
is not a comprehensive security guarantee.


### 4.3.1: gemeinsame Integration / combined integration

Die neuen Kontopfade bestanden auch fünf gezielte WebKit-Browserfälle. Die
Login-Datenbankfixture wird über eine explizite Modulmarkierung je Testfall
aktiviert; acht Fälle bleiben mit unverändertem Setup, Teardown und Assertions
grün. Damit passieren auch die strikten Prüfungen auf unbenutzte Parameter.

Five focused WebKit browser cases also passed for the account paths. An explicit
module marker activates the isolated login database fixture per test case;
all eight cases retain their setup, teardown and assertions. This also satisfies
the strict unused-parameter check.


Watten-Ansagen bestanden sieben reale DE/EN-Browserfälle sowohl mit Chromium
als auch WebKit: zwei/vier Sitze, Referenzkarte, Nichtansager, Gegenbieten und
beide Ansagen des Dreier-Solisten. 166 Ansage-/Stapelproben und 633 Proben innerhalb
der Namensfelder fanden keine Überdeckungen oder Fallbacks. 45 Austeilursprünge
und zwölf Dreier-Stichlayouts wurden zusätzlich gemessen. Claude prüfte die
letzte Quellkorrektur und den tatsächlichen Solo-Screenshot ohne Blocker.
Die drei anfänglichen WebKit-Abbrüche waren eine belegte Test-RPC-Race bei
`Date.now()+10` vor `pauseAt`; der Test friert die Zeit nun ausschließlich mit
öffentlichen Clock-APIs ein. Keine Assertion oder Kollisionstoleranz wurde gelockert.

Watten calls passed seven real DE/EN browser cases in both Chromium and WebKit:
two/four seats, a reference card, non-callers, counterbids and both solo-caller
values in three-player games. All 166 call/deck samples and 633 intra-badge
samples had zero overlaps or fallbacks. Forty-five dealing origins and twelve
three-seat trick layouts were also measured. Claude approved the final source
correction and actual solo screenshot without blockers. Three initial WebKit
aborts proved a test RPC race between `Date.now()+10` and `pauseAt`; the test
now pins time using only public Clock APIs. Assertions and collision tolerances
were not weakened.

Der Tablet-Block richtet ausschließlich Vierertische ab 761×701 CSS-Pixeln neu
aus. Zwei gezielte Chromium-Tests bestanden 80 Anzeige-Fixtures über acht Größen,
einschließlich 768×1024, 1024×768 und 1280×800 sowie den Ausschluss kleiner
Telefone und Zwei-/Dreiertische. Lange Namen, Titel, Danke, eins bis vier
Stichpakete, vier ausgespielte Karten und passive/aktive Blödeln-Anzeigen wurden
visuell und geometrisch geprüft. Die absichtlich kombinierten Anzeige-Fixtures
sind keine Behauptung legaler Spielzustände. Ein separat gebündelter Testrenderer
brauchte explizite SVG-Sichtbarkeit, um die Kartenbilder zu malen; die genaue
Browserursache dieser Harness-Abweichung ist nicht vollständig isoliert.
Die Produktdarstellung wurde daraus nicht geändert. Ein separater echter
Viererspiel-Ablauf am unveränderten Bundle prüft deshalb das Einschauen.

The tablet block only rearranges four-seat tables at 761×701 CSS pixels and
above. Two focused Chromium tests passed 80 display fixtures across eight sizes,
including 768×1024, 1024×768 and 1280×800, and checked exclusion of compact phones
and two/three-seat tables. Long names, titles, Thanks, one to four captured
packets, four played cards and passive/active Blödeln panels received visual and
geometric checks. Deliberately combined display fixtures are not assertions of
legal engine states. A separately bundled test renderer needed explicit SVG
visibility to paint its artwork; the exact browser cause of that harness
variation has not been fully isolated. This did not change product artwork.
A separate real four-player flow against the unmodified bundle therefore checks
inspection.


Am integrierten Bundle `b8b564037f40` bestanden die beiden Tablet-Tests auch in
WebKit. Der zusätzliche echte blinde Viererablauf bestand mit zwei Ansagenden,
beiden Ausrichtungen, vollständig gedruckten Karten und tatsächlichen
Bestätigungen bis zum Kartenspiel. Vier native Screenshots wurden betrachtet.
Der erste erweiterte WebKit-Lauf fand außerdem den alten pauschalen 44-Pixel-
Vertrag für dekorative Stichpakete. Ausschließlich die neue obere Tablet-
Paketspalte nutzt bewusst 26–40 Pixel, damit Namen und Karten frei bleiben;
ihre eigene Größenprüfung ersetzt dort den alten Vertrag. Andere Pakete und
alle 44-Pixel-Bedienelemente behalten ihre bisherigen Grenzwerte.

Against integrated bundle `b8b564037f40`, both tablet tests also passed in WebKit.
The additional real blind four-player flow passed with two callers, both
orientations, fully printed cards and real acknowledgements through to card
play. Four native screenshots were inspected. The first expanded WebKit run
also found the old blanket 44-pixel contract for decorative captured packets.
Only the new upper tablet packet column deliberately uses 26–40 pixels to keep
names and cards clear; its specific size check replaces that old contract.
Other packets and all 44-pixel controls retain their existing bounds.
Claude prüfte die endgültige Tablet-Quelle und tatsächliche Hoch-/Querformatbilder
ohne blockierende Befunde. Das war keine Freigabe des integrierten Vollnachweises.

Claude independently read the final tablet source and actual portrait/landscape
screenshots and reported no blockers within that scope. His review did not
claim integrated-build or full-gate approval.


### Befunde im integrierten Volltest / findings in the integrated full run

Der erste vollständige 4.3.1-Kandidat `8ad560ef` bestand 625 Tool- und 3541
Backend-Tests mit 85,30 Prozent Branch-Abdeckung sowie Produktionsimage und
Offline-Smoke-Test. Alle acht Browser-Pools liefen zu Ende; fünf Fehler
verhinderten den Nachweis und jeden Push dieses Kandidaten. Die Belege bleiben
erhalten. Davon war ein echter Layoutfehler in zwei Sprachfällen enthalten:
Bei 1280×800 kollidierte der obere gegnerische Fächer mit einer Stichkarte.
Die Höhenberechnung begrenzt nun zuerst die eigene Hand und danach verdeckte
Fächer innerhalb ihrer bisherigen Größenwünsche; Stichkarten bleiben mindestens
90 Pixel und gegnerische Karten mindestens 56 Pixel breit. Die harte Prüfung
vergleicht ausgespielte Karten jetzt auch mit allen gegnerischen Karten,
einschließlich null bis fünf Restkarten an den beiden belegten Engstellen.

Drei weitere Fehler betrafen Testverträge: Ein weiterhin gültiges Nachwurfrecht
des vorherigen Spielers ist kein laufender CPU-Übergang; der Austrittstest wartet
weiter auf Menschenzug und geschlossene Nachziehschulden, ohne das Nachwurfrecht
zu verbieten. `_cpu_thinking` wurde ausdrücklich nicht als Idle-Garantie benutzt.
Der Tour-Queue-Test verwendet den bereits eingebauten echten Lobby-Controller,
weil private Kontodokumente beim Abmelden korrekt beendet werden. Beim
Dreier-Watten wartet die Rückschauprüfung vor dem kontrollierten RAF-Schritt
auf das tatsächliche native `toggle`-Ereignis. Versions-, Annahme-, Queue-,
Identitäts-, Kollisions- und Austrittsprüfungen bleiben erhalten. Die vier
gezielten Wiederholungsfälle bestanden am integrierten Stand ohne Retry.
Ein neuer vollständiger Nachweis bleibt vor dem Push zwingend.

The first complete 4.3.1 candidate `8ad560ef` passed 625 tool tests, 3541 backend
tests with 85.30 percent branch coverage, the production image and offline
smoke test. All eight browser pools completed; five failures prevented its
receipt and push, and their evidence was retained. Two language cases exposed
one real layout defect: at 1280×800 the upper opponent fan overlapped a played
card. Height budgeting now caps the own hand first and the backs next within
their existing preferred sizes, retaining a 90-pixel trick minimum and 56-pixel
opponent-card minimum. Hard checks now compare every played card with every
opponent card, including zero to five remaining cards at the two known tight
viewports.

The other three failures concerned test contracts. A prior player's continuing
afterthrow right is not an ongoing CPU transition: the departure test still
waits for the human turn and closed refill debts without forbidding that right.
`_cpu_thinking` is explicitly not treated as an idle guarantee. The tour-queue
test uses the already mounted real lobby controller because private account
documents correctly retire after sign-out. Three-player Watten history now
waits for the actual native `toggle` event before advancing its controlled RAF.
Version, acceptance, queue, identity, collision and departure assertions remain.
All four focused repetitions passed on the integrated tree without retries.
Fresh complete verification is still mandatory before pushing.


Der fertig gebaute integrierte Stand `d94e3f4d4e4c` bestand danach sechs gezielte
WebKit-Fälle: die beiden echten DE/EN-Vierertische, das echte Einschauen,
90 Anzeige-Fixtures mit gegnerischen Restkartenzahlen, den Scope-Guard sowie
die Dreier-Rückschau mit nativem Toggle. Die tatsächlichen Bilder wurden
betrachtet. Claude meldete nach Quellenreview der Höhenberechnung und sämtlicher
drei Testkorrekturen keine Blocker. Der regulär geöffnete Stichverlauf blendet
die Tischkarten absichtlich aus (`watten-polish.css`); leere Tischflächen in
diesen Rückschau-Bildern sind kein belegter Rasterfehler.

The rebuilt integrated bundle `d94e3f4d4e4c` then passed six focused WebKit cases:
both real DE/EN four-player tables, real inspection, 90 display fixtures with
remaining opponent-card counts, the scope guard and native-toggle three-player
history. Actual images were inspected. Claude reported no blockers after
reviewing the height-budget source and all three test corrections. Opening
trick history intentionally hides table cards (`watten-polish.css`); empty
surfaces in those review images are not evidence of a raster defect.
