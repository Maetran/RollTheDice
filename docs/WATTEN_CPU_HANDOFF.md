# Watten: bounded tactical CPU policy package

Prepared for the existing authorized Claude Code conversation after the Mac is
unlocked. Read AGENTS.md, the owner decisions and the current eight pure Watten
modules. This branch includes their independently reviewed source through
`272cfdb`; no gameplay runtime is exposed here. The separate runtime author owns
transport, database, timers and CPU scheduling. Do not duplicate those files.

## Ownership and delivery

Own only four new files: `app/watten_cpu.py`, `app/watten_cpu_memory.py`,
`tests/test_watten_cpu.py`, `tests/test_watten_cpu_memory.py`. No existing source,
frontend, settings, migration, dependency, version, generated asset, commit hook,
production or push changes. Commit these four files when complete; Codex reviews,
integrates and runs the full required checks later.

Implement an explicit immutable/strictly restorable CPU memory and a reproducible,
bounded tactical decision function. Inputs are one CPU's existing personal DTO,
its previously permitted observations, public one-time call events and an explicit
seed/RNG. Output one legal command proposal (or an explicit wait), with its current
deal/phase/opportunity binding. Make actual command encoding consistent with
EngineCommand, rather than confusing view action names with command kinds.
No EngineState, DealtCards, Room, database, model, storage payload, other viewer's
projection, secret call, actual stock or opponent hand may be supplied or read.
Any simulation uses newly sampled hypothetical unknown cards, never real hidden
state. Do not import the private engine/room/view selectors into policy code.
Pure card/rule/play helpers are allowed for hypothetical simulations.

## Knowledge contract

- Human and CPU have the same personal DTO. Remember only cards/calls actually
  received while allowed. Normal announcing hands are available only to their
  actual announcers; Ladinisch original cards only during that CPU's unclosed
  inspection window. Acknowledge after the policy has consumed the window.
- Later knowledge can include its own hand, already public played cards and
  bids, public Danke, permitted private good/bad/unsure from its own partner,
  and an open partner hand only when that option supplies it. Never reconstruct
  a denied original bottom from server state. Official-knower duty and inferred
  knowledge stay distinct. A blind non-inspector may infer a call without becoming
  obligated to follow trump. Memory must not add a persistent client call display.
- The optional matching reference card is not the original shown card. In
  particular a Weli reference by itself does not encode the trump suit: Weli
  shown as the colour card means bells, whereas Weli as the sole strike can
  accompany any trump suit. Critical Ladinisch Weli remains second critical.
- Preserve useful public observations independently of the history UI setting:
  the CPU may remember what it previously saw, just as a person can. Do not
  fetch an unavailable archive. Handle duplicate observations, restart and a
  new deal without carrying old private hands/calls into that deal.
- Memory storage is server-private and explicit/versioned; generic dataclass
  serialization and implicit unrecognized keys are unsuitable.

## Actual playing decisions

Support every confirmed 2/3/4 profile, normal announcements, Ladinisch ready/ACK,
card selection, bids and the designated hold/go/counter response. Four-player
partners are opposite; three-player solo/partner roles rotate by dealer. The
policy must know its actual partner before using signals or conserving cards.
Do not invent Guter/Schlechter, new regional rules or difficulty modes.

Use practical partner/trick/stake tactics and bounded reproducible uncertainty
sampling where worthwhile. Preserve a winning partner when sensible, conserve
strong cards, account for known public cards and remaining tricks, avoid pointless
nonwinning strikes when a cheaper allowed play exists, and make score/stake-aware
bid decisions. A pending bid blocks cards; only its designated decider responds.
Gestrichen prevents an initiating player's own bid, but never hold/go/counter.
Critical/right duty exemptions and no obligation to win must hold at all skill.

Explicitly bound simulations and computation per decision. No external model,
network, dependency or background worker. Provide a small stable list of typical
Tyrolean CPU first names for the runtime to choose without reusing human identities.
Think delays, scheduling and their randomization remain runtime responsibilities.

## Evidence

Write fixed tactical counterexamples for partner-saving, conservation, hidden-call
uncertainty, correct solo/partner rotation, critical/Weli collisions, protected-card
duty, pending bids and score-aware responses. Replay/dedup and malformed memory
must fail closed. Hidden-state independence is essential: identical permitted
inputs must produce identical outputs with the same RNG even if actual denied
opponent hands/stock/calls differ elsewhere. Include only bounded, small paired
seeded policy comparisons against a deliberately simple legal baseline; report
observed results honestly, without claiming general strength from a tiny sample.

Only tiny serial assigned Python tests and targeted Ruff/Bandit/Vulture are
allowed during shared work. No full suite, browser/container pool or dependency
installation. Ask Codex before any heavier benchmark, and preserve a clean
checkpoint on a real Claude limit. Return full commit SHA, exact commands/results,
decision budget and remaining limitations. This package alone does not finish P5.
