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

Während der gesamten Runde kann jeder CPU-Sitz ausserdem öffentlich abgeräumte
Karten mitzählen. Nur wenn dieses Wissen vollständig ist, der Nachziehstapel
leer ist und genau zwei aktive Spieler ohne Rückzüge übrig sind, lässt sich die
gegnerische Hand aus den übrigen Karten ableiten. Eine lückenhafte Beobachtung
oder unbekannte abgeräumte Karten lassen keine vollständige Hand entstehen.
Die CPU sucht dann begrenzt nach einem gegen alle legalen Antworten sicheren
Gewinnzug; Aufnehmen, Nachwerfen, Abräumen und die optionale Viererregel werden
berücksichtigt. Die Suche verwendet höchstens 8’000 Knoten und fällt bei Abbruch
auf die bisherigen Regeln zurück. Ihre synchrone Laufzeit hängt von Rechner und
Last ab. Direkte sichere Schlusszüge haben Vorrang. Bei einer individuellen
CPU-Stärke von höchstens 0,55 wird die zusätzliche Suche nicht verwendet; diese
Stärke enthält die oben beschriebene CPU-Eigenheit. Darüber nimmt ihre Nutzung
mit der Stärke zu und kann sie wie andere Einschätzungen übersehen werden. Die
beiden eng bewiesenen Blockmuster bleiben separat verfügbar.

Bei zwei bis sechs aktiven Spielern kann die CPU eine tatsächlich beobachtete
öffentliche Paketaufnahme auch als unsicheres Signal verwenden: Eine höhere
Karte kann auf Verdacht eine weitere Aufnahme auslösen und eine eigene
Schlusskette vorbereiten. Die Aufnahme kann freiwillig gewesen sein; bekannte
Gegenkarten, Tischregel und Gefahr durch weitere aktive Sitze werden
berücksichtigt. Nach einer weiteren Handaktion desselben Gegners, bei
Beobachtungslücken oder Kontextwechsel verfällt der Hinweis. An grösseren Tischen kann sie auch ohne Aufnahmehinweis hoch anspielen, um bis zu vier tiefere oder mittlere Karten für spätere Züge vorzubereiten. Ob sie nochmals dran kommt und was dann auf dem Stapel liegt, bleibt ungewiss. Gelegentliche
Fehleinschätzungen bleiben möglich. Vollständig bekannte Hände und sichere
Schlusszüge haben Vorrang.

Die bisherige Paarblock-Taktik gilt nur mit zwei aktiven Spielern, bei leerem Tisch und
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
Zusätzlich erkennt die CPU ein weiteres sicheres Muster: Hat sie selbst nur
noch zwei verschiedene gewöhnliche Ränge und kann mit einem davon die bekannte
gegnerische Hand zum Aufnehmen zwingen, legt sie diese Gruppe und beendet danach
die Runde mit dem verbliebenen Rang. Eine gegnerische 10 oder ein nach Tischregel
als 10 gültiger Vierer verhindert diese Annahme; ebenso darf der eigene Zug den
Stapel nicht selbst abräumen. Auch diese Gelegenheit kann übersehen werden.

With the stock empty, each CPU seat additionally remembers cards from public
packet pickups it actually observed. Plays and follow-up throws remove exactly
the played cards from that knowledge. An opposing hand is complete only when
all its cards are evidenced by those observations; unobserved cards stay unknown.
Every accepted card command is observed, including between CPU turns. The observer
does not read private peeks, opposing hands or internal achievement evidence.
Version gaps, withdrawals, seat/account changes, new rounds and restarts discard
knowledge. An observation failure discards this table's memory and is logged;
the accepted move remains valid.

Each CPU seat can also count publicly cleared cards throughout the round. Only
when that record is complete, the stock is empty and exactly two active players
remain without withdrawals can the other hand be deduced from the remaining
cards. Gaps or unobserved cleared cards cannot produce a complete hand. The CPU
then searches within a fixed budget for a win against all legal replies,
including pickups, follow-up throws, clearances and the optional quartet rule.
The search uses at most 8,000 nodes and falls back to the existing policy if
interrupted. Its synchronous execution time depends on hardware and load. Direct
guaranteed finishes retain priority. CPUs with individual skill at or below
0.55 do not use the additional search; that skill includes the personality
offset described above. Its use increases with skill and can be missed like
other judgements. The two narrowly proven blocking patterns remain available
separately.

With two to six active players the CPU can also treat an actually observed
public pickup as an uncertain signal. A higher card may prompt another pickup
and prepare a finishing sequence. Pickups can be voluntary; known opposing
cards, the table rule and risks from other active seats remain relevant. At larger tables the CPU may lead high even without a pickup clue to prepare up to four lower or middle cards for later turns; reaching another turn and the pile then remain uncertain. The
hint expires after that opponent next changes their hand, an observation gap or
a context change. Misjudgements remain possible. Fully known hands and safe
finishes take priority.

