# Watten pure engine and room foundation

## Local account progress

Both local preview flags also gate `/watten/konto/fortschritt`,
`/watten/konto/verlauf` and `/watten/rangliste`. A newly completed native match
commits its unchanged result-v1 record, immutable evidence, own-account credit,
one-time achievements and checkpoint atomically. Failure rolls back all of
them; restart and repeated completion cannot grant again. Historical result
reads never backfill XP or invent missing profile/bid evidence.

The current 22 pub titles, 27 achievements and XP values are a labelled draft.
XP standings measure persistence; wins and win rate use explicit table/CPU
filters and a ten-match minimum for a win-rate place. A match's reward panel
acknowledges only its own displayed sequence; the account's explicit “Seen”
action acknowledges the displayed global boundary. Older unseen match rewards
remain pending. None of these reads writes grants or advances an acknowledgement.

DE/EN names, conditions and the actual stored award price appear in the account
and achievement feed. Archived catalog entries retain their stored XP and use
an archive label instead of a guessed condition. The public Watten host remains
closed; these pages are noindex, no-store and authenticated.

Source snapshot: 18 October 2026, local game integration after PR #54. Pure
transitions now have a gated native transport, durable result writer, personal
CPU runner and DE/EN browser UI. The production host remains closed.
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
The first dealer comes from a cryptographic server draw; subsequent dealers rotate
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
triggers duty; a later critical does not remove an existing duty. An ordinary
strike substitutes only when it takes the current trick. Trump, the Rechter
and critical cards need not win. Without ordinary trump, protected cards are
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
`ROLLTHEDICE_WATTEN_GAME_PREVIEW` gate; local native documents also require the
account preview gate. A separate default-off `ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW`
can authorize only the immutable founder's private web preview on the existing
production apex. The local booleans remain strictly local; production account
authorization is a fresh active-account/ownership lookup. The fixed Watten
origin, production PWA, Watten mail context and notification delivery remain
closed. See the [deployment contract](DEPLOYMENT.md#private-watten-webvorschau--private-watten-web-preview).

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

`watten_cpu.py` and `watten_cpu_memory.py` select tactics from only a CPU's
personal DTO, public events and allowed observations remembered during play.
`watten_cpu_runtime.py` schedules bounded decisions under the same lock. It
persists each accepted observation before an inspection ACK can close the
window. Pause, replaced runtime generations and stale opportunities invalidate
old jobs; a failed checkpoint never installs a candidate or spins on retries.
The private runtime schema is version 2, with strict version-1 human compatibility.

The UI decodes public card assets before connecting, checks fresh account
identity before every socket and binds its expected account in the server-side
join guard. Intentional departure with a lost ACK is resolved through a read;
it never automatically joins the departed account again. Private DOM is cleared
synchronously on page departure. Mobile portrait and short landscape layouts
have isolated browser checks; physical-device acceptance remains separate.

`watten_evidence.py` validates public scoring evidence and complete relational
membership. Result-v1 stays unchanged; missing profile, start and bid facts
remain UNKNOWN. This adapter does not award XP or supply a public account feed.

Focused unit/review evidence is recorded in the [execution log](WATTEN_EXECUTION_LOG.md).
It is not the next integrated full-check receipt or complete product acceptance.
The integrated full proof, broader CPU strength calibration and physical-device
acceptance remain open. Targeted native tests exercise real HTTP/WebSocket/SQLite
matches, atomic failure/retry, restart, stale lifecycle commands and revoked
private fanout. The [historical room handoff](WATTEN_ROOM_HANDOFF.md)
preserves the bounded implementation assignment; this guide describes current sources.
