# Hausdepp-Computer / Hausdepp computers

Die Computer verwenden dieselben Befehle und denselben Regelprüfer wie Menschen.
Es gibt keine eigene CPU-Hausregel und keine zusätzliche Nachwurfsperre.
Sie erhalten ausschliesslich ihre persönliche `project_state`-Ansicht: eigene
Hand, offenes Paket, öffentliche Handgrössen und Anzahl der Nachziehkarten.
Verborgene gegnerische Hände, Nachziehreihenfolge und interne Erfolgsnachweise beeinflussen
keine Entscheidung. Auch erlaubte private Abhebeinformationen werden von dieser
Strategie nicht zur Vorhersage des verdeckten Stapels verwendet.

Computers use the same commands and authoritative validator as humans, without
special rules or additional-card locks. They receive only their personal
`project_state` view: their own hand, the open pile, public hand sizes and stock
count. Hidden opposing hands, draw order and internal achievement evidence never
influence a decision. This policy also does not use permissible private bottom
inspection information to predict the face-down stock.

## Entscheidungen / Decisions

- Pflichtauffüllen bleibt vorrangig und hält die öffentliche FIFO-Reihenfolge ein.
  Danach werden mögliche Nachwürfe anhand der neuen Hand erneut geprüft. /
  Mandatory refills take priority and respect FIFO; additional cards are then
  reconsidered from the newly drawn hand.
- Bei leerem Nachziehstapel sucht der Computer eine sichere eigene Schlusskette:
  10er oder vier Gleiche räumen ab, bis die letzte gleichrangige Gruppe gelegt
  werden kann. Die Suche unterstellt keine gegnerische Karte. /
  With empty stock, it searches for a guaranteed finish through its own tens or
  quartets, followed by the final matching group, without assuming opposing cards.
- Eine erlaubte Vierer-Ergänzung erhält Vorrang. Hohe Paare und Drillinge werden
  zusammengehalten, während niedrigere Karten abgebaut werden. Eine 10 reicht
  zum Abräumen; weitere 10er bleiben als Reserve, sofern nicht die ganze Gruppe
  den sicheren Schlusszug bildet. /
  Legal quartet completions take priority. Higher pairs and triples are retained
  while lower cards are shed. One ten clears a pile; further tens stay in reserve
  unless the full group belongs to a guaranteed finish.
- Eine Hand mit höchstens drei Karten ab König darf bei mehr als sechs
  Nachziehkarten und geschätzter Erfolgswahrscheinlichkeit von mindestens 60 %
  zocken. Die Schätzung zählt nur eigene und aktuell offen liegende Karten als
  bekannt. Ausgespielte, bereits entfernte Karten sind keine heimliche Datenquelle. /
  A hand of at most three cards, all kings or higher, may gamble with more than six
  stock cards and an estimated success chance of at least 60%. Only its own cards
  and the current open pile are counted as known; removed cards provide no hidden
  information.
- Ohne legale Handkarte werden bei höchstens drei Nachziehkarten die erwarteten
  Zusatzkarten eines misslungenen Zockens gegen das sichere Aufnehmen gewogen.
  Im letzten Duell wird eine gegnerische Einzelkarte gezielt blockiert, wenn danach
  eine konkrete eigene Schlusschance bleibt. /
  With no legal hand card and at most three stock cards, expected failed-gamble
  additions are weighed against a deliberate pickup. In the final duel, a one-card
  opponent is blocked when doing so leaves a real follow-up finish.
