# Zilch-Regelvertrag (intern)

Stand: `zilch-house-v1`. Dieses Dokument ist der verbindliche Regelvertrag für
die serverseitige Engine. Zilch bleibt eine geschützte `noindex`-Vorschau für
den Admin-Account `Mani` (mit einer ausdrücklich konfigurierten privaten
Allowlist für einen zweiten Testspieler). Es gibt ausdrücklich keine
öffentliche Regelseite. Die aktuelle Oberfläche ist eine private, spielbare
Human-vs-Human-, Human-vs-CPU- und Solo-Produktoberfläche, keine öffentliche
Freischaltung.

## Begriffe

| Deutsch | English | Bedeutung |
| --- | --- | --- |
| Wurf | roll | Ein serverseitig erzeugtes Ergebnis für alle freien Würfel. |
| Halten | hold | Verbindlich ausgewählte Wertungswürfel; Halten kann nicht zurückgenommen werden. |
| Rundenpunkte | unbanked round points | Punkte eines noch nicht angeschriebenen Zuges. |
| Anschreiben / Sichern | bank | Rundenpunkte dauerhaft zum Gesamtstand hinzufügen. |
| Zilch | Zilch / no-score turn | Zugverlust; ungesicherte Punkte verfallen. |
| Bestätigungswurf | confirmation roll | Nach einer bestimmten starken Wertung erforderlicher weiterer Punktewurf. |
| Hot Dice | Hot Dice / free roll | Alle sechs physischen Würfel wurden gehalten; sie werden wieder frei, die Rundenpunkte bleiben bestehen. |
| Straße | straight | Einmal 1–6. |
| Drilling | three of a kind / triple | Drei gleiche Würfel als Wertungsgruppe. |
| Drei Paare | three pairs | Drei verschiedene Paare in einem Sechs-Würfel-Wurf. |

## Verbindliche Wertung

Es werden immer sechs Würfel verwendet; das Ziel beträgt mindestens 10.000
Punkte.

| Wertung | Punkte | Regel |
| --- | ---: | --- |
| Einzelne 1 | 100 | Jede einzeln gehaltene 1. |
| Einzelne 5 | 50 | Jede einzeln gehaltene 5. |
| Drei 1en | 1.000 | Ein Drilling; löst einen Bestätigungswurf aus. |
| Drei gleiche 2–6 | Augenzahl × 100 | Beispielsweise drei 4en = 400. |
| Vier oder fünf Gleiche | keine eigene Sonderwertung | Sie bestehen aus einem Drilling plus möglichen einzelnen 1en/5en. |
| Sechs Gleiche | zwei getrennte Drillinge | Beispielsweise sechs 1en = 2.000; kein Multiplikator. |
| Straße 1–6 | 2.000 | Alle sechs Würfel. |
| Drei Paare | 500 | Alle sechs Würfel, drei Paare. |
| Zwei Drillinge | Summe beider Drillinge | Beispielsweise 3×2 und 3×4 = 600. |
| „500 für nichts“ | 500 | Nur bei sechs freien Würfeln ohne sonstige wertbare Kombination, etwa 2-2-3-4-6-6. Dies ist **kein** Zilch. |

Es gibt in dieser Regelversion keine weiteren Sonderkombinationen.

### Auswahl und Kombination

- Der Spieler darf jeden gültigen, punktenden Teil eines Wurfs halten. Er darf
  etwa bei 3×5 nur eine 5 für 50 halten oder den Drilling für 500.
- Werden drei gleiche Würfel gemeinsam gehalten, zählen sie zwingend als
  Drilling und nicht als drei Einzelwürfel. Bei vier oder fünf gleichen
  1en/5en ergänzt ein Drilling die übrigen ausgewählten Einzelwürfel.
- Ein bereits bestätigter Hold ist endgültig; es gibt keine Unhold-Aktion.
- Mehrere wertende Gruppen dürfen gemeinsam gehalten werden, zum Beispiel
  3×1 (=1.000) plus zwei weitere einzelne 1en (=200). Die Engine liefert auch
  kombinierte Auswahloptionen.

Beispiele:

- `5-5-5-5-2-3`: ein Drilling 5 = 500; alle vier 5en zusammen = 550; nur
  eine 5 = 50.
