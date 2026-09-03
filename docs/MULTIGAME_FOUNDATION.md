# Multi-Game Foundation: ZDWA and Zilch

This document describes the multi-game boundary introduced for ZDWA and the
internal Zilch preview. The binding Zilch house rules live in
[ZILCH_RULES.md](ZILCH_RULES.md); neither document is a public player-facing
rule page. The private in-app rule guide is a localized projection of that
contract, not a second rule source.

The current private increment is a playable **human-vs-human, human-vs-CPU,
and solo preview** with a complete private product surface: lobby, waiting room
where relevant, live game, history, read-only completed-result report, and rule
guide. It is not a public release and it deliberately remains outside ZDWA
results, statistics, leaderboards, achievements, and replay views.

## Boundaries

- **Shared:** accounts, normalized usernames, session cookies, roles, player
  identity, chat, WebSocket transport, join/rejoin lifecycle, broadcasts,
  connection state, timeout handling, and active-game persistence.
- **ZDWA:** the existing five-dice state, ZDWA join/start details, scoring
  engine, scorecards, suggestions, superadmin edit mode, final results,
  leaderboards, statistics, and achievements.
- **Zilch:** a separate state factory, six dice, target score 10,000, a one- or
  two-participant domain limit, independent player boards, snapshot projection,
  and a pure server-side scoring/turn engine. Play mode
  (`solo | cpu | multiplayer`) and participant type (`human | cpu`) are
  distinct from WebSocket connections. The preview exposes `multiplayer` with
  exactly two authenticated human participants, `cpu` with one authenticated
  host plus one CPU domain participant, and `solo` with exactly one human
  participant and one human connection; it has no spectators. Solo uses the
  versioned `reach_10000_fewest_turns` objective at version 1: reach at least
  10,000 points, then rank future runs by fewer turns, fewer rolls, fewer
  Zilchs, and shorter active duration. A CPU has neither an account/user ID,
  session, resume token, WebSocket, nor offline state. `_players` remains
  transport-only, while `_participants` holds domain seats and
  `_expected_connections` states how many human connections are required.
  Solo has no CPU, opponent, competitive winner/tie, opening roll, or final
  reply. Its UI is a separate route/root with its own stylesheet boundary (`data-game="zilch"`), a
  private navigation, six server-snapshot dice, and no manual dice-selection
  affordance. The CSS-only design system uses warm table, paper-card, and dice
  tokens without third-party game assets. Completed games have their own
  versioned `zilch-house-v1` payload and private result/history projection.

`app/game_registry.py` is the intentionally small composition point. It
selects state creation, per-game join/start setup, gameplay-action dispatch,
progress projection, snapshots, and terminal finalization by a centrally
validated `zdwa | zilch` type. Legacy active snapshots without `_game_type` are
restored as `zdwa`.

## Preview access

`app/game_access.py` is the sole policy location for Zilch preview access. Its
safe production default requires a valid resolved session, `identity.is_admin`,
and normalized username `mani`. A second human can be admitted only through
the explicit comma-separated environment variable
`ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES`; values are normalized, `mani` is
ignored there so its admin requirement cannot be weakened, and an allowlisted
user receives no admin role or other elevated capability. Leave the variable
empty in normal production operation.

The same policy drives switch visibility and the protected `/zilch`,
`/zilch/spiel/{id}`, `/zilch/historie`, `/zilch/ergebnis/{id}`, and
`/zilch/regeln` routes, creation, lobby/history/result/rule APIs, and every
WebSocket connection/action. The raw `/static/zilch.html` artifact is denied.
Zilch is not in the public SEO registry or sitemap and its shell is `noindex`.

## Typed completion boundary

Alembic revision `20260903_0016` gives `completed_games` and deletion audit
tombstones an explicit non-null `game_type` constrained to `zdwa | zilch`.
Existing rows are deterministically backfilled to `zdwa`; the legacy JSON
importer and every current ZDWA writer also pass `zdwa` explicitly. The
composite chronological result index is `(game_type, finished_at)`.