The earlier pair-block tactic applies only to two active players, with an empty table and stock,
exactly three distinct ordinary own cards and a completely known opposing pair.
Any other seats must have finished with empty hands; withdrawals and an open
follow-up window are excluded.
Their order must be low < pair < blocker < reserve. For example, with 6/K/ace
against known 7/7, the CPU plays K instead of 6, forces a pickup and retains the
ace for every legal reply. All 70 rank patterns of this narrow case are proved
against the engine, including follow-up throws and final duels at tables with
three, four and six seats. Earlier finishers retain their ranks. Existing
difficulty can make the CPU miss this tactic like other judgements. Guaranteed own finishes retain
priority. The CPU also recognises another guaranteed pattern: if its own hand
contains just two ordinary ranks, it can play one whole group to force the
completely known opponent to pick up, then finish with the remaining rank. An
opposing ten or a quartet acting as a ten under the table rule invalidates the
assumption, as does a move that would itself clear the pile. The CPU can miss
this opportunity too.

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

**Gezielter Vergleich der endgültigen Gewichtung / Targeted final-weight comparison (4 November 2026):**

Bei gemischter Resthand ohne Aufnahmehinweis wurde der Gewichtungsfaktor von
0,8 auf 0,5 gesenkt; die Taktik bleibt möglich. Beobachtete Hinweise und
Resthände, die sich auf leerem Stapel direkt ausspielen lassen, behalten ihre
bisherige Gewichtung. Ein gepaarter A/B-Vergleich von 3’600 konstruierten
Sechs-Personen-Stellungen verwendete je 100 Seeds, die Hände 6/8/Ass,
6/Ober/Ass und 6/10/Ass, drei verdeckte Welten, zwei Stärken und jeweils mit
und ohne Aufnahmehinweis. Beide Fassungen erhalten dieselbe Sicht und dieselben
Zufallswerte; bei unterschiedlichen Zügen spielen beide Fortsetzungen mit der
eingefrorenen Strategie. Kein Lauf blieb hängen. / For mixed remaining hands
without a pickup clue, the selection weight was reduced from 0.8 to 0.5; the
risky play remains possible. Observed hints and remaining hands that finish on
an empty pile keep their previous weights. A paired A/B comparison of 3,600
constructed six-player positions used 100 seeds each, 6/8/Ace, 6/Ober/Ace and
6/10/Ace, three hidden worlds, two skills, with and without a hint. Both
policies receive the same view and randomness; differing moves continue under
the frozen policy in both legs. No run stalled.

Bei Stärke 1 und ohne Hinweis sank die Zahl der Ass-Anspiele bei 6/8/Ass und
6/Ober/Ass jeweils von 8 auf 6 pro 100 Seeds; mit Hinweis blieb sie bei 15.
Die zwölf abweichenden Hand-/Welt-Fälle ergaben sechs bessere und keine
schlechteren Endplätze nach der Reduktion. Es waren aber nur zwei verschiedene
Seeds, die auf mehrere Hände und Welten wiederholt wurden. Bei Stärke 0,55 gab
es in dieser Stichprobe keine geänderte Wahl; die Ass-Zahl bei den beiden
gemischten Händen blieb 20 pro 100. Bei 6/10/Ass spielten beide Fassungen
unabhängig vom Hinweis 100-mal das Ass; auch andere bestehende Regeln können
diese Wahl auslösen. Diese begrenzten, konstruierten Fälle und eingefrorenen
Folgezüge belegen keine allgemeine Stärke- oder Gewinnratenverbesserung. /
At skill 1 without a hint, ace leads fell from 8 to 6 per 100 seeds for both
6/8/Ace and 6/Ober/Ace; with a hint they stayed at 15. The twelve changed
hand/world cases produced six better and no worse final ranks after reduction,
but repeat only two distinct seeds across several hands and worlds. At skill
0.55 no choice changed in this sample; ace leads for the mixed hands stayed at
20 per 100. With 6/10/Ace both policies led the ace 100 times with and without
a hint; existing rules can also cause that choice. These limited constructed
cases and frozen continuations do not establish a general improvement in skill
or win rate.

Finaler Strategie-SHA-256 / Final policy SHA-256:
`147b5dd0cc804f3f3f92d733af87e745000b772fdfb6e225af6c859d079e4adf`;
A/B-Runner: `e248ed699692f0a5e2d2a75338d57ab25f4872011b4c6b1536363941d438e425`.
Die Gegenfassung wird im Speicher ausschliesslich durch Rücksetzen des Faktors
erzeugt; ihre SHA-256 ist `a779ac80ea2357534d9ca27d1a9f4ca72332a1433fbbb1f262fc215e8bc496c4`.
Seeds: `3400000 + [0..99]`. / The comparison policy is created in memory by
restoring only the factor; its SHA-256 is listed above.

```sh
python -m scripts.benchmark_hausdepp_weight_ablation --skill 1 --seeds 100
python -m scripts.benchmark_hausdepp_weight_ablation --skill 0.55 --seeds 100
```

**Vorversion vor der reduzierten Gewichtung / Previous version before the reduced weight (4 November 2026):**

Die folgenden 9’000 gepaarten Sitzpartien und 1’440 gezielten Szenariopaare
wurden vor der späteren Reduktion des Faktors für gemischte Resthände ohne
Aufnahmehinweis von 0,8 auf 0,5 gemessen. Sie beschreiben nicht den endgültigen
Strategiestand. Die Kommandos unten reproduzieren die Einstellungen; mit der
aktuellen Strategie entstehen nicht zwingend dieselben Ergebnisse. /
The following 9,000 paired seat games and 1,440 targeted scenario pairs
preceded the later reduction from 0.8 to 0.5 for mixed remaining hands without
an observed pickup. They do not describe the final policy. The commands below
reproduce the settings; the current policy need not reproduce those outcomes.

