# Watten pure engine and room foundation

Source snapshot: 18 October 2026, integrated through `272cfdb` on
`codex/watten-engine-core`. These modules are internal foundations, without a
game adapter, gameplay HTTP/WebSocket route, database writer or game UI.
The separate local account preview and closed production host are unchanged.
[Owner decisions](WATTEN_OWNER_DECISIONS.md) define the house profiles;
[all 81 findings](WATTEN_FINDINGS_STATUS.json) remain required.

## Source contracts

| Module | Responsibility |
| --- | --- |
| `app/watten_cards.py` | Validated 33-card IDs, five-card immutable deals and frozen original bottoms; caller supplies the deal schedule. |
| `app/watten_rules.py` | Announcer/dealer roles, critical precedence, card/trick comparison and actual-shown-card Danke derivation. |
| `app/watten_bidding.py` | Explicit parties/deciders, bid responses, accepted stake, once-per-deal score accounting. |
| `app/watten_play.py` | Immutable accepted-card replay, turn/duty checks, pooled party tricks and immediate third-trick end. |
| `app/watten_recipe.py` | Versioned secret-free table settings with strict payload/JSON allowlists. |
| `app/watten_room.py` | Account admission, manual seats/teams, CPUs, reservations, host/expiry/start/rematch and private room JSON. |
| `app/watten_engine.py` | Bound actors, announcement/inspection/play/bid phases, opportunities, ACKs, scoring and private restart schema. |
| `app/watten_views.py` | Separate member, CPU and spectator allowlists; never a generic state dump. |

## Profiles and options

Two players are open, with normal or Ladinisch determination. Three are open
normal play with a rotating solo naming both values. Four default to blind
Ladinisch; explicit open normal/Ladinisch profiles are represented too.
The first dealer is supplied by a later server draw; subsequent dealers rotate
clockwise. Four-player teams are chosen opposite seats, never inferred from joins.
Guter/Schlechter stay unavailable; critical cards default off in table creation.
Critical precedence is heart king > Weli > acorn seven > Rechter, including
collisions. A free Weli strike is unavailable with critical cards enabled;
a Ladinisch-forced Weli remains the second critical, with no replacement strike.

`show_rechter` and `trick_history` default off. A reference, when enabled, shows
only the matching call card to official knowers, a back to others; it never
reopens the other original bottom card. Without it, the call is memory-only
after its permitted initial delivery. Partner-hand viewing is opt-in, open only,
and requires partners. The recipe stores `password_required`, never a password,
verifier, invitation, reservation, identity, hand or call. Runtime mapping must
retain the chosen ruleset/version and translate recipe options explicitly.

## Phases and privacy

Normal precall hands are visible only to the actual announcers. Ladinisch needs
two accepted original-card shows and two individual inspection ACKs. Rejoin can
resume an unacknowledged window; an ACK closes only that actor's window forever.
Open Ladinisch emits its public call once when the final ACK opens play; blind
Ladinisch does not. Public Danke depends only on actual shown Rechter cards.

Only official knowers follow ordinary-trump/Rechter leads. A critical lead never
triggers duty; a later critical does not remove an existing duty. A nonwinning
strike is an allowed alternative. Without ordinary trump, protected cards are
not forced. A pending bid freezes card play, while private partner feedback
remains possible. Gestrichen opening rights use the initiating player's own
score; designated hold/go/counter responses remain possible. The chosen source
threshold is target minus two, not an additional configurable house rule.

Commands bind account and participant, deal, phase and public opportunity.
Positive integer human accounts reject Boolean aliases; CPUs have explicit None
bindings. ACKs contain no private payload or repeated call event. Each bound
actor has at most 64 cached ACKs; separate actor-local feedback sequences reject
evicted private envelopes without revealing activity through another actor's
ACK eviction or changing public opportunity. CPU views use their own personal
allowlist. Public views contain counts and played cards, never hidden hands,
stock, cached commands or account IDs. History includes only already public cards.

## Runtime contract and acceptance

The local adapter in `watten_runtime.py`, `watten_http.py` and
`watten_websocket.py` now composes these pure transitions under the shared table
lock. It rederives authority after lock acquisition, revokes replaced sockets,
and commits candidate state and a final result in one database transaction before
installing or acknowledging it. It uses explicit versioned storage and separate
per-viewer projections. This is local development behind the independent
`ROLLTHEDICE_WATTEN_GAME_PREVIEW` gate; production remains closed. Native UI,
CPU scheduling and a complete rematch journey remain follow-up work.

One-time public calls use a durable delivery outbox with recipient-bound ACKs,
so a crash after commit but before broadcast does not lose open C/D's initial
call. This does not reopen inspection or keep a client reference when disabled.
Terminal checkpoints remain available for final ACKs. Local Watten result deletion
is explicitly rejected until coherent atomic retirement exists; generic deletion
must not leave a checkpoint pointing at a tombstoned result.

Intentional running departure persists an absent set and a lifecycle revision.
Card play, bids, answers, announcements, inspection closure and the next deal
wait for every absent person to return. Ordinary reconnect only restores the
allowed view; explicit resume binds the current account and absence revision.
Allowed private partner feedback and delivery ACKs may continue. Restart retains
the pause. Old leave replays cannot detach a fresh connection; a logout during
an awaited broadcast cannot receive the former account's private leave snapshot.

Focused unit/review evidence is recorded in the [execution log](WATTEN_EXECUTION_LOG.md).
It is not the next integrated full-check receipt or complete P2/P3 acceptance.
Browser flows, the final integrated full proof, CPU policy and physical-device
acceptance remain open. Targeted native tests exercise real HTTP/WebSocket/SQLite
matches, atomic failure/retry, restart, stale lifecycle commands and revoked
private fanout. The [historical room handoff](WATTEN_ROOM_HANDOFF.md)
preserves the bounded implementation assignment; this guide describes current sources.
