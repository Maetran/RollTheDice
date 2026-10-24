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
- Design usage answers which look players spend their time with. Every
  engagement event already carries visible, recently active milliseconds
  (at most 60 seconds per event). It now also names the look that was on
  screen while that time was counted, from a fixed list of eight values:
  `zdwa:new:light|dark|classic` (2026 design: light, dark, Classic),
  `zdwa:old:light|dark|classic` (previous design) and
  `zilch:tavern|lcars` (Zilch tavern table or LCARS). Switching theme or
  design closes the running interval, so time before the switch stays with
  the previous look. Page views and actions carry no look. The server keeps
  only daily totals in `analytics_design_buckets`: UTC day, look, area
  (`table` for game rooms `/spiel`, `site` for every other page, including
  spectating) and summed milliseconds — at most 16 rows per day, with no
  visit, session, account, device or country relation. Unknown looks, looks
  that do not match the event's game and resent events are ignored. These
  totals are kept for 400 days (independent of the 90-day/200,000-event
  limit for individual events). Guests and accounts are counted alike;
  DNT/GPC visitors send nothing. The dashboard additionally shows the stored
  ZDWA design choice of active accounts (`users.zdwa_design`) as a current
  count, not as history.
  **Deutsch:** Die Design-Nutzung zeigt, mit welchem Erscheinungsbild gespielt
  wird. Jedes Engagement-Ereignis enthält schon die sichtbare, zuletzt aktive
  Zeit (höchstens 60 Sekunden je Ereignis). Neu nennt es zusätzlich das
  Design, das dabei zu sehen war – aus acht festen Werten:
  `zdwa:new:light|dark|classic` (Design 2026: Hell, Dunkel, Classic),
  `zdwa:old:light|dark|classic` (bisheriges Design) und `zilch:tavern|lcars`
  (Zilch-Wirtshaustisch oder LCARS). Ein Wechsel von Farbschema oder Design
  schliesst das laufende Intervall ab; die Zeit davor bleibt beim vorherigen
  Design. Seitenaufrufe und Aktionen tragen kein Design. Gespeichert werden
  nur Tagessummen in `analytics_design_buckets`: UTC-Tag, Design, Bereich
  (`table` für Spielräume `/spiel`, `site` für alle übrigen Seiten inklusive
  Zuschauen) und summierte Millisekunden – höchstens 16 Zeilen pro Tag, ohne
  Bezug zu Besuch, Sitzung, Konto, Gerät oder Land. Unbekannte oder nicht zum
  Spiel passende Werte und erneut gesendete Ereignisse werden verworfen. Die
  Tagessummen bleiben 400 Tage erhalten, unabhängig von der Grenze von 90
  Tagen/200.000 Ereignissen für Einzelereignisse. Gäste und Konten zählen
  gleich; mit DNT/GPC wird nichts gesendet. Zusätzlich zeigt das Dashboard
  die gespeicherte ZDWA-Designwahl aktiver Konten (`users.zdwa_design`) als
  aktuellen Stand, nicht als Verlauf.
- Filters use UTC calendar days: today (UTC), or today and the preceding
  6, 29 or 89 days. They are not rolling 24-hour windows.

## Hausdepp preview monitoring / Hausdepp-Vorschau

**Deutsch:** Hausdepp erscheint ausschliesslich beim accountgebundenen Gründer
mit Hausdepp-Zugang. Eine Dashboard-Freigabe erweitert diesen Zugang nicht.
Jede Statistikabfrage prüft die Berechtigung erneut. Für andere Dashboard-Konten
umfasst auch «Beide Spiele» nur ZDWA und Zilch: Ergebnisse, Vergleichszeitraum,
Tageswerte, Aktionen, Seiten, Länder, Besuchswechsel und aktuelle Raumzahlen
enthalten keine Hausdepp-Werte. Verborgene Zwischenstationen erzeugen keine
erfundenen Wechsel zwischen öffentlichen Spielseiten.