- `1-1-1-5-5-2`: drei 1en und zwei einzelne 5en = 1.100. Wegen der drei 1en
  folgt ein Bestätigungswurf.
- `1-2-3-4-5-6`: Straße = 2.000. Alle Würfel sind gehalten, daher Hot Dice
  und ein Bestätigungswurf.
- `2-2-3-4-6-6`: „500 für nichts“ = 500. Alle Würfel werden danach für
  denselben Spieler wieder frei; auch hier ist ein Bestätigungswurf nötig.

## Zugablauf, Risiko und Sichern

1. In `multiplayer` und `cpu` würfeln die Teilnehmer vor Spielbeginn jeweils
   einmal. Der höhere Wert beginnt; bei Gleichstand wird erneut gewürfelt.
   Jeder Startwurf wird ausschließlich serverseitig erzeugt. In einer
   CPU-Partie würfelt zuerst der Mensch; der serverseitige CPU-Runner erzeugt
   danach den gleichwertigen CPU-Wurf. Im Solo-Sprint gibt es bewusst keinen
   bedeutungslosen Startwurf: der einzige Mensch beginnt direkt mit seinem
   ersten normalen Zug.
2. Der aktive Teilnehmer würfelt ausschließlich auf dem Server alle noch
   freien Würfel und hält anschließend mindestens eine gültige Wertung.
3. Nach dem dritten Wurf müssen insgesamt mindestens 300 Rundenpunkte
   verbindlich gehalten sein. Ist das mathematisch nicht mehr möglich, tritt
   sofort Zilch ein. Gibt es eine erreichbare 300er-Auswahl, liefert der Server
   ausschließlich diese gültigen Fortsetzungs-Holds statt einer kleineren,
   unzulässigen Auswahl.
4. Anschreiben ist ab 400 Rundenpunkten möglich, solange kein
   Bestätigungswurf offen ist. Ein erfolgreiches Anschreiben überträgt die
   Punkte dauerhaft und setzt die eigene Zilch-Serie zurück.
5. Es gibt kein gewöhnliches Wurflimit: Nach erfüllter 300er-Regel darf der
   Spieler weiterwürfeln, bis er anschreibt oder Zilch erleidet.

## Bestätigungswurf und Hot Dice

Ein weiterer Punktewurf mit mindestens 50 Punkten muss gehalten werden, wenn

- ein Drilling aus 1en gehalten wurde; oder
- durch die Holds alle sechs physischen Würfel gehalten wurden.

Der zweite Fall umfasst insbesondere Straße, drei Paare, zwei Drillinge,
sechs Gleiche und „500 für nichts“. Hot Dice setzt die sechs Würfel wieder auf
frei; die Rundenpunkte und die Hold-Historie bleiben erhalten. Während ein
Bestätigungswurf offen ist, darf nicht angeschrieben werden. Erzeugt der
Bestätigungswurf erneut drei 1en oder Hot Dice, beginnt die Bestätigung erneut.

## Zilch, Serien und Spielende

Ein Zilch tritt ein, wenn

- ein Wurf keine gültige Wertung liefert (ausgenommen das bestätigte „500 für
  nichts“ bei sechs freien Würfeln); oder
- die 300er-Schwelle am dritten Wurf nicht verbindlich erreicht werden kann.

Ungesicherte Rundenpunkte verfallen; das eigene Board protokolliert den Zug
als `zilch`. Beim **dritten aufeinanderfolgenden** Zilch werden 500 Punkte
abgezogen, niemals unter 0. Ein erfolgreiches Anschreiben setzt die Serie
zurück. Die bestätigte Regel bestimmt den Übergang zur dritten Serie; ob nach
einem vierten oder weiteren Zilch ohne Anschreiben weitere Abzüge in einer
festen Kadenz folgen sollen, ist bewusst noch nicht festgelegt. Die aktuelle
Engine zieht daher genau beim Übergang `2 → 3` einmal 500 Punkte ab und erfindet
keine weitere Straflogik.

In `multiplayer` und `cpu` wird ab mindestens 10.000 angeschriebenen Punkten
die mögliche Schlussrunde begonnen. Der andere Teilnehmer erhält einen
vollständigen normalen Zug mit beliebig vielen Würfen nach diesen Regeln.
Danach gewinnt der höchste Gesamtstand; bei Gleichstand gibt es keinen Sieger
und keinen Stechwurf. Der Solo-Sprint hat keinen Gegner, keine Schlussrunde
und keinen Gegenzug: ein legaler Bank-Vorgang mit mindestens 10.000 Punkten
schließt sein Objective unmittelbar ab.

