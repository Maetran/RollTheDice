# Account statistics data model

Account statistics are derived from completed games in SQLite. Normal and
Hardcore are separate statistical populations; only game counts and point sums
may be combined.

## Stored data

`completed_games` represents completed games. Its relevant fields are:

| Meaning | Field |
| --- | --- |
| Primary key | `id` |
| Public game identifier | `game_id` |
| Completion timestamp | `finished_at` |
| Player-count/team mode | `mode` (`1`, `2`, `3`, or `2v2`) |
| Statistical population | `hardcore` (`false` = Normal, `true` = Hardcore) |
| Completion status | Membership in `completed_games`; active games use a different table |

Scores and account relations are stored in `game_participants`:

| Meaning | Field |
| --- | --- |
| Primary key | `id` |
| Completed-game relation | `game_id` → `completed_games.id` |
| Account relation | `user_id` → `users.id` |
| Score | `points` |

No schema change or migration is required. `hardcore` is non-nullable and is
set when runtime games and legacy leaderboard records are persisted.

## Aggregation and API

- `app/api_users.py::_statistics_for_user` calculates account totals and the
  separate Normal and Hardcore buckets.
- `GET /api/users/me/statistics` supplies the account statistics.
- `GET /api/users/me/game-history?mode=normal|hardcore|all&limit=10|50|100|all`
  supplies the chart and matching recent-games list.
- `app/static/account.html` renders filters, summaries, chart datasets, and the
  filtered game list.

History queries filter by `hardcore` before applying the selected limit. They
sort by `finished_at DESC, completed_games.id DESC`; the client reverses the
result only for the chart's oldest-to-newest time axis.

## Existing-data audit

The pre-implementation read-only audit found no ambiguous completed games:

| Database | Completed | Normal | Hardcore | Missing mode |
| --- | ---: | ---: | ---: | ---: |
| Local development data | 21 | 11 | 10 | 0 |
| Production at implementation time | 189 | 176 | 13 | 0 |

Historical scores are not migrated, recalculated, or rewritten by this change.

## Separate Zilch statistics and leaderboards

Zilch has a deliberately separate calculation path. Personal statistics and
result history remain account-bound even though public Zilch is available to
guests and active accounts. Guest games intentionally have no account identity
and therefore never create a personal statistic, leaderboard row, or award.
The calculation does not
reuse ZDWA scorecards, `stats.json`, the public leaderboard JSON files,
achievement metrics, or public player-profile APIs.

The sole source of truth is a completed SQLite row with
`completed_games.game_type = 'zilch'` and a successfully validated Zilch
payload:

- competitive Human-vs-Human and Human-vs-CPU records use
  `zilch_result`, schema version 1;
- Solo Sprint records use `zilch_solo_result`, schema version 2;
- unknown, malformed, or incomplete payloads are logged and skipped rather
  than being converted to zero-valued statistics.

The calculation runs on read in `app/zilch_statistics.py`. The source query
filters by game type before payload validation and is read in bounded database
pages; API responses use a maximum leaderboard page size of 100 and never send
raw result payloads. The current data volume does not justify an aggregate
table or cache. A future cache must remain rebuildable from `CompletedGame`
and invalidate Zilch tombstones.

`GameParticipant.user_id` is the primary identity for personal statistics and
leaderboards; a stored display name exists only for historical result reading.
CPU seats have no user ID and never get a user statistic or leaderboard entry.
Only active accounts appear in the Zilch leaderboards. Deleted or inactive
accounts remain readable by their historical name in a permitted result report
but are excluded from ranking identities.

### Personal statistics

`GET /api/zilch/statistics` uses the authenticated user's session only;
it accepts no user ID. It returns separate overview, Human-vs-Human,
Human-vs-CPU (overall and per strategy), and Solo sections. The overview
combines only additive/comparable metrics: finished records, mode counts,
banked points and rounds, highest/average banked round, Zilchs, recorded
penalties, reliably known Hot Dice, and stored duration. It intentionally has
no cross-mode win rate.

For competitive modes, a victory rate is
`wins / (wins + losses)`. Ties are reported separately and excluded from the
denominator; if no decisive game exists, the value is unavailable. Historic
Hot Dice is unavailable instead of `0` if a schema-1 loss lacks the committed
hold data needed to count it. Averages only use records that contain the
relevant metric and are rounded in the server projection.

Solo statistics keep only compatible Objective ID/version comparisons.
`reach_10000_fewest_turns` v1 distinguishes completed from abandoned runs;
abandoned runs appear in personal totals but never in ranking. Active duration
is the server-stored duration with pause and restart downtime excluded. For a
terminal recovery from the known historical timer overcount, an active duration
above the complete wall-clock duration is conservatively capped to that wall
duration; the recovery can therefore never improve a leaderboard position.

