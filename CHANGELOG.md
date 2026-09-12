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

## Erreichbare Erfolge / Reachable achievements — 2026-09-12

- **Deutsch:** Zilchs Konto verlinkt die eigene Historie direkt aus den
  Statistiken. ZDWA zählt den sichtbar geöffneten Verlauf für Rückblick;
  versteckte oder fehlgeschlagene Ladevorgänge zählen nicht. Erfolgsanzeigen
  werden nach neuen Aktionen aktualisiert. GitHub-Klicks bleiben auch beim
  Wechsel aus der installierten App einem angemeldeten Konto zugeordnet.
  Regel- und Ranglistenbesuche über die ZDWA-Ansicht der Zilch-App sowie
  gespeicherte Sprachänderungen lösen ihre Erfolge zuverlässig aus.
  Styler Full und Styler-Show zählen künftig nur belegte Fünflings-Fulls;
  alte mehrdeutige Ergebnisse vergeben keine neuen Erfolge. Bereits vergebene
  Auszeichnungen bleiben erhalten. Kein Backfill, stiller Rollout.
- **English:** Zilch links personal history directly from account statistics.
  ZDWA counts visibly opened history for Looking Back; hidden or failed loads
  do not count. Collections refresh after new actions. GitHub clicks retain
  account attribution when leaving an installed app. Rule and leaderboard
  visits through Zilch's embedded ZDWA pages and saved language changes trigger
  their achievements. Styler Full and Styler Show now require proven
  five-of-a-kind Full entries; ambiguous old scores grant no new awards.
  Existing awards stay intact. No backfill; silent rollout.

## Zilch Classic Chatleiste / Chat bar — 2026-09-12

- **Deutsch:** Die Chatleiste bleibt beim Öffnen, Schließen und erneuten
  Antippen dunkel und lesbar. Ein allgemeiner Hover-Effekt übermalt ihren
  Hintergrund nicht mehr. Stiller Hotfix ohne Versions-Push oder neues Popup.
- **English:** The chat bar stays dark and readable when opened, closed or
  tapped again. A generic hover effect no longer covers its background.
  Silent hotfix without a release push or new popup.

## Zilch Classic Remaster — 2026-09-12

- **Deutsch:** Classic behält den Wirtshauslook mit Notizblock und Würfeln,
  erhält aber ruhigere Nussbaumtöne, helle Naturpapierflächen und matte
  Messingakzente. Klarere Schrift, zurückhaltende Schatten und besser lesbare
  Auswahlfelder lösen die kräftigen Glanz- und Gelbeffekte ab. Die Bedienung
  und das Wording bleiben erhalten; LCARS bleibt unverändert.
  Die Zilch-Regeln samt Punktetabelle sind schon ohne JavaScript lesbar und
  bleiben bei einer gestörten Regeln-API verfügbar. Such- und Vorschautexte,
  der direkte Regeln-Link und öffentlich indexierbare Produkticons ergänzen
  die vorhandenen Canonicals und Sitemap.
- **English:** Classic keeps its tavern table, score notebook and dice, with
  quieter walnut tones, natural paper and matte brass accents. Clearer type,
  restrained shadows and readable mode choices replace heavy gloss and yellow
  highlights. Controls and familiar wording stay intact; LCARS is unchanged.
  Core Zilch rules and the scoring table are readable without JavaScript and
  survive a rules API outage. Clearer search and preview copy, a direct rules
  link and indexable public product icons complement the existing canonicals
  and sitemap.

## Wall of Shame — 2026-09-12

- **Deutsch:** Unter den ZDWA-Bestenlisten stehen jetzt die drei Konten mit
  den meisten selbst abgebrochenen gestarteten Partien: letzte zehn Tage und
  insgesamt seit Beginn der Erfassung. Normal und Hardcore sowie Solo und
  Mehrspieler zählen zusammen. Timeouts, Verbindungsabbrüche und Abbrüche
  durch Mitspieler zählen weiterhin nicht. Die Listen zeigen aktuelle Namen
  aktiver Konten und verlinken ihre Profile; gleiche Zahlen teilen sich einen
  Rang. Auch ein unperfekter Zettel verdient ein Ende.