- **Kaufen statt verbrennen:** Solange der Nachziehstapel noch Karten hat,
  bewertet der Computer Karten nach ihrem Spielwert (10 und Ass hoch, niedrige
  Karten als Ballast) und jede zusätzliche Handkarte als Last, die mit sinkendem
  Stapel steigt. Ein kleines wertvolles Paket wird aufgenommen, statt eine 10
  oder ein Ass darauf zu verbrennen; ein Paket, das eigene Paare zu Drillingen
  oder vier Gleichen ergänzt, erhält einen Bonus. Ohne legale Handkarte wird ein
  wertvolles Paket dem Zocken vorgezogen. Im Duell zweier Spieler zählt jede
  zusätzliche Karte mehr: Dort verbrennt er keine 10 auf einem Paket aus
  höchstens zwei Karten, solange mehr als zwölf Nachziehkarten übrig sind, und
  liegt ein Ass oben, wägt er Kaufen und Abräumen wie am grösseren Tisch ab
  (seit 3.8.2; vorher räumte er ein Ass im Duell fast immer mit der 10 ab). In
  6000 gepaarten Duellen verlor er so 4,7 % seltener als zuvor; mit drei bis
  sechs Spielern blieb die Stärke unverändert. Ohne Nachziehstapel räumt die 10
  wie bisher ab. In 3000 gepaarten Testpartien
  (gleiche Verteilung, jede Sitzposition) gegen die vorherige Strategie verlor
  der Computer 674-mal statt der fairen 750 (−10 %), am deutlichsten mit drei bis
  fünf Spielern. /
  **Buy instead of burn:** while stock remains, the computer values cards by
  their worth (tens and aces high, low cards as ballast) and every extra hand card
  as a burden that grows as the stock shrinks. It picks up a small valuable packet
  rather than burning a ten or an ace on it; a packet that turns its own pairs into
  triples or quartets earns a bonus. Without a legal hand card, a valuable packet
  beats a gamble. Heads-up, every extra card weighs more: there it refuses to burn
  a ten on a packet of at most two cards while more than twelve stock cards remain,
  and with an ace on top it weighs buying against clearing as at a larger table
  (since 3.8.2; before, it nearly always cleared an ace with a ten in a duel). In
  6,000 paired duels it lost 4.7 % less often than before; with three to six
  players strength stayed the same. With an empty stock, a ten clears as before. In 3,000 paired test games
  (same deal, every seat) against the previous policy, it lost 674 times instead
  of a fair 750 (−10 %), most clearly with three to five players.
- **Hohe Karten zurückhalten (seit 3.10.0):** Von Ober, König und Ass legt der
  Computer nur eine Karte, auch wenn er mehrere hat, und wirft die übrigen nicht
  sofort nach. Der nächste Spieler muss diese eine Karte beantworten (gleich hoch
  oder höher, mit einer 10 oder durch Aufnehmen), während die Reserve für die
  nächste Antwort bleibt. Vier Gleiche räumen weiterhin sofort ab, und ohne
  Nachziehstapel wird nachgeworfen, wenn das die Runde beendet. Niedrige Paare
  wirft er weiter zusammen ab. Volle Computer vergessen das Zurückhalten in rund
  12 % der Fälle, sanfte zu Beginn in rund 60 %. In gepaarten Partien gegen die
  eingefrorene 3.8.2-Policy mit Produktionsparametern verlor er so an jeder
  Tischgrösse 14–16 % seltener; bei sanfter Stärke mit 2 Spielern rund 5 %
  seltener, mit 4 Spielern ohne messbaren Unterschied (Zahlen und Befehl unter
  „Reproduzierbare Prüfung“). In der vorangehenden, explorativen
  Zweikampf-Simulation schnitten schwächer ab: nur Ass, alle bis auf eine Karte,
  auch Unter oder niedrigere Ränge, Zurückhalten nur solange der Stapel nicht
  leer ist. /
  **Holding back high cards (since 3.10.0):** of Obers, Kings and Aces the
  computer plays a single card even when it holds several, and does not follow up
  with the rest at once. The next player has to answer that one card (equal or
  higher, a ten, or by taking the packet) while the reserve waits for the next
  answer. Four of a kind still clear at once, and without stock it follows up
  when that ends its round. Low pairs are still shed together. Full-strength
  computers forget to hold back in about 12 % of cases, gentle ones at the start
  in about 60 %. In paired games against the frozen 3.8.2 policy at production
  settings it lost 14–16 % less often at every table size; at gentle strength
  about 5 % less often with 2 players and no measurable difference with 4 (figures
  and command under “Reproducible checks”). In the preceding exploratory heads-up
  simulation, these did worse: aces only, all but one card, also Unters or lower
  ranks, holding back only while stock remains.