Der Vergleich umfasst 9’000 gepaarte Sitzpartien: 150 Austeilungen pro
Tischgrösse, Stärke und Gegnerprofil, jeweils für jeden Startplatz. `frozen` ist
die unveränderte Referenz; `voluntary40` nimmt bei leerem Nachziehstapel mit
40 % Wahrscheinlichkeit freiwillig auf, obwohl ein legaler Zug möglich ist.
Die Stressregel ist keine Schätzung menschlichen Verhaltens. Alle Sitze erhalten
laufend nur ihre eigene Sicht; es gab keinen Gedächtnisreset. Beide Beine nutzen
dieselben Seeds, können aber durch abweichende Entscheidungen auseinanderlaufen.
Die Startplatzanzahl unterscheidet sich von der Zahl zu einem Entscheidungszeitpunkt
noch aktiver Personen. Kein Lauf blieb hängen. / This comparison covers 9,000
paired seat games: 150 deals for each table size, skill and opponent profile,
rotating every starting seat. `frozen` is the unchanged reference; `voluntary40`
voluntarily picks up with 40% probability when the stock is empty and a legal
play exists. This stress rule is not an estimate of human behaviour. Each seat
continuously receives only its own view, without a memory reset. Both legs use
the same seeds but can diverge through their decisions. Starting seats differ from
the number of players still active at a decision. No run stalled.

| Startplätze / Starting seats | Stärke / Skill | Gegner / Opponent | Paare / Pairs | Niederlagen alt → neu / Losses old → new | Nur alt / nur neu / Only old / only new | Platzsumme alt → neu / Rank sum old → new |
| ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 4 | 0.55 | frozen | 600 | 150 → 148 | 3 / 1 | 1500 → 1497 |
| 4 | 0.55 | voluntary40 | 600 | 36 → 34 | 3 / 1 | 1155 → 1148 |
| 4 | 1 | frozen | 600 | 150 → 154 | 0 / 4 | 1500 → 1509 |
| 4 | 1 | voluntary40 | 600 | 28 → 27 | 1 / 0 | 1138 → 1134 |
| 5 | 0.55 | frozen | 750 | 150 → 151 | 4 / 5 | 2250 → 2254 |
| 5 | 0.55 | voluntary40 | 750 | 16 → 19 | 0 / 3 | 1686 → 1694 |
| 5 | 1 | frozen | 750 | 150 → 152 | 0 / 2 | 2250 → 2255 |
| 5 | 1 | voluntary40 | 750 | 17 → 19 | 0 / 2 | 1663 → 1669 |
| 6 | 0.55 | frozen | 900 | 150 → 150 | 6 / 6 | 3150 → 3154 |
| 6 | 0.55 | voluntary40 | 900 | 21 → 24 | 0 / 3 | 2322 → 2329 |
| 6 | 1 | frozen | 900 | 150 → 153 | 1 / 4 | 3150 → 3159 |
| 6 | 1 | voluntary40 | 900 | 13 → 13 | 0 / 0 | 2272 → 2279 |

Niedrigere Platzsummen sind besser. Aggregiert nach Stärke und Gegner, jeweils
2’250 Sitzpaare, lauten Niederlagen alt → neu (nur alt / nur neu): 0,55 gegen
frozen **450 → 449 (13 / 12)**, gegen voluntary40 **73 → 77 (3 / 7)**; 1,0
gegen frozen **450 → 459 (1 / 10)**, gegen voluntary40 **58 → 59 (1 / 2)**.
Insgesamt sind es **1’031 → 1’044 (18 / 31)**. Bei frozen sind die 150
Referenzverluste je Tischgrösse durch die Sitzrotation vorgegeben. Daraus folgt
keine allgemeine Stärkeverbesserung: veränderte Spiele sind selten, die Sitzpaare
eines Deals abhängig und diese Stichprobe war kein zurückgehaltener Holdout.
Sie misst keine Gewinnrate gegen Menschen. / Lower rank sums are better. Across
2,250 pairs per skill/opponent group, losses old → new (only old / only new)
are: skill 0.55 against frozen **450 → 449 (13 / 12)** and voluntary40
**73 → 77 (3 / 7)**; skill 1 against frozen **450 → 459 (1 / 10)** and
voluntary40 **58 → 59 (1 / 2)**. Overall: **1,031 → 1,044 (18 / 31)**.
The 150 frozen reference losses per table size follow from seat rotation. This
does not establish a general strength improvement: changed games are rare,
seat rotations share deals, and the sample was not held out. It does not measure
win rates against people.

Die folgende Tabelle zählt ausschliesslich Situationen mit so vielen **tatsächlich
aktiven** Personen wie der Starttisch. Hinweis und ohne Hinweis sind getrennt;
jeweils stehen geeignete Ansichten / ausgewählte passende Züge. Solche Treffer
sind keine kausalen Aktivierungen: eine andere Regel kann denselben Zug wählen.
Die Gegenprobe vergleicht je Partie höchstens den ersten passenden hohen Zug,
bei dem die Referenz im identischen Zustand anders spielte. Beide Fortsetzungen
verwenden danach die eingefrorene Strategie und identische Zustände, Sitzspeicher
und Zufallswerte. Sie zeigt Anzahl Fälle, Summe eigener Karten beim nächsten
regulären Zug und Anzahl besserer / schlechterer Endplätze. Sie ist bedingt auf
diese ausgewählten Fälle und kein Gesamtspiel-Effekt. / The table below counts
only decisions with as many **actually active** players as the starting table.
Hinted and unhinted eligible views / matching selected plays are separate. A
match is not a causal activation: another rule can choose the same play. For
at most the first matching high play per game where the reference chose
otherwise, a counterfactual compares the identical state, seat memories and
randomness, using the frozen policy for both continuations. It shows cases,
total own cards at the next regular turn, and better / worse final placements.
This is conditional on the selected cases, not a full-game treatment effect.