### Zilch leaderboards

`GET /api/zilch/leaderboards` accepts only a validated category, optional CPU
strategy, offset, and a bounded limit (maximum 100). Its response contains no
raw result payload, session, or connection data. Guests may read the public
tables; only the signed-in caller can receive an `own_entry`. Responses use
`Cache-Control: no-store`.

| Category | Eligible records | Ordering |
| --- | --- | --- |
| `solo_sprint` | completed `reach_10000_fewest_turns` v1 runs | fewest turns, rolls, Zilchs, active duration, then older completion |
| `multiplayer_wins` | Human-vs-Human only | most wins; then fewer losses, more ties, higher final score, higher banked round |
| `cpu_wins` | Human-vs-CPU for one selected strategy | most wins against that strategy; then fewer losses, more ties, higher final score, higher banked round |

The public Zilch UI lists the best compatible Solo run per active account, so one
account cannot fill the table with repeated runs. CPU tables remain separate
for `conservative`, `normal`, and `aggressive`; no cross-difficulty rank is
created. All three use Competition Ranking (`1, 2, 2, 4`) and show at most the
top 100 entries by default. The API and table expose every rank-affecting
value. A completion timestamp is the final stable Solo tie-break; a user ID
only settles an otherwise fully equal presentation order.

Deleting a typed Zilch result creates a `DeletedGame` tombstone with
`game_type = 'zilch'` and removes its `CompletedGame` row in one transaction.
On-read aggregation therefore drops it immediately. The generic deletion route
does not run ZDWA JSON cleanup or ZDWA achievement synchronization for Zilch.
It invokes the Zilch-specific award cleanup described below; there is no restore
workflow today.

## Zilch awards and player context

Zilch awards are a separate namespace. They are not ZDWA
achievements and do not reuse the ZDWA achievement catalog or rollout markers.
Personal goals award 1–10 Zilch points and feed a separately calculated
Zilch-rank ladder; they never add **Ehrenberg-Marken**, alter a ZDWA title or
stars, or enter a public ZDWA profile/ranking. Zilch recognition remains
visible only within the Zilch product context. The account collection remains
private; a public, noindex player view exposes only safe award metadata.

### Source of truth and eligibility

The source chain starts with an authoritative, successfully persisted
`CompletedGame` row with `game_type = 'zilch'` and a known, strictly validated
Zilch result payload. The Zilch finalizer explicitly registers that new result
as a post-rollout evaluation work item in `zilch_achievement_evaluations`.
Only such registered work items are eligible: recovery processes pending work
items, never the historic `CompletedGame` population. After payload validation,
`zilch_achievement_evidence` stores the narrow server-derived facts for each
eligible human participant, and `zilch_achievement_unlocks` is the durable
namespaced outcome. Live snapshots, browser counters, WebSocket notices,
private statistic aggregates, and leaderboard projections are not sources of
truth. A CPU seat cannot receive an account award.

The original rollout is deliberately forward-only without a retrospective
database scan. Existing Zilch history is not registered or backfilled, even if
its payload would otherwise meet a condition. A later versioned catalog update
may synchronize new definitions from the narrow evidence that the original
rollout already registered. For each completed, non-tombstoned registration it
may load exactly that registration's still-present typed `CompletedGame` source
by game ID and enrich only the existing evidence after validating its source,
seat, user mapping, metadata, and every already stored fact. Evaluations drive
this bounded lookup; the service never enumerates, discovers, or imports the
ordinary historic `CompletedGame` population. A mismatch fails closed and
rolls back both evidence changes and the catalog-version marker.

### Delivery, acknowledgement, and revocation

After evaluation has durably unlocked an award, the server creates one private
`zilch_achievement_deliveries` row for it. Delivery is idempotent per unlock,
so terminal-state recovery or a browser reload cannot create a duplicate. The
pending-delivery API is only a presentation queue. A client acknowledgement
sets `acknowledged_at`; it neither grants an award nor changes its eligibility.
The authoritative result, registered evaluation, validated evidence, and
server-side unlock remain decisive.

`zilch_achievement_rank_deliveries` separately retains each account's latest
genuine upward Zilch-rank transition. The pending-delivery response derives it
from the authoritative, chronological unlock collection and queues it exactly
once after the individual award cards. This deliberately gives players who
already had a rank before the card existed one retrospective presentation on
their next private Zilch visit, without scanning completed-game history or
creating an award. A newer upward tier replaces the row and requires a fresh
acknowledgement; revocation removes or recalculates a stale transition on the
next private delivery read.