- **Wechselnde Stärke und sanfter Einstieg:** Für jedes menschliche Konto am
  Tisch wird aus seinen abgeschlossenen Hausdepp-Runden zuerst eine gekappte
  Stufe berechnet: 0 Runden entsprechen 0,55, bis 50 Runden steigt sie
  gleichmässig auf 1,0. Der Tisch verwendet den Median dieser Stufen; bei gerader
  Anzahl werden die beiden mittleren gemittelt. 0 und 1000 Runden ergeben also
  0,775, nicht 1,0. Konten zählen einmal, CPUs und Zuschauer nicht. Die Zählung
  bleibt einmalig beim Tischstart; persönliche Einsteigertipps bleiben individuell.
  Abgeschlossene Runden sind ein Erfahrungswert, keine Messung des Könnens.
  Jeder Computer erhält zusätzlich eine stabile Eigenheit von ±0,08. Daraus folgt
  eine Ausrutscherquote von 5 % (volle Stärke) bis rund 30 % (sanftester Start):
  eine etwas höhere Karte als nötig, eine übersehene Kaufgelegenheit oder ein
  verpasster Nachwurf, Zocken statt Aufnehmen. Ab Stufe 0,9 wird eine gute
  Kaufgelegenheit nur noch mit 30 % dieser Quote übersehen (etwa 1,5–3 %), damit
  erfahrene Spieler keine offensichtlichen Fehlkäufe sehen. Pflichtauffüllen, Abheben und
  sichere Schlussketten werden nie verspielt. Die Zufallsentscheidung ist pro
  Tisch, Sitz und Spielstand fest, damit wiederholte Berechnungen während der
  Denkpause nicht hin- und herspringen. Gegen die vorherige Strategie verlor
  volle Stärke 441 von 2000 gepaarten Partien (fair 500), Stufe 0,8 484 und der
  sanfteste Start 558. /
  **Varying strength and a gentle start:** each human account's completed rounds
  first determine a capped level: 0.55 at zero rounds, rising evenly to 1.0 at
  50 rounds. The table uses the median of these levels, averaging the middle two
  for an even number of people. Zero and 1,000 rounds therefore yield 0.775,
  rather than 1.0. Each account counts once; CPUs and spectators do not count.
  Counts are still read once at table start; beginner tips remain personal.
  Completed rounds indicate experience, not measured ability.
  Each computer also has a stable ±0.08 personality. This yields a
  misjudgement rate from 5 % (full strength) to about 30 % (gentlest start): a
  slightly higher card than needed, a missed bargain or follow-up, a gamble instead
  of a pickup. From level 0.9, a good purchase is missed at only 30 % of that rate
  (about 1.5–3 %), so experienced players do not see obvious misses. Mandatory
  refills, cutting and guaranteed finishes are never
  misplayed. The random judgement is fixed per table, seat and state so repeated
  evaluations while thinking do not flip-flop. Against the previous policy, full
  strength lost 441 of 2,000 paired games (fair 500), level 0.8 484, and the
  gentlest start 558.
- **Tipps für neuere Spieler:** Wer weniger als 50 Runden gespielt hat, sieht in
  der eigenen Zugzeile kurze Tipps aus derselben Bewertung, etwa „Ass aufnehmen,
  10 behalten“, „Paket aufnehmen, 10 behalten“, „Aufnehmen – vier Gleiche“ oder
  „Aufnehmen statt zocken“. Sie verwenden nur die eigene Sicht und erscheinen nur,
  wenn der Spieler selbst entscheiden kann. /
  **Tips for newer players:** with fewer than 50 rounds, the own turn line shows
  short tips from the same evaluation, such as “take the ace, keep your ten”,
  “take the pile, keep your ten”, “take it – four of a kind” or “pick up instead
  of gambling”. They use only the player's own view and appear only when that
  player can decide.