| Aktiv / Active | Stärke / Skill | Gegner / Opponent | Hinweis: Ansichten / Treffer / Hinted views / matches | Ohne Hinweis / Unhinted views / matches | Gegenproben / Counterfactuals | Karten alt → neu / Cards old → new | Besser / schlechter / Better / worse |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 4 | 0.55 | frozen | 8 / 3 | 155 / 64 | 8 | 17 → 17 | 0 / 2 |
| 4 | 0.55 | voluntary40 | 78 / 14 | 175 / 59 | 16 | 29 → 32 | 1 / 1 |
| 4 | 1 | frozen | 5 / 1 | 172 / 87 | 9 | 13 → 13 | 0 / 4 |
| 4 | 1 | voluntary40 | 71 / 14 | 192 / 70 | 20 | 43 → 43 | 4 / 1 |
| 5 | 0.55 | frozen | 5 / 0 | 198 / 95 | 12 | 20 → 22 | 0 / 1 |
| 5 | 0.55 | voluntary40 | 67 / 11 | 235 / 91 | 19 | 32 → 34 | 1 / 1 |
| 5 | 1 | frozen | 5 / 0 | 210 / 94 | 7 | 14 → 14 | 0 / 1 |
| 5 | 1 | voluntary40 | 73 / 15 | 237 / 82 | 19 | 36 → 40 | 2 / 2 |
| 6 | 0.55 | frozen | 4 / 1 | 211 / 84 | 10 | 17 → 17 | 3 / 2 |
| 6 | 0.55 | voluntary40 | 62 / 17 | 245 / 70 | 22 | 32 → 35 | 2 / 5 |
| 6 | 1 | frozen | 4 / 2 | 237 / 89 | 12 | 22 → 22 | 0 / 4 |
| 6 | 1 | voluntary40 | 78 / 13 | 277 / 82 | 18 | 34 → 34 | 1 / 5 |

Zusätzlich wurden 1’440 gezielte gepaarte Sechs-Personen-Endspielzustände
untersucht: `6/8/Ass` und `6/Ober/Ass`, je 60 Seeds, zwei Stärken, mit und
ohne beobachteten Aufnahmehinweis sowie drei verdeckte Gegnerhände (`weak`,
`hidden_ace`, `hidden_ten`). Diese Welten sind für die CPU gleich sichtbar;
die verborgenen Karten werden nur zur Konstruktion und Auswertung verwendet.
Nach dem ersten Zug spielen beide Fortsetzungen die eingefrorene Policy. Die
Tabelle zeigt ausgespielte Asse, Summe eigener Karten beim nächsten Zug,
Aufnahmen anderer vor diesem Zug sowie bessere / schlechtere Endplätze. Alle
60 Partien jeder Zeile erreichten den nächsten Zug; keine blieb hängen. /
Another 1,440 paired synthetic six-player endgames used `6/8/Ace` and
`6/Ober/Ace`, 60 seeds each, two skills, with and without an observed pickup,
and three hidden opponent hands (`weak`, `hidden_ace`, `hidden_ten`). The
worlds present identical visible information to the CPU; hidden cards are used
only to construct and score them. Both continuations use the frozen policy after
the first move. The table shows ace leads, total own cards at the next turn,
other players’ pickups before that turn, and better / worse final ranks. All 60
cases in each row reached the next turn; none stalled.