- **English:** Below the ZDWA score leaderboards, two new lists show the three
  accounts with the most started games they abandoned themselves: the last
  ten days and all time since tracking began. Normal and Hardcore, Solo and
  multiplayer count together. Timeouts, disconnections and opponents' aborts
  still do not count. Active accounts appear under their current names with
  profile links; equal counts share a rank. Even an imperfect scorecard
  deserves a finish.

## Passkey zuerst / Passkey first — 2026-09-12

- **Deutsch:** Die Anmeldung stellt Passkeys nach vorne. Benutzername und
  Passwort erscheinen erst nach „Mit Passwort anmelden“. Nach einem Abbruch
  bleibt diese Alternative über einen ausdrücklichen Schritt erreichbar.
  Konten ohne Passkey erhalten in beiden Lobbys und Kontoseiten einen direkten
  Einrichtungshinweis. Er verschwindet nach der Einrichtung und kommt nach
  dem Entfernen des letzten Passkeys wieder. Erforderliche Passwortwechsel
  haben Vorrang; laufende Spiele werden nicht unterbrochen.
- **English:** Sign-in leads with passkeys. Username and password fields appear
  after choosing “Sign in with password”, including after cancelling a passkey
  attempt. Accounts without a passkey receive a direct setup reminder in both
  lobbies and account pages. It disappears after setup and returns when the
  last passkey is removed. Required password changes take priority; active
  games remain uninterrupted.

## Klarere Kontoeinstellungen und E-Mail / Clearer account settings and email — 2026-09-12

- **Deutsch:** ZDWA und Zilch ordnen die Einstellungen gleich: Profil und
  Zugang, Sprache und Spiel, Mitspieler und Hinweise sowie Hilfe und
  Neuigkeiten. Passkeys stehen beim Zugang vorne; Profilbearbeitung und
  Passwortwechsel öffnen sich bei Bedarf. Deaktivierte E-Mail-Funktionen
  belegen keine eigene Karte. Sprache, Lobby-Chat und ZDWA-Spieloptionen
  lassen sich getrennt speichern, ohne sich gegenseitig zurückzusetzen.
- **English:** Both games use the same settings order: profile and sign-in,
  language and play, players and notifications, then help and updates. Passkeys
  lead the sign-in section; profile editing and password changes open when
  needed. Disabled email features no longer occupy a separate card. Language,
  lobby chat and ZDWA gameplay preferences save independently without resetting
  one another.

- **Deutsch:** Neue Konten werden per E-Mail-Link bestätigt; Bestandskonten
  können eine bestätigte Adresse ergänzen und ihr Passwort selbst zurücksetzen.
  Beide Spiele senden über Resend von `noreply@zockdiewandan.online`, mit
  verifiziertem SPF/DKIM, striktem DMARC und verschlüsselter Zustellung.
  Ein Reset meldet alle Geräte ab und entfernt bisherige Passkeys.
- **English:** New accounts are confirmed by email; existing accounts can add
  a verified address and reset their password. Both games send through Resend
  from `noreply@zockdiewandan.online`, using verified SPF/DKIM, strict DMARC and
  encrypted delivery. A reset signs out every device and removes existing passkeys.

## Passkeys und Fairplay / Passkeys and fair play — 2026-09-12

- **Deutsch:** Passkeys werden zur bevorzugten Anmeldung in ZDWA und Zilch.
  In den Kontoeinstellungen lassen sie sich hinzufügen, benennen und entfernen;
  die Passwort-Anmeldung bleibt verfügbar. Öffentliche Profile zählen selbst
  ausdrücklich abgebrochene gestartete Partien getrennt je Spiel. Timeouts,
  Verbindungsabbrüche, abgesagte Warteräume und Abbrüche durch Mitspieler zählen
  nicht. Sechs ZDWA-Fairplay-Hinweise bei 1, 5 und 10 Abbrüchen erinnern getrennt
  für Solo und Mehrspieler ans Fertigspielen und vergeben null Rangpunkte.
  Alte private Solo-Historie wird nicht nachträglich umgedeutet. Der ausgewählte
  Rollout aktiviert Passkeys und Fairplay; E-Mail-Funktionen bleiben aus.
  Der Anmelden-Link auf der öffentlichen Zilch-Seite öffnet zuverlässig das
  gemeinsame Anmeldeformular und behält das gewählte Rückkehrziel.