Manuelle Punkteingabe ist nicht vorgesehen. Eine spätere manuelle
Würfelauswahl kann zusätzlich zu Quick Holds entstehen, bestimmt aber niemals
Punkte auf dem Client.

## Serververtrag für spätere Bedienung

Nach jedem Wurf liefert der Snapshot strukturierte Quick-Hold-Optionen unter
`_zilch_quick_holds`. Jede enthält mindestens eine stabile, rollgebundene ID,
Kombinationstyp, Würfelindizes/-werte, Punkte, Übersetzungs-Key samt Parametern,
Komponenten, Hot-Dice-/Free-Roll-Information und Folgeaktionen. Der Server
formatiert daraus keine deutschen Texte.

Die aktuell verfügbaren WebSocket-Aktionen sind:

- `zilch_start_roll` mit `start_roll_version`; jeder menschliche Teilnehmer
  löst genau seinen eigenen serverseitigen Startwurf aus. Der CPU-Startwurf
  wird ausschließlich über den vertrauenswürdigen Server-Runner ausgelöst;
- `zilch_roll_dice` mit `turn_id` und `version`;
- `zilch_select_hold` mit `turn_id`, `version`, `roll_id`, `option_id` sowie
  optional gegengeprüften Würfelindizes, Punkten und Kombinationstyp;
- `zilch_bank_points` mit `turn_id` und `version`.
- `zilch_abandon_solo` mit aktuellem `turn_id`, `version` und dem exakten
  Server-Flag `confirmed: true`; die Oberfläche zeigt davor einen
  Bestätigungsdialog. Die Action ist ausschließlich für den menschlichen
  Teilnehmer eines aktiven Solo-Sprints gültig.

Eine Quick-Hold-Auswahl wird für den aktuellen Turn und Roll erneut
berechnet. Alte IDs, falsche Indizes/Punkte, ein falscher Spieler, falscher
Spieltyp sowie doppelte oder veraltete Versionsstände werden ohne
Zustandsänderung abgewiesen. Der ältere Platzhalter `zilch_submit_score` wird
explizit als nicht unterstützte manuelle Punkteingabe abgelehnt.

## Private Modi, CPU-Gegner und Ergebnisgrenze

Der aktuelle private Spielmodus unterstützt drei Varianten:

- `multiplayer`: genau zwei angemeldete menschliche Teilnehmer. Beide führen
  ihren Startwurf selbst aus.
- `cpu`: ein angemeldeter menschlicher Host gegen einen echten CPU-Teilnehmer.
  Die CPU hat keinen Account, keine Session, keinen Resume-Token und keinen
  WebSocket. Sie ist daher nie „offline“ und ein zweiter Mensch kann ihre
  Stelle nicht einnehmen.
- `solo`: genau ein angemeldeter menschlicher Host mit dem versionierten
  Objective `reach_10000_fewest_turns` v1. Es gibt keinen Gegner, keinen CPU-
  Teilnehmer, keinen Raumcode und keinen Startwurf.

### Solo-Sprint: `reach_10000_fewest_turns` v1

Der erste echte Solo-Modus ist ein 10.000-Punkte-Sprint: Ziel ist, mindestens
10.000 gesicherte Punkte in möglichst wenigen **eigenen Zügen** zu erreichen.
Es gibt kein Rundenlimit. Der Server beobachtet die unveränderten Engine-
Ereignisse und speichert als Challenge-Metriken Anzahl Züge, Anzahl Würfe,
Zilchs, Hot-Dice-Ereignisse, höchste gesicherte Runde und aktive Dauer. Die
spätere, noch nicht implementierte Vergleichsreihenfolge lautet: weniger Züge,
dann weniger Würfe, weniger Zilchs und kürzere aktive Dauer.

