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

ZDWA und Zilch verwenden eine gemeinsame Versionsfolge: Major für neue
Produktgenerationen, Minor für neue Funktionen, Patch für Fehlerkorrekturen
und Wartung. Historische Nummern wurden rückwirkend anhand der Git-Änderungen
zugeordnet; ihre Daten sind Commitdaten, keine behaupteten Deploymentdaten.
Die vollständige Zuordnung steht in der [Versionsübersicht](docs/VERSION_HISTORY.md).

ZDWA and Zilch share one version sequence: Major for new product generations,
Minor for new features, Patch for fixes and maintenance. Historical numbers
were assigned retrospectively from Git changes; their dates are commit dates,
not asserted deployment dates. See the [complete version history](docs/VERSION_HISTORY.md).

## 2.42.2 — Spielregeln wieder sichtbar / In-game rules visible again — 2026-09-22

**Deutsch:** Der ZDWA-Regeldialog zeigt die Spielregeln wieder an. Die
Sicherheitsrichtlinie des Reverse-Proxys erlaubt nun auch eingebettete Seiten
derselben Website; die Turnstile-Freigabe und der Schutz vor fremder Einbettung
bleiben erhalten. Beim ZDWA-Spiel innerhalb der installierten Zilch-App lädt
der Dialog die passende ZDWA-Anleitung. Browsertests prüfen den Inhalt mit der
ausgelieferten Proxy-Richtlinie. Stiller Rollout ohne neue Push- oder In-App-Versionsmeldung.

**English:** The ZDWA rules dialog displays the rules again. The reverse proxy's
security policy now also allows embedded pages from the same website, while
preserving Turnstile access and protection against embedding by other sites.
When playing ZDWA inside the installed Zilch app, the dialog loads the matching
ZDWA guide. Browser tests verify its content under the deployed proxy policy.
Silent rollout without a new push or in-app release announcement.

## 2.42.1 — Klarere Benutzerverwaltung / Clearer user management — 2026-09-22

**Deutsch:** Die interne Benutzerverwaltung zeigt Konten als kompakte,
durchsuchbare Liste. Einzeln aufklappbare Konten gruppieren Rechte, Chat,
Sperren und Passwort. Beschriftete Felder vereinfachen die Kontoanlage;
Rückmeldungen stehen direkt bei der jeweiligen Aktion. Die Ansicht passt sich
Desktop, Tablet und Smartphone an und bietet mindestens 44 Pixel große
Touch-Ziele. Berechtigungen und Eigentümerschutz bleiben bestehen.
Stiller Rollout ohne neue Push- oder In-App-Versionsmeldung.

**English:** Internal user management presents accounts in a compact,
searchable list. Each account opens individually and groups permissions, chat,
bans and passwords. Labelled fields make account creation clearer, with
feedback next to the relevant action. The layout adapts to desktop, tablet and
phone screens and provides touch targets of at least 44 pixels. Permissions
and ownership protection remain in place. Silent rollout without a new push
or in-app release announcement.

## 2.42.0 — Zilch: klarer am Tisch / Clearer at the Zilch table — 2026-09-22

**Deutsch:** Jede neue Partie gegen den Würfelwirt lost seine Spielweise aus,
online wie offline. Die Einstellung entfällt; Revanchen losen neu und laufende
Partien behalten ihre Strategie. Alle bisherigen Erfolge bleiben mit denselben
Punkten erreichbar. Die Tablet-Hilfe beschreibt die aktuelle Entscheidung.
„Stand beim Sichern“ zeigt den Gesamtstand einschließlich gehaltener und
aktuell ausgewählter Punkte. Beide Papierblöcke erhalten eigene Ringe, der
doppelte Stand am unteren Rand entfällt. Startwürfe passen vollständig auf den
Tablet-Bildschirm. Eigene, fremde und CPU-Würfe shaken deutlicher und länger;
gehaltene Würfel bleiben ruhig und reduzierte Bewegung wird respektiert.
Am Spielende bleibt der letzte Wurf nach der Animation noch etwa eine Sekunde
sichtbar, bevor das Ergebnis öffnet. Regeln und Wertungen bleiben unverändert.

**English:** Every new game against the Dice Host randomly draws its play style,
online and offline. The setting is removed; rematches draw again and ongoing
games retain their strategy. Existing achievements keep their points and remain
available. Tablet guidance describes the current decision. “Total if banked”
includes committed and currently selected points. Both paper pads have their
own rings, and the duplicate total at the bottom is removed. Opening rolls fit
fully on tablet screens. Your own, other players' and CPU rolls shake more
clearly and for longer; held dice stay still and reduced motion is respected.
The final roll stays visible for about a second after its animation before
the result opens. Rules and scoring are unchanged.

