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
- Since 2.45.0, the browser sends only fixed operating-system and device-family
  categories derived from available browser hints. Analytics payloads contain
  no raw user-agent strings, OS versions, exact models or hardware identifiers;
  none of these are saved in analytics storage.
  Recognition is approximate. Each category is fixed at the first accepted
  batch of an anonymous tab session; older and unrecognized sessions remain
  `unknown` rather than having their history inferred from later batches.
  **Deutsch:** Seit 2.45.0 überträgt der Browser nur feste Betriebssystem- und
  Geräteklassen aus verfügbaren Browserhinweisen. Analytics-Nutzdaten und
  -Speicher enthalten keine Rohdaten, Versionsnummern, genauen Modelle oder
  Gerätekennungen.
  Die Erkennung ist näherungsweise. Die erste Angabe einer anonymen Tab-Sitzung
  bleibt fest; ältere und nicht erkannte Sitzungen bleiben `unknown`.
- Since 2.46.0, launch context, coarse browser family and first preferred
  browser language are also fixed at the first accepted tab-session batch.
  `app_mode` is `pwa` when `display-mode: standalone` or Apple's
  `navigator.standalone` is true, `browser` when the browser display mode or
  explicit iOS non-standalone state is available, otherwise `unknown`.
  Fullscreen alone is not PWA evidence. These counts measure visits launched
  in an app window, not installed apps or unique users.
  Browser families are `chrome`, `safari`, `edge`, `firefox`,
  `samsung_internet`, `opera`, `silk`, `other`, `unknown`. The Chrome / Chromium
  label includes browsers whose hints are indistinguishable, such as Brave;
  recognition is approximate and never changes gameplay compatibility. Safari /
  WebKit also covers the identifiable iOS standalone runtime, without claiming
  which browser originally installed that app.
  `browser_language` uses `navigator.languages[0]`, falling back to
  `navigator.language` if missing. Only an allowlisted primary language code
  remains: `de-CH` becomes `de`, `zh-Hant-TW` becomes `zh`. Regions, scripts and
  full preference lists are discarded. This browser preference is independent
  of the selected game UI language and does not prove that a visitor needs a
  translation. Older sessions remain `unknown`, including existing tabs whose
  session began before this release. Definitions:
  [PWA display mode](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Create_a_standalone_app),
  [Apple standalone](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html),
  [preferred languages](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/languages).
  **Deutsch:** Seit 2.46.0 ergänzen PWA-/Browser-Startkontext, Browserfamilie und
  erste bevorzugte Browsersprache die anonymen Tab-Besuche. Die erste Angabe
  bleibt fest. PWA bezeichnet den Start im App-Fenster, keine Installation;
  Vollbild allein genügt nicht. Browserfamilien sind näherungsweise erkannt,
  Chrome und nicht unterscheidbare Chromium-Browser teilen eine Gruppe.
  Nur der Hauptsprachcode bleibt gespeichert, etwa `de` statt `de-CH`.
  Die Spracheinstellung im Spiel beeinflusst diese Messung nicht. Ältere und
  nicht erkennbare Angaben bleiben unbekannt.
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

- The dashboard's own theme switcher selects Mission Control or LCARS. Its
  preference is stored locally in the browser, independently of ZDWA/Zilch
  appearance preferences. Both themes present the same statistics and charts;
  privacy, access and animation controls remain identical.
  **Deutsch:** Der eigene Designwechsel wählt Mission Control oder LCARS.
  Die Wahl wird lokal im Browser gespeichert und verändert die Darstellung
  der Spiele nicht. Messwerte, Diagramme, Datenschutz, Zugriff und
  Animationssteuerung folgen in beiden Designs denselben Regeln.
- Software and hardware panels count distinct anonymous tab sessions with a
  browser event in the selected UTC period and game. They complement the
  existing mobile/tablet/desktop groups; the same tab is counted once within
  each category. Operating systems use `android`, `ios`, `ipados`, `fireos`,
  `windows`, `macos`, `linux`, `chromeos` or `unknown`. Device families use
  `ipad`, `iphone`, `fire_tablet`, `android_tablet`, `android_phone`, `mac`,
  `windows_pc`, `linux_pc`, `chromebook` or `unknown`.
  **Deutsch:** Software- und Hardware-Auswertung zählen verschiedene anonyme
  Tab-Sitzungen mit Browser-Ereignissen im gewählten UTC-Zeitraum und Spiel.
  Sie ergänzen Handy, Tablet und Desktop; derselbe Tab zählt je Kategorie
  einmal. Unbekannt umfasst auch ältere Sitzungen ohne diese Messung.
- PWA/browser, browser-family and preferred-language cards also count distinct
  anonymous tab sessions with client events in the selected period and game.
  Each session has one fixed category per dimension. Percentages use all
  categories, including unknown values, as their denominator. A tab visiting
  both games is counted once with the combined filter. Unknown data is kept
  separate and never relabeled from later requests.
  **Deutsch:** PWA-/Browser-, Browserfamilien- und Sprachkarten zählen anonyme
  Tab-Besuche im gewählten Zeitraum und Spiel. Jeder Tab hat je Dimension eine
  feste Kategorie. Prozentanteile berücksichtigen unbekannte Angaben. Beim
  gemeinsamen Spielfilter zählt derselbe Tab einmal.
