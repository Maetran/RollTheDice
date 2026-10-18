# Watten CPU benchmark

Standalone B12 measurement tool: `tests/watten_cpu_benchmark.py`. It is outside
pytest discovery, imports production policy/engine modules directly, and uses no
database, HTTP server, runtime runner, pytest helper or real account.

**Current status:** source prepared; no benchmark was run while the shared full
verification pool was active. Execute only after coordinating the machine load.

From the repository root, using its existing Python environment:

```sh
python -m tests.watten_cpu_benchmark --seeds 8 --seed-start 0 --output /tmp/watten-cpu-benchmark.json
```

`--seeds` accepts 1–64 (default 8); `--max-steps` accepts 32–512 (default 240).
Every invocation covers all twelve confirmed profiles: 2/3/4 normal open,
2/4 Ladinisch open and 4 Ladinisch blind, each with critical cards off/on.
Target is eleven; reference, trick history and open partner hand remain off.
Guter/Schlechter and difficulty variants are absent. `CpuBudget()` is used
unchanged: currently **24 samples**, with the effective budget in the report.

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
card**, never initiates a bid, always holds and sends no partner advice.
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

Comparison rows count won deals and awarded stake points **once per winning
party**. `points_from_bid_deals` is the awarded stake in deals containing an
accepted bid, including a folded initial bid worth two; it is not the sum of
offers. Dreier policy-solo and policy-pair rows remain separate: a pair's points
are not doubled because its two individuals receive the same award. Both paired
legs, denominators and failures remain visible. Raw results and timings are
reproducible inputs for review; small samples justify no general strength or
production-readiness claim. Actual timings also depend on machine load.
