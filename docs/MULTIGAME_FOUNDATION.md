# Multi-Game Foundation: ZDWA and Zilch

This document describes the multi-game boundary introduced for ZDWA and the
internal Zilch preview. The binding Zilch house rules live in
[ZILCH_RULES.md](ZILCH_RULES.md); neither document is a public player-facing
rule page or a promise of a finished Zilch user interface.

The current private increment is a playable **human-vs-human Alpha** with a
private, read-only completed-result report. It is not a public release and it
deliberately remains outside ZDWA results, statistics, leaderboards,
achievements, and replay views.

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
  distinct from WebSocket connections. This Alpha exposes only
  `multiplayer`, exactly two authenticated human participants, and no
  spectators. Solo and CPU remain represented only as future domain contracts;
  CPU strategy names (`conservative | normal | aggressive`) are not a bot
  implementation. Its UI is a separate route/root with its own stylesheet
  boundary (`data-game="zilch"`), six server-snapshot dice, and no manual
  dice-selection affordance. Completed games have their own versioned
  `zilch-house-v1` payload and private result/history projection.

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

The same policy drives switch visibility and the protected `/zilch` routes,
creation, lobby/history/result APIs, and every WebSocket connection/action. The
raw `/static/zilch.html` artifact is denied. Zilch is not in the public SEO
registry or sitemap and its shell is `noindex`.

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
SQL readers explicitly filter `game_type = zdwa`. Zilch uses a separate
`zilch_result` payload at schema version 1 with its ruleset, timestamps,
participants, start-roll attempts, both boards and round histories, penalties,
final-round state, outcome, and only reliable derived metrics. It is visible
only through protected `/api/zilch/results` endpoints and
`/zilch/ergebnis/{game_id}`; it never enters the ZDWA replay renderer or any
ZDWA aggregate.

SQLite receives native non-null type columns plus INSERT/UPDATE validation
triggers because rebuilding a populated parent table would risk cascading its
participant rows. The downgrade is intentionally guarded: it works for
ZDWA-only data, but aborts before removing the discriminator if any Zilch
completed result or tombstone exists. Restore a compatible backup instead of
silently discarding Zilch history.

## Zilch rule contract and engine boundary

[ZILCH_RULES.md](ZILCH_RULES.md) records the confirmed score table, holds,
Hot Dice, confirmation rolls, Zilch behavior, start roll, banking threshold,
final reply, tie, and manual-score decisions. `app/zilch_engine.py` implements
those rules as a pure domain module. Its inputs/outputs are serializable data;
it does not import FastAPI, WebSockets, browser state, database models, ZDWA's
five-dice engine, or ZDWA scoring.

`zilch_gameplay.py` is only the adapter: it validates authenticated WebSocket
turn/version/option references, calls the pure engine, synchronizes the Zilch
live state, then broadcasts through the shared coordinator. A visible,
versioned `zilch_start_roll` action records one server-generated die per
participant and repeats ties before the first regular turn. `zilch_roll_dice`,
`zilch_select_hold`, and `zilch_bank_points` are authoritative actions.
`zilch_submit_score` remains an explicit rejected compatibility action because
manual score entry was ruled out for this phase.

The browser does not calculate scores or invent dice. It renders structured
Quick Holds from `_zilch_quick_holds`, sends their turn/version/roll/option
references, and waits for the next server snapshot. Both player boards,
opening-roll history, current unbanked score, Zilch streak, connection state,
Hot Dice/confirmation state, and final-reply markers are projected together.

The remaining product decisions are deliberately narrower: the exact penalty
cadence after a fourth or later consecutive Zilch, CPU decisions, a meaningful
solo objective, manual dice interaction, final branding/polish, Zilch
statistics/achievements, and public release.

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

The Alpha uses a CSS-only warm wood table, paper-like action cards, deep dice,
and high-contrast selection/status markers. This is an independent direction,
not a copy of Bubblebox or another game's assets, sounds, fonts, code, logos,
or layout.

## Verified repository architecture

- FastAPI composition and page/API routing live in `app/main.py`; authored
  browser modules live below `frontend/` and are built into `app/static/`.
- A single SQLAlchemy `User` and server-side `Session` model powers HTTP and
  WebSocket authentication. Admin is the exact role value `admin`; usernames
  have an immutable display form and a normalized lookup form.
- Live games are process-memory dictionaries restored from JSON in the
  `active_games` table. WebSocket players have a short game ID, optional
  account `user_id`, resume token, and process-local socket.
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
  `solo | cpu | multiplayer` separate from connections. HTTP creation in this
  Alpha is intentionally narrower: exactly two authenticated humans.
- The confirmed engine now powers the private browser flow. Quick Holds are
  the only selection method in this increment; manual dice selection and final
  interaction polish stay future work.
- Typed completion now preserves terminal recovery data until a result write
  succeeds. ZDWA aggregates remain explicitly type-filtered; Zilch exposes
  only private per-user history and a read-only report.
- The current preview URLs are `/zilch`, `/zilch/spiel/{id}`, and the private
  `/zilch/ergebnis/{id}`. They are `noindex` implementation routes, not
  committed public URLs.

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
- [ ] Decide the purpose and success metric of true solo play.

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
- [ ] Add accessible manual dice selection; no public Zilch rules page exists
  until the preview is productized.

### Phase 3 — modes and participants

- [x] Finish private human-vs-human play for two participants, including join,
  versioned opening roll, Quick Holds, banking, turn changes, final reply,
  terminal result, and simultaneous boards.
- [ ] Define solo objectives without coupling the engine to one metric; store
  a challenge/ruleset identifier rather than hard-coding “reach 10,000”.
- [ ] Add CPU lifecycle without fake accounts or sockets. CPU difficulty may
  change decisions only and may consider score, dice remaining, opponent
  score, and endgame context.
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
- [ ] Design Zilch-specific statistics and achievements from confirmed rules;
  never reuse ZDWA achievement evaluation.

### Phase 5 — productization and release

- [ ] Complete accessible mobile/desktop UX, keyboard operation, reduced
  motion, error states, reconnect behavior, and browser coverage.
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