- Pro Sitz bleiben höchstens 48 eigene, bereits angenommene Entscheidungen im
  Arbeitsspeicher. Kehrt dieselbe beobachtbare Lage wieder, versucht der Computer
  einen anderen legalen Plan. Die Erinnerung bleibt über menschliche Züge erhalten
  und endet bei Trennung, neuer Runde oder Neustart. Maximal 128 aktive Tische
  besitzen diese zusätzliche Erinnerung; sie wird weder gespeichert noch ausgesendet. /
  Each seat remembers at most 48 accepted decisions using its own observable
  position. A repeated position prompts another legal plan. Memory survives human
  turns and resets on disconnect, a new round or restart. At most 128 tables retain
  this extra memory; it is neither persisted nor transmitted.

## Öffentlich beobachtetes Endspiel / Publicly observed endgame

Bei leerem Nachziehstapel merkt sich jeder CPU-Sitz zusätzlich Karten aus
tatsächlich beobachteten öffentlichen Paketaufnahmen. Spielen und Nachwerfen
entfernen genau die ausgespielten Karten aus diesem Wissen. Eine fremde Hand
gilt erst als vollständig bekannt, wenn alle Karten durch diese Beobachtungen
belegt sind; unbekannte Restkarten bleiben unbekannt. Die Beobachtung folgt
jedem akzeptierten Kartenbefehl, auch zwischen zwei CPU-Zügen. Private
Abhebeinformationen, fremde Hände und interne Erfolgsnachweise werden dafür
nicht gelesen. Versionslücken, Rückzüge, Sitz-/Kontowechsel, neue Runden und
Neustarts verwerfen das Wissen. Ein Beobachtungsfehler verwirft den Speicher
dieses Tisches und wird protokolliert; der akzeptierte Spielzug bleibt gültig.

Die zusätzliche Taktik gilt nur mit zwei aktiven Spielern, bei leerem Tisch und
Nachziehstapel,
mit genau drei eigenen verschiedenen gewöhnlichen Karten und einem vollständig
bekannten gegnerischen Paar. Weitere Sitze müssen bereits fertig und leer sein;
Rückzüge und ein offenes Nachwurffenster sind ausgeschlossen.
Die Reihenfolge muss niedrig < Paar < Blockkarte <
Reserve sein. Beispiel: eigene 6/K/Ass gegen bekannte 7/7. Die CPU legt K statt
6, erzwingt die Paketaufnahme und behält das Ass für jede erlaubte Antwort.
Alle 70 Rangmuster dieses engen Falls sind gegen die Engine belegt, einschliesslich
Nachwerfen und Endduellen an Tischen mit drei, vier und sechs Plätzen. Frühere
Aussteiger behalten ihre Platzierung. Die bestehende Schwierigkeitsstufe kann
das Erkennen dieser Taktik
wie andere Einschätzungen dämpfen. Sichere eigene Schlussketten bleiben vorrangig.
Eine allgemeine Verbesserung der Gewinnrate wurde damit nicht gemessen.

With the stock empty, each CPU seat additionally remembers cards from public
packet pickups it actually observed. Plays and follow-up throws remove exactly
the played cards from that knowledge. An opposing hand is complete only when
all its cards are evidenced by those observations; unobserved cards stay unknown.
Every accepted card command is observed, including between CPU turns. The observer
does not read private peeks, opposing hands or internal achievement evidence.
Version gaps, withdrawals, seat/account changes, new rounds and restarts discard
knowledge. An observation failure discards this table's memory and is logged;
the accepted move remains valid.

The extra tactic applies only to two active players, with an empty table and stock,
exactly three distinct ordinary own cards and a completely known opposing pair.
Any other seats must have finished with empty hands; withdrawals and an open
follow-up window are excluded.
Their order must be low < pair < blocker < reserve. For example, with 6/K/ace
against known 7/7, the CPU plays K instead of 6, forces a pickup and retains the
ace for every legal reply. All 70 rank patterns of this narrow case are proved
against the engine, including follow-up throws and final duels at tables with
three, four and six seats. Earlier finishers retain their ranks. Existing
difficulty can make the CPU miss this tactic like other judgements. Guaranteed own finishes retain
priority. This does not measure a general increase in win rate.

## Tempo / Timing