Pausen und Neustart-/Offline-Zeit zählen nicht zur aktiven Dauer. Der Spieler
kann einen laufenden Sprint nach einer sichtbaren Bestätigung aufgeben. Das
ergibt das private Outcome `abandoned`; der bis dahin autoritative Verlauf und
alle Metriken bleiben erhalten. Ein erfolgreicher Zielabschluss heißt
`completed`. Keines der beiden Outcomes erzeugt künstlich einen Gewinner,
Gleichstand oder Gegner.

Die beiden Startwerte und ein möglicher Gleichstand bleiben im Snapshot
sichtbar. Anschließend zeigt die private Spielseite gleichzeitig beide Boards,
sechs ausschließlich vom Server gelieferte Würfel, Rundenscore, Gesamtpunkte,
Zilch-Serie, Verbindungsstatus, Start-/Schlussrundenmarker und eine kompakte
Rundenhistorie.

Die CPU verwendet genau dieselben gültigen serverseitigen Quick Holds,
Würfelaktionen, Versionen, Scoring-Regeln und die gleiche faire RNG-Funktion
wie ein Mensch. Sie besitzt keine eigene Zufallsquelle, kann keine künftigen
Würfe sehen, keine Kombination erfinden und keine Punktzahl bestimmen. Ihre
einzige Auswahl beim Erstellen ist eine fest validierte Strategie:

| Strategie | Basis zum Sichern | Verhalten |
| --- | ---: | --- |
| Konservativ | 500 | sichert eher früh und vermeidet unnötige Risiken |
| Normal | 750 | hält Risiko und Rundenwert im Gleichgewicht |
| Aggressiv | 1.100 | spielt häufiger auf größere Runden weiter |

Diese Werte sind transparente Produktparameter, keine abweichenden
Spielregeln. Die Strategie berücksichtigt zusätzlich Punkteabstand,
verbleibende Würfel, Hot Dice, Bestätigungswurf und Schlussrunde. Ein
Bestätigungswurf bleibt immer zwingend; ein erreichbarer Sieg wird gesichert,
und eine CPU würfelt in einem noch legalen Gegenzug weiter, wenn ein sonstiges
Sichern sicher verlieren würde. Die genaue technische Heuristik steht in
[MULTIGAME_FOUNDATION.md](MULTIGAME_FOUNDATION.md).

Die Bedienung erfolgt in dieser Stufe nur über serverseitig berechnete
Quick-Hold-Karten. Einzelne Würfel wirken nicht anklickbar und eine manuelle
Würfelauswahl oder Punkteingabe existiert nicht. Die Karten, Würfeln und
Sichern sind Tastatur- und Touch-Buttons; der Browser sendet nur die
referenzierte Option und übernimmt nie einen lokalen Punktewert.

Nach dem vollen kompetitiven Gegenzug markiert der aktive Zilch-State Gewinner
oder Gleichstand. Ein Solo-Sprint markiert stattdessen `completed` oder
`abandoned`. Beide Terminalarten werden zuerst als `active_games`-Snapshot
gespeichert, damit ein Datenbankfehler oder Neustart keinen Endstand verliert.
Anschließend erzeugt der Zilch-Finalizer idempotent entweder den unveränderten
kompetitiven `zilch_result`-Payload (Schema 1) oder den getrennten
`zilch_solo_result`-Payload (Schema 2). Solo enthält Objective-ID/-Version,
Parameter, Fortschritt, aktive Dauer, eine Board-Historie und keine
Startwurf-/Schlussrunden-/Winner-/Tie-Felder. Erst nach bestätigter Speicherung
wird der aktive Terminal-State entfernt.

Der Report ist ausschließlich über die geschützte, `noindex`
Zilch-Ergebnisroute und die private eigene Historie erreichbar. Er wird
weiterhin **nicht** in ZDWA-Historie, Scorecards, Replay, Statistik,
Leaderboard, Achievement- oder Profilaggregate geschrieben. Die getrennten
privaten Zilch-Statistiken und Bestenlisten lesen ausschließlich validierte
abgeschlossene Zilch-Payloads; sie verändern weder Ergebnisse noch Regeln. Ein alter
Terminal-State, dem eine autoritative Pflichtangabe wie der Endzeitpunkt fehlt,
bleibt aktiv und wird protokolliert; die Anwendung erfindet keine Werte.

