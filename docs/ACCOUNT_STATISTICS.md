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
