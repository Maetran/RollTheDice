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

## Server counters

Compose mounts only `/proc/stat`, `/proc/meminfo`, `/proc/loadavg` and
`/proc/uptime` read-only under `/host/proc`, without exposing host process
directories. There is no Docker socket or elevated container privilege.
These four counters supply host CPU, RAM, load and uptime.
Disk figures describe the filesystem backing `/app/data`; application uptime
is independent of host uptime. Missing counters remain visibly unavailable.
The dashboard refreshes every 30 seconds and pauses while hidden.

## Release and rollback

Version 2.43.0 is rolled out with `SILENT_RELEASE=1`; no player push or in-app
release entry is created. The existing deploy script backs up app data before
the migration. The baseline is version 2.42.6, commit `40e53b1`.

For code rollback, stop the service, select the baseline code and rebuild.
The additive analytics tables and dashboard permission column may remain in
SQLite; old code ignores them. Do not restore an older full database over new
player results. To remove analytics storage, use the migration downgrade only
after stopping the application and taking a fresh backup; it deletes analytics
and its access grants, while retaining game/account tables. Remove the new
read-only `/proc` counter mounts when returning to the old Compose file.