- **English:** Passkeys become the preferred sign-in choice in ZDWA and Zilch.
  Add, name and remove them in account settings; password sign-in remains
  available. Public profiles count started games explicitly ended early by
  that account, separately for each game. Timeouts, disconnections, cancelled
  waiting rooms and games ended by opponents do not count. Six ZDWA Fairplay
  reminders at 1, 5 and 10 early endings encourage finishing, separately for
  Solo and multiplayer, with zero rank points. Earlier private Solo history
  is not reclassified. The selected rollout enables passkeys and Fairplay;
  email features remain off.
  Sign in on the public Zilch site reliably opens the shared login form and
  preserves the selected return destination.
- **Prüfung / Review:** [Account security and Fairplay review](docs/ACCOUNT_SECURITY_REVIEW_2026-09-12.md).

## Stille Korrektur / Silent fix — Aktuelle Namen in früheren Partien — 2026-09-12

- **Deutsch:** Abgeschlossene ZDWA- und Zilch-Partien, Spielhistorie und
  Bestenlisten zeigen den aktuellen Kontonamen. Die Zuordnung verwendet feste
  Teilnehmer- und Konto-IDs; die Übernahme eines freigewordenen Namens überträgt
  keine alten Partien. Gleichstände, Teams und namensgleiche Gäste werden
  getrennt behandelt. Gastnamen, unklare Altbestände, Nachrichtentexte und
  selbst gewählte Spieltitel bleiben unverändert. Gespeicherte Spielverläufe und
  Punkte werden nicht umgeschrieben. Dieser Rollout sendet keinen Versions-Push
  und veröffentlicht kein neues In-App-Popup.
- **English:** Completed ZDWA and Zilch games, history and leaderboards show
  the current account name. Fixed participant and account IDs preserve ownership
  when a released username is reused. Ties, teams and guests sharing a name
  remain distinct. Guest names, ambiguous legacy records, message text and
  custom game titles stay unchanged. Stored gameplay and scores are not
  rewritten. This rollout sends no release push and creates no new in-app popup.

## Benutzername ändern / Change username — 2026-09-11

- **Deutsch:** In den Einstellungen von ZDWA und Zilch lässt sich der gemeinsame
  Benutzername mit dem aktuellen Passwort ändern. Vergebene und ungültige Namen
  werden verständlich abgefangen. Anmeldung, Profil und neue Partien verwenden
  den neuen Namen; Statistiken, Erfolge, Sitzungen und Spielerauswahl bleiben
  erhalten. Bestehende Partien und Nachrichten behalten ihren gespeicherten
  Namen. Der Profillink ändert sich und der bisherige Name wird frei.
- **English:** Change the shared username in either game's settings using the
  current password. Clear messages explain invalid or taken names. Signing in,
  profiles and new games use the new name; statistics, achievements, sessions
  and player selection are preserved. Existing games and messages keep their
  recorded names. The profile link changes and the previous name becomes available.

## Stille Korrektur / Silent fix — Geschriebene Punkte und ruhigeres Laden

- **Deutsch:** Neue Classic-Punkte werden Ziffer für Ziffer mit echten
  Kugelschreiber-Pfaden geschrieben, auch beim Mitspieler. Bestehende Einträge
  bleiben bei Neuladen und Wiederverbinden ruhig; reduzierte Bewegung zeigt
  sofort die fertigen Zahlen. Wertung und Bedienung warten nie auf die Animation.
  Die Registrierungsprüfung startet nur noch bei „Registrieren“, nicht bei
  Login-Fokus oder Autofill, und wird nach einer Anmeldung entfernt.
- **English:** New Classic scores are written digit by digit with real ballpoint
  paths, including on the other player's screen. Existing entries do not replay
  on reload or reconnect; reduced motion shows the finished numbers immediately.
  Scoring and controls never wait for the animation. Registration verification
  starts only on “Register”, not login focus or autofill, and is removed on login.
- **Messung / Measurement:**
  [Classic loading and handwriting audit](docs/ZDWA_CLASSIC_LOADING_2026-09-10.md).

## Stille Korrektur / Silent fix — Classic näher am Kaffeetisch