Die Hausdepp-Karte zeigt gespeicherte abgeschlossene Runden, Teilnahmen,
abgeschlossene Turniere und bekannte Rundendauern. Aktuelle Tische,
verbundene menschliche Spieler, Computerplätze, laufende Turniere und
Rundenpausen stammen aus dem momentanen Spielbetrieb. Server-Raum- und
Spielerzahlen folgen dem gewählten Spielfilter; CPU, RAM und HTTP-Anfragen
bleiben ausdrücklich gemeinsame Infrastrukturwerte.

Browserbesuche von Hausdepp werden bisher nicht erfasst und deshalb als
unbekannt angezeigt. Ältere Runden ohne Startzeit erhalten nachträglich keine
Dauer. Die optionale Durchschnittsdauer berücksichtigt nur bekannte Angaben
innerhalb der höchstens 2’000 neuesten Ergebnisse. Neue manuelle Abbrüche und
Inaktivitätsabbrüche werden über ein festes Serverereignis erfasst; mehrfache
Zustellversuche zählen durch einen Hash zur Deduplizierung nur einmal. Das
Ereignis enthält weder Namen noch Karten, Einblicke oder Erfolgsdaten.
Die normale Ereignisaufbewahrung und deren Kapazitätsgrenzen gelten auch hier.
Frühere Abbrüche werden nicht nachgetragen; verlorene Telemetrie wird nicht
aus Spielergebnissen erfunden.

**English:** Hausdepp is available only to the account-bound founder with
Hausdepp access. A dashboard grant does not grant this preview. Each statistics
request checks the current capability. Other dashboard readers receive only
ZDWA/Zilch data, including combined totals, comparisons, daily counts, actions,
pages, countries, journeys and live rooms. Hidden intermediate pages do not
create invented transitions between public game pages.

The Hausdepp card shows persisted completed rounds, participations, completed
tournaments and known round durations. Live tables, connected human players,
computer seats, active tournaments and round breaks come from current runtime
state. Server room/player totals follow the game filter; CPU, memory and HTTP
request figures remain explicitly shared infrastructure totals.

Hausdepp browser visits have not been measured and are shown as unavailable.
Older rounds without timing evidence are not assigned a duration. Optional
duration averages inspect at most the newest 2,000 results. New manual and
inactivity aborts use a fixed server event with a hashed deduplication key;
retries count once. No names, cards, peeks or achievement data are exposed.
Normal event retention and capacity limits apply. Earlier aborts are not
backfilled, and missing telemetry is never fabricated from completed results.

## Visual analysis

- The dashboard's own design switcher selects Mission Control, LCARS or
  NEXUS. Mission Control remains the default; switching back is possible at
  any time. Its preference is stored locally in the browser, independently
  of ZDWA/Zilch appearance preferences. All three designs present the same
  statistics and charts; privacy, access and animation controls follow the
  same rules.
  **Deutsch:** Der eigene Designwechsel wählt Mission Control, LCARS oder
  NEXUS. Mission Control bleibt der Standard; ein Rückwechsel ist jederzeit
  möglich. Die Wahl wird lokal im Browser gespeichert und verändert die
  Darstellung der Spiele nicht. Messwerte, Diagramme, Datenschutz, Zugriff
  und Animationssteuerung folgen in allen drei Designs denselben Regeln.
