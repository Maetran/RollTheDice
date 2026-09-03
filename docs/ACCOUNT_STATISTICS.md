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

## Private Zilch statistics and leaderboards

Zilch has a deliberately separate, private calculation path. It does not
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
raw result payloads. The private preview scale does not justify an aggregate
table or cache. A future cache must remain rebuildable from `CompletedGame`
and invalidate Zilch tombstones.

`GameParticipant.user_id` is the primary identity for personal statistics and
leaderboards; a stored display name exists only for historical result reading.
CPU seats have no user ID and never get a user statistic or leaderboard entry.
Only active accounts appear in the private leaderboards. Deleted or inactive
accounts remain readable by their historical name in a permitted result report
but are excluded from ranking identities.

### Personal statistics

`GET /api/zilch/statistics` uses the authenticated preview user's session only;
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
is the server-stored duration with pause and restart downtime excluded.

### Private leaderboards

`GET /api/zilch/leaderboards` accepts only a validated category, optional CPU
strategy, offset, and a bounded limit (maximum 100). Its response contains no
raw result payload, session, or connection data. All calls require the same
Zilch preview policy as gameplay and use `Cache-Control: no-store`.

| Category | Eligible records | Ordering |
| --- | --- | --- |
| `solo_sprint` | completed `reach_10000_fewest_turns` v1 runs | fewest turns, rolls, Zilchs, active duration, then older completion |
| `multiplayer_wins` | Human-vs-Human only | most wins; then fewer losses, more ties, higher final score, higher banked round |
| `cpu_wins` | Human-vs-CPU for one selected strategy | most wins against that strategy; then fewer losses, more ties, higher final score, higher banked round |

The public UI lists the best compatible Solo run per active account, so one
account cannot fill the table with repeated runs. CPU tables remain separate
for `conservative`, `normal`, and `aggressive`; no cross-difficulty rank is
created. All three use Competition Ranking (`1, 2, 2, 4`) and show at most the
top 100 entries by default. The API and table expose every rank-affecting
value. A completion timestamp is the final stable Solo tie-break; a user ID
only settles an otherwise fully equal presentation order.

Deleting a typed Zilch result creates a `DeletedGame` tombstone with
`game_type = 'zilch'` and removes its `CompletedGame` row in one transaction.
On-read aggregation therefore drops it immediately. The generic deletion route
does not run ZDWA JSON cleanup or achievement synchronization for Zilch, and
there is no restore workflow today.
