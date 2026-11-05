# Watten CPU: experience and table tactics

The CPU uses the same personal card view and permitted observations as a human
in its seat. It evaluates newly sampled hypothetical deals. Actual opposing
hands, stock cards and denied announcements never enter its decision function.
Public cards, public trick winners, its own remembered inspection and permitted
partner feedback remain the sources of its card knowledge.

## Experience

Completed Watten games of the actual human participants determine the bounded
calculation budget. The runtime reads only aggregate counts from existing
`CompletedGame` and `GameParticipant` records after authorizing the current
table. Imported legacy games do not count. Each seated human account first maps
to its existing difficulty profile. The table uses the median profile; an even
number averages each parameter of the two middle profiles. Sample counts remain
bounded integers. CPUs, spectators and duplicate accounts do not add votes.
For example, zero and 1,000 completed matches yield 40 samples, confidence 0.84,
close-choice window 0.046, partnership 0.0265 and bid minimum 0.67, rather than
the highest tier. The runtime still reads current counts when authorizing a CPU
decision; this change adds no frozen per-deal level. Counts indicate experience,
not measured human ability.

| Completed Watten games | Hypothetical deals per decision | Confidence weight | Close-choice window | Misplay chance |
| --- | ---: | ---: | ---: | ---: |
| 0–9 | 16 | 0.72 | 0.080 | 6% |
| 10–29 | 24 | 0.82 | 0.045 | 2.5% |
| 30–74 | 40 | 0.90 | 0.025 | 1.5% |
| 75 or more | 64 | 0.96 | 0.012 | 1% |

These thresholds are implementation choices. Larger samples and narrower
close-choice windows make later decisions more precise; they do not guarantee
that every higher tier wins a particular deal. The misplay chance applies only
when another legal card has a worse sampled result; the actual frequency is
therefore lower. A misplay cannot violate trump duty or forced cards, and it
does not deliberately overtake an already safe partner as the last player.
There is no machine learning,
Elo model, external model, training history or client-selectable difficulty.
Progression survives restarts because it is derived from durable completed
games. Deleting retained games can lower the derived count; no second permanent
counter or personal behaviour profile is created.

## Subjective bidding

The CPU estimates its chance from its own hand, permitted knowledge and sampled
unknown cards. Small samples remain uncertain, including samples in which every
hypothetical deal wins. Each additional stake point requires a further 7.5
percentage points of confidence before initiating another raise or counterbid.
The existing match-equity calculation still weighs staying, leaving and
countering against both teams' current scores. A stake that already decides
both sides' match cannot be raised just for a fictitious fold advantage.

There is no scripted opening-round bidding ladder and no automatic bid merely
because the action is legal. Feedback is assessed only while receiving a bid;
an authorized partner may state good, bad or unsure once for that offer. In blind
four-player play only the blind teammate sends feedback to the informed
decision maker. Both informed and blind CPUs may open three or initiate later
raises only on their own card turn; an off-turn informed CPU never delays its
partner's bidding or card decision.
The informed player remains responsible for hold, fold and counterbid responses,
including outside their own card turn.

A CPU decision maker with a partner never answers an offer before that partner's
one signal for it, whether the partner is a person or a CPU, in open or blind
play. In open play the CPU still sends its own advice first. The signal shifts
its own subjective chance by ten percentage points for good or bad and leaves it
unchanged for unsure; near the hold/fold and counterbid thresholds this changes
the answer. The wait is derived from the CPU's own view only: the partner's
dialog stays available while a match is paused, the private signal survives a
restart, and a returning counteroffer clears it so that a fresh signal is
requested. Two-player seats and the three-player solo have no partner and never
wait. A partner who never answers holds the table like any other pending human
action until the existing inactivity limit ends the match.

Blödeln is a separate optional request between the two non-callers. Requesting
and answering use stable random 50% choices per deal and CPU seat, independent
of card strength. An unanswered request blocks card play and bidding, while
showing and inspection continue. No request means normal play. A CPU receives
only its own forced bottom card; another player's forced card is learned only
when it is actually played.

Retourschneider is owned by human consent. A CPU waits for its human teammate,
and the server applies that human's yes or no to the whole mixed team in one
transition. Two human teammates still decide separately. A team containing only
CPUs receives no offer and continues the ordinary deal flow. Older saved mixed
choices with an already-recorded human yes may finish one server-authorized
mirror-yes; the CPU can never veto that consent. Older saved all-CPU offers do
not block the next deal or create a policy job.

## Soft playing preferences