- NEXUS adds a dark command-console layout with prominent KPIs and their
  measurement context, arranged separately for phone, tablet and desktop
  screens. Star controls move the actual metric or analysis panel into a
  reserved Favorites area at the top; removing a favorite restores its
  original position. Period/game filters, automatic refresh and chart
  interaction continue to apply to favorited panels. Local storage keeps only
  stable favorite identifiers, scoped to the signed-in dashboard viewer;
  metric snapshots are not saved. Favorites stay in this browser and do not
  synchronize across devices or accounts.
  **Deutsch:** NEXUS ergänzt eine dunkle Kommandozentrale mit prominenten
  Kennzahlen samt Messkontext und eigenen Anordnungen für Handy, Tablet und
  Desktop. Sternschalter verschieben die tatsächliche Kennzahl oder den
  Analysebereich in einen reservierten Favoritenbereich oben; das Entfernen
  stellt den bisherigen Platz wieder her. Zeitraum-/Spielfilter, automatische
  Aktualisierung und interaktive Diagramme gelten auch für Favoriten. Lokal
  werden nur stabile Favoritenkennungen getrennt nach angemeldetem
  Dashboard-Nutzer gespeichert, keine Momentaufnahmen der Messwerte. Favoriten
  bleiben in diesem Browser und werden nicht zwischen Geräten oder Konten
  synchronisiert.
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
- **Design usage** (section 03) follows the selected period and game filter.
  A head-to-head bar compares ZDWA new against previous and Zilch tavern table
  against LCARS as shares of visible time. The breakdown lists every look
  (ZDWA new: light, dark, Classic; ZDWA previous: light, dark, Classic; Zilch:
  tavern table, LCARS) with readable time, its share within the game, and
  time at the game table versus other pages; exact seconds appear on hover
  and in the table. Account choices are a current snapshot, independent of
  the period; guests keep their choice only in the browser and are not
  included. Because every account starts with the new design, the panel
  marks the default share ("of these, never asked": accounts registered after
  the update plus pre-release accounts that have not signed in since) and
  shows the **answers after the update** on their own: pre-release accounts
  whose `zdwa_design_prompted_at` was set more than five minutes after the
  account was created, i.e. they saw the one-time question or chose in their
  settings. Closing the question without a change counts as keeping the new
  design. While `ROLLTHEDICE_ZDWA_DESIGN` is `owner` or `off`
  (`design_usage.zdwa_design_mode`), a note explains that the stored choice
  does not apply yet. Shares describe visible time, not people: one long
  session can outweigh many short ones.
  **Deutsch:** Die **Design-Nutzung** (Bereich 03) folgt Zeitraum und
  Spielfilter. Ein direkter Vergleich zeigt ZDWA neu gegen bisher und Zilch
  Wirtshaustisch gegen LCARS als Anteil der sichtbaren Zeit. Die Aufschlüsselung
  nennt jedes Design (ZDWA Neu: Hell, Dunkel, Classic; ZDWA Bisher: Hell, Dunkel,
  Classic; Zilch: Wirtshaustisch, LCARS) mit lesbarer Zeit, Anteil im Spiel und
  Zeit am Spieltisch gegenüber übrigen Seiten; exakte Sekunden erscheinen beim
  Überfahren und in der Tabelle. Die Kontowahl ist ein aktueller Stand,
  unabhängig vom Zeitraum; Gäste speichern ihre Wahl nur im Browser und fehlen
  dort. Weil jedes Konto mit dem neuen Design startet, weist das Panel den
  Standardanteil aus („davon nie gefragt“: nach dem Update registrierte Konten
  und ältere Konten ohne Anmeldung seither) und zeigt die **Antwort nach dem
  Update** getrennt: ältere Konten, deren `zdwa_design_prompted_at` mehr als
  fünf Minuten nach der Kontoerstellung gesetzt wurde, die also die einmalige
  Frage gesehen oder im Konto gewählt haben. Wer die Frage ohne Änderung
  schließt, zählt als „Neu behalten“. Steht `ROLLTHEDICE_ZDWA_DESIGN` auf
  `owner` oder `off` (`design_usage.zdwa_design_mode`), erklärt ein Hinweis,
  dass die gespeicherte Wahl noch nicht greift. Anteile beschreiben sichtbare
  Zeit, keine Personen: Eine lange Sitzung kann viele kurze aufwiegen.
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