- HTTP request origin is a separate operational measurement, independent of
  browser tracking or login. It aggregates responses by UTC day, trusted
  Cloudflare country, status class, fixed request channel and agent family,
  without storing IPs, raw user agents, paths,
  queries, accounts or session IDs. Bots, asset and API requests count too.
  Health checks, the dashboard document and its statistics polling are excluded.
  All games/hosts are included even when a single-game filter is selected;
  only the selected period applies. Requests served from Cloudflare cache or
  blocked before reaching the app, and WebSocket frames, are outside this count.
  Recording starts with 2.46.0; historical traffic is not reconstructed.
  Bounded buffering and database failures can cause loss; the dashboard exposes
  the dropped request count since the application process started. This is
  anonymous server-load aggregation, not a count of people or visits.
  Agent families name declared crawlers such as Googlebot and Bingbot, plus
  recognizable API clients such as curl and Python. These are **unverified
  self-declarations**; a browser-like agent does not establish a human user.
  Channels use fixed `api`, `asset`, `page`, `other` categories. Limits and
  Cloudflare rule preparation are documented in
  [Cloudflare protection](CLOUDFLARE_PROTECTION.md).
  **Deutsch:** Die Request-Herkunft ist eine eigene Betriebskennzahl. Auch Bots,
  Dateien und API-Aufrufe zählen, unabhängig von Anmeldung und Browsermessung.
  Zusammengefasst werden UTC-Tag, Land, Statusklasse und feste Kanal-/Clientfamilien, ohne IP-Adressen,
  Browser-Rohdaten, Pfade, Parameter, Konten oder Sitzungskennung. Healthchecks
  und das Dashboard samt Statistikabrufen sind ausgeschlossen. Der Zeitraum
  gilt, der Spielfilter nicht: gezählt wird die gesamte Anwendung. Cloudflare-
  Cachetreffer, dort blockierte Anfragen und WebSocket-Nachrichten sind nicht
  enthalten. Messung ab 2.46.0; keine rekonstruierte Historie. Verlorene Requests
  werden seit Prozessstart ausgewiesen.
  Googlebot, Bingbot und typische API-Clients wie curl/Python werden als
  unbestätigte Selbstangabe erkannt; eine Browserkennung beweist keinen Menschen.
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

Version 2.46.0 is rolled out with `SILENT_RELEASE=1`; no player push or in-app
release entry is created. The existing deploy script backs up app data before
the update. The browser/PWA/language baseline is version 2.45.0, commit
`03e0eb6`; the LCARS baseline is version 2.44.0, commit `657763f`; the Deep
Dive baseline is version 2.43.0, commit `3e92116`. Migration `20261005_0051`
adds three bounded category columns to anonymous sessions, defaulting old rows
to `unknown`, without changing accounts, access grants or game tables.
Migration `20261005_0052` adds anonymous daily HTTP country/status counters;
it has no account, game or browser-session relation.
The pre-analytics baseline remains
version 2.42.6, commit `40e53b1`.

**Deutsch:** Version 2.46.0 wird still mit `SILENT_RELEASE=1` ausgeliefert,
ohne neue Push- oder In-App-Versionsmeldung. Für die PWA-/Browser-/Sprachmessung
ist Version 2.45.0 (`03e0eb6`) die Rückfallversion. Migration `20261005_0051`
ergänzt drei begrenzte Kategorie-Spalten; ältere Sitzungen erhalten
`unknown`. Konten, Zugriffsrechte und Spieldaten bleiben erhalten. Die
Datensicherung läuft über das bestehende Deploy-Skript.
Migration `20261005_0052` ergänzt anonyme tägliche HTTP-Länder-/Statuszähler.

For code rollback of browser/PWA/language analysis, stop the service, select
version 2.45.0 and rebuild. The additive columns and request counters may remain;
old code ignores them. An optional downgrade to `20261005_0050` removes only these
classifications, preserving device analysis, anonymous events, accounts,
access grants and results; it also removes the separate daily request counters.
Back up and stop the service first.
For code rollback of the LCARS theme, stop the service, select version 2.44.0
and rebuild. Select version 2.43.0 to return to the first dashboard.
The two additive device columns may remain when rolling back to these
versions; old code ignores them. An optional downgrade to `20261004_0049`
removes only these classifications, preserving anonymous sessions, events,
access grants and player results. Back up and stop the service first.
To return to the pre-analytics implementation, select version 2.42.6 instead.
The additive analytics tables and dashboard permission column may remain in
SQLite; old code ignores them. Do not restore an older full database over new
player results. To remove analytics storage, use the migration downgrade only
after stopping the application and taking a fresh backup; it deletes analytics
and its access grants, while retaining game/account tables. Remove the new
read-only `/proc` counter mounts when returning to the old Compose file.