## 2.41.0 — Call for help — 2026-09-22

**Deutsch:** Erster sichtbarer Hinweis auf die zuvor still ausgelieferte
Adminhilfe: Angemeldete Spieler können direkt aus beiden Spielen Hilfe rufen,
Admins übernehmen mit einem Klick und behalten ihren Platz in der eigenen
Partie. Ruhige Avatare und zentrierte Desktop-Menüs sind ebenfalls enthalten.
Neu schützt eine feste Konto-ID den Gründer dauerhaft vor Sperren,
Deaktivierung, Chat-Ausschluss, administrativem Passwort-Reset und
Rechteentzug. Der Gründer kann vertrauenswürdige Admins zu Ownern ernennen
und diese Berechtigung wieder entziehen. Owner verwalten normale Adminrechte;
Admins können keine anderen Mitarbeiterkonten übernehmen. Datenbankregeln
sichern den Schutz zusätzlich ab. Die private Verwaltung zeigt die Rollen
und zulässigen Aktionen in beiden Sprachen; öffentliche Profile behalten das
dezente Admin-Schild. Ein entzogener Adminzugang beendet auch bestehende
ZDWA-Bearbeitungssitzungen.

**English:** First public announcement of the previously silent admin-help
release: signed-in players can request help from either game, admins can
respond with one click and retain their seat in their own game. Stable avatars
and centered desktop menus are included. A stable account ID now permanently
protects the founder against bans, deactivation, chat exclusion,
administrative password resets and permission removal. The founder can grant
and revoke ownership for trusted admins. Owners manage ordinary admin rights;
admins cannot take over other staff accounts. Database rules reinforce these
boundaries. Private administration shows roles and permitted actions in both
languages; public profiles retain the discreet admin badge. Revoked admin
access also terminates existing ZDWA editing sessions.

## 2.40.0 — 2026-09-22

**Deutsch:** Dezente Admin-Schilder erscheinen an Profilbildern in Lobby, Partie
und Chat sowie als Rollenhinweis im Profil. Angemeldete Mitspieler können
Adminhilfe rufen. Persistente, atomar übernehmbare Hilferufe bieten einen
kompakten Admin-CTA und eine separat abschaltbare Push-Art. Der Hilfezugang ist
auf die angefragte Partie als Zuschauer begrenzt; private und Solo-Partien sind
abgedeckt. Eigene Admin-Partien pausieren mit einem Einsatzhinweis und behalten
Sitz und Spielstand. Berechtigte oder versehentliche Rufe bleiben ohne Strafe;
Missbrauch sperrt weitere Hilferufe. Admins verwalten getrennte Spiel- und
Hilferufsperren für 3/5/7/14/30/60 Tage oder dauerhaft, mit Grund, automatischem
Ablauf und protokollierter Aufhebung. Anmeldung bleibt für Kontoinformationen
verfügbar. Beide Spiele nutzen persönliche Admin-Konten und dieselben Regeln.
Auf sehr kurzen Handybildschirmen bleibt etwas mehr Abstand zwischen der
letzten ZDWA-Zeile und der festen Aktionsleiste.

**English:** Discreet admin shields appear on avatars in lobbies, games and chat,
with a role description on profiles. Signed-in participants can request admin
help. Durable requests with atomic claiming provide a compact admin action and
an independently configurable push type. Assistance grants spectator access
only to the requested game, including private and Solo games. The admin’s own
game pauses with a message and preserves their seat and progress. Valid and
accidental requests carry no penalty; misuse blocks further help requests.
Admins manage separate playing and help-request bans for 3/5/7/14/30/60 days or
permanently, with reasons, automatic expiry and recorded revocation. Sign-in
stays available for account information. Both games use personal admin accounts
and the same rules.
Very short phone screens retain a little more space between the last ZDWA
score row and the fixed action bar.

## 2.39.4 — Ruhige Profilbilder und zentrierte Desktop-Menüs / Stable profile pictures and centered desktop menus — 2026-09-22

- **Deutsch:** Lobbys, Bestenlisten und Chats behalten bereits geladene
  Profilbilder bei Aktualisierungen. Auch Zilch-Spielaktionen bauen unveränderte
  Bilder nicht mehr neu auf. Damit bleiben die Avatare auf Desktop, Tablet und
  Handy ruhig; Spielerwechsel und neue Profilbilder erscheinen weiterhin.
  Die Desktop-Navigation sitzt auch in der ZDWA-Lobby und im Zilch-LCARS-Design
  mittig. Auf der Zilch-Seite für nicht verfügbare Links stehen die
  Header-Werkzeuge wieder rechts. Stiller Rollout ohne Versions-Push oder
  neues Versionspopup.