- **Deutsch:** Der ZDWA-Classic-Schreibblock hat wärmeres, gedämpftes Papier
  statt einer grell hellen Fläche. Blaue Kugelschreiber-Schrift und locker
  gezeichnete Linien bleiben klar lesbar. Die Handschrift wird lokal
  mitgeliefert. Unregelmäßige Filzfasern und glatte Sepia-Würfel mit dezenter,
  individueller Patina machen den Tisch lebendiger. Auch im Handy-Querformat
  bleibt der Hintergrund auf Filz. Auf kurzen Bildschirmen bleiben Block
  und Aktionen per Scrollen erreichbar; Bedienung, Regeln und Wertung
  ändern sich nicht.
- **English:** ZDWA Classic uses warmer, muted score-sheet paper instead of
  a glaringly bright surface. Blue ballpoint lettering and loosely drawn
  lines stay clearly legible. Handwriting is bundled locally. Irregular felt
  fibres and smooth sepia dice with subtle, individual patina bring more
  character to the table. Mobile landscape backgrounds stay on felt too.
  Short screens keep the sheet and its actions reachable by scrolling;
  controls, rules and scoring are unchanged.

## Stille Korrektur / Silent fix — Schneller in die Lobby

- **Deutsch:** Neue Gäste gelangen direkt in die Lobby. Der Browser merkt sich
  den aktuellen Versionsstand; spätere neue Updates erscheinen weiterhin.
  Die Sicherheitsprüfung für ZDWA-Registrierungen lädt erst beim Nutzen der
  Kontofelder oder bei „Registrieren“. Der Registrierungsschutz bleibt erhalten.
- **English:** New guests go straight to the lobby. The browser remembers the
  current release and still announces future updates. The ZDWA registration
  security check loads when using the account fields or choosing “Register”.
  Registration remains protected.
- **Technisch / Technical:** Der mobile Produktionsbericht erfasste den
  Versionsdialog als LCP und 508 KB vorzeitig geladene CAPTCHA-Ressourcen.
  Messdaten und Prüfumfang / measurements and validation:
  [ZDWA loading audit](docs/ZDWA_LOADING_AUDIT_2026-09-09.md).

## Stille Korrektur / Silent fix — Ruhigere LCARS-Kontraste

- **Deutsch:** Im LCARS-Spielraum sind Rahmen und Chat gedämpfter, die Würfel
  haben weniger Leuchteffekt und doppelte Konturen. Die Auswahl bleibt klar
  erkennbar. Positive Punkte erscheinen in hellem, gedecktem Apricot;
  Würfelwirt-Badges erhalten flache LCARS-Farben mit dunkler Schrift.
  Schwarzer Hintergrund, Layout, Blattwechsel und Spielregeln bleiben gleich.
- **English:** LCARS game rooms use quieter frame and chat colours, with less
  dice glow and fewer doubled outlines. Selections remain clear. Positive
  scores use a light, muted apricot; dice keeper badges use flat LCARS colours
  with dark lettering. The black background, layout, sliding score sheets
  and game rules are unchanged.

## Stille Korrektur / Silent fix — LCARS-Punkteblätter im Wechsel

- **Deutsch:** Das aktive LCARS-Punkteblatt liegt groß oben und bietet mehr
  Platz für den Verlauf. Darunter bleiben Name und Gesamtstand des anderen
  Spielers in einer kompakten Leiste sichtbar. Beim Zugwechsel schiebt sich
  das neu aktive Blatt von unten nach oben. Classic, Spielregeln und Wertung
  bleiben unverändert.
- **English:** The active LCARS score sheet occupies the large upper area,
  giving its history more room. The other player's name and total remain
  visible in a compact strip below. When turns change, the newly active sheet
  slides from bottom to top. Classic, game rules and scoring are unchanged.

## Stille Korrektur / Silent fix — Startwürfel, LCARS-Punktebuch und ruhigerer Würfelwirt

- **Deutsch:** Startwürfe erscheinen als Miniwürfel; beide Ergebnisse bleiben
  kurz sichtbar, auch vor einem erneuten Versuch bei Gleichstand. Das
  LCARS-Punktebuch zeigt beide Spieler mit Gesamtstand und separat scrollbar
  bleibendem Verlauf. Der Würfelwirt lässt mehr Zeit zwischen Wurf und
  Entscheidung. Zufall, Regeln und Wertung bleiben unverändert.