The registry selects a game-specific finalizer. A terminal live state is first
persisted as an `active_games` recovery snapshot, then a finalizer builds its
authoritative result in one typed write. `game_id` makes repeated finalization
idempotent: an existing row of the same type is a successful recovery, while a
type conflict or database failure leaves the terminal active state intact.
Only after confirmed persistence is that active state removed. Startup retries
unpersisted terminal states; a malformed legacy Zilch terminal (for example
without an authoritative end timestamp) is logged and retained rather than
invented, converted to ZDWA, or deleted.

ZDWA keeps its existing scorecard payload, legacy replay, leaderboard JSON,
statistics, and achievement pipeline behind the `zdwa` finalizer. All of those
SQL readers explicitly filter `game_type = zdwa`. Competitive Zilch uses the
separate `zilch_result` payload at schema version 1 with its ruleset,
timestamps, participants, start-roll attempts, both boards and round histories,
penalties, final-round state, outcome, and only reliable derived metrics. Solo
uses the distinct `zilch_solo_result` payload at schema version 2: its
objective id/version and parameters, one human board and round history,
authoritative run metrics, active duration, and `completed` or `abandoned`
outcome. Both are visible only through protected `/api/zilch/results` endpoints and
`/zilch/ergebnis/{game_id}`; it never enters the ZDWA replay renderer or any
ZDWA aggregate.

Private Zilch statistics and leaderboards are a second, Zilch-only read model.
`app/zilch_statistics.py` first filters `CompletedGame` by
`game_type = zilch`, then accepts only the known, strictly validated schema-1
competitive and schema-2 Solo payloads. It calculates the signed-in account's
personal overview and mode-specific values on request; it never reads active
games, ZDWA scorecards, legacy JSON files, browser counters, or CPU-runner
state. Unknown or incomplete historic data is skipped rather than silently
turned into zero. The all-time source is scanned in bounded database pages;
the current private preview data volume does not justify a persisted aggregate
or cache.

The private tables are: one best successful compatible Solo Sprint v1 run per
active account (fewest turns, rolls, Zilchs, active duration, then older
completion), Human-vs-Human wins (then losses, ties, final score, and highest
banked round), and Human-vs-CPU wins separately for each strategy using the
same transparent tie-breaks. All use Competition Ranking (`1, 2, 2, 4`) and
have a hard maximum of 100 entries. Human identity comes from `GameParticipant.user_id`; CPU never
gets an account statistic or rank. Historical deleted/inactive account names
remain in permitted result reports but are not ranking identities. Deleting a
Zilch row/tombstone removes it from calculation-on-read without any ZDWA
rebuild or achievement synchronization.

SQLite receives native non-null type columns plus INSERT/UPDATE validation
triggers because rebuilding a populated parent table would risk cascading its
participant rows. The downgrade is intentionally guarded: it works for
ZDWA-only data, but aborts before removing the discriminator if any Zilch
completed result or tombstone exists. Restore a compatible backup instead of
silently discarding Zilch history.

## Zilch rule contract and engine boundary

[ZILCH_RULES.md](ZILCH_RULES.md) records the confirmed score table, holds,
Hot Dice, confirmation rolls, Zilch behavior, competitive start roll, banking
threshold, final reply, tie, the Solo Sprint objective, and manual-score
decisions. `app/zilch_engine.py` implements
those rules as a pure domain module. Its inputs/outputs are serializable data;
it does not import FastAPI, WebSockets, browser state, database models, ZDWA's
five-dice engine, or ZDWA scoring.

`zilch_gameplay.py` is only the adapter: it validates authenticated WebSocket
turn/version/option references, calls the pure engine, synchronizes the Zilch
live state, then broadcasts through the shared coordinator. A visible,
versioned `zilch_start_roll` action records one server-generated die per
competitive participant and repeats ties before the first regular turn. Solo
starts directly with its first normal turn, so it never receives a meaningless
opening-roll action. `zilch_roll_dice`, `zilch_select_hold`, and
`zilch_bank_points` are authoritative actions; a confirmed
`zilch_abandon_solo` action is available only to the current Solo participant.
`zilch_submit_score` remains an explicit rejected compatibility action because
manual score entry was ruled out for this phase.