For blind Ladinisch, the second trick may be left to a partner who still acts
last. This is a small preference between close simulated choices, never a
compulsory play or a guarantee that the partner can take the trick. A clearly
stronger rollout overrides it. Other small preferences avoid duplicating an
already played rank when the CPU does not know the call and encourage spending
useful strength before the round ends. Legal-card and trump-duty checks always
take precedence.

For the first trick of a blind round, the owner's opening convention additionally
favours a card whose printed rank and suit have not appeared in that trick.
Each repeated attribute costs half the tier's partnership preference, at most
1.8–3.5 percentage points combined. This applies to informed announcers too,
so their partner can see more combinations. In any blind trick, an uninformed
partner additionally favours a different printed rank when the repeated rank
could still be strike under the permitted hypotheses. The additional preference
is 1.5 times the tier's partnership weight, and the close-choice window is at
least that wide for this comparison. In an otherwise hopeless trick the CPU
compares at most the cheapest repeated and cheapest different-rank alternative,
rather than considering every expensive card. Legal cards, including forced
cards, remain legal; a clearly stronger rollout can still repeat a rank and a
CPU can make a mistake. No actual call is assumed. This convention is an explicit
owner request, not an extra regional rule taken from the sources.

A second close-choice preference preserves strength when the partner is likely
already winning the current trick. It checks only the sampled hypothetical
worlds: safe partner winners favour a cheap card; a later opposing seat with a
sampled threat can favour a card that covers it. An uninformed CPU averages over
its permitted call hypotheses, while an informed CPU uses the call it actually
learned. This does not expose real opposing hands or turn the partner's card
into proof of a hidden call. A clearly better full-round rollout still wins.

When an informed player leads blind, sampled worlds also estimate whether a
trump lead may let an informed opponent take it with a compulsory response.
This is a soft cost, not a prohibition: drawing trump can still be the
strongest move, within the existing close-choice window.

As the last player, the CPU does not overtake its partner when that partner is
already winning under every call still consistent with its knowledge and a legal
card preserves the partner's win under all those calls. It may overtake when duty
leaves no such alternative, and it may cover earlier when an opponent still has a
turn. This stricter preference also gives up opportunities to take the lead in
the next trick; it never overrides card legality. Sampled hands are hypothetical,
except when the table explicitly enables an open partner hand. In each sampled
world the rollout players use that world's call and hands. This is a deliberately
optimistic approximation of simulated players, including blind ones; it does not
provide the policy with the real hidden call or other players' real hands. A
separate information-limited rollout was evaluated but is not used by the game.

## Shown cards after Ladinisch inspection

An inspecting CPU remembers its own shown original card (the strike card for the
strike announcer, the colour card for the suit announcer) only from its own
inspection window. The other inspector is always an opponent in two- and
four-player seating, so playing that card reveals nothing new to them while the
rest of the hand stays hidden. Among the near-best rollout candidates the CPU
swaps to the shown card when it is comparable: same kind (trump with trump, or
ordinary strike with an equal strike; never a Rechter or critical card), the
same result against the current public trick, and a trick that the alternative
surely wins stays surely won. The shown card must itself lie inside the checked
candidate window below the best rollout and at most the tier's close-choice
window below the otherwise chosen card; a sampled certain win is never given up, and soft
preferences such as the blind opening custom may be worse by at most 0.75 of the
partnership weight (one repeated printed attribute, not two). In an otherwise
hopeless trick the early reduction keeps the cheapest card and a comparable
shown card, so the rollouts decide between them. Legal duties, Blödeln bottoms,
the safe-partner rule and deliberate misplays keep their priority; a misplay is
never undone by swapping back to the shown card, and a swap after a misplay may
not score below the misplayed card.

## Blind rollout experiment, 4 November 2026

We tested a candidate which instead let blind simulated seats use only their own
sampled hand, the visible trick and public critical-card order. It is more
faithful to their information, but is still only a simple approximation. Its
more realistic information model does not by itself establish stronger play.
The delivered CPU retains the previous rollout and the new soft rank preference.

Two different comparisons gave different indications. The first used 64 seeds,
both critical-card options, four dealers and both parties, against an intentionally
simple reference that does not bid and always holds. Each experience row below
contains 1,024 synthetic opening deals per model; observations share seeds. These
results do not establish strength against skilled opponents or people.

| Experience | Rollout | Policy wins | Policy bids | Policy points | Reference points |
| --- | --- | ---: | ---: | ---: | ---: |
| Newcomer | Previous | 686 | 752 | 2,006 | 794 |
| Newcomer | Information-limited | 695 | 773 | 2,038 | 783 |
| Experienced | Previous | 706 | 836 | 2,087 | 797 |
| Experienced | Information-limited | 716 | 858 | 2,132 | 774 |