Das variable Normaltempo ist um 12,5 % verlangsamt. Neue Züge mischen schnelle
Reaktionen von etwa 0,18–0,42 Sekunden, normale Pausen von 0,51–1,35 Sekunden
und gelegentliche Denkpausen bis 2,7 Sekunden.
Nach dem eigenen Abräumen liegen weitere Aktionen meist bei 0,135–0,731 Sekunden,
mit gelegentlichen längeren Pausen. Pflichtziehen und Nachwerfen haben eigene
kurze Bereiche. Mehrere CPUs erhalten unabhängige Fristen; die kürzeste handelt
zuerst. Eine fremde Auffüllung startet eine bereits laufende Denkzeit nicht neu.
Nach der Pause wird die Entscheidung unter der Spielsperre anhand des aktuellen
Zustands neu berechnet. Kein Nachwurf wird künstlich garantiert oder blockiert.

Variable normal timing is 12.5% slower. First actions mix fast responses around
0.18–0.42 seconds, ordinary pauses of 0.51–1.35 seconds and occasional thinking
pauses up to 2.7 seconds. Follow-up actions after a clearance usually take
0.135–0.731 seconds, with occasional longer pauses.
Refills and additional cards have their own short ranges. Multiple CPUs receive
independent deadlines; the earliest acts first. Another player's refill does not
restart an existing wait. After waiting, the decision is recalculated under the
game lock from the current state. No additional-card opportunity is artificially
guaranteed or blocked.

`ROLLTHEDICE_HAUSDEPP_CPU_DELAY_SECONDS` bleibt eine ausdrückliche feste
Test-/Betriebsüberschreibung von 0 bis 5 Sekunden; ohne sie variiert das Tempo.
Ungültige Werte fallen auf das normale variable Verhalten zurück. /
`ROLLTHEDICE_HAUSDEPP_CPU_DELAY_SECONDS` remains an explicit deterministic
test/operations override bounded to 0–5 seconds. Without it, timing varies;
invalid values fall back to normal variable timing.

## Reproduzierbare Prüfung / Reproducible checks

```sh
python -m pytest -q -n 0 tests/test_hausdepp_cpu_strategy.py tests/test_hausdepp_cpu_runner.py
python -m pytest -q -n 0 -s tests/test_hausdepp_cpu_strategy.py -k 800_paired
python -m pytest -q -n 0 -s tests/test_hausdepp_cpu_strategy.py -k production_settings
```

**Vergleich mit 3.8.2 bei Produktionsparametern / Against 3.8.2 at production
settings:** `tests/hausdepp_cpu_policy_382.py` ist eine unveränderte Kopie der
3.8.2-Policy. `paired_production_benchmark` lässt auf denselben Austeilungen
(Seeds `900000 + Spielerzahl * 10000 + [0..Deals−1]`, Geber am letzten Sitz)
jeden Sitz einmal den aktuellen Computer spielen, alle anderen die 3.8.2-Policy,
alle mit derselben Stärke und denselben pro Entscheidung gesetzten
Zufallsaussetzern wie im Live-Runner. Ein 3.8.2-Sitz verlöre dabei genau einmal
pro Austeilung; „relativ“ = Niederlagen / Austeilungen. Der Test prüft den
Zweikampf auf 300 Austeilungen (< 0,95); die volle Reproduktion dauert einige
Minuten. /
`tests/hausdepp_cpu_policy_382.py` is an unchanged copy of the 3.8.2 policy.
`paired_production_benchmark` plays the current computer once on every seat of
the same deals (seeds `900000 + players * 10000 + [0..deals−1]`, dealer on the
last seat) against the 3.8.2 policy on all other seats, all at the same skill
with the live runner's per-decision seeded misjudgements. A 3.8.2 seat would lose
exactly once per deal; "relative" = losses / deals. The test checks heads-up on
300 deals (< 0.95); the full reproduction takes a few minutes.

```sh
python -c 'from tests.test_hausdepp_cpu_strategy import paired_production_benchmark as b; print(b()); print(b(sizes=(2, 4), deals=(1500, 600), skill=0.55))'
```