Deleting a Zilch result calls the Zilch-specific cleanup for its source game.
It removes the normalized evidence and evaluation, synchronizes affected
private Zilch accounts, and removes any unlock that no longer has supporting
evidence; the delivery then disappears through its unlock foreign key. The
next private profile/pending-delivery response consequently presents that award
as locked or absent, rather than leaving a historical Zilch award visible. The
deletion must not call ZDWA achievement synchronization, alter ZDWA aggregate
JSON, or change Ehrenberg-Marken/title data. There is no restore workflow:
restoring a backup is the only supported way to recover a deleted source result
and its private award state.

If this post-delete cleanup is interrupted after the typed deletion transaction
has committed, a bounded recovery reads only `DeletedGame(game_type='zilch')`
tombstones that still reference Zilch award state. It removes stale evidence;
it never scans ordinary completed results and can therefore never act as a
retrospective unlock backfill.

### Account and public views

`/zilch/erfolge` is the account collection. `/zilch/spieler/{username}` is a
public, noindex Zilch-context player view. It never exposes ZDWA achievements,
result URLs, source game IDs, evidence IDs, queue timestamps, or acknowledgement
timestamps. Historical display names may remain readable in a permitted result
report, but deleted/inactive accounts and CPU seats are not award identities.

`GET /api/zilch/results` lists only rows linked to the current account through
`GameParticipant.user_id`. `GET /api/zilch/results/{game_id}` and the matching
result page require the current account to be a linked human participant and
return an opaque 404 otherwise. The HTTP history/detail projection omits
internal `user_id` values; ownership decisions use the relational database link,
never a client parameter or the persisted JSON identity.

Unknown payload schemas, malformed/incomplete result data, results before the
Zilch award rollout that were never registered, and deleted results deliberately
produce no award claim. Older result schemas can also lack an event or metric needed for a
future category; such data is reported as unavailable rather than inferred or
reconstructed from client state. Zilch awards have no public aggregate and no
retrospective scan of unregistered results. Their cross-game points and rank
are projections of durable Zilch unlock keys, not stored browser values.

### Version-2 catalog, points, ranks, and APIs

All keys are namespaced as `zilch.*` and are versioned separately from the
ZDWA catalog. The expanded catalog contains 74 conditions supported by
validated result evidence. It includes the original milestones plus cumulative
games/wins/banked points, 2,500–5,000-point rounds, Hot-Dice streaks, high-risk
recoveries, close and decisive human wins, 1,000/2,000/3,000-point comebacks,
start-roll reversals, fast human-vs-human finishes, Solo turn/roll targets,
four-, five-, and six-of-a-kind groups, 11,000–15,000 final scores,
twenty-Zilch games, and competitive marathon wins.

Point values are immutable catalog metadata. The possible positive-point total
is derived from that catalog, and the ten familiar rank names are scaled from
the same proportional thresholds as ZDWA while remaining a different score.
Deleting a personal source immediately changes the projected Zilch points and
rank if an award is revoked.

Five additional `zilch.community_games_*` milestones track 100, 500, 1,000,
5,000, and 10,000 qualified completed Zilch games globally. Each game enters a
unique ledger once, regardless of player count. At a threshold, the server
atomically freezes recipients to active accounts that already completed at
least one qualified Zilch game. Later accounts do not inherit the old award.
Community awards are always worth 0 points and are not revoked if an old
triggering result is later deleted; they document a shared moment rather than
an individual result. A separate per-game account-participant ledger keeps that
minimum-one-game eligibility stable even when mutable result evidence is later
removed. At the version-2 rollout, revision `20260904_0019` reconstructs already
reached thresholds at the exact Nth explicitly registered evidence source,
excludes typed deletion tombstones, and freezes recipients from qualifying
account seats at or before that ordinal. Startup then performs one atomic,
versioned resynchronization from those isolated evidence/recipient tables. Its
internal version-3 pass additionally enriches only completed, non-tombstoned
registrations from their exact typed source loaded by game ID. It does not
enumerate `CompletedGame`; validation failure rolls back the evidence and
catalog marker together.

Account-only APIs are `GET /api/zilch/achievements`,
`GET /api/zilch/achievements/pending`, and
`POST /api/zilch/achievements/{key}/acknowledge`, plus
`POST /api/zilch/achievement-rank/acknowledge` for the currently pending rank
card. Guests may read the safe
`GET /api/zilch/players/{username}/achievements`, the rank ladder at
`GET /api/zilch/achievement-ranks`, and
`GET /api/zilch/leaderboards?category=achievement_points`. Public projections
remove all award provenance and delivery state; the player endpoint therefore
does not disclose a result or become a general account-profile API.