Claude independently tested the candidate against the prior `f89354f7` CPU,
which bids and responds, on 400 seeds without and 200 with critical cards, all
four dealers and both parties. The candidate had 9 fewer wins and 226 fewer
points in 3,200 paired deals without critical cards; with critical cards it had
2 fewer wins and 41 fewer points in 1,600 paired deals. Rank repetitions fell
from 894 to 712, and from 437 to 337 respectively. Its previous rank-preference
variant with the old rollout had 11 fewer points without critical cards; its
other implementation differences prevent attributing the whole effect to the
rollout alone. These runs use the default skill and 24 sampled worlds, not
separate experience tiers. Their grouped results are preserved in
`experiments/watten_blind_rollout/claude_final.jsonl` and `claude_earlier.jsonl`.

A separate holdout isolates the rollout: both candidates use exactly the same
`efc38c71` code and soft rank preference; only `_simulated_card` differs. Each
row uses new seeds 2000–2099, all dealers and both parties, against the same
`f89354f7` bidding CPU. Policy points are signed points for the tested party,
compared with zero for the symmetric old-versus-old reference. Per-seed results
are stored in `experiments/watten_blind_rollout/`.

| Critical cards | Rollout | Wins / 800 | Signed points | Bids | Rank repetitions |
| --- | --- | ---: | ---: | ---: | ---: |
| No | Previous | 400 | -7 | 609 | 171 |
| No | Information-limited | 398 | -72 | 628 | 188 |
| Yes | Previous | 401 | +8 | 612 | 159 |
| Yes | Information-limited | 402 | -45 | 598 | 181 |

The eight dealer/party rotations of a seed are dependent. Aggregating by seed,
the new-minus-old point difference is -0.65 points per seed (standard error
0.66) without critical cards and -0.53 (standard error 0.79) with them. Neither
holdout alone establishes a statistically reliable difference, and the change
in bid counts even reverses direction between these two samples. Together with
the larger strong-opponent comparison, the results raise enough concern to defer
the rollout change rather than claim it makes the CPU stronger. They do not
establish a win rate against people, cover all difficulty tiers or prove a real
information leak.

The old-versus-old benchmark necessarily produces 400 wins and zero signed
points because both parties of every deal are rotated; this is a symmetric
reference, not a measured human win rate. The candidate source SHA-256 is
`efc38c719ec084b4e135d621ef01053af0ba43f6fd459a941e13770757bb446d`,
the delivered comparison source is
`f2d3f793f722d7aa691d308250306f706d17bb66364aed15e63411edbd0f3511`,
and the patch reconstructing the candidate has SHA-256
`0339df31e7b24167329322e9288f012e43e80cc8210f75afaacfda4aa718ddf3`.
The current hardened runner has SHA-256
`4afd676597dda0b398342ce6e8312dd0c4314666b5a7c39e09d1ffc393f712ef`;
one seed from each of the four archived variants was reproduced exactly after
the security changes.
The benchmark reconstructs and validates these sources in a temporary directory
and requires the unchanged reference support files from `f89354f7`. From the
repository root, each of the four holdout rows can be reproduced, for example:

```sh
python -m scripts.benchmark_watten_blind_strong --mode rankonly --critical 0 --output /tmp/watten-rankonly.json
python -m scripts.benchmark_watten_blind_strong --mode final --critical 0 --output /tmp/watten-experiment.json
```

Use `--critical 1` for the other two rows. The old simple-opponent wrapper
`scripts/benchmark_watten_blind_rollout.py` requires the experimental patch in
an isolated checkout and refuses to silently compare the old rollout with itself.
For Claude's final reference comparison, run the strong wrapper in `final` mode
with `--seed-start 1000 --seeds 400 --critical 0` and again with
`--seed-start 1000 --seeds 200 --critical 1`.
The historical simple-reference runs were made before a syntax-only Ruff fix;
the newcomer runs were repeated after it with identical outcomes.

The CPU does not treat customary partner play as proof of a hidden call. In
particular, a low second-trick card never reveals its partner's actual hand or
creates a private communication channel.

A reviewed reconnect suspicion was rejected against real personal engine views:
with live trick history disabled, fresh memory at trick four remembers the last
winner and infers the preceding winner from that trick's leader. Two remembered
winners already select the same later-trick preference as three continuously
observed winners. Real trick-two, three and four regressions keep the cheap
partner convention in the actual second trick. No policy or weight changed;
forgotten older cards and private calls are not reconstructed.

