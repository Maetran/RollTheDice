# Multi-Game Foundation: ZDWA and Zilch

This document describes the multi-game boundary introduced for ZDWA and the
internal Zilch preview. The binding Zilch house rules live in
[ZILCH_RULES.md](ZILCH_RULES.md); neither document is a public player-facing
rule page or a promise of a finished Zilch user interface.

## Boundaries

- **Shared:** accounts, normalized usernames, session cookies, roles, player
  identity, chat, WebSocket transport, join/rejoin lifecycle, broadcasts,
  connection state, timeout handling, and active-game persistence.
- **ZDWA:** the existing five-dice state, ZDWA join/start details, scoring
  engine, scorecards, suggestions, superadmin edit mode, final results,
  leaderboards, statistics, and achievements.
- **Zilch:** a separate state factory, six dice, target score 10,000, a one- or
  two-participant limit, independent player boards, snapshot projection, and a
  pure server-side scoring/turn engine. Play mode (`solo | cpu | multiplayer`)
  and participant type (`human | cpu`) are distinct from WebSocket connections.
  Only human solo and human-vs-human creation are exposed today; CPU strategy
  names (`conservative | normal | aggressive`) are a future decision contract,
  not a bot implementation. Its UI is a separate route/root with its own
  stylesheet boundary (`data-game="zilch"`) and remains a deliberately
  provisional shell.

`app/game_registry.py` is the intentionally small composition point. It
selects state creation, per-game join/start setup, gameplay-action dispatch,
progress projection, and snapshots by a centrally validated `zdwa | zilch`
type. Legacy active snapshots without `_game_type` are restored as `zdwa`.

## Preview access

`app/game_access.py` is the sole policy location for Zilch preview access. It
requires a valid resolved session, `identity.is_admin`, and a normalized
username of `mani`. The policy is applied by the protected `/zilch` routes,
Zilch creation, lobby filtering, detail APIs, and before any protected
WebSocket frame is sent. Zilch is not in the public SEO registry and its page
uses `noindex`.

## Completion boundary

No `CompletedGame.game_type` migration is included in this foundation. The
real persistence path currently persists directly into ZDWA's result history,
statistics, leaderboards, and achievement calculations. Because Zilch has no
completion rules yet, it never enters that path; defensive guards reject a
non-ZDWA completion attempt. A later Zilch completion branch must introduce a
typed completed-game model/migration and explicitly separate all aggregates
before enabling finalization.

## Zilch rule contract and engine boundary

[ZILCH_RULES.md](ZILCH_RULES.md) records the confirmed score table, holds,
Hot Dice, confirmation rolls, Zilch behavior, start roll, banking threshold,
final reply, tie, and manual-score decisions. `app/zilch_engine.py` implements
those rules as a pure domain module. Its inputs/outputs are serializable data;
it does not import FastAPI, WebSockets, browser state, database models, ZDWA's
five-dice engine, or ZDWA scoring.

`zilch_gameplay.py` is only the adapter: it validates authenticated WebSocket
turn/version/option references, calls the pure engine, synchronizes the Zilch
live state, then broadcasts through the shared coordinator. `zilch_roll_dice`,
`zilch_select_hold`, and `zilch_bank_points` are authoritative actions.
`zilch_submit_score` remains an explicit rejected compatibility action because
manual score entry was ruled out for this phase.

The remaining product decisions are deliberately narrower: the exact penalty
cadence after a fourth or later consecutive Zilch, CPU decisions, a meaningful
solo objective, manual dice interaction, final tactile UI, typed completed-game
persistence, Zilch stats/achievements, and public release.

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
- Completed games, participants, legacy JSON leaderboards, statistics, replay
  snapshots, and achievements currently encode ZDWA semantics. They therefore
  remain outside Zilch until typed completion is introduced.
- Deployment is a single FastAPI container with SQLite and JSON data in the
  mounted `data` directory, fronted by nginx in production. Alembic migrations
  run before readiness; the guarded deploy script backs up persistent data.

## Consolidated planning sources and resolved tensions