Die private Navigation führt nur zu funktionierenden Bereichen:
`/zilch` (Lobby), `/zilch/spiel/{id}` (Partie), `/zilch/historie` (eigene
abgeschlossene Partien), `/zilch/ergebnis/{id}` (read-only Ergebnis),
`/zilch/statistiken` (eigene Auswertung), `/zilch/bestenlisten` (private
Ranglisten) und `/zilch/regeln` (diese Regeln als lokalisierte In-App-Hilfe).
Alle diese Routen
sind serverseitig durch dieselbe Preview-Policy geschützt und bleiben
`noindex`; die Regelseite ist weder öffentlich noch eine zweite verbindliche
Regelquelle. Gemeinsame Konto- und Spracheinstellungen bleiben Plattformfunktionen
und führen bei gültiger Berechtigung zurück zur privaten Zilch-Lobby.

Zum manuellen privaten Test kann Admin `Mani` direkt einen Solo-Sprint oder
eine CPU-Partie anlegen. Für eine Zwei-Menschen-Partie vor dem App-Start den
normalisierten Namen des zweiten angemeldeten Testkontos in
`ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES` setzen, beide Browser in die private
Zilch-Lobby wechseln, beitreten und den Startwurf nacheinander ausführen.
Ohne diese Konfiguration bleibt ausschließlich Admin `Mani` zugelassen.

## Technische und Produktgrenzen

- Die Engine verwendet für Menschen und CPU-Teilnehmer denselben injizierbaren,
  serverseitigen Zufallsweg. Clients liefern nie Würfelergebnisse. Die
  serverseitige Denkpause `ROLLTHEDICE_ZILCH_CPU_DELAY_SECONDS` (Standard 0,55
  Sekunden, begrenzt auf 0–5) beeinflusst nur die sichtbare Taktung, niemals
  Würfel oder Wertung.
- Aktive Zustände samt Turn-ID, Holds, Rundenpunkten, Boards und Quick-Hold-
  Grundlage bleiben über die bestehende aktive Persistenz
  restart-sicher. Ein Abschluss wird erst nach einer erfolgreichen,
  idempotenten privaten Ergebnis-Persistenz entfernt und bleibt vollständig
  von ZDWA-Ergebnissen, Statistiken, Achievements und Bestenlisten getrennt.
- Die private Auswertung verwendet nur abgeschlossene, validierte Zilch-
  Ergebnisse: Solo Sprint v1 nach weniger Zügen, Würfen, Zilchs und aktiver
  Dauer; Human-vs-Human nach Siegen, dann weniger Niederlagen, mehr
  Gleichständen, höherer Endpunktzahl und höchster Runde; CPU-Partien nach
  denselben Kriterien je Strategie. Aufgegebene Solo-Läufe und nicht aktive
  Konten sind nicht rankingfähig.
- Noch offen bleiben insbesondere eine präzise Strafkadenz nach mehr als drei
  aufeinanderfolgenden Zilchs, weitere Solo-Objectives/Challenges, manuelle
  Würfelauswahl, finale Interaktions-/Markenpolitur und Zilch-Achievements.

## Designrichtung

Die private Oberfläche nutzt die vorhandene `data-game="zilch"`-Grenze mit
warmen Holz-/Spieltischflächen, physisch wirkenden CSS-Würfeln, deutlich
leuchtenden gehaltenen/ausgewählten Zuständen, großen papierartigen
Quick-Hold-/Würfel-/Sichern-Karten, gut lesbarer Standardschrift und großen
Touch-Zielen. Lobby, Wartesaal, Startwurf (nur kompetitiv), ein oder zwei
Boards, Ergebnis, Historie und
die private Hilfe bleiben dabei eine eigenständige Zilch-Oberfläche. Zilch, Hot
Dice, Bestätigungswurf und Spielende erhalten einen zusätzlichen Textstatus und
kurze reduzierte-Bewegung-freundliche CSS-Effekte. Semantische Buttons,
sichtbarer Fokus, Live-Status und nicht allein farbbasierte Zustände gehören zur
Bedienung. Finales Branding, eine lizenzierte Akzentschrift und weitere
Produktpolitur sind nicht Teil dieser Regelversion.

Das ist ausschließlich eine eigene Designrichtung. Es werden keine Grafiken,
Sounds, Fonts, Logos, Award-Designs, Quellcodes oder pixelgenauen Vorlagen von
Bubblebox oder anderen Dritten übernommen.
