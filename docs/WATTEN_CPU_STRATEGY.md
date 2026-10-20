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
table. Imported legacy games do not count. In a mixed table, the least
experienced human determines the shared level.

| Completed Watten games | Hypothetical deals per decision | Confidence weight | Close-choice window |
| --- | ---: | ---: | ---: |
| 0–9 | 16 | 0.72 | 0.080 |
| 10–29 | 24 | 0.82 | 0.045 |
| 30–74 | 40 | 0.90 | 0.025 |
| 75 or more | 64 | 0.96 | 0.012 |

These thresholds are implementation choices. Larger samples and narrower
close-choice windows make later decisions more precise; they do not guarantee
that every higher tier wins a particular deal. There is no machine learning,
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
an authorized partner may state good, bad or unsure once for that offer.

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
1.8–3.5 percentage points combined. The existing close-choice window still
limits which simulated moves can compete. This applies to informed announcers
too, so their partner can see more combinations; it never forces a card that
violates trump duties or excludes a clearly better simulated move. Later tricks
keep the existing rank-only preference for uninformed seats. This convention is
an explicit owner request, not an extra regional rule taken from the sources.

The CPU does not treat customary partner play as proof of a hidden call. In
particular, a low second-trick card never reveals its partner's actual hand or
creates a private communication channel.

The [Tiroler Wattergemeinschaft's tips](https://www.tiroler-wattergemeinschaft.at/ladinisch-watten/)
describe leaving the second trick to a partner acting last, avoiding duplicate
ranks while uninformed, and using strong cards before it is too late.
[UltraWatten](https://www.ultra-watten.com/watten-regeln/ladinisch-watten) describes
a related low-card custom after an announcer takes the first trick.
[Watten Südtirol](https://watten-suedtirol.com/tipps-tricks/) treats these as
tactics and also discusses score-aware bidding and counting visible cards.
Their different regional rules are not imported into the house rules.

## Verification status

Only source syntax and targeted Ruff checks were run for this change, as
requested. No test suite or new strength benchmark was run. The older benchmark
in `WATTEN_CPU_BENCHMARK.md` predates this strategy and does not measure the new
tiers or prove a strength increase against people.

## Deutsche Kurzfassung

Die CPUs berücksichtigen nur ihre eigenen erlaubten Informationen. Mit mehr
abgeschlossenen Watten-Spielen der Menschen am Tisch rechnen sie mit 16, 24,
40 oder 64 möglichen Kartenverteilungen; bei gemischter Erfahrung zählt der
unerfahrenste Mitspieler. Die Stufen beginnen bei 0, 10, 30 und 75 Spielen.
Die Anzahl kommt aus den bestehenden abgeschlossenen Spielen und bleibt über
Neustarts erhalten. Das ist eine feste Anpassung der Spielstärke, kein
maschinelles Lernen.

Geboten wird bei subjektiv guten Chancen und sinnvoller Punkteabwägung. Für
jede weitere Erhöhung steigt die nötige Sicherheit. «Zweiter Stich ist
Partnerstich» bleibt eine weiche Taktik im blinden Ladinisch, wenn der Partner
zuletzt spielt. Klar bessere Kartenentscheidungen und sämtliche Spielregeln
gehen vor. Im ersten Stich eines blinden Spiels vermeiden sie nach Möglichkeit
bereits sichtbare Kartenwerte und Farben, auch als informierte Ansager. Je
wiederholtem Merkmal beträgt der weiche Nachteil 0,5 × Partnerschaftsgewicht,
zusammen höchstens 1,8–3,5 Prozentpunkte innerhalb des bestehenden Fensters für
ähnlich gute Züge. Daraus wird kein Wissen über den geheimen Schlag oder die
Farbe abgeleitet. Diese Eröffnungskonvention ist eine ausdrückliche Vorgabe des
Eigentümers. Neue Messungen zur Spielstärke und eine Testsuite wurden für diese
Änderung ausdrücklich nicht ausgeführt.