This file consolidates the repository standards, `README.md`, the historical
account plan, and the recovered 3 September 2026 Zilch planning artifacts in
`Documents/Codex`. The recovered checklist remains useful detail; this file is
the repository-owned current status.

- Earlier wording treated `1 | 2` as the Zilch mode. That remains only the
  currently exposed creation choice. The durable domain distinguishes
  `solo | cpu | multiplayer`, and a participant is not required to be an
  authenticated user or WebSocket connection.
- Earlier scope language mentioned a basic playable Zilch turn. That was held
  back until the house rules were confirmed. The rules engine is now complete
  for the internal contract, while the preview shell intentionally remains
  separate and non-final rather than becoming a premature design project.
- A completed-game migration was suggested as an option. It is intentionally
  deferred because no Zilch completion can occur and all current aggregates are
  ZDWA-specific. The defensive boundary rejects non-ZDWA finalization.
- The current preview URL is `/zilch` with rooms below `/zilch/spiel/{id}`.
  It is a private, `noindex` implementation route, not a committed public URL.

## Master checklist

### Phase 0 — foundation and ZDWA protection (this branch)

- [x] Introduce validated `zdwa | zilch` game types and default legacy states
  without a marker to `zdwa`.
- [x] Route state creation, join/start hooks, snapshots, progress, and gameplay
  actions through a small registry while retaining existing ZDWA functions.
- [x] Keep account/session/auth, connection security, rejoin, chat, broadcast,
  timeout, and active persistence shared.
- [x] Protect Zilch page, list, detail, creation, room redirect, static page
  artifact, and WebSocket server-side for admin username `Mani` only.
- [x] Keep Zilch out of completed results, achievements, statistics,
  leaderboards, public SEO registry, sitemap, and service-worker precache.
- [x] Model six dice, target 10,000, up to two separate boards, play modes,
  transport-independent participant types, and reserved CPU strategies.
- [x] Provide a separate DE/EN preview shell and safe app switch/hotkey without
  implementing rules or final design.
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
- [ ] Build the tactile DE/EN controls and accessible manual dice selection;
  no public Zilch rules page exists until the preview is productized.

### Phase 3 — modes and participants

- [ ] Finish human-vs-human play for two participants and keep both boards
  visible at once.
- [ ] Define solo objectives without coupling the engine to one metric; store
  a challenge/ruleset identifier rather than hard-coding “reach 10,000”.
- [ ] Add CPU lifecycle without fake accounts or sockets. CPU difficulty may
  change decisions only and may consider score, dice remaining, opponent
  score, and endgame context.
- [ ] Test disconnect/rejoin independently from participant/turn persistence.

### Phase 4 — typed completion and account features

- [ ] Add a `game_type` (and, if required, ruleset/version) migration to
  completed/deleted games with deterministic `zdwa` backfill and rollback.
- [ ] Split result projection and every leaderboard/statistics query by game
  type before allowing Zilch completion.
- [ ] Persist participant type and optional account assignment without making
  `user_id` mandatory.
- [ ] Design Zilch-specific statistics and achievements from confirmed rules;
  never reuse ZDWA achievement evaluation.

### Phase 5 — productization and release

- [ ] Complete accessible mobile/desktop UX, keyboard operation, reduced
  motion, error states, reconnect behavior, and browser coverage.
- [ ] Replace the temporary `Mani` policy with an explicit feature flag or
  entitlement and test staged rollout/rollback.
- [ ] Decide permanent URLs and SEO status only when the feature is public.
- [ ] Run migration rehearsal and restore test, then lint, full backend and
  browser suites, asset consistency, and production smoke checks.

## Foundation acceptance and rollback

Acceptance requires unchanged ZDWA create/join/rejoin/roll/write/chat/finish
behavior; an explicit game type in every saved state; complete denial of Zilch
data to unauthorized users; distinct Zilch state/actions/snapshots; and no
Zilch result entering ZDWA aggregates. Removing the Zilch routes/switch and
registry entry disables the preview; existing active snapshots remain readable
because untyped states default to ZDWA. No database migration is part of this
branch, so schema rollback is unnecessary.