The browser does not calculate scores or invent dice. It renders structured
Quick Holds from `_zilch_quick_holds`, sends their turn/version/roll/option
references, and waits for the next server snapshot. Both player boards,
opening-roll history, current unbanked score, Zilch streak, connection state,
Hot Dice/confirmation state, and final-reply markers are projected together.

The remaining product decisions are deliberately narrower: the exact penalty
cadence after a fourth or later consecutive Zilch, additional Solo objectives,
manual dice interaction, final branding/polish, Zilch statistics/achievements,
and public release.

## Human-vs-human Alpha operation

1. Sign in as admin `Mani` and, only for a private second test participant,
   set `ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES` to that account's normalized
   username before starting the app.
2. Open the server-confirmed Zilch switch, create a two-human game, and let the
   allowlisted second account join it from the private Zilch lobby.
3. Each participant presses the opening-roll card. Both dice stay visible;
   tied results restart the attempt, otherwise the higher die receives the
   first ordinary turn.
4. The active participant rolls, chooses one server-produced Quick Hold, then
   rolls again or banks when allowed. Reloading either browser reconnects with
   its authenticated player identity; no saved browser score or Quick Hold is
   reused.
5. After the full reply, both terminal snapshots link to the protected,
   read-only result report. The Zilch lobby lists only the signed-in preview
   account's own completed games; it does not add a public history or a ZDWA
   replay.

## Human-vs-CPU operation

A preview-authorized host can create `play_mode = cpu` with exactly one human
and one CPU participant. The server validates one of the closed strategy names
`conservative`, `normal`, or `aggressive` at creation; a browser cannot supply
thresholds, a participant ID, a CPU action, or a changed strategy later. A
second human cannot join that game. The ordinary shared join/rejoin path still
creates the one human transport player, but the CPU is never added to
`_players`, never receives a resume token, and cannot be presented as offline.

The human performs the opening roll first. Once it is durable, a trusted
server-runner performs the CPU opening roll through the same Zilch action and
fair RNG path; ties repeat with the same ordering. During normal play that
runner observes the current authoritative state, waits a short cancellable
server-side interval, then makes exactly one visible decision: select an
already-valid Quick Hold, roll, or bank. It revalidates every transition
through the same Zilch domain commands used by human actions, broadcasts the
ordinary snapshot/event, stops for pause/terminal state, and never uses a fake
WebSocket, browser, session, or account.

`app/zilch_cpu_strategy.py` is pure and deterministic: it receives only the
current authoritative board/totals, available dice, server-generated Quick
Holds, confirmation/Hot-Dice state, Zilch streak, and final-reply context. It
cannot see future rolls, form a new dice combination, calculate a different
score, or alter RNG. Its public product parameters are deliberately small:

| Strategy | Base bank goal | Character |
| --- | ---: | --- |
| `conservative` | 500 | Prefer a legal safe bank and avoid unnecessary risk. |
| `normal` | 750 | Balance a useful round with a further roll. |
| `aggressive` | 1,100 | Seek larger rounds and accept more Zilch risk. |

Before a legal bank is compared, the policy adjusts that goal by the current
position only: a material 1,200-point deficit raises it by 150, an equivalent
lead lowers it by 150, one/two available dice lower it by 150, five/six dice
raise it by 100, and a non-confirmation Hot Dice adds 100. The result is
clamped to the confirmed 400-point bank floor and 1,800. It also treats a
required confirmation roll as mandatory, banks a reachable win when allowed,
and continues a final reply that would otherwise certainly lose. These are
documented decision heuristics, not scoring rules, secret odds, or a different
difficulty RNG. Quick Hold points remain the primary selection criterion;
strategy risk preference only resolves the presentation-equivalent choice.

