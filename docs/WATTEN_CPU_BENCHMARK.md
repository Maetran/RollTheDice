# Watten CPU benchmark

Standalone B12 measurement tool: `tests/watten_cpu_benchmark.py`. It is outside
pytest discovery, imports production policy/engine modules directly, and uses no
database, HTTP server, runtime runner, pytest helper or real account.

**Measured 18 October 2026:** the coordinated default run completed before the
next shared full verification pool started. All 608 cases completed without
errors: 11,583 accepted commands, 484 policy versus 124 baseline deal wins,
1,442 versus 318 awarded stake points. Card/bid decision latency was p50
1.1327ms and p95 3.4855ms; the complete run took 12.44 seconds. These synthetic
opening deals and simple baseline do not establish human strength or Elo.

The ignored report is preserved at
`test-results/watten-cpu-benchmark/run-20261018-default608.json`; SHA-256
`4390ae5be880c1ecd824d735586590bdd1bcf4e384260e60e36e004209b23aac`.
Coordinate machine load again before rerunning.

From the repository root, using its existing Python environment:

```sh
python -m tests.watten_cpu_benchmark --seeds 8 --seed-start 0 --output /tmp/watten-cpu-benchmark.json
```

`--seeds` accepts 1–64 (default 8); `--max-steps` accepts 32–512 (default 240).
To exercise a live experience tier instead of the default profile, add
`--completed-games 0` (newcomer) or `--completed-games 75` (experienced).
The matching sample budget and all skill parameters appear in the report.
Every invocation covers all twelve confirmed profiles: 2/3/4 normal open,
2/4 Ladinisch open and 4 Ladinisch blind, each with critical cards off/on.
Target is eleven; reference, trick history and open partner hand remain off.
Guter/Schlechter are absent. Without an experience argument, the default
`CpuBudget()` uses **24 samples**.

Each seed fixes a SHA-256-sorted canonical deck, dealt round-robin in seat order.
Every dealer is tried. Each identical deck/dealer fixture is played twice with
policy and baseline parties exchanged; both legs share the deal ID and policy
seed. With eight seeds this is 608 separate engine executions (paired legs
are statistically dependent). Normal calls are chosen by the acting controller;
Ladinisch uses the actual original bottom cards. Each execution starts a fresh
zero-score **opening deal**, rather than simulating a whole match or progression.

The harness holds synthetic engine state only to apply commands and select each
seat's personal DTO. `decide()` receives only that DTO, its own observed memory,
the explicit seed and production budget. One-time public events are merged into
each seat's memory after accepted transitions; original inspection is remembered
before ACK. Partner advice is private and comes only from each seat's own
personal DTO. Advice proposals run before simultaneous primary proposals, which
are then recomputed. No hidden engine object enters the policy interface.

The named baseline announces Seven/Hearts, plays the **first remaining legal
card**, never initiates a bid, always holds, declines optional preplay requests
and sends no partner advice. The explicit decline keeps current Blödeln consent
from stalling the measurement; it does not add tactical card knowledge.
`legal_cards()` supplies legality only; the baseline does not rank cards using
the real call, foreign hands or stock. This baseline does not exercise policy
responses to opposing bids. It is a deliberately simple comparator, not a
claim about human strength or a second product difficulty setting.

JSON contains environment/source hashes, seeds, budget, every case outcome,
accepted command counts and maximum steps. Latency uses `perf_counter()` around
production `decide()` only, without deliberate think time; nearest-rank p50/p95
and maximum are separate for all calls, proposals, card/bid decisions and waits.
This prevents cheap waiting calls from masking card-decision latency. Errors are
reported separately; a failed or exhausted case makes the process exit nonzero.

The tactical counters record a policy lead by an officially informed blind
player, how often that lead is trump or the Rechter, and how often another legal
non-trump lead was available. They also count policy decisions while a partner
currently wins, overtakings, and those with a legal card that would not overtake.
For a policy trump lead in a blind deal, they count later officially informed
players whose available cards were restricted, separately by partnership. These
descriptive counters use actual engine state only after the decision: they do
not enter the CPU view or imply that an alternative was strategically better.
They also do not establish whether the winning partner would have stayed ahead
after the rest of the trick. Interpret counters using their matching denominators.

Comparison rows count won deals and awarded stake points **once per winning
party**. `points_from_bid_deals` is the awarded stake in deals containing an
accepted bid, including a folded initial bid worth two; it is not the sum of
offers. Dreier policy-solo and policy-pair rows remain separate: a pair's points
are not doubled because its two individuals receive the same award. Both paired
legs, denominators and failures remain visible. Raw results and timings are
reproducible inputs for review; small samples justify no general strength or
production-readiness claim. Actual timings also depend on machine load.

## Tactics comparison, 4 November 2026

The same benchmark and seeds `10000..10031` were run on the previous policy
(`a206eabe3b4260eeebf99da595243715a7cdbaca`) and the tactics update. Each row
contains 2,432 synthetic opening deals over all twelve profiles, with every
dealer and both party assignments; 512 of those deals were blind. The old
source was run with the same measurement harness as the new source. All 9,728
executions completed. The target policy played against the named simple
baseline, not directly against the other policy.

| Experience | Policy wins, all deals | Policy wins, blind deals | Policy stake points, all deals |
| --- | ---: | ---: | ---: |
| Newcomer, previous | 1,890 / 2,432 | 351 / 512 | 5,551 |
| Newcomer, updated | 1,868 / 2,432 | 352 / 512 | 5,486 |
| Experienced, previous | 1,905 / 2,432 | 356 / 512 | 5,669 |
| Experienced, updated | 1,899 / 2,432 | 352 / 512 | 5,649 |

| Experience | Informed blind trump leads with non-trump alternative / informed leads | Partner overtakes with non-overtaking alternative / partner-winning choices | Informed partners restricted by a policy trump lead |
| --- | ---: | ---: | ---: |
| Newcomer, previous | 167 / 815 | 710 / 3,590 | 29 |
| Newcomer, updated | 159 / 807 | 661 / 3,612 | 30 |
| Experienced, previous | 159 / 818 | 756 / 3,560 | 19 |
| Experienced, updated | 145 / 813 | 712 / 3,564 | 18 |

The stricter partner-trick filter was also measured against the preceding
intermediate tactics update on the same seeds. In the experienced tier, the
intermediate update won 1,898 deals, with 746 partner overtakes despite an
alternative across 3,550 partner-winning choices. The final version won 1,899
deals, with 712 such overtakes across 3,564 choices. In the newcomer tier, both
won 1,868 deals; the count fell from 701 / 3,597 to 661 / 3,612. All 4,864
intermediate executions completed. These are descriptive comparisons subject to
the same limitations as the table above.

The lead restricting an informed partner may itself come from any CPU seat;
it is not necessarily an officially informed lead. An officially informed
player and their informed clockwise neighbour are on opposing teams in blind
four-player play. These counts describe decisions and available choices, not
whether the alternative would have won the trick. The paired legs and outcomes
from the same seed are dependent. These results do not establish a general
strength difference or human win rate. Reproduce each experience tier at a
given revision using:

```sh
python -m tests.watten_cpu_benchmark --seeds 32 --seed-start 10000 --completed-games 0 --output /tmp/watten-newcomer.json
python -m tests.watten_cpu_benchmark --seeds 32 --seed-start 10000 --completed-games 75 --output /tmp/watten-experienced.json
```
