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

## Nächster Release / Next release — Mehr Ziele, klarer Tisch

### Deutsch

- Die beiden Erfolgs-Sammlungen wachsen unabhängig weiter. Die neue Serie
  **Doppelwurf** zählt einen Zürcher Kalendertag, an dem du eine gültige ZDWA-
  und eine gültige Zilch-Partie abschließt. Es gibt Ziele für das erste Mal,
  10, 50, 100 und 500 solcher Tage sowie für 3, 7, 14 und 30 Tage am Stück.
  Beide Spiele vergeben dafür eigene Punkte und eigene Abzeichen.
- Weitere Ziele würdigen lange Spielserien, große Punktesammlungen,
  Mehrspieler- und Teamrunden sowie Zilch-Runden mit hohen Bankwerten. Die
  Zilch-Community kann nun außerdem 25’000, 50’000 und 100’000 abgeschlossene
  Partien gemeinsam feiern.
- Bestehende Rangschwellen bleiben unverändert. Neue hohe Stufen verlängern den
  Weg nach oben, sodass kein Konto durch die Erweiterung zurückgestuft wird.
  Die neue Doppelwurf-Serie startet erst mit diesem Release; alte oder
  importierte Partien werden nicht nachträglich als neue Erfolge gezählt.
- In ZDWA behalten Highscore-Tabellen auch ohne Ergebnis-Link eine einheitliche
  Zeilenhöhe. Zilch zeigt den Wechsel zu ZDWA mit besserem Kontrast; in der
  installierten Zilch-App liegt die Holztextur wieder hinter Lobby und Spiel
  über die volle sichtbare Fläche.

### English

- Both achievement collections grow independently. The new **Double Roll**
  series counts a Zurich calendar day on which you finish one valid ZDWA game
  and one valid Zilch game. Goals cover the first day, 10, 50, 100 and 500
  such days, plus runs of 3, 7, 14 and 30 days. Each game grants its own
  points and badge.
- More goals celebrate long runs, big point collections, multiplayer and team
  tables, and high-value Zilch banks. The Zilch community can now also
  celebrate 25,000, 50,000 and 100,000 completed games together.
- Existing rank thresholds remain unchanged. New high tiers extend the path
  upward, so no account is demoted by this expansion. The Double Roll series
  begins with this release; old or imported games are not retroactively turned
  into new awards.
- ZDWA high-score tables keep a uniform row height even without a result link.
  Zilch gives the route to ZDWA better contrast; in the installed Zilch app,
  the wood texture again fills the entire visible lobby and game surface.

## Nächster Release / Next release — Push-Auswahl mit Mitspieler-Rufen

### Deutsch

- Die Lobby kann angemeldete Konten ohne aktivierte Push-Art höchstens alle
  14 Tage freundlich in die Push-Einstellungen einladen. Die Begrenzung gilt
  kontoweit, also auch bei mehreren Tabs und zwischen ZDWA und Zilch.
- Der Hinweis öffnet den Systemdialog nie von selbst. Erst der bewusste Klick
  auf **Push zulassen & auswählen** fragt das Gerät nach der Freigabe, meldet
  dieses Gerät an und führt direkt zur Auswahl im Konto.
- Neue Geräte aktivieren keine Nachrichtenart mehr automatisch. Spieler wählen
  Mitspieler-Rufe für freie öffentliche Plätze, tägliche Spielideen und
  Versionshinweise einzeln; alles bleibt jederzeit ausschaltbar. Die private
  Spielerauswahl kann Mitspieler-Rufe weiterhin auf bekannte Konten begrenzen.

### English

- The lobby may gently invite signed-in accounts with no active Push category
  to review Push settings at most every 14 days. The limit is account-wide,
  including across tabs and between ZDWA and Zilch.
- The hint never opens the system permission sheet by itself. Only the
  deliberate **Allow push & choose** click asks the device for permission,
  registers that device and takes the player straight to the account choices.
- New devices no longer enable any message category automatically. Players
  choose player calls for free public seats, daily play ideas and release
  notes separately; everything remains switchable off. The private player
  selection can still limit player calls to known accounts.

## Nächster Release / Next release — Profilbilder für echte Fotos

### Deutsch

- Profilbilder akzeptieren jetzt normale JPG-, PNG- und WebP-Fotos bis 8 MB
  und 4’096 × 4’096 Pixel. Damit funktionieren auch typische Handyfotos wie
  das bisher abgewiesene, rund 384 KB große PNG zuverlässig.
- Die Vorschau blockiert Bilder nicht mehr wegen einer unzuverlässigen
  Browser-Dekodierung. Auch wenn ein mobiles Dateiauswahlfenster keinen
  Medientyp mitliefert, prüft und verarbeitet der Server das Bild verbindlich.