- **English:** Opening rolls use miniature dice, with both results briefly
  visible even before retrying a tie. The LCARS notebook shows both players'
  totals and independently scrollable histories. The dice keeper leaves more
  time between rolling and deciding. Randomness, rules and scoring are unchanged.

## Stille Korrektur / Silent fix — Zilch lädt unabhängig von Schrift und Konto

- **Deutsch:** Die öffentliche Zilch-Überschrift steht bereits im HTML; die
  Lobby wartet beim Anzeigen nicht mehr auf die Kontoabfrage. Spielstart,
  Kontodaten und Chat bleiben bis zur bestätigten Identität geschützt.
  Die LCARS-Schrift wird nur im gewählten Design früh geladen und versioniert
  gecacht. Bei langsamen Downloads bleibt die Ersatzschrift ohne späten
  Layout-Sprung. Spielregeln und Wertung ändern sich nicht.
- **English:** The public Zilch heading is included in the HTML, and displaying
  the lobby no longer waits for the account check. Starting games, account
  data and chat remain protected until identity is confirmed. The LCARS font
  is preloaded only for the selected theme and uses versioned caching. Slow
  downloads keep the fallback font without a late layout jump. Rules and
  scoring are unchanged.
- **Technisch / Technical:** Browser-Traces und getrennte Origin-/CDN-Messungen:
  [Ladezeit-Audit / loading audit](docs/ZILCH_LOADING_AUDIT_2026-09-08.md).
  Zeitweise öffentliche Download-Stalls sind damit nicht infrastrukturell
  behoben / this does not resolve the separate intermittent public download stalls.

## Stille Korrektur / Silent fix — Würfel und Schreibblock

- **Deutsch:** LCARS-Würfel zeichnen ihre Farben direkt statt mit
  verschachtelten Bildfiltern; Auswahl und Konturen bleiben erhalten.
  Der Schreibblock springt bei jedem Wurf und neuen Punkteeintrag ans Ende;
  zwischen Würfen lassen sich ältere Einträge
  weiterhin in Ruhe lesen.
- **English:** LCARS dice use direct colours instead of nested image filters;
  selection and outlines are preserved. The score notebook returns to the
  bottom on every roll and new score entry; older entries can still be read
  between rolls.

## Stille Korrektur / Silent fix — Freier Wurf in LCARS

- **Deutsch:** „Freier Wurf“ erscheint im LCARS-Design als helles Statusband
  direkt auf der Punktekachel. Wurfbezeichnung und Punkte bleiben lesbar;
  Auswahl und Weiterwürfeln funktionieren wie bisher.
- **English:** LCARS shows “Free roll” as a bright status band inside the
  scoring tile. The throw name and points remain readable; selecting dice and
  rolling again work as before.

## Nächster Release / Next release — LCARS näher am Original

### Deutsch

- Der LCARS-Hintergrund ist durchgehend schwarz, auch in der installierten
  App. Holztextur, Hintergrundraster und Papierdekorationen sind entfernt.
- Flache Farbsegmente, kräftige L-förmige Konsolenrahmen und eine lokal
  mitgelieferte schmale Displayschrift orientieren sich stärker an LCARS.
- Spielauswahl, Punktedisplay und Würfelaktionen tragen dieselbe Designsprache.
  Bedienung und Spielregeln bleiben erhalten.

### English

- LCARS now has a solid black background, including in the installed app.
  Wood textures, background grids and paper decorations are removed.
- Flat colour segments, prominent L-shaped console rails and a bundled narrow
  display font bring the appearance closer to LCARS.
- Game selection, score displays and dice actions share the same visual style.
  Controls and game rules are unchanged.

## Nächster Release / Next release — Zilch auf der Brücke

### Deutsch

- Zilch hat einen eigenen, lokalen Design-Schalter: **Klassisch** oder
  **LCARS**. Die Wahl bleibt in diesem Browser gespeichert und ist bewusst von
  der ZDWA-Auswahl getrennt.
- LCARS bringt ein dunkles Konsolendisplay mit Apricot-, Lila-, Blau- und
  Türkisflächen, abgerundeten Bedienfeldern und technischer Display-Typografie.
