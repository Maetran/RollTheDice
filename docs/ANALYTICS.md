# Mission Control

Private operations dashboard: `https://zockdiewandan.online/admin/dashboard`.
No separate service, database, public endpoint for statistics, or subdomain.

Access is account-ID based. The founder always has access. In Administration
→ Users → Access rights, the founder grants or revokes dashboard access for
each account independently of role. Other admins, owners and dashboard readers
cannot delegate it. Inactive accounts cannot enter. Each dashboard API request
checks the current database permission; a revoked reader loses access without
needing to sign out. All dashboard documents are `noindex` and `no-store`.

## Measurement

- Anonymous tab sessions expire after 30 minutes of inactivity; they do not
  identify unique people or stitch activity between devices.
- Page categories replace usernames, room and result IDs. Query strings,
  fragments, tokens, entered text, and chat content are never stored.
- Page views, visible and recently active seconds, fixed click action names,
  broad device classes, source hostnames, and optional country codes are
  recorded in bounded batches. DNT/GPC disables browser analytics.
- Countries are accepted only from a trusted Cloudflare peer. Sources:
  [IPv4](https://www.cloudflare.com/ips-v4),
  [IPv6](https://www.cloudflare.com/ips-v6). Direct/untrusted requests have
  unknown location; no external per-visitor location lookup is performed.
- Browser events describe use of the interface. Completed game metrics derive
  authoritative persisted results, including eligible historical results.
  Created rooms are recorded only after the server accepts creation.
- Offline games are not tracked. Admin, dashboard and authentication pages are
  excluded; account pages use only the anonymous `/konto` category and fixed
  tab names. Measurement starts with this rollout and may undercount when
  browser tracking is blocked. Events expire after 90 days; a 200,000-event cap
  can shorten the available history during sustained high traffic.
- Filters use UTC calendar days: today (UTC), or today and the preceding
  6, 29 or 89 days. They are not rolling 24-hour windows.

## Visual analysis

- Globe and world map use locally bundled public-domain Natural Earth geometry.
  Source hashes and preparation instructions are in
  [the geography asset notes](../frontend/dashboard/GEOGRAPHY.md).
  The map does not request any external map service. Country markers aggregate
  measured tab visits at a representative country coordinate; they are not
  live people, cities, GPS positions or per-visitor locations. Unknown origin
  remains in the totals and country list, without an invented map location.
- Country details show visits, page views, active seconds and the games used
  by those anonymous tab visits. A tab can visit both games, so per-game
  visit counts may overlap.
- The activity heatmap groups events by UTC weekday and hour in the selected
  period. It describes aggregated activity, not a single week's chronology.
  Visits are distinct within each cell and can appear in several cells; adding
  all cell visits does not produce the total number of visits.
- Page journeys count consecutive, distinct page categories in the same
  anonymous tab, with gaps over 30 minutes breaking the sequence. They use
  at most the latest 10,000 page-view events and disclose sampling. They are
  observed navigation paths, not conversion or completion rates.
- Comparisons use the preceding equally sized UTC calendar period. The
  current UTC day is still incomplete; new measurements and retention limits
  can mean that the previous period has no comparable data.
  Coverage describes the earliest retained client event, not a guarantee that
  browser measurement was continuous or captured every visitor.
- Page engagement combines views, tab visits and active visible time.
  Browser blocking and excluded private/authentication pages may leave gaps.
- Decorative motion is separate from counts. Pause controls and the browser's
  reduced-motion preference stop continuous animation. Globe rendering pauses
  when hidden or offscreen.

## Server counters

Compose mounts only `/proc/stat`, `/proc/meminfo`, `/proc/loadavg` and
`/proc/uptime` read-only under `/host/proc`, without exposing host process
directories. There is no Docker socket or elevated container privilege.
These four counters supply host CPU, RAM, load and uptime.
Disk figures describe the filesystem backing `/app/data`; application uptime
is independent of host uptime. Missing counters remain visibly unavailable.
The dashboard refreshes every 30 seconds and pauses while hidden.
Server trend lines contain up to 120 measurements collected while the dashboard
is open. They live only in that browser document and reset on leaving it or
losing permission; this release does not store a historical server time series.

## Release and rollback

Version 2.44.0 is rolled out with `SILENT_RELEASE=1`; no player push or in-app
release entry is created. The existing deploy script backs up app data before
the update. The Deep Dive baseline is version 2.43.0, commit `3e92116`; both
versions use the same analytics schema. The pre-analytics baseline remains
version 2.42.6, commit `40e53b1`.

For code rollback, stop the service, select version 2.43.0 and rebuild.
To return to the pre-analytics implementation, select version 2.42.6 instead.
The additive analytics tables and dashboard permission column may remain in
SQLite; old code ignores them. Do not restore an older full database over new
player results. To remove analytics storage, use the migration downgrade only
after stopping the application and taking a fresh backup; it deletes analytics
and its access grants, while retaining game/account tables. Remove the new
read-only `/proc` counter mounts when returning to the old Compose file.