CPU and human dice both call the same injectable server-side fair RNG function.
The runner has no separate random source, does not inspect future values, and
does not retry an unfavorable result. Its delay is operational pacing only:
`ROLLTHEDICE_ZILCH_CPU_DELAY_SECONDS` defaults to 0.55 seconds and is bounded
to 0–5 seconds. The active JSON state persists the CPU participant, strategy,
turn, boards, start roll, ruleset, and outcome, but never a task or timer. On
startup/rejoin, the lifecycle derives whether one unpaused CPU turn is due and
schedules it once; a human disconnect pauses the game and prevents CPU play
until the ordinary safe resume condition is met.

The existing typed Zilch finalizer stores the CPU in the same `zilch_result`
schema: `participant_type = cpu`, a historical display name and strategy, no
user ID, and its authoritative boards, rounds, scores, Zilchs, penalties, Hot
Dice, final reply, and outcome. That remains private and cannot enter ZDWA
results, statistics, achievements, leaderboards, or replay.

## Solo Sprint operation

A preview-authorized human can create `play_mode = solo` with exactly one
domain participant and one required human transport connection. The sole
currently offered objective is the immutable
`reach_10000_fewest_turns` objective at version 1. It has no client-selectable
parameters: score at least 10,000 under `zilch-house-v1`; future comparison
uses, in order, fewer turns, fewer rolls, fewer Zilchs, then shorter active
duration. There is no round limit, opponent, CPU, start roll, final reply, or
competitive winner/tie.

The normal Zilch engine remains unchanged. The player rolls, selects only
server-generated Quick Holds, rolls again or banks under the ordinary 300/400,
Hot Dice, confirmation-roll, and Zilch rules. After a bank or a Zilch, the
next turn belongs to that same participant. The pure
`app/zilch_solo_objective.py` observes only authoritative turn, roll, Hot Dice,
bank, and Zilch events; it cannot score dice, alter the RNG, or make gameplay
decisions. It writes a versioned objective envelope containing progress and
the authoritative metrics (turns, rolls, Zilchs, Hot Dice, highest banked
round, total points, and active duration).

Solo begins directly with the first normal turn. Reaching the objective ends
the run with `completed`; the participant may instead explicitly confirm an
`abandoned` run. Both outcomes are terminal and are idempotently persisted by
the existing typed Zilch finalizer. Active duration is measured server-side:
manual pause and restart/rejoin downtime are excluded, while active connected
play time is retained. Reload/rejoin restores the one participant, objective,
turn/version, dice and holds; no CPU runner is ever scheduled for a Solo game.
Its private report/history uses `zilch_solo_result` schema 2 and deliberately
shows no opponent, final reply, winner, tie, CPU strategy, or ZDWA aggregate.

## Private product UI

The protected Zilch app has a compact navigation for lobby, a remembered active
game, own completed games, private statistics, private leaderboards, rules,
shared account/settings, and the explicit return to ZDWA. The app-mode switch replaces the rendered game root rather than
mounting Zilch next to ZDWA; logout, session expiry, and loss of preview access
fall back to ZDWA. A normal account page can return to the private Zilch lobby
only after the session is still policy-authorized.

The lobby separates waiting, running/paused, and own completed games. A Zilch
room may use the existing optional room-code mechanism; a code stays in the
browser session only and is checked by the server on join/rejoin. Waiting and
start-roll states remain distinct from regular competitive gameplay.
Competitive games retain both boards; Solo has one board plus an objective and
progress card. In every mode, the six non-clickable dice, server-produced
Quick-Hold cards, roll/bank actions, hold/bank constraints, events, connection
state where applicable, and terminal outcome are projected only from the
authoritative snapshot.

The private UI uses scoped CSS variables for a warm wood table, paper-like
cards, deep dice, high-contrast hold/status states, large touch targets, and
short optional effects. It has a skip link, semantic navigation, keyboard
focus, live status announcements, responsive two-board layouts, and a
reduced-motion path. This is an independent direction, not a copy of Bubblebox
or another game's assets, sounds, fonts, code, logos, or layout.