- **English:** Lobbies, leaderboards and chats retain loaded profile pictures
  when their contents refresh. Zilch game actions also keep unchanged images
  in place. Avatars stay steady on desktop, tablet and phone while player
  changes and new profile pictures still appear. Desktop navigation is centered
  in the ZDWA lobby and Zilch's LCARS theme as well. Zilch's unavailable-link
  page keeps its header tools on the right. Silent rollout without a release
  push or a new release popup.

## 2.39.3 — Eigenes Spiel nach Gerätewechsel fortsetzen / Resume your game after switching devices — 2026-09-22

- **Deutsch:** Ein geteilter Link zu einer öffentlichen ZDWA-Partie führt
  angemeldete Teilnehmer auch auf einem anderen Gerät auf ihren bestehenden
  Platz zurück. Der Versuch wird nicht mehr als doppelter Beitritt desselben
  Kontos abgewiesen. Die ZDWA-Lobby bietet Wieder aufnehmen bereits für eigene
  wartende Partien und Zuschauen für Warteräume. Bei passwortgeschützten
  ZDWA-Partien führt der Rückweg über Wieder aufnehmen in der Lobby mit dem
  Spielpasswort; auch Zuschauen verlangt weiterhin das Passwort. So bleibt die Rückkehr
  nach dem Teilen des Links oder einem Mitspieler-Ruf erreichbar, solange
  die Partie noch offen ist. Voraussetzung ist dasselbe Konto auf dem neuen
  Gerät. In ZDWA und Zilch meldet ein noch offener Spieltab auf dem vorherigen
  Gerät die Übernahme und nimmt den Platz nicht durch automatisches
  Wiederverbinden zurück.
- **English:** Shared links to public ZDWA games return signed-in participants
  to their existing seat, including on another device. The attempt is no
  longer rejected as a duplicate join by the same account. The ZDWA
  lobby now offers Resume for your own waiting games and Watch for waiting
  rooms. For protected ZDWA games, return through Resume in the lobby with
  the game password; spectating also still requires the password.
  You can return after sharing the link or notifying players
  while the game remains open. Sign in to the same account on the new device.
  In ZDWA and Zilch, a game tab still open on the previous device reports the
  transfer and no longer reclaims the seat through automatic reconnects.

## 2.39.2 — Stabile Spielflächen nach dem Drehen / Stable game surfaces after rotation — 2026-09-22

- **Deutsch:** Nach Hochformat → Querformat → Hochformat verschieben alte
  Bildschirmmaße den Spielkopf und den Spielzettel nicht mehr. ZDWA und Zilch
  verwenden die verkleinerte sichtbare Fläche nur für eine tatsächliche
  Bildschirmtastatur und messen nach dem Drehen erneut. Chatleiste und
  Tippflächen bleiben erreichbar, begonnene Nachrichten erhalten. Neue
  Browserprüfungen decken wiederholtes Drehen, verspätete Bildschirmmaße und
  direkte Fingertipps auf Telefonen und Tablets ab.
- **English:** After portrait → landscape → portrait, stale viewport metrics
  no longer displace the game header and score sheet. ZDWA and Zilch use the
  reduced visible area only for an actual on-screen keyboard and measure again
  after rotation. The chat bar and touch targets remain reachable, and drafts
  are preserved. New browser regressions cover repeated rotation, delayed
  viewport metrics and direct touch interactions on phones and tablets.

## 2.39.1 — Achievement-Details und lesbare Menüs / Achievement details and readable menus — 2026-09-22

- **Deutsch:** Das neue Achievement-Board unter **Spieler & Ranking → Neueste
  Erfolge** zeigt nun zu jedem Erfolg eine Kurzbeschreibung. Alle Einträge öffnen
  eine Detailansicht, auch Kontoerfolge und Zilch-Erfolge ohne öffentliche Partie.
  Eindeutig zugeordnete ZDWA-Partien bleiben aus den Details erreichbar. Menüs
  und Dialogaktionen umbrechen Wörter natürlich und nutzen bei Bedarf die
  Silbentrennung der gewählten Sprache. Ankündigung des Achievement-Boards per
  Versionshinweis und Push an dafür angemeldete Geräte.
- **English:** The new achievement board under **Players & Ranking → Latest
  achievements** now shows a short description for every achievement. All
  entries open details, including account and Zilch achievements without a
  public game. Proven ZDWA source games remain accessible from the details.
  Menus and dialog actions wrap at natural word boundaries and use hyphenation
  for the selected language when needed. The achievement board is announced
  through release notes and push to devices subscribed to release updates.

## 2.39.0 — Neue Erfolge der Community / Latest community achievements — 2026-09-22