| Stärke / Skill | Hand | Welt / World | Hinweis / Hint | Asse alt → neu / Ace leads | Karten alt → neu / Cards old → new | Aufnahmen alt → neu / Pickups old → new | Besser / schlechter / Better / worse |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: |
| 0.55 | 6/8/A | weak | ja / yes | 7 → 20 | 120 → 120 | 24 → 38 | 4 / 4 |
| 0.55 | 6/8/A | weak | nein / no | 7 → 19 | 120 → 120 | 24 → 37 | 5 / 4 |
| 0.55 | 6/8/A | hidden_ace | ja / yes | 7 → 20 | 120 → 120 | 18 → 30 | 6 / 3 |
| 0.55 | 6/8/A | hidden_ace | nein / no | 7 → 19 | 120 → 120 | 18 → 30 | 7 / 3 |
| 0.55 | 6/8/A | hidden_ten | ja / yes | 7 → 20 | 120 → 120 | 18 → 18 | 4 / 6 |
| 0.55 | 6/8/A | hidden_ten | nein / no | 7 → 19 | 120 → 120 | 18 → 18 | 5 / 6 |
| 0.55 | 6/O/A | weak | ja / yes | 7 → 20 | 120 → 120 | 76 → 76 | 8 / 3 |
| 0.55 | 6/O/A | weak | nein / no | 7 → 19 | 120 → 120 | 76 → 76 | 8 / 3 |
| 0.55 | 6/O/A | hidden_ace | ja / yes | 7 → 20 | 120 → 120 | 55 → 54 | 6 / 2 |
| 0.55 | 6/O/A | hidden_ace | nein / no | 7 → 19 | 120 → 120 | 55 → 54 | 6 / 2 |
| 0.55 | 6/O/A | hidden_ten | ja / yes | 7 → 20 | 120 → 120 | 18 → 18 | 2 / 7 |
| 0.55 | 6/O/A | hidden_ten | nein / no | 7 → 19 | 120 → 120 | 18 → 18 | 2 / 7 |
| 1 | 6/8/A | weak | ja / yes | 3 → 13 | 120 → 120 | 20 → 29 | 1 / 4 |
| 1 | 6/8/A | weak | nein / no | 3 → 10 | 120 → 120 | 20 → 27 | 1 / 3 |
| 1 | 6/8/A | hidden_ace | ja / yes | 3 → 13 | 120 → 120 | 17 → 22 | 1 / 2 |
| 1 | 6/8/A | hidden_ace | nein / no | 3 → 10 | 120 → 120 | 17 → 22 | 1 / 1 |
| 1 | 6/8/A | hidden_ten | ja / yes | 3 → 13 | 120 → 120 | 17 → 16 | 1 / 1 |
| 1 | 6/8/A | hidden_ten | nein / no | 3 → 10 | 120 → 120 | 17 → 17 | 1 / 1 |
| 1 | 6/O/A | weak | ja / yes | 3 → 13 | 120 → 120 | 73 → 73 | 2 / 3 |
| 1 | 6/O/A | weak | nein / no | 3 → 10 | 120 → 120 | 73 → 73 | 2 / 2 |
| 1 | 6/O/A | hidden_ace | ja / yes | 3 → 13 | 120 → 120 | 53 → 52 | 3 / 1 |
| 1 | 6/O/A | hidden_ace | nein / no | 3 → 10 | 120 → 120 | 53 → 52 | 3 / 0 |
| 1 | 6/O/A | hidden_ten | ja / yes | 3 → 13 | 120 → 120 | 11 → 11 | 2 / 2 |
| 1 | 6/O/A | hidden_ten | nein / no | 3 → 10 | 120 → 120 | 11 → 11 | 2 / 1 |

Auch diese konstruierten Fälle beweisen keinen Vorteil; insbesondere führt ein
häufigeres Aufnehmen nicht automatisch zu besserem Endplatz. Das Modell bearbeitet
Nachwürfe vor dem nächsten regulären Zug, nicht als zeitliches Live-Wettrennen. /
These constructed cases also do not prove an advantage; more pickups do not
necessarily improve final rank. The model processes follow-up throws before the
next regular move, not as a live timing race.

Referenz / Reference: `f89354f74397b7c4e2c042d428b6484bb40b99de`;
SHA-256 Strategie / strategy
`80654a4840a96bec49b1b62ad3f6d503e4c9663e720fbb2b7fe3ec4b7f2cee7a`,
Gedächtnis / memory `e7b4a49418315149f6f70e2dc665a5dea939daee9ef04235afebc974e1807cbb`,
Gesamtspiel-Runner / full-game runner `f17df43c86a5668ef7c995ec438db3878f305c2537bdc847fc2de671db8f63fb`,
Szenario-Runner / scenario runner `febb1f736b3d851ab07b1112c7b7554083aeffab8a26ce6e1830f2d9cb9ec1d0`.
Alle erfassten Quellhashes wurden beim Laufbeginn und -ende geprüft. / All
recorded source hashes were checked before and after each run.

```sh
python -m scripts.benchmark_hausdepp_suspicions --players 6 --deals 150 --skill 1 --opponent voluntary40 --seed-base 2500000
python -m scripts.benchmark_hausdepp_multiseat_scenarios --players 6 --seeds 60 --skill 1 --world weak --middle 8 --seed-base 3100000
```

Für weitere Zeilen Tischgrösse 4/5/6, Stärke 0.55/1 und Gegner
`frozen`/`voluntary40` beziehungsweise im Szenario Stärke 0.55/1, Mitte
`8`/`O`, Welt `weak`/`hidden_ace`/`hidden_ten` sowie optional `--without-hint`
wählen. Gesamtspiel-Seeds: `2500000 + Spielerzahl * 10000 + [0..149]`;
Szenario-Seeds `3100000 + [0..59]`. / For other rows select table size 4/5/6,
skill 0.55/1 and opponent `frozen`/`voluntary40`, or for scenarios skill
0.55/1, middle `8`/`O`, world `weak`/`hidden_ace`/`hidden_ten`, and optionally
`--without-hint`. Full-game seeds are `2500000 + player count * 10000 + [0..149]`;
scenario seeds are `3100000 + [0..59]`.

**Historische Zweier-/Dreierfassung vor den späteren 4–6-Sitz-Erweiterungen und Schutzregeln / Historical two-/three-player version before the later 4–6-player extensions and guards (4 November 2026):**