Migration `20261013_0055` adds the account columns `zdwa_design` and
`zdwa_design_prompted_at` and the separate daily table
`analytics_design_buckets`; it has no relation to visits, events or game
tables. Version 2.50.0 and older cannot start on this schema: their migration
step does not know revision `20261013_0055`. The rollback without data loss is
`ROLLTHEDICE_ZDWA_DESIGN=off` and a restart. A code rollback to 2.50.0 first
needs `alembic downgrade 20261010_0054`, which drops the design totals and the
stored account choices only (or restoring the deploy's data backup); back up
and stop the service first.
**Deutsch:** Migration `20261013_0055` ergänzt die Kontospalten `zdwa_design`
und `zdwa_design_prompted_at` sowie die eigene Tagestabelle
`analytics_design_buckets` ohne Bezug zu Besuchen, Ereignissen oder Spieldaten.
Version 2.50.0 und ältere starten mit diesem Schema nicht, weil ihr
Migrationsschritt die Revision `20261013_0055` nicht kennt. Der Rückweg ohne
Datenverlust ist `ROLLTHEDICE_ZDWA_DESIGN=off` mit Neustart. Ein Code-Rollback
auf 2.50.0 braucht vorher `alembic downgrade 20261010_0054`, das nur die
Design-Tagessummen und die gespeicherte Kontowahl entfernt (oder die
Datensicherung des Deploys); vorher sichern und den Dienst stoppen.

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

## Audiochat-Aktivität / Voice activity

**Deutsch:** Zusätzlich zu den unverändert anonymen Audio-Datenmengen erfasst
Mission Control ab 4.4.0 neue, serverseitig beobachtete Sprachchat-Nutzung in
ZDWA, Hausdepp und Watten. Ein erfolgreich autorisierter Audio-Beitritt zählt
als Aktivierung. Heartbeats und Wiederaufnahme derselben Mitgliedschaft sind
keine neuen Aktivierungen. Gezählt werden Aktivierungen, Partien mit Audio,
eindeutige Konten und Minuten mit aktivierter Zuhörverbindung. «Partien mit Audio»
zählt unterschiedliche Tisch-/Partie-IDs einschliesslich der Wartephase, nicht
nur abgeschlossene Spiele. Diese Minuten
sind weder Sprechzeit noch ein Nachweis hörbarer Sprache oder eine Abrechnung.

Die separate Tabelle enthält UTC-Tag, Spielart, Partie-ID, Konto-ID,
Aktivierungen, aktive Zeit und erste/letzte Beobachtung. Tagessummen bleiben
höchstens 400 Tage erhalten; Kontolöschung entfernt ihre zugehörigen Werte.
Das bestehende geschützte Dashboard zeigt zusätzlich die zehn aktivsten Konten
mit aktuellem Benutzernamen. Jede Abfrage prüft die bestehende Dashboard- und
Produktberechtigung erneut. Es gibt keinen öffentlichen Audio-Rang und keine
Aufzeichnung, Transkription oder Inhaltsauswertung.

Zeit entsteht aus begrenzten serverseitigen Intervallen bestätigter
Mitgliedschaft. Verbindungsverlust pausiert die Messung; verspätetes Aufräumen
verlängert sie nicht beliebig. Wiederholte Nachrichten, Geräteübernahme und
Spielübergaben zählen keine Zeit doppelt. Begrenzte Hintergrundschreibvorgänge
beeinträchtigen das Spiel bei Ausfällen nicht; fehlende Daten bleiben eine
Messlücke. Frühere Spiele und anonyme Datenmengen werden nicht nachgetragen
oder nachträglich Konten zugeordnet.

**English:** Alongside unchanged anonymous payload totals, Mission Control
records newly observed server-side voice use in ZDWA, Hausdepp and Watten from
4.4.0. A successfully authorized audio membership counts as an activation;
heartbeats and resuming the same membership do not. Metrics show activations,
games with audio, distinct accounts and minutes with listening enabled. Games
with audio counts distinct table/game IDs including waiting rooms, not only
completed games. Minutes
are neither speaking time, proof of audible conversation nor billing evidence.

A separate table contains UTC day, game type, game ID, account ID, activations,
active time and first/last observation. Daily totals expire after at most
400 days and are removed with account deletion. The existing protected
dashboard shows the ten most active accounts using their current usernames.
Every request rechecks dashboard and product access. There is no public voice
ranking, recording, transcription or conversation analysis.

Time uses bounded server-observed membership intervals. Disconnect pauses it;
delayed cleanup cannot extend it indefinitely. Replayed messages, device takeover
and game handoffs cannot duplicate time. Bounded background writes never block
gameplay on failure; missing observations remain a measurement gap. Historical
games and anonymous byte totals are not backfilled or assigned to accounts.