- **Deutsch:** Unter **Spieler & Ranking** bündeln ZDWA und Zilch ihre
  Ranglisten und einen neuen Feed der zuletzt verdienten Erfolge. Jeder Eintrag
  zeigt Spieler, Erfolg, Schwierigkeit und Zeitpunkt; die neuesten stehen
  zuerst. Leichte, mittlere und schwere Erfolge lassen sich mit jeweils einem
  exklusiven, erneut abwählbaren Schnellfilter anzeigen. Jede Seite enthält
  höchstens 20 Einträge und ist über große Blättertasten erreichbar. ZDWA
  verlinkt nur eine noch vorhandene, eindeutig belegte Ursprungspartie;
  Konto- und Sammelerfolge bleiben ohne erfundenen Link und Zilch gibt keine
  privaten Spielreferenzen preis. Die Liste ist für Telefone und Touch-Tablets
  im Hoch- und Querformat sowie für alle Designs ausgelegt. Stiller Rollout
  ohne Versions-Push oder neues Versionspopup.
- **English:** Under **Players & Ranking**, ZDWA and Zilch now group their
  rankings with a feed of the latest earned achievements. Each entry shows the
  player, achievement, difficulty and time, newest first. Easy, medium and hard
  achievements each have one exclusive quick filter that can be toggled off.
  Pages contain at most 20 entries and use large paging controls. ZDWA links
  only to a surviving, proven source game; account and aggregate achievements
  remain truthfully unlinked, and Zilch exposes no private game reference. The
  list is designed for phones and touch tablets in portrait and landscape
  across every theme. Silent rollout without a release push or new release
  popup.

## 2.38.4 — Ruhige Avatare bei Spielaktionen / Stable avatars during game actions — 2026-09-21

- **Deutsch:** ZDWA behält bereits geladene Profilbilder im Zugstatus und in
  den Spielzettel-Überschriften bei, während Würfel gehalten oder gelöst,
  gewürfelt und Werte geschrieben werden. Die Bilder werden bei unveränderter
  Person nicht mehr neu geladen oder kurz leer dargestellt. Ein Browsertest
  prüft Knoten, Bildquelle und Ladezustand über diese Aktionen hinweg. Stiller
  Rollout ohne Versions-Push oder neues Versionspopup.
- **English:** ZDWA keeps decoded profile pictures in the turn status and score
  sheet headers while dice are held or released, rolled, and scores are
  entered. Images for the same person no longer reload or briefly appear
  empty. A browser regression covers node identity, source and load state
  across these actions. Silent rollout without a version push or a new release
  popup.

## 2.38.3 — Kompakte Chatleisten und ganzer ZDWA-Zettel / Compact chat bars and full ZDWA sheet — 2026-09-20

- **Deutsch:** Die eingeklappten Chatleisten bleiben bündig am unteren Rand,
  belegen aber nur noch eine kompakte Bedienhöhe; der Home-Indikator vergrößert
  die Leiste nicht mehr. ZDWA passt den vollständigen Spielzettel an den
  verfügbaren Bereich an, sodass alle Zeilen ohne internes Scrollen sichtbar
  bleiben. Stiller Rollout ohne Versions-Push oder neues Versionspopup.
- **English:** Collapsed chat bars remain flush with the bottom edge while
  using only a compact control height; the home-indicator inset no longer makes
  the bar taller. ZDWA fits the complete score sheet into the available space,
  keeping every row visible without internal scrolling. Silent rollout without
  a version push or a new release popup.

## 2.38.2 — Chatleisten bündig am Rand / Chat bars flush with the edge — 2026-09-20

- **Deutsch:** Die mobilen Chatleisten schließen in beiden Spielen bündig mit
  dem sichtbaren unteren Bildschirmrand ab. Der Schutzabstand zum Home-Indikator
  liegt innerhalb der Leiste; darunter bleibt keine ungenutzte Lücke.
  Chatinhalt bleibt eingeklappt verborgen, Eingabe und Reaktionen erreichbar.
  Das Antippen einer Nachrichtenvorschau öffnet in beiden Spielen den Chat
  mit fokussierter Eingabe über denselben Ablauf wie der Chatbalken.
  Stiller Rollout ohne Versions-Push oder neues Versionspopup.
- **English:** Mobile chat bars in both games sit flush with the visible bottom
  edge. Home-indicator protection sits inside the bar, with no unused gap below.
  Collapsed chat content stays hidden, while typing and reactions remain
  accessible. Tapping a message preview opens either game's chat and focuses
  its input through the same flow as the chat bar. Silent rollout without a
  version push or a new release popup.

## 2.38.1 — Chatleisten und Zilch-Vorschläge / Chat bars and Zilch suggestions — 2026-09-20