The service worker never precaches Zilch pages or the Zilch JS/CSS bundles.
Protected `/zilch` navigation is network-only; this prevents an old cached
private shell from surviving logout or a policy change. The authorized shell
loads its versioned Zilch assets on demand.

## Verified repository architecture

- FastAPI composition and page/API routing live in `app/main.py`; authored
  browser modules live below `frontend/` and are built into `app/static/`.
- A single SQLAlchemy `User` and server-side `Session` model powers HTTP and
  WebSocket authentication. Admin is the exact role value `admin`; usernames
  have an immutable display form and a normalized lookup form.
- Live games are process-memory dictionaries restored from JSON in the
  `active_games` table. WebSocket players have a short game ID, optional
  account `user_id`, resume token, and process-local socket. Zilch keeps the
  separate durable participant list so a CPU participant has none of those
  transport fields.
- The WebSocket coordinator owns origin validation, session resolution,
  connection limits, action throttling, common session actions, and dispatch.
  Chat/reactions are reusable; ZDWA roll/write/correction/superadmin actions are
  game-specific.
- Completed-game rows now have a type discriminator. ZDWA's participants,
  legacy JSON leaderboards, statistics, replay snapshots, and achievements
  remain ZDWA-only; Zilch reads its separate versioned JSON result payload.
- Deployment is a single FastAPI container with SQLite and JSON data in the
  mounted `data` directory, fronted by nginx in production. Alembic migrations
  run before readiness; the guarded deploy script backs up persistent data.

## Consolidated planning sources and resolved tensions

This file consolidates the repository standards, `README.md`, the historical
account plan, and the recovered 3 September 2026 Zilch planning artifacts in
`Documents/Codex`. The recovered checklist remains useful detail; this file is
the repository-owned current status.

- The durable domain keeps `1 | 2` participant capacity and
  `solo | cpu | multiplayer` separate from connections. HTTP creation exposes
  exactly two authenticated humans for `multiplayer`, one authorized human and
  one server-owned CPU seat for `cpu`, or one authorized human with the
  versioned Solo Sprint objective for `solo`.
- The confirmed engine now powers the private browser flow. Quick Holds are
  the only selection method in this increment; manual dice selection and final
  interaction polish stay future work.
- Typed completion now preserves terminal recovery data until a result write
  succeeds. ZDWA aggregates remain explicitly type-filtered; Zilch exposes
  separate private history, results, statistics, and leaderboards.
- The current preview URLs are `/zilch`, `/zilch/spiel/{id}`,
  `/zilch/historie`, `/zilch/ergebnis/{id}`, `/zilch/statistiken`,
  `/zilch/bestenlisten`, and `/zilch/regeln`. They are `noindex`
  implementation routes, not committed public URLs.

## Master checklist

### Phase 0 — foundation and ZDWA protection (this branch)

- [x] Introduce validated `zdwa | zilch` game types and default legacy states
  without a marker to `zdwa`.
- [x] Route state creation, join/start hooks, snapshots, progress, and gameplay
  actions through a small registry while retaining existing ZDWA functions.
- [x] Keep account/session/auth, connection security, rejoin, chat, broadcast,
  timeout, and active persistence shared.
- [x] Protect Zilch page, list, detail, creation, room redirect, static page
  artifact, and WebSocket server-side for admin username `Mani` by default.
- [x] Keep Zilch out of **ZDWA** completed results, achievements, statistics,
  leaderboards, replay, public SEO registry, sitemap, and service-worker
  precache while allowing only its separate private result payload.
- [x] Model six dice, target 10,000, up to two separate boards, play modes,
  transport-independent participant types, and reserved CPU strategies.
- [x] Provide a separate DE/EN preview shell and safe app switch/hotkey.
- [x] Cover legacy restore, ZDWA modes, access matrix, API/WebSocket isolation,
  snapshot/dispatch boundaries, switch/logout/direct URLs, and regressions.

### Phase 1 — rule decision record (Manuel confirmed)

- [x] Confirm the base scoring table: single 1 = 100, single 5 = 50, three 1s
  = 1,000, and other triples = face value × 100.
