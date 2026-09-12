# RollTheDice

Two dice games. One account. A table for your next game night.

- [Play ZDWA — Zock die Wand an](https://zockdiewandan.online/)
- [Play Zilch — Zilch die Wand an](https://zilch.zockdiewandan.online/)

RollTheDice is a self-hostable, real-time game platform with German and English
interfaces. Play in your browser or install either game as a Progressive Web App.
Guests can play; accounts add personal history, statistics, achievements and
community features.

## The games

| | ZDWA | Zilch |
| --- | --- | --- |
| Dice | Five | Six |
| Goal | Build the best score across the score sheet | Bank 10,000 points before your opponent |
| Modes | Solo, two or three players, 2v2 teams; Normal or Hardcore | Two players, three CPU difficulty styles, or Solo Sprint |
| Solo challenge | Complete your own score sheet | Reach 10,000 in as few turns as possible |
| Progress | Ehrenberg-Marken, titles and rank badges | Separate Zilch points, ranks and achievements |
| Rules | [ZDWA guide](https://zockdiewandan.online/regeln) | [Zilch guide](https://zilch.zockdiewandan.online/regeln) |

Both games use server-authoritative dice and scoring. Zilch has its own rules
engine, results and rankings: its points never affect ZDWA standings.

## Contents

- [Quick start](#quick-start)
- [Playing together](#playing-together)
- [Accounts and progress](#accounts-and-progress)
- [Lobby chat](#lobby-chat)
- [Push notifications](#push-notifications)
- [Release notes and feedback](#release-notes-and-feedback)
- [Progressive Web Apps](#progressive-web-apps)
- [Local development](#local-development)
- [Architecture](#architecture)
- [Data and deployment](#data-and-deployment)
- [Documentation](#documentation)
- [Product delivery gate](#product-delivery-gate)

## Quick start

You need Docker with the Compose plugin and Git.

```bash
git clone https://github.com/Maetran/RollTheDice.git
cd RollTheDice
cp .env.example .env
```

For the first administrator, set `ROLLTHEDICE_ADMIN_USERNAME` and a strong
temporary `ROLLTHEDICE_ADMIN_PASSWORD` in `.env`. There is no default password.
Set `ROLLTHEDICE_ZILCH_ACCESS_MODE=public` to allow guests and accounts into Zilch.

```bash
docker compose up -d --build
```

Open [ZDWA](http://localhost:8000/), [Zilch](http://localhost:8000/zilch), or the
[API documentation](http://localhost:8000/docs).

After the first successful administrator login, remove the bootstrap password
from `.env` and recreate the container. Game data lives in the mounted
`./data` directory and survives container rebuilds.

For an internet-facing server, follow the
[deployment guide](docs/DEPLOYMENT.md) before exposing the application. It covers
HTTPS, secure cookies, the reverse proxy, trusted forwarding and registration
protection.

## Playing together

- Create a table quickly, or add an optional room code.
- Share an invitation link without exposing room codes or resume credentials.
- Rejoin your seat after a disconnect; active games also survive server restarts.
- Chat and send quick reactions in the game room. An open chat keeps its draft
  while live messages, game updates, or a reconnect arrive.
- Watch eligible multiplayer tables in a read-only spectator view.
- Leave a game through **Pause**, **Return to Lobby**, or **Stay in Game**.
  Pausing preserves the table until its displayed deadline. Returning to the
  lobby ends the room for everyone without creating a completed result. A
  started table ended this way counts only for the signed-in account that
  actively ends it. Timeouts and disconnects do not count. ZDWA Fairplay
  reminders award zero rank points; scores and completed-game totals remain
  unchanged.
- Switch between games from lobbies and app pages. Live game rooms deliberately
  have no game switcher.

Waiting, running and paused rooms expire after one hour without a
server-accepted room action. They are then aborted without a completed result.

### Zilch at the table

Select scoring dice directly or use compact suggestions. Selections remain
reversible until **Roll again** or **Bank** commits them; **Combined score**
selects all currently scoring dice in one action. Hot Dice, the competitive
start roll and the final reply are handled by the server.

The score notebook returns to its latest entries on every roll and newly
recorded score. Reading older entries stays possible between rolls, including
while changing dice selections or receiving chat messages.
LCARS gives the active player's scrollable score history the large upper
sheet. The other player's name and total remain visible in a compact strip
below. When turns change, the newly active sheet slides from bottom to top;
the Classic notebook is unchanged. Opening rolls use the same miniature dice
as scoring suggestions; both results remain visible for 1.2 seconds before
play or a tied opening attempt continues. Rejoining a running game skips that
pause.

CPU opponents use the same dice and scoring path as humans, with conservative,
normal or aggressive decisions. Solo Sprint has no opponent or final reply;
its private metrics exclude pauses and server downtime.
The dice keeper's default action pause is 1.25 seconds, with at least 1.8
seconds after rolling to read the result and 1.5 seconds after the opening
result. The existing 1.9-second Zilch handoff remains; pauses are not added
together and do not alter decisions, randomness or scoring.

Keyboard controls include 1–6 for dice, Space to roll, B to bank, and
Q/W/E/R/T/Z/U/I for visible suggestions. Shortcuts are disabled while typing or
using dialogs. See the [full Zilch rule contract](docs/ZILCH_RULES.md).

After every completed or abandoned Solo Sprint, and every completed CPU or
two-player Zilch game, the end screen opens automatically. Its actions sit
above the summary: start a new Solo run, request a rematch, or return to the
lobby. Signed-in players receive their private report; guests retain the same
current-session summary without a personal history entry. A protected CPU or
two-player rematch keeps its room code in the current browser session; when
reopening an older report, players enter the code again so it is never stored
in the result history.

## Accounts and progress

One account works across both games. Both settings pages follow the same four
sections: **Profile & sign-in**, **Language & play**, **Players & notifications**,
and **Help & updates**. Profile and sign-in open first, with passkeys as the
preferred sign-in method. Open profile editing or password changes when needed;
email settings appear only when email is enabled. Shared language and lobby-chat
preferences save separately from ZDWA gameplay options. Statistics and
achievements keep their own tabs.

**Deutsch:** Die Einstellungen beider Spiele folgen derselben Reihenfolge:
**Profil & Zugang**, **Sprache & Spiel**, **Mitspieler & Hinweise** und
**Hilfe & Neuigkeiten**. Profil und Zugang sind zuerst geöffnet, mit Passkeys
als bevorzugter Anmeldung. Profilbearbeitung und Passwortwechsel öffnest du
bei Bedarf; E-Mail-Einstellungen erscheinen erst bei aktiviertem Versand.
Gemeinsame Sprache und Lobby-Chat werden getrennt von ZDWA-Spieloptionen
gespeichert. Statistik und Erfolge behalten eigene Tabs.

ZDWA offers locally saved Light, Dark and Classic appearances through its compact
header appearance button. Classic turns the table into a coffee-table score
sheet: softer, warm paper rests on irregular green felt, with blue ballpoint
lettering and loosely drawn lines. Bundled handwriting keeps the style
consistent across devices; smooth sepia dice have subtle, individual patina.
The felt also fills mobile landscape backgrounds. Short screens retain
scrollable access to the sheet and its actions. Newly recorded Classic scores
are drawn as blue ballpoint centre-line strokes, digit by digit, in about half
a second. Opponents see the same writing; existing scores, reloads and reconnects
do not replay it. Reduced-motion preferences show the final ink immediately.
The score and controls never wait for the animation, which needs no extra font
or network request. Controls, rules and scoring
are unchanged. Zilch remembers its separate Classic or LCARS choice locally in the
same browser. LCARS uses a solid black canvas, flat segmented console rails,
rounded LCARS elbows and locally hosted condensed display lettering, including
in the installed PWA. Controls, rules, randomness and scoring stay the same.
Free rolls appear as a bright LCARS status band inside the scoring tile, with
the throw name and points remaining readable.
Inside LCARS game rooms, quieter frame and chat colours and reduced dice glow
keep selections clear. Positive scores use a light, muted apricot, and CPU
badges use flat LCARS colours with dark lettering. The black background,
layout and sliding score sheets are unchanged.
Under **Account → Settings → Profile & sign-in → Change username**, enter a new name and your
current password. Names follow the registration rules (3–32 characters) and
are unique regardless of case. The new name applies to signing in, profiles
and new games in both products. Sessions, statistics, achievements, avatars
and saved player selections remain attached to the same account. Completed
game views, history and leaderboards show the current account name, resolved
through the stored participant/account IDs. Reusing a released name never
transfers earlier games. Guest names, ambiguous unassigned legacy entries,
message text and game titles stay unchanged. Profile links change and the old
name becomes available again. In the private Zilch preview mode, names tied to
preview access require an administrator to adjust the access configuration first.

**Deutsch:** Unter **Konto → Einstellungen → Profil & Zugang → Benutzername ändern** kannst du
mit deinem aktuellen Passwort einen neuen Namen wählen. Er gilt für Anmeldung,
Profil und neue Partien in beiden Spielen. Konto, Statistiken, Erfolge und
Spielerauswahl bleiben erhalten. Auch abgeschlossene Partien und Bestenlisten
zeigen deinen aktuellen Kontonamen. Die Zuordnung erfolgt über feste IDs,
auch wenn jemand deinen alten Namen übernimmt. Gastnamen, nicht eindeutig
zugeordnete Altbestände, Nachrichtentexte und Spieltitel bleiben unverändert.
Dein Profillink ändert sich und der alte Name wird frei.

Administrators manage accounts and moderation.

The production account release enables email registration and recovery alongside
passkeys and public Fairplay counters. Resend sends from
`noreply@zockdiewandan.online`; the [mail setup record](docs/MAIL_SETUP_2026-09-12.md)
describes DNS, delivery checks and operating limits. Only account/address
confirmations, requested password resets and reset confirmations are sent.
There is no inbox, operator copy or newsletter. New accounts become usable
only after following the confirmation link and choosing a password; existing
accounts can add a confirmed address under **Profile & sign-in**.

Passkeys lead the sign-in screen. Password fields open only after choosing
**Sign in with password**, including on devices where passkeys are unavailable.
Accounts without a passkey see a setup reminder in the lobby and account page;
its link opens and focuses the setup form. The reminder disappears after a
passkey is saved and returns if the last one is removed. Required password
changes take priority, and active games are not interrupted.

Passkeys are the preferred sign-in choice on supported devices. They use the
fixed ZDWA origin as the WebAuthn relying party and work across ZDWA and the
controlled Zilch subdomain. The server stores public credential material only;
passwords remain a fallback. Add, name or remove passkeys in account settings.
A password reset signs out every device and removes existing passkeys; enroll
them again after signing in. An ordinary password change keeps passkeys.
Disabling email through its deployment flag restores legacy password sign-up.
See the [email account plan](docs/EMAIL_ACCOUNTS_PLAN.md) and
[account security review](docs/ACCOUNT_SECURITY_REVIEW_2026-09-12.md).

**Deutsch:** Der Konto-Release aktiviert E-Mail-Registrierung und Wiederherstellung
zusätzlich zu Passkeys und öffentlichen Fairplay-Zählern. Resend versendet von
`noreply@zockdiewandan.online`; DNS, Versandprüfungen und Betriebsgrenzen stehen
im [Versandprotokoll](docs/MAIL_SETUP_2026-09-12.md). Die Anwendung verschickt nur
Konto-/Adressbestätigungen, angeforderte Passwort-Resets und die Bestätigung
nach einem Reset. Es gibt kein Postfach, keine Kopie an die Administration und
keinen Newsletter. Neue Konten entstehen erst nach Bestätigungslink und eigener
Passwortwahl. Bestehende Konten können unter **Profil & Zugang** eine bestätigte
Adresse ergänzen.

Passkeys stehen beim Anmelden vorne. Die Passwortfelder erscheinen erst nach
**Mit Passwort anmelden**, auch wenn das Gerät keine Passkeys unterstützt.
Konten ohne Passkey erhalten in Lobby und Konto einen Einrichtungshinweis,
der direkt zum passenden Formular führt. Nach dem Speichern verschwindet er;
nach dem Entfernen des letzten Passkeys erscheint er wieder. Erforderliche
Passwortwechsel haben Vorrang, laufende Spiele bleiben ungestört.

Passkeys sind die bevorzugte Anmeldung auf unterstützten Geräten und gelten
für ZDWA sowie die kontrollierte Zilch-Subdomain. Der Server speichert nur
öffentliche Credential-Daten; Passwörter bleiben eine Alternative. Passkeys
lassen sich in den Kontoeinstellungen hinzufügen, benennen und entfernen.
Ein Passwort-Reset meldet alle Geräte ab und entfernt bisherige Passkeys;
danach lassen sie sich neu hinzufügen. Ein normaler Passwortwechsel behält sie.
Bei deaktiviertem E-Mail-Feature ist die bisherige Registrierung mit
Benutzername und Passwort wieder verfügbar.

The public Zilch lobby paints its heading directly from HTML and shows its
controls without waiting for the account check. Creating a game, account data
and chat still require the confirmed identity. LCARS preloads its versioned,
immutable-cached font only when selected; a slow font keeps the fallback for
that page instead of moving the layout later. Private preview routes retain
their access checks. See the [loading-performance audit](docs/ZILCH_LOADING_AUDIT_2026-09-08.md)
for measured frontend improvements and the separate production transport issue.

**ZDWA** offers public profiles and rankings, Normal/Hardcore statistics, score
charts and completed-game replays. Achievement milestones award
additional points for exploring the account: setting or changing an avatar,
opening settings, statistics, rules, history, achievements and leaderboards,
using the GitHub links, changing language/theme, switching games, and saving
chat or push settings. These interaction awards are available in both ZDWA
and Zilch and are recorded from successful product actions. The sole
one-time repair is **Profile Picture** for accounts that already had a
currently stored avatar when the award shipped; it uses that durable avatar
record only. Historic avatar replacements and all game-history awards remain
forward-only. Rank thresholds remain fixed, so this expansion cannot demote a
player. In Zilch, interaction awards appear in the collection without opening
a result dialog over account or game controls.
**Ehrenberg-Marken**, which contribute to titles and star insignia. Newly earned
awards are celebrated individually, followed by a **LEVEL UP!** card for a
genuine title increase.

**Zilch** offers personal history, participant-only result reports, statistics
split by Solo/human/CPU play, and separate leaderboards. Its expanded namespaced
achievements cover scoring, risk, duels, CPU play, Solo efficiency, cross-game
play and community milestones. Personal awards contribute Zilch points;
community milestones have a fixed eligible audience and award no personal
points. An animated rank-up card follows earned award cards; the latest genuine
rank transition also supports one-time retrospective delivery for existing
accounts.

The account has a separate same-day series in both collections: finish a valid
ZDWA game and a valid Zilch game on the same Zurich calendar day to earn points
in each game. The series starts at its rollout boundary, so historic games are
not reinterpreted as a bulk of new awards. Existing rank thresholds stay fixed;
new high-end titles add room to progress without demoting anyone.

Guest play creates no account-linked history, statistics, ranking or
achievements. Administrative result deletion is audited; affected derived
statistics and revocable awards are updated within the correct game's boundary.

Details: [account statistics and achievement lifecycle](docs/ACCOUNT_STATISTICS.md).
Branch audit: [account security and Fairplay review](docs/ACCOUNT_SECURITY_REVIEW_2026-09-12.md).

Public profiles show deliberately abandoned started games separately for ZDWA
and Zilch. Only the account that explicitly ends the game receives the count.
Timeouts, disconnections, waiting-room cancellations and opponents' aborts do
not count. Scores and completed-game rankings remain based on finished games.
Six ZDWA Fairplay reminders mark 1, 5 and 10 deliberate aborts, separately for
Solo and multiplayer, with **zero rank points**. Old private Solo history is
not reclassified. Waiting for a timeout deliberately also remains uncounted;
the app cannot reliably distinguish intent from a connection failure.

The ZDWA lobby's **Wall of Shame**, below the score leaderboards, lists the
three active accounts with the most self-initiated abandonments in the last
ten days (a rolling 240 hours) and all time since tracking began. Normal and
Hardcore, Solo and multiplayer count together. Entries use account IDs and
current names, so renaming an account keeps its counts and reusing an old name
does not transfer them. Equal counts share a rank; a stable account-ID tie
break keeps each list to at most three accounts. The lists refresh with the
existing leaderboards and show an empty state until there are eligible games.

**Deutsch:** Öffentliche Profile zeigen selbst abgebrochene gestartete Partien
getrennt für ZDWA und Zilch. Nur das ausdrücklich abbrechende Konto erhält den
Zähler. Timeouts, Verbindungsabbrüche, abgesagte Warteräume und Abbrüche durch
Mitspieler zählen nicht. Punkte und Ergebnisranglisten beruhen weiter auf
abgeschlossenen Partien. Sechs ZDWA-Fairplay-Hinweise erinnern bei 1, 5 und 10
Abbrüchen getrennt für Solo und Mehrspieler daran, Partien zu Ende zu spielen –
mit **null Rangpunkten**. Alte private Solo-Historie wird nicht umgedeutet.
Bewusstes Warten auf einen Timeout bleibt ebenfalls ungezählt; die Anwendung
kann Absicht nicht sicher von einer Verbindungsstörung unterscheiden.

Die **Wall of Shame** unter den Punkte-Bestenlisten der ZDWA-Lobby zeigt die
drei aktiven Konten mit den meisten selbst ausgelösten Abbrüchen: in den
letzten zehn Tagen (rollierende 240 Stunden) und insgesamt seit Beginn der
Erfassung. Normal und Hardcore sowie Solo und Mehrspieler zählen zusammen.
Die Zuordnung folgt dem Konto, angezeigt wird der aktuelle Name. Umbenennen
erhält die eigenen Zähler; wer einen früheren Namen übernimmt, erbt sie nicht.
Gleiche Abbruchzahlen teilen sich einen Rang. Die stabile Reihenfolge nach
Konto-ID begrenzt jede Liste auf höchstens drei Konten. Die Listen laden mit
den bestehenden Bestenlisten nach und bleiben ohne passende Partien leer.

## Lobby chat

Both lobbies share one compact, expandable chat above their leaderboard section.

- Signed-in accounts can read and write; guests cannot.
- Each message identifies its sender and originating game: `zdwa` or `zilch`.
- Filters show ZDWA only, Zilch only, or both.
- The server freezes each message's eligible account audience when it is sent.
  Later logins cannot reveal messages sent while an account was disconnected,
  signed out or had chat disabled.
- Eligible history is retained for three days; older messages and audience
  records are permanently deleted.
- Chat and lobby-only message popups have separate account settings, both on
  by default and shared across devices.

Flood protection allows **400 characters per message** and **five messages per
account per 30 seconds**, shared across tabs and reconnects. Administrators can
mute an account (read-only) or exclude it from lobby chat, and remove either
restriction.

Game-room chat is separate: text survives reconnects in the active room state;
quick reactions also appear in each connected participant's live chat.

## Profiles and live game-start notices

Every account can add one small public profile picture in **Account**. The
server accepts JPG, PNG and WebP uploads up to **8 MB** and **4,096 × 4,096
pixels**, fully decodes them, then stores a fresh **256 × 256 WebP** without
original bytes or metadata. The stored image is capped at **64 KB**. This keeps
profiles, lobby chat, game rooms and statistics lightweight while preventing
uploaded image markup, script payloads and metadata from being served back.

**Game-start notices** use the existing private, account-bound player selection:
when a selected account starts a public, watchable ZDWA or Zilch game, connected
users who enabled the account setting see a short live banner in either lobby.
It links to spectator mode unless the recipient is already in a game. These
notices are neither push notifications nor persisted history; recipient consent,
selection membership, room access and account status are rechecked at delivery.

## Push notifications

Push is optional. Register each device from account settings and grant browser
permission. Registering a device only prepares it; invitations, reminders and
app update alerts are separate switches and **all start off** until the player
chooses them. In a supported lobby, a signed-in account with no enabled Push
category may see a friendly invitation to review the settings at most once per
14 days. It never opens the system permission sheet on its own: only the
player's explicit **Allow push on this device** click does that, then the player
chooses the categories. The account-wide off switch removes every stored device
subscription, even when used from a browser that cannot itself receive push.

The invitation is deliberately useful rather than generic: **player calls**
make it easy to join a public room with a free seat. A player can restrict those
calls to their private, account-bound player selection, while daily play ideas
and release notes remain separate choices.

| | Player invitations | Daily play reminders |
| --- | --- | --- |
| Trigger | A seated player clicks **Notify players** in a public waiting room | The server, only after a separate opt-in |
| Eligibility | Room still has an open seat; recipient opted in and is not already seated | Account has played neither ZDWA nor Zilch today |
| Timing | Any time, including after the recipient has already played | A new random time between 17:00 and 21:00, Europe/Zurich |
| Limits | One attempt per sender per minute across both games; one dispatch per room per ten minutes | At most one reminder attempt per account per Swiss calendar day |
| Click destination | The specific room, with normal join/rejoin checks | The selected game's lobby |

A valid human roll or scoring action counts as playing; finishing a game is not
required. Login, chat, spectating and CPU actions do not count. Existing
completed results are also checked. Activity and opt-out are checked again
immediately before dispatch.

Reminder schedules are stable across restarts. There is no overnight catch-up,
and durable daily claims prevent repeat attempts after failures or preference
changes. Each game has **32 German/English variants**: pub-table banter for
Zilch, cheerful challenges for ZDWA. The rotation advances with reminder
attempts, so skipped days do not skip texts. If both products are registered,
they alternate; the chosen game's subscribed devices receive the same message.

Invitation senders get brief in-app feedback, not a push themselves, and never
see recipient identities. Private, full, started and Solo rooms do not send
invitations. Clicking an invitation to a full or started room does not
automatically switch the recipient into spectator mode.

Production requires the three VAPID settings in the
[Web Push operations guide](docs/DEPLOYMENT.md#web-push). Push-service acceptance
does not guarantee when a device displays a notification.

### App update alerts

After a successful production deployment, opted-in accounts receive a short
German or English release notice. Backend-only updates say **“Stability
improvements”**; usability releases have a reviewed feature summary, such as
**“New: lobby chat.”** Clicking opens the matching game's lobby.

Release publication is tied to a healthy deploy, never a process restart.
Durable claims allow one attempt per account and Git revision, across the chosen
game's registered devices. For shared releases, only the most recently registered
eligible product is selected, avoiding duplicate alerts from both PWAs.
The eligible audience and devices are frozen at publication; later opt-ins do
not receive old releases. Consent is checked again before each device, and
pending releases expire after 24 hours. Play activity and invitation filters do
not suppress separately enabled update alerts.

### Private invitation allowlist

Account settings offer **All players** (the existing default) or **Selected
players only**. Open a player's profile in either game and choose **Add to player
selection**. Up to 100 accounts are stored by stable user ID, not typed names.
Player names in the lobby, chat and game link to profiles; opening a profile
from a live game uses a separate tab so the table stays connected.

Under **Account → Settings → Your player selection**, review the selected
accounts, remove them individually and save the invitation filter. The list
remains manageable when push is off. Adding a player enables neither push nor
the filter automatically. Only the actual authenticated sender can satisfy the
list, not another player seated at their table. An empty list with **Selected
players only** blocks every invitation.

The private, one-way list is shared across games and devices and affects only
player invitations. It is the foundation for a future friendlist; mutual friend
requests and public friendship profiles are not implemented.

### Zilch Classic

Classic keeps the tavern table, score notebook, dice and familiar wording.
The remaster uses restrained walnut tones, natural paper and matte brass
accents, with clearer type, fewer bevels and quieter shadows. Mode labels fit
narrow phones without splitting words. Scoring choices, dice states, shortcuts
and room layout retain their behavior. The LCARS theme remains independent.
The installed app's solid system canvas matches Classic's walnut palette;
its scrolling wood layer preserves the existing iOS safe-area handling.
The game chat bar keeps its dark background when opened or closed, including
after tapping on touchscreens.

**Deutsch:** Classic behält Wirtshaustisch, Notizblock, Würfel und vertraute
Begriffe. Das Remaster bringt ruhigere Nussbaumtöne, Naturpapier und matte
Messingakzente, klarere Schrift und weniger Glanz- und Schatteneffekte.
Spielartnamen passen auch auf schmale Handys ohne zerrissene Wörter.
Wertung, Würfelzustände, Tastenkürzel und Spielaufteilung funktionieren wie
bisher. LCARS bleibt eigenständig; auch der Systemrand der installierten App
passt zur neuen Holzpalette.
Die Chatleiste im Spiel bleibt beim Öffnen und Schließen dunkel, auch nach
dem Antippen auf Touchscreens.

Zilch's public lobby and rules page have host-specific canonicals and a
sitemap. The rules include core gameplay and the scoring table in the initial
HTML, and remain readable if the rules API is unavailable. Public product
icons are discoverable; private game and account pages stay noindex.
There is one canonical German page per route; the English interface is a
client-side preference, not a separate indexed language URL.

**Deutsch:** Lobby und Regeln haben eigene Canonicals und eine Sitemap für
die Zilch-Domain. Kernregeln und Punktetabelle stehen bereits im HTML und
bleiben auch bei einer gestörten Regeln-API lesbar. Öffentliche Produkticons
sind auffindbar; persönliche Spiel- und Kontoseiten bleiben ausgeschlossen.
Pro Route gibt es eine kanonische deutsche Seite. Die englische Oberfläche
ist eine Spracheinstellung, keine eigene indexierte Sprachadresse.

Details: [Zilch SEO review](docs/ZILCH_SEO_REVIEW_2026-09-12.md).

### Zilch recommendation tiles

Quick-hold tiles have 56px minimum touch targets (about 27% larger), clearer
labels and previews of the dice they select. Matching dice use a face plus a
count, such as **1 ×3**; mixed combinations show their actual faces. Selections
worth at least 1,000 points have a gold accent. Points, accessible labels and
keyboard shortcuts remain explicit. Tapping still only selects a reversible
draft; the scoring rules and roll/bank confirmation flow are unchanged.

## Release notes and feedback

After a successful release, a short, player-friendly **What's new?** dialog
explains the most important changes in German or English. It appears in the
lobby or account, never over a game room. **Got it** saves the acknowledgement
to your account across both games and all devices; guests acknowledge in their
current browser. **Later** or Escape defers the message for that page visit.
If you've missed several updates, only the latest relevant release pops up.

On a guest's first visit, the current release becomes that browser's starting
point without opening a dialog. Future updates are still announced, and
existing guest acknowledgements and account notifications continue to work.
The ZDWA lobby loads its registration security check only when you choose
**Register**. Focusing or autofilling login fields does not start it, and signing
in removes any obsolete check. Registration still requires the configured
security check; ordinary login and existing sessions do not run a hidden widget.

**Deutsch:** Beim ersten Gastbesuch öffnet sich kein Versionsdialog; der Browser
merkt sich den aktuellen Stand und zeigt spätere neue Updates weiterhin an.
Bestehende Gastbestätigungen und Kontohinweise bleiben erhalten. Die ZDWA-Lobby
lädt die Sicherheitsprüfung erst bei **Registrieren**, nicht beim Fokussieren
oder automatischen Ausfüllen der Anmeldefelder. Nach erfolgreicher Anmeldung
wird eine überholte Prüfung entfernt. Für die Registrierung bleibt sie erforderlich.

Measurement details: [ZDWA loading audit](docs/ZDWA_LOADING_AUDIT_2026-09-09.md).
Follow-up: [Classic loading and handwriting audit](docs/ZDWA_CLASSIC_LOADING_2026-09-10.md).

Revisit the **last ten releases** under **Account → Settings → News & versions**.
The first announcement also introduces lobby chat, invitation allowlists and
optional PWA push notifications. In-app notes do not require browser push
permission and do not change any notification preference.

**Help & more details**, collapsed beneath the history, links to
[GitHub issues](https://github.com/Maetran/RollTheDice/issues) and the more detailed
[changelog](CHANGELOG.md). To report a problem, describe what happened, the game,
your device and steps to reproduce it. A GitHub account is required; never share
passwords or private room codes.

Authors maintain the bilingual title and bullets in `app/release-notice.json`
alongside the short push summaries. The deploy archives those exact texts after
the application is healthy; restarting the server does not publish a release.
See the [release authoring guide](docs/DEPLOYMENT.md#spielerfreundliche-release-notes).

## Progressive Web Apps

Each game has its own installable PWA, manifest and versioned assets.

- ZDWA stays on `zockdiewandan.online`, preserving existing installations,
  bookmarks and origin-bound resume data.
- Zilch uses `zilch.zockdiewandan.online` and a network-only service worker;
  private room and API data are not cached.
- `zdwa.zockdiewandan.online` is a redirect-only alias.
- Installed PWAs keep game switching inside their existing app window:
  ZDWA uses the same-origin `/zilch` compatibility routes; Zilch uses the private
  `/zdwa` bridge. Account navigation preserves the currently selected game.
- Ordinary browser navigation uses each game's canonical origin.
- Zilch provides version-aware update/install notices. Dismissed install
  prompts snooze for seven days unless a new version is deployed.

On iPhone and iPad, enable push from the installed home-screen app.

The canonical lobbies and public rule pages are indexable. Personal pages,
temporary rooms and compatibility bridges stay `noindex`; the SEO registry
generates the corresponding sitemaps.

## Local development

Use Python 3.12+ (CI uses 3.13) and Node.js 22.

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
npm ci
npx playwright install chromium
```

Start the application:

```bash
ROLLTHEDICE_ZILCH_ACCESS_MODE=public \
  uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Environment variables are read by the application; Compose loads `.env`
automatically, while a direct Uvicorn launch requires exporting the variables
you need. Leave Turnstile, transactional email, passkeys and VAPID settings
disabled for ordinary local work.
Never use production push subscriptions for tests.

### Frontend workflow

Edit JavaScript and CSS in `frontend/`, then rebuild the committed assets:

```bash
npm run build:static
```

For changes only to static HTML, images or manifests, use `npm run sync:assets`.
The build creates deterministic content hashes for assets and service workers.
Generated files under `app/static/` must be committed alongside their sources.

### Quality checks

```bash
npm run lint
npm run test:backend
npm run test:browser
git diff --check
```

Browser tests start a separate server on port 8010 with a disposable SQLite
database. `npm run test:browser` also runs the username-change suite against a
fresh server in public Zilch mode (`playwright.username.config.js`), separately
from the private-preview scenarios. CI also runs security and dependency checks; see
[the quality workflow](.github/workflows/quality.yml).

Backend tests use `pytest-xdist`: pytest automatically selects up to four workers,
keeping tests from the same file together. This applies to Codex, the terminal,
CI and PyCharm pytest runs through `pyproject.toml`. Install the updated development
dependencies with `.venv/bin/python -m pip install -r requirements-dev.txt`.
Use `npm run test:backend -- -n 2` for two workers, or
`npm run test:backend -- -n 0` for a serial run. For a quick check without coverage,
run `.venv/bin/python -m pytest tests/test_scoring_logic.py -n 0`.

In PyCharm, select the project's `.venv/bin/python` interpreter and pytest as the
default test runner under Python Integrated Tools. You can then right-click
`tests` or an individual test file to run it; no pre-existing run configuration
is needed. Add `-n 0` to the generated pytest configuration when debugging with
breakpoints. Browser tests retain one worker because they share a server and
database; increasing their worker count requires a separate isolation check.

## Architecture

FastAPI serves static pages, REST endpoints and WebSocket rooms. SQLAlchemy and
Alembic manage SQLite persistence. Browser code uses native JavaScript modules,
bundled with esbuild; no separate frontend application server is required.

```text
app/
  main.py                 HTTP routes, lifecycle and application assembly
  game_websocket.py       Shared realtime coordinator
  game_ws_*.py            Session, gameplay, social and admin actions
  game_registry.py        Game-specific adapters
  game_engine.py          ZDWA turn/scoring engine
  zilch_*.py              Zilch engine, CPU, Solo, results and achievements
  lobby_chat.py           Audience-scoped cross-game chat
  web_push.py             Subscriptions, preferences and room invitations
  push_reminders.py       Activity-aware daily scheduler
  push_reminder_copy.py   Bilingual reminder catalog
  game_activity.py        Minimal cross-game play-day evidence
  models.py               Accounts, sessions, game and community data
  product_hosts.py        Canonical origins and safe handoffs
  site_seo.py             Public-page registry, robots and sitemaps
  static/                 HTML, generated browser assets and PWA workers
frontend/                 Authored JavaScript and CSS
alembic/                  Versioned database migrations
tests/                    Backend and browser regression suites
scripts/                  Builds, validation, backups and deployment
docs/                     Rules, architecture and operations
data/                     Runtime SQLite/JSON data; never committed
```

The shared account, session, chat, rejoin and transport infrastructure does not
mix game rules or result processing. Completed results carry an explicit
`game_type`; private Zilch payloads never enter ZDWA aggregates.
See [the multi-game foundation](docs/MULTIGAME_FOUNDATION.md).

## Data and deployment

The SQLite database stores accounts, sessions, active-game recovery snapshots,
typed completed results, account-safe abandoned-game aggregates, achievements,
chat audiences and push subscriptions.
Legacy ZDWA leaderboard JSON files remain in `data/` for compatibility.

Back up the **entire data directory while the application is stopped**, including
SQLite WAL files when present. Do not replace or delete it during an update.
Completed results are finalized idempotently; active recovery state is retained
until persistence succeeds.

For production, use the guarded deployment workflow:

```bash
scripts/deploy_zdwa.sh
```

It checks the remote worktree, briefly stops the service for a consistent backup,
fast-forwards the selected branch, verifies asset versions, rebuilds the
container and checks `/api/health`. After success it retains the five newest
deployment backups. Startup applies Alembic migrations before readiness.

The documented deployment uses one application process behind Nginx and a
loopback-bound container port. The two canonical origins share that process and
one data directory. Do not add application workers without redesigning the
process-local realtime room ownership.

See [deployment, host setup and rollback](docs/DEPLOYMENT.md) for the complete
preflight and production verification procedure.

## Documentation

- [Player rules: ZDWA](https://zockdiewandan.online/regeln) ·
  [Zilch](https://zilch.zockdiewandan.online/regeln)
- [Zilch rule contract](docs/ZILCH_RULES.md)
- [Multi-game architecture](docs/MULTIGAME_FOUNDATION.md)
- [Statistics, achievements and ranks](docs/ACCOUNT_STATISTICS.md)
- [Localization conventions](docs/LOCALIZATION.md)
- [Deployment and operations](docs/DEPLOYMENT.md)

## Product delivery gate

Every visible change ships as a complete German/English product increment:
update this README, update player rules when behavior changes, and keep
canonical URLs, Open Graph metadata and indexing policy correct.

The mandatory [product delivery standard](docs/PRODUCT_DELIVERY.md) is enforced
through `npm run lint` and CI. Backend tests and, for visible changes, browser
tests are required before committing and deploying.