The [Tiroler Wattergemeinschaft's tips](https://www.tiroler-wattergemeinschaft.at/ladinisch-watten/)
describe leaving the second trick to a partner acting last, avoiding duplicate
ranks while uninformed, and using strong cards before it is too late.
[UltraWatten](https://www.ultra-watten.com/watten-regeln/ladinisch-watten) describes
a related low-card custom after an announcer takes the first trick.
[Watten Südtirol](https://watten-suedtirol.com/tipps-tricks/) treats these as
tactics and also discusses score-aware bidding and counting visible cards.
Their different regional rules are not imported into the house rules.

## Verification status

Source syntax, targeted Ruff checks and behavioural tests cover the changes.
The release additionally requires the repository’s complete local verification.
The paired synthetic comparison in [WATTEN_CPU_BENCHMARK.md](WATTEN_CPU_BENCHMARK.md)
reports the newcomer and experienced tiers against a simple baseline, including
blind-play and partnership counters. It does not prove a strength difference or
win rate against people.

## Deutsche Kurzfassung

Die CPUs berücksichtigen nur ihre eigenen erlaubten Informationen. Für jeden
sitzenden Menschen gilt je nach abgeschlossenen Watten-Spielen zunächst ein
Profil mit 16, 24, 40 oder 64 möglichen Kartenverteilungen. Die Stufen beginnen
bei 0, 10, 30 und 75 Spielen. Der Tisch verwendet den Median der Profile; bei
gerader Personenzahl wird jeder Parameter der beiden mittleren Profile gemittelt.
Die Stichprobenzahl bleibt ganzzahlig und begrenzt. 0 und 1000 Spiele ergeben
40 Stichproben, Sicherheit 0,84, Auswahlfenster 0,046, Partnergewicht 0,0265 und
Gebotsschwelle 0,67 statt der höchsten Stufe. Konten zählen einmal; CPUs und
Zuschauer stimmen nicht mit. Die Runtime liest weiterhin aktuelle Zähler vor
CPU-Entscheidungen, ohne neue feste Stufe pro Gabe. Abgeschlossene Spiele sind
ein Erfahrungswert, keine Messung menschlichen Könnens.
Die Anzahl kommt aus den bestehenden abgeschlossenen Spielen und bleibt über
Neustarts erhalten. Das ist eine feste Anpassung der Spielstärke, kein
maschinelles Lernen. Gelegentlich wählen CPUs eine gemäss Simulation schwächere
legale Karte: mit 6 %, 2,5 %, 1,5 % beziehungsweise 1 % pro geeigneter Situation.
Gibt es keine schwächere erlaubte Alternative, entfällt der Fehlwurf. Trumpfpflicht
und Pflichtkarten bleiben immer verbindlich; ein sicherer Partnerstich wird als
letzte Position nicht absichtlich überstochen.

Geboten wird bei subjektiv guten Chancen und sinnvoller Punkteabwägung. Für
jede weitere Erhöhung steigt die nötige Sicherheit. «Zweiter Stich ist
Partnerstich» bleibt eine weiche Taktik im blinden Ladinisch, wenn der Partner
zuletzt spielt. Klar bessere Kartenentscheidungen und sämtliche Spielregeln
gehen vor. Im ersten Stich eines blinden Spiels vermeiden sie nach Möglichkeit
bereits sichtbare Kartenwerte und Farben, auch als informierte Ansager. Je
wiederholtem Merkmal beträgt der weiche Nachteil 0,5 × Partnerschaftsgewicht,
zusammen höchstens 1,8–3,5 Prozentpunkte. Für den blinden Partner ohne bekannte
Ansage kommt in jedem Stich eine zusätzliche weiche Präferenz von 1,5 ×
Partnerschaftsgewicht hinzu, wenn der wiederholte Rang noch Schlag sein könnte
und ein anderer legaler Rang verfügbar ist. Das Auswahlfenster wird hierfür bei
Bedarf erweitert; bei einem sonst aussichtslosen Stich werden höchstens die
billigste wiederholte und die billigste andere Karte verglichen. Klar bessere
Züge, Pflichtkarten und Fehlwürfe bleiben möglich. Daraus wird keine geheime
Ansage vorausgesetzt. Diese Konvention ist eine ausdrückliche Vorgabe des Eigentümers. Hat eine
einschauende CPU eine eigene Karte gezeigt, spielt sie unter den nahezu besten
Kandidaten diese bekannte Karte, wenn sie vergleichbar ist: gleiche Art (Trumpf
oder gleichrangiger Schlag, nie Rechter oder kritische Karte), gleiches
Ergebnis im aktuellen Stich und kein Verlust eines sicheren Stichs. Ihr
Rollout muss im geprüften Kandidatenfenster liegen und darf höchstens um das
Auswahlfenster unter der sonst gewählten Karte liegen; nach einem Fehlwurf nie
unter der Fehlkarte. Weiche
Präferenzen wie die blinde Eröffnungsregel höchstens um 0,75 × Partnergewicht.
Bei aussichtslosen Stichen bleibt die gezeigte Karte als zweiter Kandidat
erhalten. Eine entscheidende CPU antwortet auf ein Angebot erst nach dem
Gefühl ihres Partners (Mensch oder CPU, offen oder blind); gut/schlecht
verschieben die eigene Einschätzung um zehn Prozentpunkte, unsicher nicht.
Nach einem zurückkommenden Gegenangebot wird erneut gefragt. Vermutlich sichere
Partnerstiche werden geschont; wenn danach noch
spielende Gegner den Stich in den erlaubten hypothetischen Verteilungen
gefährden, kann eine stärkere Deckung sinnvoll sein. Uninformierte CPUs mitteln
über mögliche Ansagen, informierte nutzen die wirklich bekannte Ansage. Die
Taktiken werden durch gezielte Verhaltenstests geprüft; vor der Freigabe folgt
zusätzlich der vollständige lokale Releaseablauf. Ein gepaarter Vergleich mit
einer einfachen Referenz für Anfänger- und Erfahrungsstufe steht in
[WATTEN_CPU_BENCHMARK.md](WATTEN_CPU_BENCHMARK.md). Er belegt keine allgemeine
Stärkeänderung oder Gewinnrate gegen Menschen.

Beim blinden Ausspiel berücksichtigt eine informierte CPU anhand hypothetischer
Verteilungen, ob ein wissender Gegner durch ein Trumpfanspiel übernehmen muss.
Das ist eine weiche Abwägung im bestehenden Auswahlfenster: Trumpf auszuspielen
kann weiterhin sinnvoll sein.

Als letzte Person übersticht die CPU ihren Partner nicht, wenn dieser bei allen
noch möglichen Ansagen bereits gewinnt und eine legale Karte diesen Partnerstich
bei allen diesen Ansagen erhält. Lässt die Trumpfpflicht keine solche Karte zu,
darf sie überstechen; wenn nach ihr noch ein Gegner spielt, kann sie den Stich
weiterhin decken. Diese strengere Taktik verzichtet auch auf die Möglichkeit,
durch das Überstechen den nächsten Stich selbst anzuspielen. Die Spielregeln
gehen immer vor. Nur bei aktivierter Option «Partnerhand offen» stammt eine fremde
Hand aus dem Spiel; ansonsten sind die verteilten Hände Annahmen. Die vereinfachten
blinden Spieler innerhalb einer Simulation wählen nur anhand ihrer hypothetischen
eigenen Karten, sichtbarer Stichkarten und fest bekannter Kritischer; sie lesen
weder die hypothetische Ansage noch fremde hypothetische Hände. Als letzte Person
können sie einen scheinbaren Stich mit einer höheren Karte der angespielten Farbe
versuchen; die unbekannte Ansage kann diesen Versuch scheitern lassen. Wenn der
entscheidende CPU-Sitz anhand seiner erlaubten Sicht genau eine mögliche Ansage
erschliesst, darf nur derselbe simulierte Sitz diese Ableitung in späteren Zügen
nutzen, ohne fremde Hände zu sehen. Andere blinde Simulationsplätze erfahren sie
nicht; eine Pflicht, Trumpf zuzugeben, entsteht durch die Ableitung nicht.
Informierte Simulationsplätze nutzen weiterhin die hypothetische Ansage und die
verteilten Hände. Das ist eine vereinfachte Näherung, keine echte fremde Hand. Der Vergleich
beider Simulationsmodelle mit Einsteiger- und Erfahrungsstufe samt Geboten,
Punkten, reproduzierbarem Aufruf und Grenzen steht oben unter «Blind rollout
comparison»; er belegt keine Gewinnrate gegen Menschen.

Ein geprüfter Wiederverbindungsverdacht wurde mit echten persönlichen
Engine-Ansichten widerlegt: Ohne offenen Stichverlauf kennt ein frisches
Gedächtnis im vierten Stich den letzten Gewinner und erschliesst aus dessen
Anspieler den vorherigen. Zwei gemerkte Gewinner wählen bereits dieselbe späte
Taktik wie drei durchgehend beobachtete. Regressionen für den zweiten, dritten
und vierten Stich halten den günstigen Partnerstich im tatsächlichen zweiten
Stich. Politik und Gewichte bleiben unverändert; ältere Karten und private
Ansagen werden nicht wiederhergestellt.
