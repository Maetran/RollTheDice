# Hausdepp-Computer / Hausdepp computers

Die Computer verwenden dieselben Befehle und denselben Regelprüfer wie Menschen.
Es gibt keine eigene CPU-Hausregel und keine zusätzliche Nachwurfsperre.
Sie erhalten ausschliesslich ihre persönliche `project_state`-Ansicht: eigene
Hand, offenes Paket, öffentliche Handgrössen und Anzahl der Nachziehkarten.
Gegnerische Hände, Nachziehreihenfolge und interne Erfolgsnachweise beeinflussen
keine Entscheidung. Auch erlaubte private Abhebeinformationen werden von dieser
Strategie nicht zur Vorhersage des verdeckten Stapels verwendet.

Computers use the same commands and authoritative validator as humans, without
special rules or additional-card locks. They receive only their personal
`project_state` view: their own hand, the open pile, public hand sizes and stock
count. Opposing hands, draw order and internal achievement evidence never
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
- Pro Sitz bleiben höchstens 48 eigene, bereits angenommene Entscheidungen im
  Arbeitsspeicher. Kehrt dieselbe beobachtbare Lage wieder, versucht der Computer
  einen anderen legalen Plan. Die Erinnerung bleibt über menschliche Züge erhalten
  und endet bei Trennung, neuer Runde oder Neustart. Maximal 128 aktive Tische
  besitzen diese zusätzliche Erinnerung; sie wird weder gespeichert noch ausgesendet. /
  Each seat remembers at most 48 accepted decisions using its own observable
  position. A repeated position prompts another legal plan. Memory survives human
  turns and resets on disconnect, a new round or restart. At most 128 tables retain
  this extra memory; it is neither persisted nor transmitted.

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
python -m pytest -q -n 0 -s tests/test_hausdepp_cpu_strategy.py -k 400_paired
```

Der gepaarte Vergleich verwendet je Tischgrösse 2–6 die 20 Seeds
`26000 + Spielerzahl * 100 + [0..19]`, Geber am letzten Sitz und jeden möglichen
Sitz einmal mit der neuen Strategie gegen die eingefrorene alte Referenzpolicy.
Nachziehen hat in der Simulation Vorrang, dann ein möglicher Nachwurf, dann der
aktuelle Spieler; beide Seiten erhalten dieselbe Reihenfolge. Zeitliche Rennen
werden separat im Runner getestet. Ergebnis bei diesem Stand:

The paired comparison uses 20 seeds per table size, `26000 + players * 100 +
[0..19]`, the last seat as dealer, and every possible seat once using the new
policy against the frozen old reference. Simulations prioritise refills, then
available additional cards, then the current turn, equally for both policies.
Timing races are tested separately. Results at this revision:

| Spieler / Players | Gepaarte Sitz-Deals / Paired seat-deals | Alte Niederlagen / Old losses | Neue Niederlagen / New losses |
| --- | ---: | ---: | ---: |
| 2 | 40 | 20 | 13 |
| 3 | 60 | 20 | 18 |
| 4 | 80 | 20 | 16 |
| 5 | 100 | 20 | 20 |
| 6 | 120 | 20 | 17 |
| Gesamt / Total | 400 | 100 | 84 |

Eine zusätzliche, zuvor nicht zur Auswahl der Varianten verwendete Stichprobe
mit 50 Seeds je Grösse (`910000 + Spielerzahl * 100 + [0..49]`) und denselben
Sitzwechseln ergab 233 statt 250 Niederlagen in 1’000 Sitz-Deals. Reproduzierbar:

A further holdout sample, not used to select the policy variants, used 50 seeds
per size (`910000 + players * 100 + [0..49]`) and the same seat rotations: 233
instead of 250 losses in 1,000 seat-deals. Reproduce with:

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