Die damals untersuchte Strategie wurde gegen den vorher committeten Stand
`f89354f74397b7c4e2c042d428b6484bb40b99de` verglichen. Strategie, öffentliches
Gedächtnis und Endspiel-Solver der Referenz sind separat eingefroren. Jede
Austeilung wird für jeden Sitz mit beiden Strategien und identischen Seeds
wiederholt; Gegner sind die Referenz (`frozen`), die einfache Teststrategie
(`simple`) oder künstliche Stressgegner, die mit 15 % beziehungsweise 40 %
Wahrscheinlichkeit freiwillig aufnehmen, wenn sie bei leerem Nachziehstapel
auch legal legen könnten (`voluntary15`, `voluntary40`). Das ist keine Annahme
über die Häufigkeit menschlicher Bluffs. Alle Sitze verwenden die angegebene
Stärke ohne Eigenheiten. / The then-current policy was paired with the
preceding commit `f89354f74397b7c4e2c042d428b6484bb40b99de`. Its strategy,
public memory and solver are separately frozen. Every deal is replayed at every
seat with identical seeds. Opponents are the frozen policy, a simple test
policy, or artificial stress opponents that voluntarily pick up with a 15% or
40% chance when they can legally play with an empty stock. These are not claims
about human bluff rates. All seats use the stated skill without personality offsets.

`continuous` beobachtet alle akzeptierten Übergänge; `restart` erzeugt direkt
nach dem letzten Nachziehen für jeden Sitz einen neuen, getrennten Speicher.
Erst spätere Aufnahmen sind Hinweise. Die Schwelle gilt in beiden Vergleichsbeinen,
obwohl abweichende Züge deren späteren Verlauf verändern können. Die Tabelle nennt
**Ansichten / passende Züge**: Geeignete Ansichten sind keine tatsächlichen
Aktivierungen; ein passender Zug kann auch aus einer anderen Taktik stammen.
**Aufnehmen / Antwort** prüft rein nach der Auswahl am tatsächlichen nächsten
Sitz, ob sofort ein legaler Antwortzug möglich ist; diese verborgenen Karten
gehen nie an die CPU. Das misst keine spätere Annahme des Stapels, keinen ganzen
Spielverlauf und kein Live-Nachwurfrennen. / `continuous` observes every accepted
transition; `restart` creates fresh independent seat memories immediately after
the last stock draw. Only subsequent pickups can become hints. The reset is
applied at the same logical threshold in both legs, although their later play may
diverge. **Views / matching plays** counts eligible views, not actual tactic
activations: another tactic can select the same play. **Pickup / reply** checks
only after selection whether the actual next player can immediately play; hidden
cards never enter the CPU. It does not model later choices or the live follow-up
throw race.

| Speicher / Memory | Plätze / Seats | Stärke / Skill | Gegner / Opponent | Sitzpaare / Seat pairs | Niederlagen alt → neu / Losses old → new | Nur alt / nur neu / Only old / only new | Ansichten / passende Züge / Views / matching plays | Aufnehmen / Antwort / Pickup / reply |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| continuous | 2 | 0.55 | frozen | 800 | 400 → 400 | 0 / 0 | 0 / 0 | 0 / 0 |
| continuous | 2 | 0.55 | voluntary40 | 800 | 242 → 242 | 0 / 0 | 0 / 0 | 0 / 0 |
| continuous | 2 | 1.0 | frozen | 800 | 400 → 400 | 0 / 0 | 0 / 0 | 0 / 0 |
| continuous | 2 | 1.0 | simple | 600 | 155 → 155 | 0 / 0 | 0 / 0 | 0 / 0 |
| continuous | 2 | 1.0 | voluntary15 | 600 | 251 → 251 | 0 / 0 | 0 / 0 | 0 / 0 |
| continuous | 2 | 1.0 | voluntary40 | 800 | 229 → 229 | 0 / 0 | 0 / 0 | 0 / 0 |
| continuous | 3 | 0.55 | frozen | 900 | 300 → 300 | 0 / 0 | 3 / 1 | 1 / 0 |
| continuous | 3 | 0.55 | voluntary40 | 900 | 113 → 113 | 0 / 0 | 47 / 15 | 4 / 11 |
| continuous | 3 | 1.0 | frozen | 900 | 300 → 300 | 0 / 0 | 7 / 3 | 3 / 0 |
| continuous | 3 | 1.0 | voluntary40 | 900 | 106 → 106 | 0 / 0 | 64 / 15 | 4 / 11 |
| restart | 2 | 0.55 | frozen | 800 | 400 → 400 | 0 / 0 | 25 / 5 | 5 / 0 |
| restart | 2 | 0.55 | voluntary40 | 800 | 242 → 241 | 1 / 0 | 127 / 38 | 9 / 29 |
| restart | 2 | 1.0 | frozen | 800 | 400 → 400 | 0 / 0 | 9 / 4 | 4 / 0 |
| restart | 2 | 1.0 | simple | 600 | 185 → 185 | 0 / 0 | 22 / 7 | 7 / 0 |
| restart | 2 | 1.0 | voluntary15 | 600 | 242 → 243 | 0 / 1 | 29 / 5 | 3 / 2 |
| restart | 2 | 1.0 | voluntary40 | 800 | 221 → 222 | 0 / 1 | 109 / 33 | 10 / 23 |
| restart | 3 | 0.55 | frozen | 600 | 200 → 200 | 0 / 0 | 11 / 3 | 3 / 0 |
| restart | 3 | 0.55 | voluntary40 | 600 | 75 → 75 | 0 / 0 | 60 / 23 | 7 / 16 |
| restart | 3 | 1.0 | frozen | 600 | 200 → 200 | 0 / 0 | 14 / 7 | 7 / 0 |
| restart | 3 | 1.0 | voluntary40 | 600 | 68 → 67 | 1 / 0 | 90 / 29 | 7 / 22 |