- Würfeln, Halten, Weiterwürfeln, Sichern, Regeln, Wertung und serverseitige
  Ergebnisse funktionieren unverändert.

### English

- Zilch has its own local appearance button: **Classic** or **LCARS**. The
  choice stays in this browser and is deliberately separate from ZDWA's theme.
- LCARS adds a dark console display with apricot, lilac, blue, and cyan panels,
  rounded controls, and technical display typography.
- Roll, hold, roll again, bank, rules, scoring, and server-side results work
  exactly as before.

## Nächster Release / Next release — Classic am Kaffeetisch

### Deutsch

- ZDWA bietet über den bekannten Design-Schalter nun Hell, Dunkel und Classic.
  Die Auswahl bleibt lokal in diesem Browser gespeichert.
- Classic legt die Würfel auf grüne Filzoptik, gibt ihnen eine sanft gebrauchte
  Sepia-Note und zeigt Punkteblätter, Tabellen sowie Legenden wie handschriftlich
  auf Papier. Regeln und Wertung bleiben unverändert.
- Die sichtbaren Fake-Würfe drehen in ZDWA und Zilch ein wenig schneller, ohne
  Zufall, Serverentscheidung oder Spielergebnis zu verändern.

### English

- ZDWA now offers Light, Dark, and Classic through the familiar appearance
  button. The choice stays saved locally in the current browser.
- Classic puts the dice on green felt, gives them a gently worn sepia look, and
  renders score sheets, tables, and legends like handwritten paper. Rules and
  scoring remain unchanged.
- Visible fake rolls spin a little faster in ZDWA and Zilch without changing
  randomness, server decisions, or any player result.

## Nächster Release / Next release — Klar zwischen den Spielen wechseln

### Deutsch

- Der Wechsel zwischen ZDWA und Zilch verwendet oben rechts nun in beiden
  Spielen denselben Z-förmigen Wechselpfeil. Das Symbol zeigt die Richtung des
  Wechsels, der sichtbare Zielname macht die Aktion eindeutig.
- Auf breiten Bildschirmen stehen Symbol und Zielname mit sauberem Abstand
  nebeneinander. Auf Mobilgeräten bleibt der Button bewusst kompakt, ohne dass
  seine Bezeichnung für Hilfstechnologien verloren geht.

### English

- Switching between ZDWA and Zilch now uses the same Z-shaped transfer arrow
  at the top right of both games. The symbol conveys the change while the
  visible destination name makes the action unambiguous.
- On wider screens, the symbol and destination name sit side by side with
  clear spacing. On mobile, the button intentionally remains compact without
  losing its accessible name.

## Nächster Release / Next release — Alle Würfelwirt-Siege im Blick

### Deutsch

- Die kompakte Würfelwirt-Rangliste in der Zilch-Lobby zählt nun alle Siege
  gegen Konservativ, Normal und Aggressiv zusammen. Sie zeigt damit dieselbe
  Gesamtbilanz, die die Überschrift schon immer erwarten ließ.
- Die ausführlichen Zilch-Bestenlisten bleiben bewusst nach Spielweise
  filterbar, damit sich die einzelnen Schwierigkeitsgrade weiterhin direkt
  vergleichen lassen.

### English

- The compact Dice Keeper ranking in the Zilch lobby now combines all wins
  against Conservative, Normal, and Aggressive, matching the total implied by
  its heading.
- The detailed Zilch leaderboards remain filterable by playing style so the
  individual difficulty levels can still be compared directly.

## Nächster Release / Next release — Klarer Abschluss bei Zilch

### Deutsch

- Nach jedem abgeschlossenen oder aufgegebenen Solo-Lauf sowie nach jeder
  abgeschlossenen Würfelwirt- oder Zwei-Personen-Partie öffnet Zilch
  automatisch die Ende-Ansicht. Angemeldete Teilnehmer erhalten nach der
  serverbestätigten Speicherung ihren privaten Bericht; Gäste sehen dieselbe
  Zusammenfassung im aktuellen Browser-Tab.
- Oberhalb der Zusammenfassung stehen die nächsten Schritte: **Neues Solo** im
  Solo-Sprint, **Revanche** gegen den Würfelwirt oder nach einem Duell sowie
  **Zur Zilch-Lobby**.