- [x] Decide four/five/six of a kind, straight, three pairs, two triples, and
  every other special combination.
- [x] Decide entry threshold and any minimum bank threshold.
- [x] Decide Hot Dice, mandatory scoring selection after a roll, and whether a
  scoring group may be split.
- [x] Decide Zilch behavior, victory at exactly/at least 10,000, final reply,
  ties, and turn order.
- [x] Decide whether score entry is calculated only, manual, or a separate
  audited correction path.
- [x] Define the first true Solo objective as
  `reach_10000_fewest_turns` version 1, without coupling the engine to future
  challenge variants.

### Phase 2 — authoritative Zilch engine

- [x] Specify commands/events and invariants for roll, immutable hold, bank,
  Zilch, Hot Dice, turn transition, and completion.
- [x] Use one server-authoritative RNG path for every participant; CPUs must
  never receive altered odds.
- [x] Return deterministic scoring choices keyed by dice IDs and validate every
  client selection again on the server.
- [x] Add exhaustive unit/integration tests for combinations, stale commands,
  illegal holds, turn ownership, thresholds, banking, and terminal states.
- [x] Build private DE/EN Quick-Hold controls, two-player boards, status
  states, opening roll, reconnect/reload projection, and reduced-motion-safe
  Alpha presentation.
- [ ] Add accessible manual dice selection. The private in-app rules guide does
  not change the decision that no public Zilch rules page exists.

### Phase 3 — modes and participants

- [x] Finish private human-vs-human play for two participants, including join,
  versioned opening roll, Quick Holds, banking, turn changes, final reply,
  terminal result, and simultaneous boards.
- [x] Add a private Solo lifecycle with one human participant, a versioned
  objective envelope, direct first turn, no CPU/opponent/final reply, and
  server-owned progress/metrics.
- [x] Add a private human-vs-CPU lifecycle without fake accounts or sockets.
  Strategy changes decisions only and considers score, dice remaining,
  opponent score, confirmation/Hot-Dice state, and endgame context while using
  the exact same server RNG and engine actions.
- [x] Test reload/rejoin independently from participant/turn persistence.

### Phase 4 — typed completion and account features

- [x] Add a `game_type` and versioned Zilch payload migration to
  completed/deleted games with deterministic `zdwa` backfill and guarded
  ZDWA-only rollback.
- [x] Split result projection and every ZDWA leaderboard/statistics query by
  game type before allowing private Zilch completion.
- [x] Persist participant type and optional account assignment in the Zilch
  payload without making `user_id` mandatory.
- [x] Provide idempotent recovery plus a protected, read-only Zilch report and
  minimal own-history list.
- [x] Calculate private Zilch-only personal statistics and separated
  leaderboards from validated completed result payloads, without a ZDWA
  aggregate path.
- [ ] Add Zilch achievements from confirmed rules; never reuse ZDWA achievement
  evaluation.

### Phase 5 — productization and release

- [x] Complete the private accessible mobile/desktop product surface: app-mode
  navigation, lobby, waiting/start-roll state, live game, history, result,
  rule guide, keyboard operation, reduced motion, and reconnect/error states.
- [ ] Replace the temporary `Mani` policy with an explicit feature flag or
  entitlement and test staged rollout/rollback.
- [ ] Decide permanent URLs and SEO status only when the feature is public.
- [ ] Run a production backup/restore rehearsal, then lint, full backend and
  browser suites, asset consistency, and production smoke checks.

## Foundation acceptance and rollback

Acceptance requires unchanged ZDWA create/join/rejoin/roll/write/chat/finish
behavior; an explicit game type in every saved state; complete denial of Zilch
data to unauthorized users; distinct Zilch state/actions/snapshots; typed,
idempotent finalization; and no Zilch result entering ZDWA aggregates. Removing
the Zilch routes/switch and registry entry disables the preview; existing active
snapshots remain readable because untyped states default to ZDWA. Schema
rollback is permitted only while no Zilch result/tombstone exists; otherwise a
compatible database backup is required.