Die 20 Läufe umfassen 14’800 gepaarte Sitzpartien; kein Lauf blieb hängen.
Die Ergebnisse zeigen vereinzelt veränderte Partien, belegen aber keine allgemeine
Stärkeänderung oder Gewinnrate gegen Menschen. Die Stressgegner können gezielt
mehr höhere Karten behalten; deshalb sind dort viele Verdachtszüge beantwortbar.
Sitzrotationen desselben Deals sind abhängig und bilden keine unabhängigen
Stichproben. Der Datensatz wurde nicht als unabhängiger Holdout zurückgehalten.
Die Modell-Simulation behandelt mögliche Nachwürfe vor dem nächsten regulären Zug,
nicht als zeitliches Wettrennen. / The 20 runs cover 14,800 paired seat games,
without stalls. There are isolated changed results but no demonstrated general
strength difference or human win rate. Stress opponents can retain higher cards,
so many speculative plays remain answerable. Rotated seats share the same deal
and are not independent; this was not a held-out sample. Follow-up throws are
processed before the next regular move, not as a live timing race.

Die grossen Messungen liefen vor der strukturellen Vereinheitlichung der beiden
Runner. SHA-256 der damals ausgeführten Runner: `d28f0826b5759c2ae359efbdeb18c8c308fb75d18d2af998d49b944bff451909`
(durchgehend) und `43bcb6edda6d0bac33413579cc176e9a5cd66a15ea958783ab37862decc538f8`
(Neustart). Dieselben Strategie- und Wissensquellen hatten die Hashes
`3a72217455cb93a2e42140d9801a7e5df7fe369ba97ec2905afec38956601194` und
`9b63f56d0d457862ed2f7db15081033c14b66f6bf08c961ac4ea9605e6628068`.
Nach Refaktor in einen Runner waren sämtliche Ergebnis- und Verhaltenszähler in
16 Vergleichsläufen mit je 12 identischen Deals gleich (2/3 Sitze × zwei Stärken ×
frozen/voluntary40 × zwei Speichermodi). / The large runs used separate runners
before consolidation; their exact SHA-256 hashes are listed above along with the
policy and memory hashes. After the structural refactor, all result and tactic
counters matched in 16 comparisons of 12 identical deals each (two/three seats,
two skills, frozen/voluntary40 and both memory modes).

```sh
python -m scripts.benchmark_hausdepp_suspicions --players 2 --deals 400 --skill 1 --opponent frozen --seed-base 2500000
python -m scripts.benchmark_hausdepp_suspicions --players 2 --deals 400 --skill 1 --opponent voluntary40 --seed-base 2500000 --restart-on-empty-stock
```

Für die weiteren Tabellenzeilen `--players`, `--deals`, `--skill`, `--opponent`
und gegebenenfalls den Neustartschalter entsprechend setzen. Die Seeds sind
`2500000 + Spielerzahl * 10000 + [0..Deals−1]`. / Set `--players`, `--deals`,
`--skill`, `--opponent`, and the optional restart flag to reproduce other rows.
Seeds are `2500000 + player count * 10000 + [0..deals−1]`.


**Historischer Vergleich vor der Verdachtstaktik / Historical comparison before the pickup-inference tactic:**
Der gepaarte Vergleich lässt auf denselben Austeilungen jeden Sitz einmal die
aktuelle Strategie gegen die eingefrorene 4.14.1-Policy spielen. In den
Vergleichspartien ohne Änderung verwenden alle Sitze diese Referenz. Jeder Sitz
beobachtet alle akzeptierten Übergänge aus seiner eigenen Sicht; die
Fehleinschätzungen sind je Deal, Sitz und Zustand fest gesetzt. Alle Sitze
verwenden dieselbe angegebene Stärke ohne zusätzliche CPU-Eigenheiten. Der Wert der
Referenz ist durch die Sitzrotation vorgegeben: In jedem Deal verliert genau ein
Sitz. Sitzpositionen desselben Deals sind nicht unabhängig; die Simulation misst
Modellstrategien und ist keine menschliche Gewinnrate. Diese Stichprobe ist kein
unabhängiger, vor der Entwicklung zurückgehaltener Testdatensatz. Die Simulation
bearbeitet Pflichtziehen und mögliche Nachwürfe vor dem nächsten regulären Zug;
sie bildet das zeitliche Rennen der Live-Oberfläche nicht nach. /
The paired comparison plays the current policy in each seat once on the same
deals against the frozen 4.14.1 policy. Every seat uses the reference in the
unchanged games. Each seat observes all accepted transitions from its own view;
misjudgements are seeded by deal, seat and state. All seats use the stated skill
without additional CPU personality offsets. The reference loss count follows
from seat rotation: exactly one seat loses per deal. Seats within a deal are not
independent; the simulation measures model policies, not human win rates. This
sample was not held out independently before development. The simulation handles
required refills and possible follow-up throws before the next regular turn; it
does not reproduce the timing race in live play.

```sh
python -m scripts.benchmark_hausdepp_policies --players 2 --deals 1000 --skill 1.0 --seed-base 1300000
python -m scripts.benchmark_hausdepp_policies --players 2 --deals 1000 --skill 0.55 --seed-base 1300000
```