- Die Überschrift und der Button auf Zilch-Spielerprofilen heben sich auf dem
  Desktop wieder klar vom Holz-Hintergrund ab.

### English

- After every completed or abandoned Solo run, and every completed Dice Keeper
  or two-player game, Zilch opens its end screen automatically. Signed-in
  participants receive their private report after server-confirmed persistence;
  guests see the same summary in their current browser tab.
- The next actions now sit above the summary: **New solo** for the Solo Sprint,
  **Rematch** against the Dice Keeper or after a duel, and **Back to Zilch
  lobby**.
- The heading and button on Zilch player profiles now stand out clearly from
  the wood background on desktop.

## Nächster Release / Next release — Chat ohne Unterbruch

### Deutsch

- Im aktiven Zilch-Spiel bleibt der geöffnete Chat als eigenes, stabiles
  Element erhalten. Eingehende Nachrichten, Schnellreaktionen und
  Spielstandsaktualisierungen ersetzen weder das Eingabefeld noch einen
  begonnenen Text.
- ZDWA setzt einen geöffneten Chat bei einer Wiederverbindung nicht mehr auf
  „geschlossen“ zurück. Damit bleibt die laufende Texteingabe auch bei einem
  kurzen Netzwechsel nutzbar.
- Der Zilch-Verlauf bleibt live und zeigt bei einer bereits längeren
  Nachrichtenliste weiter die neuesten Einträge, ohne die Bedienung zu stören.

### English

- In an active Zilch game, the open chat now remains a stable element. Incoming
  messages, quick reactions, and game updates neither replace the input nor a
  started draft.
- ZDWA no longer resets an open chat to closed when it reconnects, so a short
  network change does not interrupt typing.
- Zilch history remains live and keeps the latest entries accessible even when
  the message list is already longer.

## Nächster Release / Next release — Erkundung, die zählt

### Deutsch

- Ein schon gespeichertes Profilbild erhält einmalig den Erst-Erfolg in ZDWA
  und Zilch. Die Korrektur stützt sich ausschließlich auf das aktuelle,
  dauerhafte Profilbild; frühere Wechsel werden weder erraten noch
  rückwirkend vergeben.
- Konto-Tabs erfassen jetzt den tatsächlich geöffneten Bereich. Erfolgreich
  gespeicherte Einstellungen, Push-Bereiche, GitHub-Links und der Wechsel
  zwischen den Spielen zählen über den passenden Ablauf statt über einen
  freien Event-Aufruf. Zilch-Erkundungs-Auszeichnungen blockieren dabei keine
  Bedienung mit einem Ergebnisdialog.
- Bestehende Achievement-Werte und Ranggrenzen bleiben unverändert; niemand
  wird heruntergestuft. Neue Punkte gibt es nur für die dazugehörigen Aktionen.

### English

- An already stored profile picture receives the first-picture award once in
  ZDWA and Zilch. The repair uses only the current durable profile-picture
  record; earlier changes are neither guessed nor granted retroactively.
- Account tabs now track the area that was actually opened. Successful setting
  changes, Push areas, GitHub links and switching games use their matching
  product flow instead of a free-form event call. Zilch exploration awards do
  not block controls with a result dialog.
- Existing achievement values and rank thresholds remain unchanged, and nobody
  is demoted. New points are available only for their matching actions.

## Nächster Release / Next release — Mehr Ziele, klarer Tisch

### Deutsch

- Neue Erkundungs-Erfolge in beiden Spielen belohnen Profilbild setzen und
  wechseln, Einstellungen und Übersichten öffnen, GitHub-Links, Theme- und
  Sprachwechsel, Chat-/Push-Einstellungen sowie den Wechsel zwischen ZDWA und
  Zilch. Nur ausdrücklich aufgezeichnete Aktionen ab diesem Rollout zählen;
  bestehende Ränge und historische Achievements bleiben unverändert.

### English

- New exploration achievements in both games reward setting and changing a
  profile picture, opening settings and overviews, GitHub links, theme and
  language changes, chat/push settings, and switching between ZDWA and Zilch.
  Only explicitly recorded actions from this rollout count; existing ranks and
  historical achievements remain unchanged.

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