- Die Sicherheit und der Speicherbedarf bleiben klein: Der Server prüft das
  Format und alle Pixel vollständig, entfernt Metadaten und speichert nur eine
  neu erzeugte quadratische 256-Pixel-WebP-Datei bis 64 KB. Die hochgeladene
  Originaldatei wird nie gespeichert.

### English

- Profile pictures now accept ordinary JPG, PNG and WebP photos up to 8 MB and
  4,096 × 4,096 pixels. Typical phone photos, including PNG files around
  384 KB that were previously rejected, now work reliably.
- Preview no longer blocks pictures because of unreliable browser decoding.
  Even when a mobile file picker omits a media type, the server remains the
  strict authority that verifies and processes the image.
- Safety and storage stay small: the server fully checks the format and every
  pixel, removes metadata and stores only a newly generated square 256-pixel
  WebP up to 64 KB. The uploaded original is never stored.

## Nächster Release / Next release — Zilch-Zug klarer, Lobby-Chat ruhiger

### Deutsch

- Der Zilch-Aktionsknopf orientiert sich nun direkt am serverseitigen Zugrecht.
  Sobald du würfeln darfst, ist **Würfeln**, **Weiterwürfeln** oder
  **Bestätigen** eindeutig hervorgehoben – auch wenn die kurze Zilch- oder
  Zugwechselanimation noch ausläuft. Ein zurückhaltender goldener Rand pulsiert
  langsam; bei reduzierter Bewegung bleibt er ruhig.
- Verbindungsstatus sind aus dem Lobby-Chat entfernt. Es entstehen keine neuen
  Meldungen wie „… ist jetzt verbunden“, und alte Statusereignisse werden nicht
  mehr aus der dreitägigen persönlichen Historie ausgespielt. Spielertexte,
  Berechtigungen, Löschfrist und Flood-Schutz bleiben unverändert.

### English

- The Zilch action button now follows the server-authoritative turn right.
  Whenever you may roll, **Roll**, **Roll again** or **Confirm** is clearly
  highlighted – including while a brief Zilch or turn-change animation is
  still finishing. A restrained gold border pulses slowly; it stays still for
  reduced-motion users.
- Connection status has been removed from lobby chat. No new “... is now
  connected” notices are created, and old status events are no longer shown
  from the three-day personal history. Player messages, authorization,
  deletion period and flood protection are unchanged.

## Nächster Release / Next release — Profilbilder & Spielstart live

### Deutsch

- Konten können unter **Konto → Einstellungen** ein kleines Profilbild für
  ZDWA und Zilch hinterlegen. Akzeptiert werden JPG, PNG und WebP bis 8 MB
  sowie 4’096 × 4’096 Pixel. Der Server decodiert jedes Bild vollständig und
  speichert nur eine frisch erzeugte quadratische 256-Pixel-WebP-Datei ohne
  Originaldatei, Metadaten oder Animation. Das gespeicherte Bild bleibt auf
  64 KB begrenzt und erscheint in Profilen, Chat, Spielraum und Statistiken.
- **Startmeldungen ausgewählter Spieler** sind eine neue, standardmäßig aktive
  Konto-Einstellung. Wenn ein Konto aus der privaten Spielerauswahl eine
  öffentliche zuschauerfähige Partie startet, sehen verbundene Empfänger in
  beiden Lobbys eine kurze Meldung. Außerhalb eines Spiels führt
  **Zuschauen** direkt in die Zuschaueransicht.
- Die Meldungen sind weder Push noch Chat und werden nicht gespeichert.
  Auswahl, Kontostatus, Zilch-Zugang, Raumstatus und Zuschauerberechtigung
  werden beim Versand nochmals geprüft. Teilnehmer, private und geschützte
  Räume bleiben ausgeschlossen; nach einer Minute ist das Ereignis ungültig.

### English

- Accounts can add one small profile picture for ZDWA and Zilch under
  **Account → Settings**. JPG, PNG and WebP up to 8 MB and 4,096 × 4,096
  pixels are accepted. The server fully decodes every image and stores only a
  newly generated square 256-pixel WebP without original bytes, metadata or
  animation. The stored image remains capped at 64 KB and appears in profiles,
  chat, game rooms and statistics.
- **Game start notices from selected players** are a new, enabled-by-default
  account setting. When an account from a private player selection starts a
  public watchable game, connected recipients see a short notice in either
  lobby. Outside a game, **Watch** opens spectator mode directly.
- Notices are neither push nor chat and are never stored. Selection,
  account state, Zilch access, room state and spectator access are checked
  again at delivery. Participants, private and protected rooms are excluded;
  the event expires after one minute.

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