| Spieler / Players | Stärke / Skill | Austeilungen / Deals | Niederlagen / Losses | Relativ / Relative |
| --- | ---: | ---: | ---: | ---: |
| 2 | 1.0 | 3000 | 2527 | 0.842 |
| 3 | 1.0 | 700 | 593 | 0.847 |
| 4 | 1.0 | 700 | 603 | 0.861 |
| 5 | 1.0 | 700 | 589 | 0.841 |
| 6 | 1.0 | 700 | 587 | 0.839 |
| 2 | 0.55 | 1500 | 1428 | 0.952 |
| 4 | 0.55 | 600 | 597 | 0.995 |

**Vergleich mit der alten Referenz / Against the old reference:**

Der gepaarte Vergleich verwendet je Tischgrösse 2–6 die 40 Seeds
`26000 + Spielerzahl * 100 + [0..39]`, Geber am letzten Sitz und jeden möglichen
Sitz einmal mit der neuen Strategie gegen die eingefrorene alte Referenzpolicy,
ohne Stärkestufen und Zufallsaussetzer. Er sichert nur die Richtung gegenüber
dieser alten, vortaktischen Referenz ab und belegt keine Aussage gegenüber 3.8.2.
Nachziehen hat in der Simulation Vorrang, dann ein möglicher Nachwurf, dann der
aktuelle Spieler; beide Seiten erhalten dieselbe Reihenfolge. Zeitliche Rennen
werden separat im Runner getestet. Ergebnis bei diesem Stand:

The paired comparison uses 40 seeds per table size, `26000 + players * 100 +
[0..39]`, the last seat as dealer, and every possible seat once using the new
policy against the frozen old reference, without skill levels or misjudgements.
It only guards the direction against this old, pre-tactical reference and does not
support any claim relative to 3.8.2. Simulations prioritise refills, then
available additional cards, then the current turn, equally for both policies.
Timing races are tested separately. Results at this revision:

| Spieler / Players | Gepaarte Sitz-Deals / Paired seat-deals | Alte Niederlagen / Old losses | Neue Niederlagen / New losses |
| --- | ---: | ---: | ---: |
| 2 | 80 | 40 | 28 |
| 3 | 120 | 40 | 27 |
| 4 | 160 | 40 | 18 |
| 5 | 200 | 40 | 30 |
| 6 | 240 | 40 | 37 |
| Gesamt / Total | 800 | 200 | 140 |

Eine zusätzliche, zuvor nicht zur Auswahl der Varianten verwendete Stichprobe
mit 50 Seeds je Grösse (`910000 + Spielerzahl * 100 + [0..49]`) und denselben
Sitzwechseln ergab 170 statt 250 Niederlagen in 1’000 Sitz-Deals (vor 3.10.0: 233). Reproduzierbar:

A further holdout sample, not used to select the policy variants, used 50 seeds
per size (`910000 + players * 100 + [0..49]`) and the same seat rotations: 170
instead of 250 losses in 1,000 seat-deals (before 3.10.0: 233). Reproduce with:

```sh
python -c 'from tests.test_hausdepp_cpu_strategy import paired_policy_benchmark; print(paired_policy_benchmark(seeds=50, seed_base=910000))'
```

Diese Stichproben belegen eine Verbesserung gegen die bisherige Referenz in
diesen Setups, keine allgemeine Spielstärkegarantie gegen Menschen. Alle
36 Karten, legale Übergänge und Rundenende werden in den Simulationen geprüft.
100 tatsächliche Erstspiele bleiben bei 1–4 Erfolgen; ein separater Strom aus
240 Runden prüft die weiteren Freischaltungen. Die ursprüngliche
Achievement-Kalibrierung behält bewusst ihre eingefrorene Referenzpolicy;
Erfolgsziele und Belohnungen wurden nicht geändert. Die zunächst versuchte
allgemeine Bewertungsheuristik war im Vergleich schwächer und wurde verworfen.

These samples demonstrate improvement against the old reference in these
setups, not a general strength guarantee against humans. Simulations verify
all 36 cards, legal transitions and round completion. One hundred real first
games remain at 1–4 achievements, and a separate 240-round stream checks later
unlocks. The original achievement calibration deliberately retains its frozen
reference policy; goals and rewards were not changed. An initially attempted
general scoring heuristic performed worse and was discarded.