Für andere Tischgrössen `--players 3` beziehungsweise `--players 4` setzen. /
Use `--players 3` or `--players 4` for the other table sizes.

Bei jeweils 1’000 Austeilungen wird jeder Sitz einmal durchgespielt. Die Seeds
sind `1300000 + Spielerzahl * 10000 + [0..999]`. Kein Lauf blieb hängen. /
Each row uses 1,000 deals with every seat rotated once. Seeds are
`1300000 + player count * 10000 + [0..999]`. No run stalled.

| Spieler / Players | Stärke / Skill | Sitzpartien / Seat games | Aktuelle Niederlagen / Current losses | Referenz / Reference | Nur Referenz verlor / Only reference lost | Nur aktuell verlor / Only current lost |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 0.55 | 2000 | 1000 | 1000 | 0 | 0 |
| 2 | 1.0 | 2000 | 934 | 1000 | 67 | 1 |
| 3 | 0.55 | 3000 | 1000 | 1000 | 0 | 0 |
| 3 | 1.0 | 3000 | 923 | 1000 | 78 | 1 |
| 4 | 0.55 | 4000 | 1000 | 1000 | 0 | 0 |
| 4 | 1.0 | 4000 | 907 | 1000 | 95 | 2 |

**Frühere isolierte Zweirang-Untersuchung / Earlier isolated two-rank study:**
Diese Messung wurde vor dem allgemeinen Solver erstellt; der zugehörige Runner
schaltet ihn ausdrücklich ab. Sie beschreibt nicht die gesamte aktuelle Policy. /
This measurement preceded the general solver, which its runner explicitly
disables. It does not describe the complete current policy.

Die folgende Simulation übergibt nach jedem akzeptierten Zug die persönlichen
öffentlichen Ansichten an die Erinnerungen. Im Vorher/Nachher-Vergleich spielt
jeweils ein Sitz mit beziehungsweise ohne das neue Zweirang-Muster; die übrigen
Strategien, Zufallsregeln und Anfangsausteilungen bleiben gleich. Zusätzlich
spielen sanfte und starke CPUs gegen eine einfache feste Referenz und gegen eine
starke CPU. Die Vergleiche sind Modelle, keine Messung menschlicher Spielstärke. /
The following simulation delivers each accepted transition to each seat's public
memory. In the paired comparison one seat plays with or without the new two-rank
pattern, with the same other policies and randomness rules and rotated seats. Gentle and
strong CPUs also play against a fixed simple reference and a strong CPU. These
comparisons are models, not measurements of human playing strength.

```sh
python -m scripts.benchmark_hausdepp_endgame
```

Gegen die einfache Referenz verlor die sanfte CPU (0,55) 471 von 1’000 Duellen,
die starke CPU (1,0) 315; gegen die starke CPU verlor die sanfte 623 von 1’000,
die starke 500. Jede Zeile umfasst 500 Austeilungen mit beiden Sitzpositionen;
keine Partie blieb hängen. / Against the simple reference, the gentle CPU (0.55)
lost 471 of 1,000 games and the strong CPU (1.0) 315; against the strong CPU,
the gentle one lost 623 of 1,000 and the strong one 500. Each row uses 500 deals
in both seat positions; no game stalled.

Bei Stärke 1,0 ergaben 1’500 Austeilungen mit beiden Sitzen je 1’500 Niederlagen
mit und ohne das neue Muster. Die 1’500 Niederlagen ohne das Muster folgen aus
der Sitzrotation: Ohne die Änderung spielen beide Sitze dieselbe Strategie, und
pro Austeilung verliert genau ein Sitz. Bei Stärke 0,55 waren es ebenfalls je
1’500 Niederlagen. Im Vergleich mit dem neuen Muster wurden bei Stärke 1,0 eine
und bei 0,55 drei geeignete Ansichten bei der Entscheidungsermittlung erkannt;
gezählt werden geeignete Ansichten, nicht die tatsächlich gespielten Blockaden. Die
Stichprobe zeigt keine messbare allgemeine Gewinnratenänderung. /
At skill 1.0, 1,500 deals in both seats produced 1,500 losses with and without
the new pattern. The 1,500 losses without it follow from rotating the seats:
without the change both seats use the same policy and exactly one loses per deal.
At skill 0.55 there were also 1,500 losses with and without the new pattern.
In the comparison with the new pattern, one suitable view at skill 1.0 and three
at 0.55 were recognised during decision evaluation; this counts suitable views,
not blocks actually played. The sample shows no measurable change in the overall
loss rate.

```sh
python -m pytest -q -n 0 tests/test_hausdepp_cpu_strategy.py tests/test_hausdepp_cpu_runner.py
python -m pytest -q -n 0 -s tests/test_hausdepp_cpu_strategy.py -k 800_paired
python -m pytest -q -n 0 -s tests/test_hausdepp_cpu_strategy.py -k production_settings
```

Die folgenden historischen Vergleiche entstanden vor dem gezählten Endspiel;
ihre damaligen Simulationen beobachteten die zusätzlichen öffentlichen
Übergänge nicht und messen daher nicht die neue Suche. /
The following historical comparisons predate the counted endgame; those
simulations did not observe the additional public transitions and therefore do
not measure the new search.

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