- **Deutsch:** Eingeklappte Spielchats zeigen nur den fest am unteren Rand
  liegenden Balken; darunter ragen keine Inhalte mehr hervor, auch in der PWA
  und auf Tablets. Antippen öffnet den vollständigen Chat. Zilch zeigt seine
  Wertungsvorschläge in allen Designs und Bildschirmformaten untereinander,
  mit dem stärksten Vorschlag direkt über „Alle Punktewürfel“.
  Stiller Rollout ohne Versions-Push oder neuen In-App-Versionshinweis.
- **English:** Collapsed game chats show only their fixed bottom bar, with no
  content peeking out underneath, including PWAs and tablets. Tapping opens the
  full chat. Zilch stacks scoring suggestions vertically across themes and
  screen sizes, with the strongest suggestion directly above “All scoring dice”.
  Silent rollout without a version push or a new in-app release announcement.

## 2.38.0 — Bewusst offline spielen / Choose offline play — 2026-09-20

- **Deutsch:** Beide Lobbys bieten einen ausdrücklich aktivierten Offline-Modus:
  ZDWA solo, Zilch solo oder gegen den Würfelwirt. Jeder Einstieg beziehungsweise
  jedes Fortsetzen und der Rückwechsel zu Online-Spielen werden bestätigt.
  Offline-Partien vergeben keine Erfolge und beeinflussen weder Ranglisten noch
  Kontostatistiken. Spielstand und eigene Bestwerte bleiben im Browser auf dem
  Gerät; es gibt keinen Ergebnis-Upload. Einmal vollständig geladene Offline-Dateien
  ermöglichen den nächsten Start ohne Internet. Verbindungsverlust wandelt keine
  laufende Online-Partie um. Lokale Regeln werden gegen die Serverwertung und
  vollständige Spielverläufe geprüft. Stiller Rollout ohne Versions-Push oder
  neuen In-App-Versionshinweis.
- **English:** Both lobbies offer deliberately activated offline play: solo
  ZDWA, solo Zilch or Zilch against the Dice Innkeeper. Every entry or resume and
  the return to online play require confirmation. Offline games grant no
  achievements and affect neither leaderboards nor account statistics. Saves
  and personal records stay in the device's browser; results are never uploaded.
  Once the offline package is fully loaded, the next launch works without an
  internet connection. Connection loss never converts an active online game.
  Local rules are checked against server scoring and complete game histories.
  Silent rollout without a version push or a new in-app release announcement.

## 2.37.1 — Zuschauerchat und Tablet-Spielblöcke / Spectator chat and tablet score sheets — 2026-09-20

- **Deutsch:** Der Zuschauerchat hält die Texteingabe auf dem iPhone sichtbar
  und öffnet sie direkt beim Antippen. Zuschauer erhalten auch im Chat und bei
  Reaktionen ihr eigenes Profilbild. Tablet-Spielblöcke passen ihre Zeilen an
  den tatsächlich verfügbaren Platz an; die Bedienfelder bleiben erreichbar.
  Stiller Rollout ohne Versions-Push oder neuen In-App-Versionshinweis.
- **English:** Spectator chat keeps its input visible on iPhone and focuses it
  directly on tap. Spectators also retain their own profile picture in chat
  and reactions. Tablet score sheets fit their rows to the space actually
  available while keeping controls accessible. Silent rollout without a
  version push or a new in-app release announcement.

## 2.37.0 — Kontoaktionen mit Passkey / Confirm account changes with a passkey — 2026-09-20

- **Deutsch:** Benutzername, E-Mail und Passwort sowie weitere Passkeys lassen
  sich in beiden Spielen bevorzugt mit einem vorhandenen Passkey bestätigen.
  Das Passwort bleibt eine ausdrücklich wählbare Alternative. Jede Bestätigung
  gilt nur für das angemeldete Konto und die angeforderte Aktion; Abbrechen
  lässt das Konto unverändert. Die Hauptnavigation steht auf Touch-Tablets in
  allen Hauptansichten im Hoch- und Querformat mittig. Gleichzeitiges Öffnen von
  Profil und Kontostatistik erzeugt keine konkurrierenden Erfolgseinträge mehr.
  Regulärer Rollout mit
  Versionshinweis und Push für Konten mit aktivierten Versionsbenachrichtigungen.
- **English:** Both games prefer an existing passkey when confirming username,
  email or password changes and when adding or removing passkeys. Passwords
  remain an explicit fallback. Each confirmation belongs to the signed-in
  account and requested action; cancelling leaves the account unchanged.
  Main navigation is centered across the main views on touch tablets in both
  orientations. Concurrent profile and account-statistics visits no longer
  compete to create the same achievement. Regular rollout with release notes and push for accounts that
  have enabled version notifications.

