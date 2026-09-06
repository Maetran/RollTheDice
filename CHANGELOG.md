# Versionshistorie / Changelog

Hier stehen die wichtigsten Änderungen etwas ausführlicher als in der App.
Die App zeigt die letzten zehn veröffentlichten Versionen mit kurzen,
verständlichen Hinweisen. Der
[vollständige Entwicklungsverlauf](https://github.com/Maetran/RollTheDice/commits/master/)
enthält auch ältere und rein technische Änderungen.

This page provides more detail than the in-app release notes. The app keeps the
last ten published versions easy to read. The
[complete development history](https://github.com/Maetran/RollTheDice/commits/master/)
also includes older and internal changes.

## Nächster Release / Next release — Deine Leute, klarere Würfel

### Deutsch

- In beiden Spielen lassen sich Spieler direkt am Profil zur privaten
  Spielerauswahl hinzufügen oder daraus entfernen. Die Liste speichert feste
  Konten; Namen müssen nicht mehr fehlerfrei eingetippt werden. Spielernamen im
  Lobby-Chat führen ebenfalls zum Profil. Aus einer laufenden Partie öffnet
  sich das Profil separat, damit die Spielverbindung bestehen bleibt.
- **Konto → Einstellungen → Deine Spielerauswahl** zeigt die ausgewählten
  Konten mit einzelnen Entfernen-Aktionen. Du kannst die Liste auch bei
  ausgeschaltetem Push pflegen. Hinzufügen aktiviert weder Push noch den
  Filter automatisch. Es bleibt eine private, einseitige Auswahl ohne
  Freundschaftsanfragen; bestehende Einträge und Einwilligungen bleiben erhalten.
- Zilch-Empfehlungen sind mit mindestens 56 Pixeln Höhe rund 27 % größer.
  Passende Würfel, Mengenangaben und ein goldener Akzent ab 1’000 Punkten helfen
  beim schnellen Erkennen. Beschriftungen, Punkte und Tastenkürzel bleiben
  sichtbar. Spielregeln und Bestätigung durch Weiterwürfeln oder Sichern ändern
  sich nicht.
- Technisch: einzelne kontogebundene Änderungen statt kompletter Textlisten,
  Schutz gegen veraltete Kontositzungen und parallele Hinzufügungen. Keine neue
  Datenbankmigration; ältere Push-Clients bleiben kompatibel.

### English

- Add or remove players from your private selection directly on their profile
  in either game. The list stores fixed accounts, so usernames no longer need
  to be typed correctly. Names in lobby chat also link to profiles. From a
  live game, profiles open separately to preserve the game connection.
- **Account → Settings → Your player selection** lists the selected accounts
  with individual remove actions. Manage it even with push off. Adding someone
  enables neither push nor the filter automatically. This remains a private,
  one-way selection without friend requests; existing entries and consent are
  preserved.
- Zilch recommendation tiles have a minimum height of 56 pixels, about 27 %
  larger. Matching dice, counts and a gold accent for at least 1,000 points make
  them easier to recognize. Labels, points and shortcuts stay visible. Scoring
  rules and confirmation through rolling again or banking are unchanged.
- Internally: account-bound individual edits replace whole text lists, with
  protection against stale account sessions and concurrent additions. No new
  database migration; older push clients remain compatible.

## 2026-09-06 — Neuigkeiten direkt in der App / In-app release notes

[Release-Code: 743cff7](https://github.com/Maetran/RollTheDice/commit/743cff7d779c318aab8ff20df878171368df520c)

### Deutsch

- Ein neuer Hinweis erklärt nach einem Release die wichtigsten Änderungen.
  **Verstanden** bestätigt ihn dauerhaft für dein Konto, in beiden Spielen und
  auf allen Geräten. Gäste bestätigen im jeweiligen Browser. **Später** stellt
  die Meldung nur für den aktuellen Seitenbesuch zurück.
- Unter **Konto → Einstellungen → Neuigkeiten & Versionen** lassen sich die
  letzten zehn zum Spiel passenden Releases nachlesen. Laufende Spielräume
  werden nicht mit Release-Popups unterbrochen; es gibt keine Kette alter
  Meldungen, wenn du länger nicht da warst.
- Die erste Meldung fasst zusätzlich Lobby-Chat, optionale Push-Einladungen,
  private Spielerauswahl, Spielerinnerungen und den Zilch-Verlassen-Dialog
  zusammen. Spätere Meldungen behandeln nur die jeweilige neue Version.
- Eingeklappt unter **Hilfe & weitere Details** findest du Links für
  Fehlermeldungen und diese Historie. In-App-Hinweise ändern keine
  Push-Einstellungen und benötigen keine Benachrichtigungsfreigabe.
- Für den Betrieb: deutsche und englische Texte werden gemeinsam geprüft und
  erst nach einem erfolgreichen Rollout archiviert. Bestätigungen überstehen
  Neustarts. Bestehende kurze Push-Hinweise bleiben erhalten, ohne nachträglich
  ein Popup auszulösen.

### English

- A new message explains the most important changes after a release.
  **Got it** acknowledges it across both games and all devices on your account.
  Guests acknowledge in their current browser. **Later** only postpones the
  message for the current page visit.
- Revisit the last ten relevant releases under **Account → Settings → News &
  versions**. Release popups never interrupt game rooms, and returning after a
  break won't produce a queue of old announcements.
- The first announcement also introduces lobby chat, optional push invitations,
  private invitation sender lists, play reminders and Zilch's leave-game dialog.
  Later announcements cover only their own release.
- **Help & more details** keeps links to issue reporting and this history tucked
  away. In-app notes do not change your push preferences or require notification
  permission.
- Operations: German and English texts are validated together and archived only
  after a successful rollout. Acknowledgements survive restarts. Existing short
  push summaries stay in the history without retroactively showing popups.

## 2026-09-06 — Versions-Push und private Spielerauswahl

[Release-Code: 3a514f9](https://github.com/Maetran/RollTheDice/commit/3a514f95105c83e8d61c9394d3026570ee279d3e)

### Deutsch

- Versionshinweise per Push sind eine eigene, anfangs ausgeschaltete Kategorie.
  Kurze Texte melden neue Funktionen oder Verbesserungen an der Stabilität; ein
  Klick öffnet die passende Lobby.
- Du kannst Mitspieler-Einladungen auf bis zu 100 bestehende Benutzernamen
  begrenzen. Die private Liste gilt spielübergreifend. Nur der tatsächliche
  Absender zählt; eine leere Auswahlliste blockiert alle Einladungen.
- Erfolgreiche Deployments veröffentlichen einen Hinweis einmal je Git-Version.
  Neustarts wiederholen ihn nicht. Neue Einwilligungen erhalten keine alten
  Push-Meldungen; Ausschalten wird vor dem Versand erneut geprüft.

### English

- App update push alerts are a separate category, initially off. Short texts
  announce new features or stability improvements; a click opens the right lobby.
- Limit player invitations to up to 100 existing usernames. The private list
  spans both games. Only the actual sender counts; an empty list blocks all
  invitations.
- Successful deployments publish once per Git revision. Restarts do not repeat
  the announcement. Later opt-ins do not receive old pushes, and opt-out is
  checked again before sending.

## 2026-09-06 — Rückblick: zusammen spielen / Catch-up: playing together

Diese Zusammenfassung gruppiert die unmittelbar vorherigen Änderungen; sie
erfindet keine rückwirkenden In-App-Releases.

This recap groups the immediately preceding changes; it does not create
retroactive in-app releases.

| Änderung / Change | Deutsch | English |
| --- | --- | --- |
| [Chat & Einladungen](https://github.com/Maetran/RollTheDice/commit/affa061) | Gemeinsamer Lobby-Chat mit Filtern, dreitägigem berechtigungsgebundenem Verlauf, Chat-Einstellungen und Admin-Moderation. Optionale Push-Einladungen für offene öffentliche Spielräume, mit Mengenbegrenzung. | Shared lobby chat with filters, three-day eligible history, chat settings and admin moderation. Optional, rate-limited push invitations for open public tables. |
| [Spielerinnerungen](https://github.com/Maetran/RollTheDice/commit/a95b2a3) und [Verfeinerung](https://github.com/Maetran/RollTheDice/commit/7237c47) | Separat aktivierbar: höchstens einmal täglich, zufällig zwischen 17 und 21 Uhr Schweizer Zeit, nur wenn heute noch keines der Spiele gespielt wurde. Je Spiel 32 deutsche/englische Varianten. Der Kontowechsel in der Zilch-PWA behält das gewählte Spiel bei; README neu strukturiert. | Separate opt-in: at most once daily, randomly between 17:00 and 21:00 Swiss time, only if neither game has been played today. 32 German/English variants per game. Account navigation in the Zilch PWA preserves the selected game; README reorganized. |
| [Zilch-Reaktionen](https://github.com/Maetran/RollTheDice/commit/1beadc8) | Quick Reactions erscheinen auch im Live-Spielraum-Chat. | Quick reactions also appear in the live game-room chat. |
| [Spiel verlassen](https://github.com/Maetran/RollTheDice/commit/db4bd58) | Zilch bietet Pause, Zur Lobby und Im Spiel bleiben. Zur Lobby beendet den Raum für alle. Beide Spielräume verzichten auf den Spielwechsel im Header. | Zilch offers Pause, Return to Lobby and Stay in Game. Returning to the lobby ends the room for everyone. Both game rooms omit the game switcher. |
| [Warteansicht](https://github.com/Maetran/RollTheDice/commit/e6f58f7) | Der Zilch-Wartebereich sitzt beim späteren Entscheidungswurf neben dem Block. | Zilch's waiting area sits beside the score sheet, where the opening roll later takes place. |

## Einen Fehler melden / Report a problem

Suche zuerst in den [GitHub-Issues](https://github.com/Maetran/RollTheDice/issues),
ob das Problem schon gemeldet wurde. Für eine neue Meldung beschreibe das Spiel,
Gerät und Browser, die Schritte zum Fehler, das erwartete und das tatsächliche
Verhalten. Ein geschwärzter Screenshot hilft. Du brauchst ein GitHub-Konto;
Passwörter, Zugangsdaten und private Spielraum-Codes gehören nicht in ein Issue.

Check [GitHub issues](https://github.com/Maetran/RollTheDice/issues) first to see
whether the problem is already reported. Include the game, device and browser,
steps to reproduce, and expected versus actual behavior. A redacted screenshot
helps. You'll need a GitHub account; never post passwords, credentials or private
room codes in an issue.