## 2.36.0 — Versionsnummern und lesbare Aktionen / Version numbers and readable actions — 2026-09-20

- **Deutsch:** Beide Spiele zeigen gemeinsame Versionsnummern nach
  Major.Minor.Patch. Die bisherige Entwicklung ist rückwirkend nummeriert;
  vorhandene Versionshinweise erhalten ihre passende Nummer. Pfadtests prüfen
  wichtige Einstiege, Rückwege und Produktwechsel; neue oder geänderte Pfade
  müssen ihre Tests mitbringen. Die kompakten Aktionen in Spiel-, Warte- und
  Beitrittsansichten bleiben auf schmalen Bildschirmen lesbar und antippbar,
  einschließlich aller Designs. Das Zilch-Punktebuch behält beim Drehen seine
  Leseposition und folgt weiterhin den neuesten Punkten. Stiller Rollout ohne Versions-Push oder neuen
  In-App-Versionshinweis.
- **English:** Both games display shared Major.Minor.Patch version numbers.
  Previous development is numbered retrospectively, and existing release
  notes receive their matching version. Route tests check important entry
  points, return paths and product switches; new or changed routes must update
  their tests. Compact actions in game, waiting and join views remain readable
  and touchable on narrow screens, including every theme. Zilch's score history
  preserves its reading position when rotating and keeps following the latest scores. Silent rollout with
  no version push or new in-app release announcement.

## 2.35.1 — Spielersuche und zuverlässige Links / Player search and reliable links — 2026-09-20

- **Deutsch:** Spieler finden führt in beiden Spielen zur Suche, auch ohne
  abgeschlossene Partien. Weitere Treffer lassen sich nachladen; der Rückweg
  vom Profil öffnet direkt die Spielerauswahl. ZDWA-Ergebnisse und Zuschauerlinks
  funktionieren beim Spielwechsel innerhalb der Zilch-PWA. Passwort- und
  E-Mail-Seiten bieten Rückwege; ungültige Zilch-Spiel- und Ergebnislinks zeigen
  eine hilfreiche Fehlerseite. Stiller Rollout ohne Versions-Push oder App-Hinweis.
- **English:** Find players opens search in both games, including accounts with
  no completed games. More results can be loaded, and the profile return link
  opens the exact player-selection settings. ZDWA results and spectator links
  work across games inside the Zilch PWA. Password and email pages offer useful
  exits; invalid Zilch game and result links show a helpful error page.
  Silent rollout without a version push or in-app announcement.

## 2.35.0 — Spieltische fürs Tablet / Tables for tablets — 2026-09-20

- **Deutsch:** Eigene Touch-Layouts für beide Spiele im Hoch- und Querformat,
  einschließlich des 12,9-Zoll-iPads. Spielzettel und Verläufe nutzen den Platz;
  Würfel bleiben maßvoll groß und Hauptaktionen liegen unten in Griffweite.
  ZDWA ergänzt eine Solo-Spaltenhilfe und eine Navigation zwischen den Zetteln;
  Zilch zeigt beide Punkteverläufe gemeinsam. Alle Designs sind berücksichtigt.
  Die Handyansichten und die bisherigen Maus-Desktop-Layouts bleiben erhalten.
- **English:** Dedicated touch layouts for both games in portrait and landscape,
  including the 12.9-inch iPad. Score sheets and histories use the available room;
  dice remain moderately sized and the main actions stay within reach at the bottom.
  ZDWA adds a solo column guide and score-sheet navigation; Zilch shows both
  players' histories together. All themes are covered. Phone and existing mouse
  desktop layouts are preserved.

## 2.34.0 — Feste Spieltische und kompakte Lobbys / Fixed tables and compact lobbies — 2026-09-20

- **Deutsch:** ZDWA und Zilch halten den Spieltisch innerhalb des sichtbaren
  Bildschirms. Lange Zettel, Punkteverläufe und Dialoge bleiben in ihrem eigenen
  Bereich erreichbar; Würfel, Aktionen und Chat rutschen nicht mit der Seite weg.
  Beide Lobbys bündeln fortsetzbare, laufende und wartende Partien, reduzieren
  wiederholte Spielerangaben und verkleinern den Spielstart. Community-Zahlen
  stehen im Header; ZDWAs Wall of Shame bleibt mit beiden Zeiträumen kompakter.
  Zilchs öffentliche Start- und Regelseite wurden live auf Indexierbarkeit,
  Canonicals, robots.txt und Sitemap geprüft.
- **English:** ZDWA and Zilch keep the table within the visible screen. Long
  score sheets, histories and dialogs remain accessible within their own areas;
  dice, actions and chat no longer move away with the page. Both lobbies group
  resumable, running and waiting games, remove repeated player information and
  reduce the space needed to start a game. Community figures sit in the header;
  ZDWA's Wall of Shame retains both periods in a compact view. Zilch's public
  landing and rules pages were checked live for indexing directives, canonicals,
  robots.txt and sitemap coverage.

## 2.33.4 — Styler-Neustart / Styler fresh start — 2026-09-13

- **Deutsch:** Styler Full und Styler-Show werden bei allen Konten samt
  Fortschritt zurückgesetzt. Die zugehörigen 4 bzw. 8 Ehrenberg-Marken entfallen;
  Punkte und Rang folgen den verbleibenden Erfolgen. Nur neue belegte Fulls aus
  fünf gleichen Würfeln zählen wieder, nach Abschluss ihrer Partie. Alte
  abgeschlossene und bereits laufende Nachweise vergeben nichts erneut.
  Spielstände, andere Erfolge und Zilch bleiben unverändert. Stiller Rollout.
- **English:** Styler Full and Styler Show are reset for every account,
  including their progress. Their 4 and 8 achievement points are removed;
  points and rank follow the remaining awards. Only new proven Fulls with
  five identical dice count again once their game is completed. Evidence from
  earlier completed or ongoing games does not grant them again. Game scores,
  other achievements and Zilch are unchanged. Silent rollout.

## 2.33.3 — Würfe und kompakte Bedienung / Rolls and compact controls — 2026-09-13

- **Deutsch:** ZDWA animiert angenommene Würfe auch bei Mitspielern und
  Zuschauern; gehaltene Würfel bleiben liegen. Die Korrektur sitzt als kleines
  Radiergummi neben Würfeln und benötigt keine eigene Zeile. Nach dem ersten
  Wurf übernimmt Ansagen dieselbe Fläche. Die bisherigen Zeitfenster sowie
  Solo- und Hardcore-Regeln gelten weiter. Ein verstrichenes Korrekturfenster
  öffnet sich auch bei drei Spielern oder Teams nicht erneut. Der Server prüft
  die Ansageregel auch beim Verschieben eines korrigierten Eintrags.
  Zilchs Würfelwirt lässt nach
  regulären Würfen 0,15 Sekunden weniger Pause. Normal sichert etwas früher,
  Aggressiv deutlich früher; Konservativ bleibt unverändert. Stiller Rollout.
- **English:** ZDWA animates accepted rolls for other players and spectators;
  held dice stay still. A small eraser next to Roll replaces the separate
  correction row. Announce takes that space after the first roll. Existing
  action windows and solo/Hardcore rules still apply. Expired correction
  windows stay closed in three-player and team games too. The server enforces
  the announcement rule when moving a corrected entry as well. Zilch's dice keeper
  pauses 0.15 seconds less after regular rolls. Normal banks slightly earlier,
  Aggressive noticeably earlier; Conservative is unchanged. Silent rollout.

## 2.33.2 — Erreichbare Erfolge / Reachable achievements — 2026-09-12

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

## 2.33.1 — Zilch Classic Chatleiste / Chat bar — 2026-09-12

- **Deutsch:** Die Chatleiste bleibt beim Öffnen, Schließen und erneuten
  Antippen dunkel und lesbar. Ein allgemeiner Hover-Effekt übermalt ihren
  Hintergrund nicht mehr. Stiller Hotfix ohne Versions-Push oder neues Popup.
- **English:** The chat bar stays dark and readable when opened, closed or
  tapped again. A generic hover effect no longer covers its background.
  Silent hotfix without a release push or new popup.

## 2.33.0 — Zilch Classic Remaster — 2026-09-12

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

## 2.32.0 — Wall of Shame — 2026-09-12

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

## 2.31.0 — Passkey zuerst / Passkey first — 2026-09-12

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

## 2.30.0 — Klarere Kontoeinstellungen und E-Mail / Clearer account settings and email — 2026-09-12

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

## 2.29.0–2.29.2 — Passkeys und Fairplay / Passkeys and fair play — 2026-09-12

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

## 2.28.1 — Stille Korrektur / Silent fix — Aktuelle Namen in früheren Partien — 2026-09-12

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

## 2.28.0 — Benutzername ändern / Change username — 2026-09-11

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

## 2.27.10 — Stille Korrektur / Silent fix — Geschriebene Punkte und ruhigeres Laden — 2026-09-10

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

## 2.27.9 — Stille Korrektur / Silent fix — Classic näher am Kaffeetisch — 2026-09-10

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

## 2.27.8 — Stille Korrektur / Silent fix — Schneller in die Lobby — 2026-09-09

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

## 2.27.7 — Stille Korrektur / Silent fix — Ruhigere LCARS-Kontraste — 2026-09-09

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

## 2.27.6 — Stille Korrektur / Silent fix — LCARS-Punkteblätter im Wechsel — 2026-09-09

- **Deutsch:** Das aktive LCARS-Punkteblatt liegt groß oben und bietet mehr
  Platz für den Verlauf. Darunter bleiben Name und Gesamtstand des anderen
  Spielers in einer kompakten Leiste sichtbar. Beim Zugwechsel schiebt sich
  das neu aktive Blatt von unten nach oben. Classic, Spielregeln und Wertung
  bleiben unverändert.
- **English:** The active LCARS score sheet occupies the large upper area,
  giving its history more room. The other player's name and total remain
  visible in a compact strip below. When turns change, the newly active sheet
  slides from bottom to top. Classic, game rules and scoring are unchanged.

## 2.27.5 — Stille Korrektur / Silent fix — Startwürfel, LCARS-Punktebuch und ruhigerer Würfelwirt — 2026-09-09

- **Deutsch:** Startwürfe erscheinen als Miniwürfel; beide Ergebnisse bleiben
  kurz sichtbar, auch vor einem erneuten Versuch bei Gleichstand. Das
  LCARS-Punktebuch zeigt beide Spieler mit Gesamtstand und separat scrollbar
  bleibendem Verlauf. Der Würfelwirt lässt mehr Zeit zwischen Wurf und
  Entscheidung. Zufall, Regeln und Wertung bleiben unverändert.
- **English:** Opening rolls use miniature dice, with both results briefly
  visible even before retrying a tie. The LCARS notebook shows both players'
  totals and independently scrollable histories. The dice keeper leaves more
  time between rolling and deciding. Randomness, rules and scoring are unchanged.

## 2.27.4 — Stille Korrektur / Silent fix — Zilch lädt unabhängig von Schrift und Konto — 2026-09-08

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

## 2.27.3 — Stille Korrektur / Silent fix — Würfel und Schreibblock — 2026-09-08

- **Deutsch:** LCARS-Würfel zeichnen ihre Farben direkt statt mit
  verschachtelten Bildfiltern; Auswahl und Konturen bleiben erhalten.
  Der Schreibblock springt bei jedem Wurf und neuen Punkteeintrag ans Ende;
  zwischen Würfen lassen sich ältere Einträge
  weiterhin in Ruhe lesen.
- **English:** LCARS dice use direct colours instead of nested image filters;
  selection and outlines are preserved. The score notebook returns to the
  bottom on every roll and new score entry; older entries can still be read
  between rolls.

## 2.27.2 — Stille Korrektur / Silent fix — Freier Wurf in LCARS — 2026-09-08

- **Deutsch:** „Freier Wurf“ erscheint im LCARS-Design als helles Statusband
  direkt auf der Punktekachel. Wurfbezeichnung und Punkte bleiben lesbar;
  Auswahl und Weiterwürfeln funktionieren wie bisher.
- **English:** LCARS shows “Free roll” as a bright status band inside the
  scoring tile. The throw name and points remain readable; selecting dice and
  rolling again work as before.

## 2.27.1 — LCARS näher am Original — 2026-09-08

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

## 2.27.0 — Zilch auf der Brücke — 2026-09-08

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

## 2.26.0 — Classic am Kaffeetisch — 2026-09-08

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

## 2.25.6 — Klar zwischen den Spielen wechseln — 2026-09-08

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

## 2.25.5 — Alle Würfelwirt-Siege im Blick — 2026-09-08

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

## 2.25.4 — Klarer Abschluss bei Zilch — 2026-09-08

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

## 2.25.3 — Chat ohne Unterbruch — 2026-09-08

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

## 2.25.1–2.25.2 — Erkundung, die zählt — 2026-09-07

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

## 2.24.0–2.25.0 — Mehr Ziele, klarer Tisch — 2026-09-07

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

## 2.23.0 — Push-Auswahl mit Mitspieler-Rufen — 2026-09-06

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

## 2.22.2–2.22.5 — Profilbilder für echte Fotos — 2026-09-06

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

## 2.22.1 — Zilch-Zug klarer, Lobby-Chat ruhiger — 2026-09-06

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

## 2.22.0 — Profilbilder & Spielstart live — 2026-09-06

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

## 2.21.0 — Deine Leute, klarere Würfel — 2026-09-06

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

## 2.20.0 — Neuigkeiten direkt in der App / In-app release notes — 2026-09-06

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

## 2.19.0 — Versions-Push und private Spielerauswahl — 2026-09-06

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

## 2.15.1–2.18.1 — Rückblick: zusammen spielen / Catch-up: playing together — 2026-09-06

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
