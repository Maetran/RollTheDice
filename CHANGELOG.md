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


## 3.16.1 — Sichere Kartentipps / Reliable card taps — 2026-10-19

**Deutsch:** Hausdepp bindet einen Kartentipp an die beim Aufsetzen bereits
spielbare Karte. Wird eine Karte erst während des Tipps freigegeben oder rückt
eine andere unter den Finger, legt das Loslassen keine zusätzliche Karte.
Schnelle gültige Einzeltipps und Nachwürfe bleiben ohne feste Wartezeit möglich.
Danke an Martin fürs Aufspüren – ab sofort wird wieder fair gespielt. 😉

**English:** Hausdepp binds each card tap to the card already playable at
touch-down. Releasing a finger cannot play an extra card that only became
available during the tap or moved into its place. Valid rapid single-card plays
and follow-ups remain available without a fixed delay.
Thanks to Martin for spotting it – fair play is back. 😉

## 3.16.0 — Private Watten-Owner-Vorschau / Private Watten founder preview — 2026-10-18

**Deutsch:** Ein standardmässig ausgeschaltetes Serverflag erlaubt die erste
Watten-Webvorschau ausschliesslich dem dauerhaft gebundenen Ownerkonto auf
dem bestehenden Produktionshost. Die Spieleauswahl folgt der frisch geprüften
Kontoberechtigung. Spät bestätigte Spiele ergänzen das offene Menü, ohne alte
Links oder den Fokus zu ersetzen; Rechteentzug schliesst es weiterhin sofort.
Direkte HTTP- und WebSocket-Zugriffe bleiben für andere
Konten gesperrt, auch für weitere Administratoren und angenommene Einladungen.
Computerzüge prüfen zusätzlich den tatsächlich gespeicherten Spielstand und
die Berechtigung vor dem atomaren Commit. Ein abgeschaltetes Flag stoppt weitere
Züge ohne neue Punkte oder Fortschritt. Der eigene Watten-Host, Produktions-PWA,
Watten-Mailkontext und Push-Zustellung bleiben geschlossen.

Native Freundesmeldungen zeigen gestartete Partien ausgewählter Spieler kurz
und ohne Karteninformationen an. Zuschauen braucht einen bewussten Klick;
am laufenden Tisch erscheint nur Text. Kontoeinstellungen speichern die eigene
Zustimmung und Spielerauswahl; Suchergebnisse und wartende Meldungen bleiben
begrenzt. Persönliche Folgetisch-Einladungen, Tourpräferenzen, Gerätebindung
sind serverseitig vorbereitet; ihre übrigen nativen Oberflächen und die
öffentliche Freigabe stehen noch aus. Das bestehende Dashboard ergänzt Watten
ausschliesslich aus der aktuellen Analytics-Freigabe. Partien, Menschen,
Computerplätze und belegte Dauer werden getrennt angezeigt; fehlende Besuchs-,
Installations- und Herkunftsmessung bleibt unbekannt. Kontowechsel entfernen
private Altwerte auch bei verzögerten Antworten.

Die Trumpfzugabe entspricht der bestätigten Variante 2: Ein gewöhnlicher
Schlag ersetzt vorhandenen Trumpf nur, wenn er den aktuellen Stich übernimmt.
Trumpf, Rechter und Kritische haben weiterhin keinen Überstechzwang. Engine,
CPU-Simulation und die zweisprachigen Hinweise verwenden dieselbe Regel.

**English:** A server flag, off by default, makes the first Watten web preview
available only to the permanently bound founder account on the existing
production host. The chooser follows freshly checked account permissions.
Late confirmations add games to the open menu while preserving existing links
and focus; permission withdrawal still closes it immediately.
Direct HTTP and WebSocket entry stays closed to other accounts, including
additional administrators and accepted invitees. Computer turns also verify
the actual stored source and account authority before an atomic commit.
Disabling the flag stops further turns without new points or progress. The
dedicated Watten host, production PWA, Watten email context and push delivery
remain closed.

Native friend notices briefly show selected players starting games without
card information. Watching needs an explicit click; an active table shows text
only. Account settings save consent and player selection; search results and
pending notices stay bounded. Personal follow-up invitations, tour preferences,
and device context have backend foundations; their remaining native interfaces
and public release are still pending. The existing dashboard adds Watten only
from its current analytics authorization. Matches, people, computer seats and
evidenced duration are distinct; unavailable traffic, installation and geography
measurements stay unknown. Account changes clear old private values even when
responses are delayed.

Following trump uses the confirmed second option: an ordinary rank card can
replace held trump only when it takes the current trick. Trump, the Right and
critical cards still have no duty to overtrump. The engine, CPU simulation and
bilingual guidance use the same rule.

## 3.15.0 — Watten-Folgetische und Gespräche / Watten next tables and conversation — 2026-10-18

**Deutsch:** Ein Folgetisch übernimmt Regeln und gewünschte Computerplätze.
Passwortschutz, Beitritt, Sitz, Team und Start bleiben bewusste Entscheidungen;
die eigene Platzreservierung lässt sich freigeben. Auch nach Antwortverlust
oder Neustart bleibt es derselbe Folgetisch, ohne frühere Punkte oder XP erneut
zu vergeben. Tischchat und zwölf Reaktionen funktionieren unabhängig von
Spielzügen und privatem Partnergefühl. Der bewusst geöffnete gemeinsame
Lobbychat respektiert Opt-in und den persönlichen Dreitages-Empfängerkreis.
Kontoübergänge, mobile Ansichten und verlorene Bestätigungen sind gezielt geprüft.
Lokale Tischdeko bietet acht Gegenstände, Essen und Trinken, Verschütten und
Aufräumen bei freigehaltenen Spielbereichen, auch mit reduzierter Bewegung.
Watten bleibt eine lokale Vorschau; der öffentliche Host bleibt geschlossen.

**English:** A next table carries over the rules and requested computer seats.
Protection, joining, seat, team and start remain explicit choices, and people
can release their own seat reservation. A lost response or restart keeps the
same next table without granting earlier points or XP again. Table chat and
twelve reactions work independently from gameplay and private partner advice.
The explicitly opened shared lobby chat respects opt-in and its personal
three-day audience history. Account transitions, mobile layouts and lost
confirmations have targeted checks. Watten remains a local preview with its
public host closed.
Local table decorations offer eight items, eating and drinking, spills and
cleanup while keeping play areas clear, including with reduced motion.

## 3.14.0 — Lokaler Watten-Fortschritt / local Watten progress — 2026-10-18

**Deutsch:** Neu abgeschlossene lokale Wattenpartien verbuchen Ergebnis,
Partie-XP und belegte Erfolge zusammen in einer Transaktion. Eigene Partien,
Fortschritt mit Wirtshaustiteln, Ranglisten mit erklärten Kennzahlen und ein
Erfolgsfeed erhalten eigene DE/EN-Ansichten. Bestätigungen im Partieabschluss
gelten nur für die angezeigte Partie; ältere ungesehene Fortschritte bleiben
offen. Gespeicherte XP und Erfolgswerte werden beim Lesen nicht neu vergeben.
Die Werte bleiben als Entwurf gekennzeichnet und der öffentliche Host geschlossen.
Ein privater Favorit übernimmt auf Wunsch das vollständige Tischrezept samt
Computerplätzen. Gespeichert wird nur die Schutzwahl; für den neuen Tisch sind
ein frisches Passwort oder eine ausdrückliche Schutzabwahl erforderlich.

**English:** Newly completed local Watten matches atomically store results,
match XP and evidenced achievements. Dedicated DE/EN pages show own matches,
progress and pub titles, standings with explicit measures and an achievement
feed. Acknowledging a match's closing rewards leaves older unseen progress
pending. Reads never grant XP again or reprice earlier awards. Values remain
labelled as a proposal and the public host stays closed.
A private favorite can restore the complete table recipe and CPU seat wishes.
Only the protection choice is saved; a new table needs a fresh password or
explicit protection removal.

## 3.13.0 — Lokaler Watten-Spieltisch / local Watten table — 2026-10-18

**Deutsch:** Die isolierte lokale Watten-Vorschau hat eine eigene zweisprachige
Spieloberfläche für zwei, drei und vier Personen. Sitze und Viererteams werden
bewusst gewählt; Computergegner lassen sich auf freie Plätze setzen. Ihre
Automatik verwendet nur das eigene erlaubte Wissen und dauerhaft gespeicherte
Beobachtungen. Bieten, einmaliges Einschauen und die ausdrückliche Rückkehr
nach dem Verlassen sind an die native Runtime angeschlossen. Ein reiner
Fortschrittsentwurf prüft Titel und Erfolge, vergibt aber noch keine XP.
Die öffentliche Watten-Domain bleibt geschlossen; dies ist kein Produktionsrelease.

**English:** The isolated local Watten preview has its own bilingual gameplay
interface for two, three and four players. Seats and four-player teams are
chosen deliberately; computer opponents can occupy specific free seats. Their
automation uses only their own permitted knowledge and durable observations.
Bidding, one-time inspection and explicit return after leaving use the native
runtime. A pure progression proposal checks titles and achievements without
awarding XP. The public Watten domain remains closed; this is not a production release.

## 3.12.3 — Interne Watten-Partien / internal Watten matches — 2026-10-18

**Deutsch:** Die lokale Watten-Entwicklung nutzt bestehende Konten für
Warteräume, persönliche Spielzustände und dauerhaft verbuchte Partieresultate.
Bewusstes Verlassen pausiert die Partie bis zur ausdrücklichen Rückkehr;
Karten, Punkte und ein offenes Gebot bleiben erhalten. Die feste öffentliche
Domain bleibt geschlossen. Spieloberfläche und CPU-Ausführung folgen separat.

**English:** Local Watten development uses existing accounts for waiting rooms,
personal game state and durably recorded match results. Intentionally leaving
pauses the match until an explicit return, retaining cards, scores and a pending
bid. The fixed public domain stays closed. Gameplay UI and CPU execution follow
separately.

## 3.12.2 — Interne Watten-Grundlagen / internal Watten foundations — 2026-10-18

**Deutsch:** Die internen Grundlagen für Watten bilden Karten, Stichwertung,
Einsatzbieten, Punkte, einmaliges Einschauen und die erlaubte persönliche
Sicht getrennt ab. Warteräume halten gewählte Sitze, Teams und vollständige
Tischrezepte fest. Diese Bausteine sind noch nicht an den öffentlichen
Spielbetrieb angeschlossen; Watten bleibt geschlossen und nicht spielbar.

**English:** Internal Watten foundations separately model cards, tricks,
bidding, scores, one-time inspection and each participant's permitted view.
Waiting rooms retain chosen seats, teams and complete table recipes. These
components are not connected to public gameplay yet; Watten remains closed
and unavailable to play.

## 3.12.1 — Zuverlässiger Spielwechsel / reliable game switching — 2026-10-18

**Deutsch:** Auf Kontoseiten bleibt der Spielwechsler sichtbar deaktiviert,
bis die Anmeldung geprüft ist. Dadurch verschluckt er keinen frühen Klick
mehr. Öffentliche Spielübersichten bleiben sofort bedienbar. Die feste
Watten-Domain erhält eine geschlossene Hostgrenze für HTTP und WebSockets;
sie liefert während der Vorbereitung keine fremde Spiel- oder Kontoansicht,
kein Manifest und keinen Worker. Watten ist damit noch nicht spielbar.

**English:** On account pages, the game switch stays visibly disabled until
sign-in has been checked, so it no longer loses an early click. Public game
lobbies remain immediately usable. The fixed Watten domain gains a closed
HTTP and WebSocket boundary. During preparation it cannot serve another
game, account view, manifest or worker. Watten is not playable yet.

## 3.12.0 — Hausdepp: seltene Funde sammeln / collecting rare finds — 2026-10-18

### Deutsch

20 neue Erfolge belohnen die acht seltenen Tischüberraschungen in zwei getrennten
Sammelreihen: selbst auslösen und miterleben. Der Auslöser sammelt beide.
Einzelfunde geben 50 beziehungsweise 25 EP, vier verschiedene zusätzlich
100/50 EP und alle acht zusätzlich 500/250 EP. Der Katalog hat nun 135 Erfolge
mit 5’605 Erfolgs-EP; die 24 Ränge bleiben erhalten. Eigene kleine Fundabzeichen
machen beide Reihen in Konto, Fortschritt und Erfolgsfeed erkennbar.

Beim Auslösen müssen mindestens zwei menschliche Mitspieler verbunden sein.
Die serverseitig belegte Teilnahme zählt erst nach regulärem Rundenabschluss;
Wiederholungen, spätere Reconnects und Wiederholungsversuche vergeben keine
Punkte doppelt. Zuschauer, Solo mit Computern, Offline-Spiel und Vorschauen
geben keine Fund-Erfolge. Alte Runden werden nicht rückwirkend ergänzt.

### English

Twenty new achievements reward the eight rare table surprises in two separate
collections: trigger them yourself and witness them. The activator collects
both. Single finds grant 50 and 25 XP, four different finds add 100/50 XP, and
all eight add 500/250 XP. The catalogue now has 135 achievements worth 5,605 XP;
the 24 ranks are retained. Small find badges distinguish both tracks in the
account, progress notices and achievement feed.

At least two human players must be connected when a find is triggered. The
server records that attendance privately and grants credit only after a normally
completed round. Repeated variants, reconnects and retries never duplicate
points. Spectators, solo computer games, offline play and previews do not earn
find achievements. Old rounds are not credited retroactively.


## 3.11.0 — Hausdepp: kleine Überraschungen am Tisch / little table surprises — 2026-10-18

**Deutsch:** Bier, Tee und Limonade zeigen jeden Schluck am Füllstand. Schnelles
Tippen verschüttet die restliche Flüssigkeit; ein karierter Putzlumpen erscheint.
Du ziehst ihn selbst über die Pfütze oder tippst ihn
mehrfach an. Weiteres Tippen wirft das leere Glas um, das sich nach kurzer Pause
wieder aufstellen und nachfüllen lässt. Snacks werden Stück für Stück gegessen,
Schalen und Marend-Brett bleiben stehen. Der Bierdeckel zählt in Fünfergruppen,
der Bleistift schreibt mit und verschobene Gläser hinterlassen kurz einen Ring.
Die Dose öffnet sich mit Schaum, kräftiges Hin-und-her-Schütteln lässt sie platzen
und hinterlässt eine kleine Pfütze zum Aufwischen. Ein geschütteltes Windlicht
geht kurz aus und zündet sich selbst wieder an. Diese Spielereien bleiben lokal,
begrenzt, leise und unter den Karten; reduzierte Bewegung beendet sie.
Ungefähr jede 50. Runde erhält einen von acht seltenen Funden: Stern,
Runenhammer, UFO, Portal, Drache, Kraken, Taschenuhr oder schwarzes Loch. Erst
entscheidet der Server über das seltene Angebot, dann über die Variante. Ein
Tipp überrascht den ganzen Tisch mit einer opulenten Inszenierung: Der Stern
strahlt über den Tisch, der Hammer wirbelt auch Karten durcheinander und sortiert
sie zurück. UFO und Portale entführen optische Doppelgänger von Karten und
Gegenständen, der Kraken greift nach abgeräumten Karten oder einem unnötigen
Gegenstand. Eine magische Maus mit Zylinder holt während einer zweisekündigen
visuellen Zeitpause die Uhr. Das schwarze Loch schluckt die ganze Szene samt
Holztisch, hält sie eine Sekunde schwarz und spuckt alles zurück. Nach dem Drachen
bleiben die Kartenränder für den Rest dieses Tisches angesengt, auch beim erneuten
Verbinden. Die echten Kartenwerte, Züge, Stapel und Trefferflächen bleiben korrekt. Nur der selbst
ausgelöste Hammer darf auf unterstützten Geräten kurz vibrieren. Der Server
verhindert gefälschte Angebote, alte Rundenklicks und doppelte Aktivierungen.
Nach 42 Bierdeckelstrichen gibt es ausserdem eine kleine nerdige Antwort.
Der überflüssige Fortschrittsbutton nach einer Runde entfällt. Punkte und Erfolge
bleiben sichtbar; erneutes Spielen und Lobby bleiben die eigentlichen Aktionen.
Der Endstand wartet auf die letzte Kartenbewegung und erscheint erst nach
weiteren 750 ms, damit der letzte Zug sichtbar zu Ende geht. Lange Turnierstände
stehen in einer eigenen Zeile je Gegner und verschwinden bei sechs Spielern
nicht mehr hinter Kartensymbolen oder Karten. Beim ersten vollständigen HAUSDEPP
zeigen Endstand, Tischkopf und Lobby ausdrücklich «Turnier beendet»; der
Tages-Hausdepp bleibt genannt. Die bestehende Endbedingung bleibt unverändert.

**English:** Beer, tea and lemonade show each sip in their fill level. Rapid taps
spill the remaining drink and a checked cloth lets you wipe up yourself by
dragging or repeated taps. More taps
topple the empty glass, which can be stood up and refilled after a brief pause.
Snacks are eaten piece by piece, leaving bowls and the snack board behind. The
beer mat counts in groups of five, the pencil adds marks, moved glasses briefly
leave a ring. Repeated taps open the can with foam; vigorous back-and-forth
shaking bursts it and leaves a small puddle to wipe up. Shaken lanterns go out
briefly and relight themselves. Ordinary interactions remain local,
bounded, quiet and below the cards; reduced motion clears them. About one round
in 50 offers one of eight rare finds: star, rune hammer, UFO, portal, dragon,
kraken, pocket watch or black hole. The server first decides whether a round
gets a find, then selects its variant. One tap shows everyone a brief, distinct
visual spectacle: the star shines across the table; the hammer scatters cards
and sorts them back. UFOs and portals abduct visual doubles of cards and objects;
the kraken grabs out-of-play cards or an unneeded object. A magical mouse in a top
hat retrieves the watch during a two-second visual time stop. The black hole
swallows the entire scene and wooden table, holds it black for one second and
spits everything back. The dragon leaves singed card edges for the rest of this
table session, including reconnects. Real card values, turns, stacks and hit boxes
remain correct.
Only the locally triggered hammer may briefly vibrate on supported devices.
The server rejects forged offers, stale round taps and duplicate claims.
Forty-two beer-mat strokes also reveal a little nerdy answer. The extra progress
acknowledgement button after a round is removed. Points and achievements remain
visible; playing again and returning to the lobby retain their own actions. The final result waits for
the last card movement and another 750 ms so the last play can land visibly.
Long tournament prefixes have their own line at each opponent seat, clear of
card-count icons and card backs even with six players. Once the first player
spells HAUSDEPP, the final result, table heading and lobby explicitly say
“Tournament complete” and still name today’s Hausdepp. The existing end rule is unchanged.

## 3.10.0 — Hausdepp: Computer halten hohe Karten zurück / computers hold back high cards — 2026-10-18

**Deutsch:** Hat ein Hausdepp-Computer mehrere Ober, Könige oder Asse, legt er
zuerst nur eine Karte und wirft den Rest nicht sofort nach. Der nächste Spieler
muss diese eine Karte beantworten (gleich hoch oder höher, mit einer 10 oder durch
Aufnehmen), während der Computer noch weitere hohe Karten in der Hinterhand hat.
Vier Gleiche räumen weiterhin sofort ab, niedrige Paare wirft er weiter zusammen
ab, und ohne Nachziehstapel wirft er nach, wenn er damit fertig wird; einen
solchen abschliessenden Nachwurf verpasst er nie. In gepaarten Partien (gleiche
Karten, jeder Platz, Produktionsparameter) gegen die eingefrorene 3.8.2-Policy
verlor ein Computer so an jeder Tischgrösse 14–16 % seltener. Volle Computer
vergessen das Zurückhalten in rund 12 % der Fälle, die sanfteren Computer der
ersten 50 Runden in rund 60 %; für neue Spieler werden sie dadurch kaum stärker
(2 Spieler rund 5 %, 4 Spieler ohne messbaren Unterschied). Die Messung ist mit
`paired_production_benchmark` in den Tests reproduzierbar.

**English:** When a Hausdepp computer holds several Obers, Kings or Aces, it now
plays just one first and does not follow up with the rest at once. The next player
has to answer that one card (equal or higher, a ten, or by taking the packet) while
the computer keeps more high cards in reserve. Four of a kind still clear at once,
low pairs are still shed together, and without stock it follows up when that
finishes its round, and it never misses such a finishing follow-up. In paired
games (same cards, every seat, production settings) against the frozen 3.8.2
policy a computer lost 14–16 % less often at every table size. Full-strength
computers forget to hold back in about 12 % of cases, the gentler computers of the
first 50 rounds in about 60 %, so they barely get stronger for new players (about
5 % with 2 players, no measurable difference with 4). The measurement is
reproducible with `paired_production_benchmark` in the tests.

## 3.9.1 — Abmelden bleibt in Hausdepp / signing out stays in Hausdepp — 2026-10-18

**Deutsch:** Wer sich in den Hausdepp-Einstellungen abmeldete, landete manchmal in
ZDWA statt auf der Hausdepp-Startseite. Das passierte, wenn die Seite beim Abmelden
noch Daten lud: Diese Anfrage sah die schon beendete Sitzung und löschte die
zwischengespeicherte Anmeldung, bevor die Abmeldung fertig war. Dadurch ging die
Information verloren, dass Hausdepp auch ohne Anmeldung offen ist, und die
gemeinsame Spielauswahl schickte nach ZDWA. Die Abmeldung merkt sich diese
Freigabe jetzt, bevor sie die Sitzung beendet. Ausserdem laufen zwei
ZDWA-Gerätewechsel-Tests im vollständigen lokalen Testlauf mit eigenem Konto,
damit ihnen frühere Tests die Kontosprache nicht mehr auf Englisch umstellen.

**English:** Signing out from the Hausdepp settings sometimes ended in ZDWA instead
of the Hausdepp home page. This happened when the page was still loading data
during sign-out: that request saw the session that had already ended and cleared
the cached sign-in before the sign-out finished. The fact that Hausdepp is open
without an account was lost, and the shared game switch sent the browser to ZDWA.
Sign-out now keeps that access before it ends the session. Two ZDWA device-switch
tests also use their own account in the full local test run, so earlier tests can
no longer switch their account language to English.


## 3.9.0 — Hausdepp: flexible Warteräume und Favoriten / flexible waiting rooms and favourites — 2026-10-18

**Deutsch:** „Tisch eröffnen“ bietet deinen gespeicherten Favoriten oder eine
kurze Konfiguration: fixe Spielerzahl oder offen bis sechs, Schnellspiel oder
Turnier, optional mit Passwort. Platzkarten zeigen die Besetzung. Der Gastgeber
fügt CPUs hinzu, entfernt sie und startet selbst; Menschen ersetzen bei einem
vollen Wartetisch einen CPU. Ein Favorit gilt für das Konto, speichert jedoch
kein Passwort. Spieler rufen, Teilen und Link-Kopieren bleiben verfügbar.
Vier persönliche häufige Reaktionen plus Pfeil öffnen zwölf Symbole, darunter 💩;
die Reihenfolge bleibt während einer Partie stabil. Nach bestätigtem Ablegen,
Nachwerfen oder erfolgreichem Zocken wächst das offene Paket sofort sichtbar;
Kartenflüge verzögern weder Kartenzahl noch Fächer gleicher Werte.

**English:** “Open a table” offers your saved favourite or a short setup: fixed
players or open up to six, quick game or tournament, with an optional password.
Place cards show the roster. The host adds/removes CPUs and starts explicitly;
people replace a CPU at a full waiting table. Favourites follow the account and
never retain passwords. Player calls, sharing and copying remain available.
Four personal frequent reactions plus an arrow open twelve symbols, including 💩;
the order stays stable during each game. Accepted plays, follow-ups and successful
gambles grow the visible open pile immediately; card flights never delay its
count or matching-rank fan.


## 3.8.2 — Klügere Hausdepp-Computer, spielneutrale Kontotexte / smarter Hausdepp computers, game-neutral account texts — 2026-10-18

**Deutsch:** Im Hausdepp-Zweikampf räumten Computer ein Ass oben fast immer mit
ihrer 10 ab, ausser bei höchstens zwei Paketkarten und mehr als zwölf Karten im
Stapel. Jetzt wägen sie Kaufen und Abräumen wie am grösseren Tisch ab: Mit
Nachziehstapel kaufen sie ein Ass in 79–100 % der Fälle, ohne Stapel räumt die 10
weiterhin ab. In 6000 gepaarten Duellen verloren sie so 4,7 % seltener; mit drei bis
sechs Spielern bleibt die Stärke gleich. Ab 50 eigenen Runden übersehen Computer
eine gute Kaufgelegenheit nur noch selten (etwa 1,5–3 % statt 5–9 %); die übrigen
menschlichen Ausrutscher bleiben. Anmeldung, Konto, Einstellungen und Spielanleitung
zählen die Spiele nicht mehr einzeln auf: Ein Konto, Passwort, Benutzername,
Sprache, Lobby-Chat, Profilbild und Spielerauswahl gelten für „alle unsere Spiele“,
und Mitspieler-Rufe führen in öffentliche Runden unserer Spiele. So bleiben die
Texte richtig, wenn ein weiteres Spiel dazukommt. Hinweise, die noch von „beiden
Spielen“ oder nur von ZDWA und Zilch sprachen (Spielerauswahl, Spieler finden,
Profilbild, Benutzername, gemeinsame Version, Versionshinweise, Spielerinnerungen),
sind ebenfalls angepasst. Der Lobby-Chat-Absatz der Zilch-Spielanleitung nennt jetzt
die Schnellfilter und erscheint auch auf Englisch. Nicht mehr verwendete alte Texte
wurden aus dem Sprachkatalog entfernt.

**English:** Hausdepp duels: computers used to clear an ace on top with their ten
almost every time, unless the packet had at most two cards and more than twelve
stock cards remained. They now weigh buying against clearing as at larger tables:
with stock left they buy an ace in 79–100 % of cases, without stock the ten still
clears. In 6,000 paired duels they lost 4.7 % less often; with three to six players
strength is unchanged. From 50 own rounds, computers rarely miss a good purchase
(about 1.5–3 % instead of 5–9 %); the other human-sized slips remain. Sign-in,
account, settings and the rules no longer list the games one by one: one account,
password, username, language, lobby chat, profile picture and player selection apply
to “all our games”, and player calls lead to public tables in our games. The texts
therefore stay correct when another game joins. Notes that still spoke of “both
games” or only of ZDWA and Zilch (player selection, find players, profile picture,
username, shared version, release notes, play reminders) are updated too. The lobby
chat paragraph in the Zilch rules now mentions the quick filters and appears in
English too. Old, unused texts were removed from the language catalog.

## 3.8.1 — Hausdepp: besser lesbarer Spieltisch / a more readable table — 2026-10-18

**Deutsch:** Verdeckter Stapel und offenes Paket werden nicht mehr abgedunkelt,
wenn andere Spieler dran sind; vorher lagen sie dann bei 45 % Deckkraft, was
Kartenweiss von 12,8:1 auf 3,8:1 Kontrast drückte. Was du gerade antippen kannst
(zocken, abheben, Paket nehmen), bekommt einen goldenen Leuchtrand; das
automatische Nachziehen leuchtet nicht. Name und Kartenzahl jedes Mitspielers
stehen auf einem dunklen Schild, der Spieler am Zug auf einem goldenen; auf dem
Handy in einer Zeile, und volle Tische sitzen dort in einer gleichmässigen Reihe. Die
Statuszeile ist eine Pille, gold bei deinem Zug, und zeigt keinen kleinen
Scrollbalken mehr. „Aus dem Spiel“ ist jetzt eine durchgestrichene Karte mit
Zahl; der Text bleibt für Screenreader und als Tooltip. Kein Tischtext ist
kleiner als 11 px, „Tisch frei“ und die gestrichelten Plätze sind kräftiger, und
ein sanfter Lichtkegel über der Tischmitte hebt die Karten vom Holz ab.

**English:** The stock and the open pile no longer fade while other players are
on turn; they used to sit at 45% opacity, which dropped card white from 12.8:1 to
3.8:1 contrast. Whatever you can tap now (gamble, cut, take the pile) gets a gold
ring; the automatic refill does not light up. Each opponent's name and hand size
sit on a dark plate, the player on turn on a gold one; on phones in one line, and
full tables sit there in one even row. The turn line is a pill,
gold on your turn, and no longer shows a tiny scrollbar. "Out of play" is now a
crossed-out card with its count; the words stay for screen readers and as the
tooltip. No table caption is smaller than 11px, "Table clear" and the dashed
places are stronger, and a soft lamp over the centre lifts the cards off the wood.

## 3.8.0 — Hausdepp: Rundenabschluss, Tisch-Extras, neue Erfolge / round summary, table extras, new achievements — 2026-10-17

**Deutsch:** Das Rundenende zeigt alle Platzierungen in der Reihenfolge, in der
die Spieler fertig wurden, den Hausdepp zuletzt, und für jedes Konto die in dieser
Runde verdienten EP sowie neu erreichte Erfolge; auf grossen Bildschirmen als
mittiges Fenster. Zwei oder drei gleiche Ränge oben auf dem offenen Paket fächern
sich leicht auf. Die Gegenstände am Tisch lassen sich benutzen: Münze werfen (Kopf
oder Zahl), würfeln, vom Bier, Tee oder der Limonade trinken – zu wild getippt wird
verschüttet, noch wilder kippt das Glas um –, unberührtes Bier verliert seinen
Schaum, und Snacks werden Biss für Biss verputzt. Das Profilbild im Header führt
direkt zur Profilbild-Einstellung. Ein kalter App-Start lädt 2,4 MB statt 5,6 MB
Kartenbilder und zeigt keine fehlenden Rückseiten mehr. 15 neue Erfolge nach
ZDWA-Vorbild zählen Spielzeit und Häufigkeit (Bürozeit, Arbeitszeitbetrug,
Nachteule, Wochenende, Spielabend, Serien, 500 und 1000 Runden); die Ränge bleiben
bis 2’300 EP gleich und reichen nun bis Hausdepp bei 9’000 EP. Hausdepp erhält
tägliche Spielerinnerungen und Startmeldungen der Spielerauswahl; Einstellungs-
und Hilfetexte nennen alle Spiele statt nur ZDWA und Zilch.

**English:** The round end lists every place in finishing order, the Hausdepp last,
with each account's XP for this round and newly reached achievements; on large
screens as a centred card. Two or three equal ranks on top of the open pile fan out
slightly. Table objects can be used: toss the coin (heads or tails), roll the dice,
drink beer, tea or lemonade – tap too wildly and it spills, wilder still and the
glass tips over –, an untouched beer goes flat, and snacks are eaten bite by bite.
The header avatar opens the profile picture setting. A cold app start loads 2.4 MB
instead of 5.6 MB of card art and no longer shows missing card backs. 15 new
achievements following ZDWA count play time and frequency (office hours, time
theft, night owl, weekends, card nights, streaks, 500 and 1,000 rounds); ranks
stay the same up to 2,300 XP and now reach Hausdepp at 9,000 XP. Hausdepp gains
daily play reminders and player-selection start notices; settings and help texts
name all games instead of only ZDWA and Zilch.

## 3.7.1 — Hausdepp: Abheben sichtbar machen / show who wins the cut — 2026-10-17

**Deutsch:** Hebt jemand nach dem Mischen erfolgreich ab (eine 10 oder Asse mit
einer 10), fliegen die gewonnenen Karten für alle offen vom verdeckten Stapel in
die Tischmitte. Dort steht gut eine Sekunde lang, wer sie bekommt, zum Beispiel
„Liesl bekommt Ass · 10“, danach fliegen sie sichtbar zu dieser Hand. Erst dann
wird ausgeteilt, und ein Computer wartet mit seinem ersten Zug. Bei reduzierter
Bewegung bleibt die Beschriftung ohne Flug. Browser-Tests mit echten Computern
sind robuster gegen deren neue Kaufentscheidungen. Stilles Release.

**English:** When someone cuts successfully after the shuffle (a ten, or aces with
a ten), the won cards rise face up from the stock to the table centre for
everyone. A caption names the receiver for about a second, for example "Liesl
receives Ace · 10", then the cards fly visibly into that hand. Only then is the
deal shown, and computers wait before their first move. With reduced motion the
caption appears without a flight. Browser tests with real computers are more
robust to their new buying decisions. Silent release.

## 3.7.0 — Hausdepp: klügere, gnädigere Computer und Tipps / smarter, kinder computers and tips — 2026-10-17

**Deutsch:** Computer bewerten Karten jetzt nach ihrem Spielwert: 10 und Ass sind
wertvoll, niedrige Karten Ballast, und jede zusätzliche Handkarte wiegt schwerer,
je leerer der Nachziehstapel wird. Ein einzelnes Ass oder ein kleines Paket mit
hohen Karten wird deshalb lieber gekauft, statt eine 10 darauf zu verbrennen. Ein
Paket, das eigene Karten zu Drillingen oder vier Gleichen ergänzt, ist besonders
attraktiv, und ohne legale Karte wird ein gutes Paket dem Zocken vorgezogen. Im
Duell verhalten sie sich vorsichtiger. Die Computer spielen mal besser, mal
schlechter: Jeder hat eine kleine Eigenheit, und gelegentlich unterläuft ihnen ein
menschlicher Fehler. In den ersten 50 Runden des neuesten Menschen am Tisch spielen
sie spürbar gnädiger und werden schrittweise stärker. Wer weniger als 50 Runden
gespielt hat, sieht in der eigenen Zugzeile kurze Tipps wie „Ass aufnehmen, 10
behalten“. Die Spielanleitung erklärt das Kaufen kleiner Pakete. Stilles Release.

**English:** Computers now value cards by their worth: tens and aces are valuable,
low cards are ballast, and every extra hand card weighs more as the stock empties.
They therefore prefer to buy a single ace or a small pile of high cards rather than
burn a ten on it. A pile that turns their cards into triples or four of a kind is
especially attractive, and without a legal card a good pile beats a gamble.
Heads-up, they play more cautiously. Computers play sometimes better, sometimes
worse: each has a small personality, and now and then they make a human mistake.
During the first 50 rounds of the newest person at the table they play noticeably
gentler and grow stronger step by step. Players with fewer than 50 rounds see short
tips in their own turn line, such as "take the ace, keep your ten". The rules
explain buying small piles. Silent release.

## 3.6.0 — Hausdepp: flüssige Würfe, sicheres Nachwerfen / smooth throws, reliable follow-ups — 2026-10-17

**Deutsch:** Eine getippte Handkarte fliegt sofort auf das offene Paket. Es gibt
dabei nur noch eine einzige Karte: Die Serverbestätigung übernimmt genau dieses
fliegende Bild, statt eine halbtransparente Handkarte stehen zu lassen und eine
zweite Kopie loszuschicken. Das alte Paketbild liegt immer unter der fliegenden
Karte, die Übergabe an die echte Karte geschieht ohne Aufblitzen im selben Frame,
und die übrigen Handkarten gleiten zusammen. Flugkarten anderer Spieler werden in
voller Grösse mit denselben proportionalen Ecken wie liegende Karten gezeichnet.
Computer warten nun auch nach einer menschlichen Karte deren Landung ab, selbst
wenn sie gerade auf ein Auffüllen warteten; jedes Nachwerfen verlängert diese
Zeit. Kommt die Karte des Nachfolgers zuerst an, fliegt ein zu später Nachwurf
sichtbar auf die Hand zurück, mit der Meldung „Zu spät“. Rasch vorgemerkte
Karten werden nie später als andere Aktion ausgeführt. Langes Halten einer
Handkarte wählt alle Karten dieses Rangs für genau einen Wurf. Das Auffüllen auf
drei geschieht für alle automatisch; die bisherige Einstellung entfällt. Nach dem
Abheben schauen die gesehenen untersten Karten als kleiner Fächer unter dem
verdeckten Stapel hervor, nur für den Abhebenden. Die Kartenbilder stammen aus
einer vorberechneten Tafel mit exakter Perspektive, Farbabgleich und
randabhängiger Schärfung, sodass alle Karten gleich scharf wirken. Ein seit dem
zufälligen ersten Geber wackliger Backend-Test ist stabilisiert. Stilles Release.

**English:** A tapped hand card flies to the open pile immediately, as one single
card: the server confirmation adopts that very picture instead of leaving a
faded hand card behind and launching a second copy. The old pile picture always
lies beneath the moving card, the handover to the real card happens in the same
frame without a flash, and the remaining hand cards glide together. Other
players' flying cards are drawn at full size with the same proportional corners
as cards on the table. Computers now wait for a human card to land even while
they were waiting on a refill; each follow-up extends that time. If the next
player's card arrives first, a late follow-up visibly flies back to the hand with
a "Too late" message. Quickly queued taps never run later as a different action.
Holding a hand card selects every card of that rank for exactly one throw.
Refilling to three is automatic for everyone; the former setting is gone. After
cutting, the seen bottom cards peek out from under the stock as a small fan, for
the cutting player only. Card faces come from a pre-rendered atlas with exact
perspective, paper balance and edge-aware sharpening, so every card looks equally
crisp. A backend test made flaky by the random first dealer is stabilised.
Silent release.

## 3.5.0 — Hausdepp: neueste Erfolge / latest achievements — 2026-10-17

**Deutsch:** Die Hausdepp-Rangliste hat einen neuen Bereich „Neueste erreichte
Erfolge“. Er zeigt die jüngsten Freischaltungen aller aktiven Konten, die
neuesten zuerst, mit Erfolgsname, Beschreibung, EP und Zeitpunkt. Leicht
(10 EP), Mittel (25 EP) und Schwer (50/100 EP) lassen sich filtern; geblättert
wird in Schritten von 20 Einträgen. Sichtbar sind nur der Kontoname und der
Erfolg – keine Runden, Karten, Mitspieler oder Konto-IDs. Computer erscheinen
nicht. Der Bereich ist nur angemeldet erreichbar.

**English:** The Hausdepp leaderboard gains a “Latest achievements earned”
section. It lists the newest unlocks from every active account, newest first,
with the achievement name, description, XP and time. Easy (10 XP), medium
(25 XP) and hard (50/100 XP) can be filtered, and the list pages 20 entries at
a time. Only the account name and achievement are shown – no rounds, cards,
co-players or account IDs. Computers never appear. The section is available to
signed-in players only.

## 3.4.3 — Hausdepp: stabile Kartengrösse / stable card sizes — 2026-10-17

**Deutsch:** Das offene Paket wird beim Ablegen nicht mehr vorübergehend kleiner.
Die Animation übernimmt die tatsächlich dargestellten Kartenmasse und Positionen
anstelle einer festen Breitenbegrenzung. Das bestehende Paket und die neu
ankommende Karte gehen dadurch ohne Grössensprung in die dauerhafte Darstellung
über, auch bei grossen Tablet-Karten. Die Darstellung wird auf Smartphone,
Tablet und Desktop in beiden Ausrichtungen geprüft. Stilles Release.

**English:** The open pile no longer briefly shrinks when a card is played.
Animations use the rendered card dimensions and positions instead of a fixed
width limit. Existing pile cards and the newly arriving card join the permanent
view without a size jump, including large tablet cards. Presentation is checked
on phones, tablets and desktops in both orientations. Silent release.

## 3.4.2 — Hausdepp: Karten besser verfolgen / follow the cards — 2026-10-17

**Deutsch:** Kartenwürfe laufen nacheinander und mit einer kurzen Liegephase.
Eine 10 oder vier Gleiche bleiben dadurch erkennbar, bevor das gesamte Paket
langsamer auf „Aus dem Spiel“ wandert. Computer lassen ausreichend Zeit für
diese Darstellung; menschliche Aktionen und die Spielregeln bleiben unmittelbar
verfügbar. Nachziehstapel und offenes Paket zeigen ihre tatsächliche Grösse mit
sichtbaren Kartenlagen. Auf Tablet und Desktop nutzen Karten und Stapel mehr
Platz. Grosse Hände rücken enger zusammen, besonders Karten gleichen Werts;
Scrollen und Tastaturfokus halten jede Karte erreichbar. Die iPhone-Icon-Pfade
und Cache-Versionen wurden anhand der live ausgelieferten PNGs geprüft und um
einen Browsertest für anonymes Laden und Dekodieren ergänzt. Stilles Release
ohne neue Push-Nachricht oder Versionspopup.

**English:** Card plays run in sequence with a short resting beat. A ten or four
matching ranks remain recognizable before the complete pile moves more slowly
to “Out of play”. Computers allow time for this presentation; human actions and
game rules remain immediately available. Stock and open piles show their actual
size through visible card layers. Tablets and desktops use more space for cards
and piles. Large hands pack more tightly, especially matching ranks; scrolling
and keyboard focus keep every card reachable. iPhone icon paths and cache
versions were checked against the live PNGs, with an added browser regression
for anonymous loading and decoding. Silent release without a new push or
version popup.

## 3.4.1 — Hausdepp: ein belebter Tisch / a livelier table — 2026-10-17

**Deutsch:** Auf dem Hausdepp-Tisch liegt mehr: Zu den zwölf grossen
Gegenständen kommen zehn kleine Streuteile, darunter Kronkorken, Flaschenöffner,
Pralinen, ein einzelner Würfel, lose Nüsse, Chips und Flips, ein Bierdeckel mit
Strichliste und ein Bleistift. Desktop zeigt pro Runde bis zu zwölf Dinge,
Tablet bis zu acht, das Handy bis zu vier statt einem. Jeder Gegenstand
reagiert beim Antippen eigen: Kronkorken drehen sich wie Münzen, Öffner und
Bleistift kreiseln, Pralinen und Würfel rollen, Snacks hüpfen und krümeln,
Getränke kräuseln ihre Oberfläche und das Windlicht flackert auf. Mit Maus oder
Finger lassen sich Gegenstände ein Stück über den Tisch schieben; auf Karten,
Stapeln, Namen oder Knöpfen bleiben sie nie liegen. Im Ruhezustand steigen
Bläschen im Bier und Folie und Dose glänzen gelegentlich. Gegenstände halten den
Platz frei, den eine wachsende Hand braucht, und liegen auf dem Handy nicht mehr
halb unter den eigenen Karten. Im Tischgespräch am Desktop ist der Platzhalter nicht mehr abgeschnitten. Die Bilder laden als WebP rund 5 MB
leichter. Spielregeln und Abläufe sind unverändert; reduzierte Bewegung schaltet
alle Effekte ab.

**English:** The Hausdepp table holds more: ten small scatter pieces join the
twelve large props, among them bottle caps, an opener, chocolates, a single die,
loose nuts, crisps and peanut puffs, a beer mat with tally marks and a pencil.
Desktops show up to twelve things per round, tablets up to eight and phones up to
four instead of one. Every object has its own tap reaction: caps spin like
coins, the opener and pencil twirl, chocolates and the die roll, snacks hop and
drop crumbs, drinks ripple and the lantern flares. Objects can be pushed a little
with mouse or finger and never come to rest on cards, piles, names or buttons.
At rest, bubbles rise in the beer and foil and can catch the light now and then.
Objects keep clear of the space a growing hand needs and no longer sit half
under your cards on phones. The desktop table chat no longer cuts off its hint. The artwork loads as WebP, about 5 MB lighter. Rules and game flow are
unchanged; reduced motion turns every effect off.

**Deutsch – klarere Bedienung:** Am Computer stehen „Mehrere Karten auswählen“
und „n Karten legen“ jetzt als Leiste direkt unter der eigenen Hand; der
Knopf „Abbrechen“ entfällt, weil derselbe Schalter die Mehrfachauswahl wieder
beendet (Escape funktioniert weiterhin). „Spielhilfe und Einladen“ sitzt in der
Seitenleiste unter dem Tischgespräch statt mitten auf dem Tisch. Zocken, Paket
und Aus dem Spiel tragen dieselbe Beschriftung auf gleicher Höhe, mit der Anzahl
darunter („20 zum Nachziehen“, „4 Karten“, „6 Karten“); der abgelegte Stapel
ist grösser und sauber ausgerichtet, auch auf Handy und Tablet. Ein Hinweis am
offenen Paket erklärt Antippen und Halten, und langes Drücken markiert keinen
Text mehr. Karten, die man beim Abheben unten gesehen hat, liegen als kleiner
Fächer mit „Unten: …“ links neben dem Stapel statt versteckt auf ihm. Mobil
bleiben Schalter und Knöpfe an ihrem gewohnten Platz.

**English – clearer controls:** On computers, “Select multiple cards” and
“Play n cards” now sit as a bar right below your hand; the “Cancel” button is
gone because the same switch ends multi-select (Escape still works). “Help and
invitations” moved to the sidebar below the table chat instead of sitting on the
table. Stock, pile and out-of-play cards share one label style at one height,
with the count below (“20 to draw”, “4 cards”, “6 cards”); the discarded stack
is larger and neatly aligned on phones and tablets too. A hint on the open pile
explains tap and hold, and holding no longer selects text. Cards seen at the
bottom while lifting the deck lie as a small fan marked “Bottom: …” to the left
of the stock instead of hidden on it. On phones the switch and buttons stay
where players know them.

**Mitteilung / Notice:** Weil die Mitteilung zu 3.4.0 nicht als Push ankam,
fasst der Hinweis dieser Version 3.4.0 und 3.4.1 zusammen. / Because the 3.4.0
notice did not arrive as a push, this version's notice summarises 3.4.0 and 3.4.1.

## 3.4.0 — Hausdepp: Geber, Abheben und Auffüllen / dealer, peeking and refills — 2026-10-17

**Deutsch:** Bei Hausdepp wird der erste Geber jedes Tisches jetzt ausgelost,
gegen Computer wie gegen Menschen. Bisher gab immer der letzte Sitz, und weil
Computer hinter den Menschen sitzen, hob ab drei Spielern nie ein Mensch ab. Im
Turnier gibt weiterhin nach jeder Runde der Nächste im Uhrzeigersinn. Wer beim
Abheben erfolglos Karten angeschaut hat, sieht sie als Etikett „Unten: …“ auf
dem verdeckten Stapel, solange sie darin liegen; bisher verschwanden sie nach
wenigen Sekunden in der Tischhilfe. Neu ist **Automatisch auf drei auffüllen**
pro Konto, umschaltbar in der Tischhilfe und in den Kontoeinstellungen,
standardmässig aus. Die Mehrfachauswahl wählt mit einem Tipp alle gleichen
Karten, ein weiterer Tipp nimmt einzelne heraus; ausgewählte Karten heben sich
mit Haken an. Auf Touchgeräten blieb die zuletzt angetippte Karte angehoben und
verdeckte ihre Nachbarn – das ist behoben. Die Kontoeinstellungen sind in fünf Gruppen geordnet und eingeklappt;
ein Tipp öffnet einen Punkt. In der mobilen Lobby steht „Neuer Stammtisch“ direkt
unter dem Titel, „So wird gespielt“ folgt darunter.

**English:** In Hausdepp the first dealer at every table is now drawn at
random, against computers and people alike. Previously the last seat always
dealt, and as computers sit after people, no person ever inspected the bottom
card at tables of three or more. Tournaments still pass the deal clockwise after
each round. Cards seen in a failed bottom inspection now show as a “Bottom: …”
label on the face-down pile for that player while they remain in it; before,
they vanished into the table help after a few seconds. New: **Refill to three
automatically** per account, switchable in the table help and account settings,
off by default. Multi-select picks every matching card with one tap, and another
tap takes single cards out; selected cards lift with a check mark. On touch
screens the last tapped card stayed raised and covered its neighbours; that is
fixed. Account settings are grouped
into five sections of collapsed rows that open with a tap. In the mobile lobby
“A new regular table” now sits right below the title, with “How to play” after it.

## 3.3.1 — Kacheln und ein klügerer Vorschlag / tiles and a smarter suggestion — 2026-10-17

**Deutsch:** Im neuen ZDWA-Design zeigt oben je Spieler (im 2-gegen-2 je Team)
eine Kachel Profilbild, Namen und Punkte; ein Messingrand markiert den Zug, ein
Tipp öffnet diesen Zettel. Die Würfe des Zuges stehen auf dem Würfeln-Knopf, und
der Spielzettel hat Abstand zum Kopfbereich, sodass dessen Rand sichtbar bleibt.
Der Vorschlag wählt nicht mehr fast immer das Maximum (+) in der freien Reihe:
Er vergleicht jedes Feld mit seinem üblichen Ertrag, hält flexible Felder zurück
und erscheint vor dem letzten Wurf nur, wenn Schreiben besser ist als
Weiterwürfeln. In 1000 simulierten Partien stieg der Schnitt beim Befolgen von
593 auf 861 Punkte. Die Einsteigertour für ZDWA beschreibt Zug und
Wurfzähler passend, zeigt beim Blick auf einen fremden Zettel nicht mehr auf ein
unsichtbares Feld und bleibt bei einem Verbindungsabbruch über dem Hinweis lesbar.
Das bisherige Design bleibt unverändert.

**English:** In the new ZDWA design, tiles at the top show each player (each
team in 2v2) with avatar, name and score; a brass edge marks the turn and a tap
opens that score sheet. The roll count sits on the roll button, and the score
sheet keeps clear of the header so its rule stays visible. The suggestion no
longer picks the maximum (+) in the free column almost every time: it compares
each field with what it usually scores, keeps flexible fields in reserve and,
before the last roll, appears only when writing beats rolling on. Across 1000
simulated games, following it raised the average from 593 to 861 points. The
ZDWA beginner tour now describes the turn and roll counter accurately, no longer
points at a hidden cell while another sheet is shown, and stays readable above
the reconnect notice. The previous design is unchanged.

## 3.3.0 — Gemeinsam an den nächsten Tisch / Together at the next table — 2026-10-17

**Deutsch:** Nach einer beendeten oder abgebrochenen Hausdepp-Partie erstellt
„Neu erstellen“ einen gemeinsamen Folgetisch mit denselben Einstellungen und
derselben Computerzahl. Frühere Mitspieler erhalten eine persönliche Einladung
mit ausdrücklicher Annahme; reservierte Plätze, Wiederaufnahme und mehrfaches
Klicken bleiben abgesichert. Laufende Turniere behalten „Nächste Runde“.
Wartende Hausdepp-Tische schliessen nach einer Stunde ohne neuen menschlichen
Sitz. Der Abbruch vergibt keine zusätzlichen Punkte oder Siege.

Eine Mehrfachauswahl spielt gleiche Karten als einen atomaren Zug; normales
Antippen bleibt unmittelbar. Computer handeln im variablen Normaltempo 12,5 %
langsamer. Die Lobby zeichnet Karten erst nach dem Dekodieren ihrer Motive,
wiederholt vorübergehende Bildfehler und lässt öffentliche Kartenbilder beim
PWA-Neuladen den nativen Browsercache verwenden. Private Daten bleiben online.
In allen drei Spielen reagieren Tour starten und Ansehen in den
Kontoeinstellungen bereits während des ersten Ladens; schnelle Klicks gehen
nicht mehr vor dem Binden der Bedienung verloren.

**English:** After a completed or aborted Hausdepp game, “Create again” opens
one shared follow-up table with the same settings and computer count. Previous
players receive personal invitations requiring explicit acceptance, with
reserved seats, resume support and repeat-click protection. Ongoing tournaments
keep “Next round”. Waiting Hausdepp tables close after one hour without a new
human seat. An abort grants no extra points or wins.

Multiple selection plays matching cards atomically; normal taps still play
immediately. Computers take 12.5% longer within their varied normal timing.
The lobby draws cards only after decoding their artwork, retries temporary
image failures and lets public card images use the native browser cache on
PWA reload. Private data remain online-only. In all three games, Start tour
and View in account settings work during initial loading, so an immediate
click is no longer lost before controls are wired.

## 3.2.0 — Der Hausdepp wird schlauer / Hausdepp gets smarter — 2026-10-16

**Deutsch:** Hausdepp ist da und wächst weiter: Das mobile Spielfenster bleibt
ohne Seitenscroll bedienbar, mit grossen Stapeln, internem Kartenfächer und
zugänglicher Spielhilfe. Computer setzen sichere Schlussketten ein und spielen
mit wechselnden Reaktionszeiten. Ihre Entscheidungen verwenden nur eigene
Karten und öffentliche Informationen; Regeln und Nachwurfrecht bleiben gleich.
Anmeldung und Kontoverwaltung haben eine eigene Hausdepp-Oberfläche mit Passkey
zuerst, gemeinsamen Konten und sicheren E-Mail-/Passwort-Rückwegen. Die Touren
von develop bleiben erhalten und sind auch in den neuen Einstellungen steuerbar.

Wartende Spieler können ihren Platz freigeben, ohne die übrige Runde zu beenden;
das Hostrecht wird weitergegeben. Ranglisten zeigen aktuelle Hausdepp-Titel.
Der gemeinsame Community-Chat erhält Hausdepp-Tag und Schnellfilter, bestehende
Nachrichten und Empfängergrenzen bleiben erhalten. Öffentliche Kartenbilder
werden vorgeladen, dekodiert und versioniert gecacht; private Inhalte bleiben
no-store. Eindeutige Herz-Zehner-Dateinamen, explizite Apple-Icon-Grössen und
öffentliche Apple-Fallbackpfade verbessern die Icon-Erkennung bei der Installation.

**English:** Hausdepp is here and keeps improving: the mobile table fits a single
window without page scrolling, with larger piles, an internally scrolling hand
and accessible help. Computers use safe finishing chains and varied response
times. They use only their own cards and public information; the rules and
follow-up rights remain unchanged. Dedicated Hausdepp sign-in and account
settings put passkeys first while preserving shared accounts and safe email
and password return paths. Develop's beginner tours are retained and can also
be controlled from the new settings.

Waiting players can release a seat without ending everyone else's table; host
rights transfer. Standings show current Hausdepp titles. The shared community
chat gains a Hausdepp tag and quick filter without changing stored messages or
recipient boundaries. Public card images are preloaded, decoded and cached at
versioned URLs; private content remains no-store. Fresh heart-ten filenames,
explicit Apple icon sizes and public fallback paths improve icon discovery
during installation.

Ergänzung / addition: Erfolge und Rangaufstiege erscheinen mit Bedingung und
belegbarer Begründung nach Rundenende; bisherige Meldungen werden beim nächsten
sicheren Hausdepp-Einstieg einmalig nachgezeigt. Offene Pakete sind vor dem
Nehmen auffächerbar, ausgeschiedene Karten haben einen eigenen Ablagestapel.
Requisiten bleiben bei Handänderungen an ihrem Platz und erhalten passende,
seltene Bewegungen. / Achievements and rank-ups explain their conditions and
recorded reason after rounds; earlier notices appear once on the next safe
Hausdepp entry. Inspect open piles before pickup; cleared cards have their own
stack. Props stay put as hands change and gain occasional object-specific motion.

## 3.1.0 — Einsteigertouren / beginner tours — 2026-10-16

**Deutsch:** ZDWA, Zilch und Hausdepp bieten beim ersten eigenen Spiel eine
freiwillige kurze Tour direkt am Tisch an. Hinweise erklären die passende Aktion
und ihren Zweck; fremde Züge, Pause und Wiederverbindung berücksichtigen den
aktuellen Spielzustand. ZDWA erklärt Solo, Teams und Hardcore passend zum Modus.
Jeder Schritt lässt sich über Tour beenden, × oder Escape schliessen. Eine
beendete oder abgelehnte Tour erscheint beim nächsten Spiel nicht ungefragt
wieder. Die Wahl wird getrennt je Konto und Spiel gespeichert, für Gäste im
Browser. Einmalige Angebote werden kontoweit atomar beansprucht.

Unter Einstellungen → Hilfe & Neuigkeiten lassen sich verfügbare Touren erneut
starten oder mit gekennzeichneten Beispielen anschauen und automatische Angebote
ausschalten. Gäste finden den Einstieg in den Lobbyeinstellungen. Tourknöpfe
führen keine Spielaktion aus; die Beispielansicht erzeugt keine Partie, Punkte
oder Erfolge. Alle Tourtexte sind auf Deutsch und Englisch verfügbar.

**English:** ZDWA, Zilch and Hausdepp offer an optional short tour at the table on
first play. Hints explain a suitable action and its purpose, respecting opponent
turns, pauses and reconnection. ZDWA adapts to solo, teams and Hardcore. Every
step can be closed with End tour, × or Escape. Ended or declined tours do not
reappear unsolicited. Choices are saved per account and game, or in the browser
for guests; first offers are claimed atomically across an account's devices.

Settings → Help & updates lets players restart tours, view labelled examples
and disable automatic offers. Guests find tours in lobby settings. Tour buttons
perform no gameplay action; viewing examples creates no game, score or achievement.
All tour text is available in German and English.

## 3.0.1 — Mehr Platz für die Karten / more room for the cards — 2026-10-16

**Deutsch:** Das offene Paket und der verdeckte Stapel nehmen auf dem Handy
mehr Raum ein und sind leichter anzutippen. Im üblichen Hochformat wachsen
sie von 64 auf 104 Pixel Breite, mit angepassten Grössen für schmale Handys und
Querformat. Der Spielerbogen und die Hinweise erhalten genügend Abstand,
auch mit sechs Spielern. Eine kleine Überbreite der Reaktionsleiste auf sehr
schmalen Geräten ist ebenfalls behoben.

**English:** The face-up pile and face-down stock are larger and easier to tap
on phones. In typical portrait layouts their width grows from 64 to 104 pixels,
with sizes adapted for narrow phones and landscape. The player arc and captions
keep clear of the piles, including at six-player tables. A small reaction-toolbar
overflow on very narrow screens is also fixed.

## 3.0.0 — Töröö! Der Hausdepp ist da / trumpets out, Hausdepp is here — 2026-10-16

**Deutsch:** Hausdepp öffnet als drittes Spiel der Suite für alle angemeldeten
Spieler. Zwei bis sechs Personen spielen am eigenen Kartentisch, mit Menschen,
Computern oder beidem. Das HAUSDEPP-Turnier, 100 Erfolge, 24 ironische Ränge,
eigene Kontoseiten und die Rundensieg-Rangliste gehören zum Start. Eine Runde
mit mindestens einem Computer gibt nach 75% Abzug und Abrunden 2 EP, eine reine
Menschenrunde 10 EP; Erfolgsbelohnungen bleiben vollständig.

Die Lobby und Hausregeln sind auf `hausdepp.zockdiewandan.online` öffentlich
auffindbar, mit eigenen Canonicals, Metadaten, robots.txt und Sitemap. Spielen,
private Ergebnisse und Kontodaten benötigen weiterhin eine Anmeldung. Der
Spielwähler verbindet alle drei Spiele; bestehende Anmeldungen und installierte
Apps behalten ihren Zusammenhang. Hausdepp hat ein eigenes Herz-Zehner-Icon,
ein Installationsmanifest und Mitspieler-Rufe mit den vorhandenen Opt-ins.
Owner-Monitoring bleibt gesondert geschützt. DNS, Zertifikat und Proxy werden
vor der regulären, sichtbaren Release-Mitteilung geprüft. Kein stiller Release.

**English:** Hausdepp opens as the suite’s third game for every signed-in
player. Two to six people share its own card table, with people, computers or
both. The HAUSDEPP tournament, 100 achievements, 24 ironic ranks, dedicated
account pages and round-win standings are included. A round with any computer
grants 2 XP after a 75% reduction and per-round floor; an all-human round grants
10 XP. Achievement rewards remain complete.

The lobby and house rules are publicly discoverable on the dedicated host,
with their own canonicals, metadata, robots.txt and sitemap. Playing, private
results and personal accounts still require sign-in. The shared picker links
all three games while preserving accounts and installed-app navigation.
Hausdepp has a heart-ten app icon, installation manifest and player calls using
existing opt-ins. Owner monitoring remains separately protected. DNS,
certificates and proxy are checked before the regular visible announcement.
This is not a silent release.

## 2.59.0 — Eine eigene Kartenrunde / a card table of its own — 2026-10-16

**Deutsch:** Hausdepp erhält eine eigene Gestaltung aus Tannengrün, hellem
Kartenpapier, Kartenrot und kräftiger Serifenschrift. Navigation und wichtige
Wege sind als Buttons erkennbar. Die Gegner sitzen im Halbkreis; Profilbilder
und sichtbare eigene und fremde Reaktionen gehören zur Runde. Computer erhalten
zufällige, innerhalb eines Tisches eindeutige Namen aus einem Pool von 50 Namen.
Zwölf wechselnde Requisiten vom Bier über Tee bis zu Chips und Marend füllen
freien Tischraum, auf Mobilgeräten dezenter. Dampf, Schaum und Kerzenlicht bewegen
sich sehr zurückhaltend und berücksichtigen reduzierte Bewegung. Die Lobby zeigt
eine grössere Vorschau-Hand rechts neben dem Titel mit ruhigen Kartenwechseln;
der mobile Tischstart benötigt weniger Platz.
Die Vorschau ergänzt nur unter drei Karten und spielt mehrere Karten nur mit
gleichem Rang. Eine kurze einmalige Mischanimation geht dem Abheben voraus, ohne eine Aktion
zu sperren; Neuladen, Wiederverbinden und reduzierte Bewegung wiederholen sie
nicht. Die Menüfolge entspricht der Suite: Lobby, Rangliste, Regeln, Konto. Neue Tische erhalten automatisch einen von 50 Wirtshausnamen mit deinem
Kontonamen; das Namensfeld entfällt.

Hausdepp hat ein stilisiertes Herz-Zehner-Icon, deutsche und englische Installationsmanifeste
und einen eng begrenzten Service Worker. Die installierte App startet bei
Hausdepp; Spielwechsel erhalten die App-Identität. Private Inhalte werden nicht
offline gespeichert. Der Versionshinweis erscheint oben rechts. Der gemeinsame
Spielwähler zeigt in allen Spielen aktuell verbundene Menschen an laufenden
Tischen, ohne Computer und Zuschauer, mit eindeutiger Kontenzählung und frischer
Prüfung der Spielfreigaben. Teilen, Kopieren und Mitspieler-Rufe folgen den
Suite-Abläufen mit separatem Push-Opt-in, Absenderauswahl und Sperrfristen.
Auch eine frisch installierte Hausdepp-PWA kann ihr Push-Gerät in den gemeinsamen
Einstellungen aktivieren; Einladungen bleiben auf freigegebene Konten begrenzt.

Erreichte Erfolge stehen innerhalb ihrer Gruppe vor den offenen. Häufige Ziele
benötigen mehrere unterschiedliche abgeschlossene Runden, statt schon nach
einem Spiel massenweise freizuschalten. Seltene Kunststücke bleiben direkt
erreichbar; 100 Erfolge und 24 Ränge bleiben erhalten. Reine Menschenrunden
geben 10 EP. Sobald mindestens ein Computer mitspielt, gibt jede abgeschlossene
Runde 2 EP (75 % weniger, pro Runde abgerundet), auch an gemischten Tischen und im Turnier.
Einmalige Erfolgsbelohnungen bleiben immer vollständig. Regeln und Konto
erklären die Gewichtung; bestehende Computer-Runden werden neu gewichtet.
Mission Control ergänzt für den Owner echte Hausdepp-Runden, Tische, Teilnehmer,
Turniere und neue Abbrüche. Andere Dashboard-Berechtigte erhalten diese Daten
auch unter „Alle“ nicht. Fehlende historische Messwerte bleiben unbekannt.
Die Spielregeln, Turniergrenzen, Punkte und Darstellung sind durch weitere
gezielte lokale Tests abgesichert. Die gestalterische Abnahme bleibt offen.

**English:** Hausdepp gains a distinct forest-green, card-paper and card-red
identity with strong serif headings, button-shaped navigation, opponents around
the table, account avatars and visible reactions from every sender. Computers
receive unique random names from a pool of 50. Twelve varying props fill free
table space, more subtly on phones, with minimal steam, foam and candle motion
and reduced-motion support. A compact lobby preview hand sits beside the title
and changes cards calmly; the mobile table-creation form uses less space.
The preview refills only below three cards and plays matching cards together.
A brief one-time card-back shuffle precedes cutting without blocking actions;
reload, reconnect and reduced motion do not replay it. Navigation follows the
shared suite order. Tables automatically receive one of
50 pub-style names personalised with the account name; no name field is needed.

A stylised heart-ten icon, bilingual installation manifests and a narrowly scoped worker prepare
Hausdepp installation. Suite switching retains the installed app identity;
private content is never cached offline. Update notices sit at the top right.
All game pickers show current connected human players at running tables,
excluding computers and spectators, with account deduplication and fresh access
checks. Sharing, copying and player calls follow the suite flows with a
separate push opt-in, sender selection and cooldowns. A fresh Hausdepp PWA can
register its push device in shared settings; invitations stay limited to
accounts already permitted to access the game.

Earned achievements lead each group. Common goals now require several distinct
completed rounds; rare feats remain immediately attainable. The 100 achievements,
24 ranks and full achievement rewards remain. Human-only rounds grant 10 XP.
Every completed round with any computer grants 2 XP (75% less, rounded down per round),
including mixed tables and tournament rounds. Existing computer rounds are
reweighted; rules and account explain the distinction. Owner-only Mission Control
adds real Hausdepp round, seat, tournament and new-abort metrics. Delegates cannot
see them even under All; missing historical measurements remain unknown.
Additional local rule, tournament, accounting and responsive tests cover the
increment. Visual owner acceptance remains pending.

## 2.58.0 — Vom Genie zum Hausdepp / from genius to Hausdepp — 2026-10-16

**Deutsch:** Das private Hausdepp-Konto enthält 100 Erfolge und
24 Rangstufen von Einstein bis Hausdepp. Abgeschlossene Runden geben 10 EP;
einmalige Erfolge weitere 10, 25, 50 oder 100 EP. Runden- und Erfolgs-EP,
Fortschritt, die ganze Rangleiter, Bedingungen und die durchsuchbare, filterbare
Sammlung sind direkt sichtbar. Jeder Rang hat einen eigenen zweisprachigen
Aufstiegsspruch; Newton fällt nach den Naturgesetzen bergab. Übersprungene
Stufen werden zusammengefasst und Bestätigungen kontoweit gespeichert.
Serverseitige Belege erfassen Zocken, Nachwerfen, Abräumen und Endspiel, ohne
fremde Hände oder private Abhebeinformationen preiszugeben. Vergabe und
Rundenpunkte sind wiederholungsfest. Alte Ergebnisse können nur nachweisbare
Teilnahme-, Gesellschafts- und Ergebniserfolge liefern. Der Rundenausgang
bleibt vom dauerhaften Rang getrennt. Die private Siegrangliste zählt alle
fertigen Teilnehmer einer Runde, zeigt geteilte Plätze und filtert Tischgrössen.
HAUSDEPP-Turniere behalten Tisch und Plätze über mehrere Runden: Jede Niederlage
ergänzt einen Buchstaben; die erste achte Niederlage beendet das Turnier als
Tages-Hausdepp. Geberrotation, Wiederaufnahme und eindeutige Rundenergebnisse
sind abgesichert. Die 36 zusätzlichen Erfolge betonen Comebacks und Turniere;
zusammen bleiben 3’425 einmalige Erfolgs-EP und 5’000 EP für den Schlussrang.
Öffentliche Würfelseiten erhalten überprüfte strukturierte Metadaten und
kanonische HTTP-Verweise; Robots-Regeln und Indexschutz halten Hausdepp privat.
Lokaler Dev-Branch; UI-/UX-Abnahme und
öffentlicher Rollout stehen aus.

**English:** The private Hausdepp account includes 100 achievements
and 24 ranks from Einstein to Hausdepp. Completed rounds earn 10 XP; one-time
achievements add 10, 25, 50 or 100 XP. The account shows separate XP totals,
rank progress, the complete ladder, conditions and a searchable, filterable
collection. Each rank has individual bilingual flavour copy, including Newton's
downhill natural-laws greeting. Skipped ranks are consolidated and receipts
persist account-wide. Server evidence captures gambling, additional throws,
clears and endgame feats without exposing opposing hands or private inspections.
Round credit and unlocks are idempotent. Old outcomes prove only participation,
social and outcome achievements. Round outcomes stay separate from lasting rank.
Private win standings count every finisher, share tied places and filter table
sizes. HAUSDEPP tournaments keep the same table and seats across rounds: each
loss adds a letter; the first eighth loss immediately ends the tournament with
the day's Hausdepp. Dealer rotation, reconnects and distinct round credits are
protected. The added 36 feats focus on comebacks and tournaments, totalling
3,425 one-time achievement XP with the final rank still at 5,000 XP. Public
dice pages gain validated structured data and canonical HTTP links; crawler
rules and indexing controls keep Hausdepp private.
Local development only; owner UI/UX acceptance and public rollout remain pending.

## 2.57.0 — Eine gemeinsame Spielauswahl / one shared game picker — 2026-10-16

**Deutsch:** Der gemeinsame Einstieg zeigt das aktuelle Spiel mit einem eigenen
Symbol und Namen. Er öffnet eine Auswahl aller freigeschalteten Spiele mit
aktiver Markierung statt direkt ins andere Spiel zu wechseln. Auf dem Handy
erscheint ein erreichbares Auswahlfenster, am Desktop ein Menü beim Einstieg.
Escape, Tastaturnavigation und Alt+Shift+Z werden unterstützt. Der private
Hausdepp-Zugang bleibt serverseitig beschränkt. Installierte Zilch-Apps
behalten auch bei Hausdepp ihren eigenen Service Worker und ihr Manifest; die
ZDWA-Brücke überschreibt keine Spielziele mehr. Bestehende Verlassen-Abläufe
an Würfeltischen bleiben erhalten. Lokaler Dev-Branch, keine UI-/UX-Abnahme
oder Veröffentlichung.

**English:** The shared trigger shows the current game's own icon and name.
It opens all available games with an active marker instead of immediately
switching to the other game. Phones use a reachable bottom sheet; desktop uses
a panel beside the trigger. Escape, keyboard navigation and Alt+Shift+Z are
supported. Private Hausdepp access remains server-restricted. Installed Zilch
apps retain their service worker and manifest when visiting Hausdepp, and the
ZDWA bridge no longer overwrites game destinations. Existing dice-table leave
flows remain in place. Local development branch; no owner UI/UX acceptance or
public release.

## 2.56.0 — Hausdepp rund um den Tisch / beyond the table — 2026-10-16

**Deutsch:** Hausdepp bekommt ein eigenes privates Konto mit echten
Allzeitstatistiken, persönlichen Rundenergebnissen und nachladbarer Historie.
Gemeinsame Profil- und Anmeldeeinstellungen bleiben direkt erreichbar. Die
Lobby zeigt Tischstatus, beteiligte Menschen und Computer, freie Plätze und
die passende Aktion zum Beitreten, Weiterspielen oder Zuschauen. Wartende
Tische zeigen ihre tatsächlichen Plätze. Die Spielanleitung erläutert den
vollständigen Ablauf mit Schnellstart, verlinkten Abschnitten und Beispielen
zu Pflichtziehen und Nachwerfen. Punkte und die ironische Erfolgsleiter sind
als künftige Erweiterung vorgesehen; es werden keine unbestätigten Werte oder
Auszeichnungen vergeben. Weiterhin privater Entwicklungsstand in Version 2.x;
UI/UX ist noch nicht vom Owner abgenommen. Kein Deployment.

**English:** Hausdepp has a dedicated private account with real all-time facts,
personal round outcomes and paginated history. Shared profile and sign-in
settings remain directly reachable. The lobby shows table state, human and
computer seats, vacancies and the correct join, resume or watch action. Waiting
tables display their actual seats. The complete rulebook adds a quick start,
linked sections and examples of mandatory refills and additional throws.
Points and the ironic achievement ladder remain planned extensions; no
unconfirmed scores or awards are granted. This remains a private version 2.x
development build; owner UI/UX acceptance is still pending. No deployment.

## 2.55.0 — Hausdepp mit sichtbaren Kartenwegen / visible card transfers — 2026-10-16

**Deutsch:** Gegnerische Hände zeigen für jede Karte eine verdeckte Rückseite
und weiterhin die genaue Anzahl. Alle 36 Karten erhalten einzeln vermessene,
ausgerichtete Ausschnitte mit sauberen runden Papierkanten und einheitlicher
Papierfarbe. Die Laub-Zehn ersetzt den Blendfleck durch ein höher aufgelöstes,
lizenziertes Foto desselben Motivs; Originalpixel bleiben unverändert. Karten bewegen sich beim Geben, Ziehen und Aufnehmen klar
von der Quelle zur Hand. Bei misslungenem Zocken fliegt die neue Karte zuerst
zur Mitte und anschliessend das ganze Paket zur Hand. Legen und Abräumen zeigen
passende Kartenwege. Animationen blockieren keine Spielaktion, verraten keine
fremden Karten und spielen alte Züge nach Wiederaufnahme nicht nochmals ab.
Reduzierte Bewegung bestätigt den Empfang direkt am Ziel. Private lokale
Entwicklungsfassung, kein Deployment.

**English:** Opponents show one face-down back for each hand card, alongside
the exact count. All 36 cards use individually measured, aligned crops with
clean rounded paper edges and consistent paper colour. The ten of leaves
replaces glare with a higher-resolution licensed photo of the same motif;
source pixels remain unchanged. Dealing,
drawing and picking up clearly move cards from source to hand. A failed gamble
first sends the new card to the middle, then the whole pile into the hand.
Playing and clearing use the corresponding card paths. Animations never block
play, reveal opposing hands or replay old actions on reconnect. Reduced motion
confirms receipt at the destination. Private local development build, no deploy.

## 2.54.0 — Hausdepp direkt am Tisch / direct table actions — 2026-10-16

**Deutsch:** Der bestimmte Spieler hebt selbst aktiv ab; nach jedem Ass schaut
er per weiterem Tipp weiter. Eine kurze Kartenanimation zeigt das Austeilen.
Handkarten liegen als aufsteigend sortierter Fächer, Zehner ganz rechts; ein
Tipp legt die Karte sofort, ohne zusätzliche Rangaufdrucke oder Bestätigung.
Der nächste Spieler darf bereits legen, während vorherige Spieler noch
auffüllen müssen. Nur der verdeckte Stapel folgt der Reihenfolge offener
Auffüllpflichten: spätere Spieler können bis dahin weder ziehen noch zocken.
„Du musst ziehen“ mit sanft rotem Rahmen erinnert den zuständigen Spieler;
reduzierte Bewegung zeigt einen statischen Rahmen. Verspätetes Nachziehen
verändert kein Zugrecht und öffnet kein abgelaufenes Nachwurffenster.
Private Entwicklungsfassung, ausschliesslich lokal geprüft; kein Deployment.

**English:** The designated player actively inspects the bottom card, tapping
again after each ace. A short card animation shows the deal. Hand cards form
an ascending fan with tens on the right; tapping plays immediately, without
added rank labels or confirmation. The next player may already play while
previous players still need to refill. Only the face-down stock follows pending
refill order: later players can neither draw nor gamble until earlier refills
are complete. “You must draw” in a gently pulsing red frame reminds the player
responsible; reduced motion keeps the frame static. Late draws change neither
turn rights nor an already closed additional-card window. Private development
build, verified locally only; no deployment.

## 2.53.0 — Hausdepp, private Entwicklungsfassung / private development build — 2026-10-16

**Deutsch:** Hausdepp erhält eine eigene Lobby, einen Stammtisch mit
36 doppeldeutschen Karten und selbstständig spielende Computer-Mitspieler für
2–6 Teilnehmer. Das dauerhaft gebundene Founder-Konto erreicht den privaten
Bereich über die Spielauswahl; Seiten, APIs, WebSockets und Ergebnisse prüfen
diese Freigabe serverseitig. Handkarten und erfolgloses Abheben sind pro Spieler
privat. Die vollständigen Hausregeln umfassen Zehner, vier Gleiche, Nachwerfen,
verpflichtendes Auffüllen per Stapeltipp und das Endspiel. Tischgespräch,
Reaktionen und Wiederaufnahme nutzen die Suite. Die Oberfläche unterstützt
Deutsch/Englisch und beide Ausrichtungen auf Mobilgerät, Tablet und Desktop.
Punkte und Achievements werden vorbereitet; Bedingungen und Titel sind noch
nicht umgesetzt. Die ironische Rangrichtung endet später beim Titel Hausdepp.
Nur Entwicklungsbranch, kein behauptetes Deployment; V3 folgt zum grossen Release.

**English:** Hausdepp adds its own lobby, a shared table with 36 double-headed
German cards and autonomous computer players for 2–6 participants. Only the
permanently bound founder account can open the private game through the switcher;
pages, APIs, WebSockets and outcomes enforce access on the server. Hand cards
and unsuccessful bottom peeks remain private per player. Complete house rules
cover tens, four of a kind, additional throws, mandatory tap-to-refill and the
endgame. Table talk, reactions and reconnection reuse the suite. The interface
supports German/English and both orientations on phones, tablets and desktops.
Points and achievements are planned; award conditions and titles are not yet
implemented. The ironic rank progression will eventually end at Hausdepp.
Development branch only, no claimed deployment; V3 is reserved for the major launch.

## 2.52.0 — NEXUS für Mission Control / NEXUS for Mission Control — 2026-10-15

**Deutsch:** Berechtigte Dashboard-Nutzer können im Designwechsel zusätzlich
**NEXUS** wählen: eine dunkle Kommandozentrale mit prominenten Kennzahlen,
verständlichem Messkontext und für Handy, Tablet und Desktop angepassten
Anordnungen. **Mission Control** bleibt der Standard; das bisherige Design
und **LCARS** sind jederzeit auswählbar. Die Dashboard-Wahl wird unabhängig
vom Spieldesign in diesem Browser gespeichert.
Ein Stern verschiebt Kennzahlen und Analysebereiche in den reservierten
Favoritenbereich oben. Beim Entfernen kehren sie an ihren ursprünglichen
Platz zurück. Die tatsächlichen Bereiche behalten ihre Aktualisierung,
Filter und Diagramminteraktion. Gespeichert werden nur stabile
Favoritenkennungen je Dashboard-Nutzer in diesem Browser, keine Messwerte.
Zugriffsrechte, Messdefinitionen und Spielregeln bleiben erhalten.

**English:** Authorized dashboard viewers can now also select **NEXUS** in
the design switcher: a dark command console with prominent KPIs, clear
measurement context and layouts tailored to phones, tablets and desktops.
**Mission Control** remains the default; the original design and **LCARS**
can be selected at any time. The dashboard choice is saved in this browser,
independently of game appearance.
A star moves metrics and analysis panels into the reserved Favorites area at
the top. Removing it returns them to their original position. The actual
panels retain their refreshes, filters and chart interaction. Only stable
favorite identifiers are saved for each dashboard viewer in this browser,
without metric values. Access rights, measurement definitions and game rules
are preserved.

## 2.51.0 — Neues ZDWA-Design für alle / New ZDWA design for everyone — 2026-10-14

**Deutsch:** Das neue Design ist jetzt für alle ZDWA-Seiten der Standard:
Lobby, Spieltisch, Spieler und Ranking, Regeln, Konto und die übrigen Seiten.
Nach dem ersten Wurf zeigt der eigene Spielzettel die möglichen Punkte jedes
erlaubten Feldes; das beste Feld ist hervorgehoben. Hell, Dunkel und Classic gibt
es in beiden Designs. Wer das bisherige Design bevorzugt, wechselt im Konto
unter Einstellungen → Sprache & Spiel → Aussehen zurück; Konten, die das alte
Design kannten, werden nach dem Update einmal gefragt. Gäste finden den
Schalter unten in der Lobby. Auch das Offline-Spiel zeigt das gewählte Design.
Neu erfasst das anonyme Dashboard die sichtbare Nutzungszeit in
Sekunden pro Design und Farbschema (ZDWA neu/bisher in Hell, Dunkel, Classic;
Zilch Wirtshaustisch oder LCARS) als Tagessummen ohne Personenbezug. Auf dem
Handy stehen „Neues Spiel“ und „Du spielst als“ wieder untereinander. Rückweg
ohne Deploy: `ROLLTHEDICE_ZDWA_DESIGN=off` und Neustart.

**English:** The new design is now the default on every ZDWA page: lobby, game
table, players and ranking, rules, account and the remaining pages. After the
first roll your own score sheet shows the points each allowed field would
score, with the best field highlighted. Light, Dark and Classic exist in both
designs. Players who prefer the previous design switch back under Account →
Settings → Language & play → Appearance; accounts that knew the old design are
asked once after the update. Guests find the switch at the bottom of the lobby.
Offline play shows the chosen design too. The anonymous
dashboard now records visible usage time in seconds per design and colour theme
(ZDWA new/previous in Light, Dark, Classic; Zilch tavern table or LCARS) as daily
totals without any personal reference. On phones, "New game" and "You are
playing as" are stacked again. Rollback without a deploy:
`ROLLTHEDICE_ZDWA_DESIGN=off` and a restart.

## 2.50.0 — ZDWA-Design 2026 als Owner-Vorschau / ZDWA design 2026 as owner preview — 2026-10-13

**Deutsch:** Ein neues Erscheinungsbild für ZDWA-Lobby und Spieltisch ist
eingebaut, aber vorerst nur für den Owner-Account sichtbar. Die Lobby stellt
das Eröffnen eines Tisches in den Vordergrund. Am Tisch liegt der Spielzettel
wie Papier mit handschriftlichen Einträgen, der Würfelbereich ist ein grüner
Filz, und nach dem ersten Wurf zeigt der eigene Zettel in jedem erlaubten Feld
die Punkte, die dort eingetragen würden; das beste Feld ist hervorgehoben.
Regeln, Wertung und Daten bleiben für alle gleich. Rückweg ohne Deploy:
`ROLLTHEDICE_ZDWA_DESIGN_PREVIEW=off` und Neustart; pro Browser mit
`?design=classic` ab- und mit `?design=2026` wieder einschalten. Stiller
Release ohne Versions-Push oder neues In-App-Popup.

**English:** A new look for the ZDWA lobby and game table is built in, but for
now only the owner account sees it. The lobby puts opening a table first. At
the table the score sheet looks like paper with handwritten entries, the dice
sit on green felt, and after the first roll your own sheet shows the points
each allowed field would score, with the best field highlighted. Rules,
scoring and data stay the same for everyone. Rollback without a deploy:
`ROLLTHEDICE_ZDWA_DESIGN_PREVIEW=off` and a restart; per browser turn it off
with `?design=classic` and back on with `?design=2026`. Silent release without
a version push or new in-app popup.

## 2.49.2 — Verlässlicher Spielzettel-Fokus / Reliable score sheet focus — 2026-10-11

**Deutsch:** ZDWA-Mehrspielerpartien folgen wieder verlässlich dem aktiven
Spielzettel. Ein durch Wischen oder Auswahl geöffneter anderer Zettel bleibt
für den laufenden Zug im Blick, auch bei eigenen und fremden Würfen, beim
Halten und bei Ansagen. Beim nächsten Spieler wird die automatische
Ansicht wiederhergestellt. Nach einem Eintrag bleibt die kurze Lesezeit vor
dem Wechsel erhalten. Stiller Release ohne Versions-Push oder neues
In-App-Popup.

**English:** ZDWA multiplayer games reliably follow the active score sheet
again. A different sheet opened by swiping or selecting it stays in view for
the current turn, including your own and other players' rolls, dice selections
and announcements. Automatic following resumes when the next player's turn
begins. The brief reading pause after a score is entered remains before the
view moves on. Silent release without a version push or new in-app popup.

## 2.49.1 — Cloudflare-Schutz und Besucher-IP / Cloudflare protection and visitor IP — 2026-10-11

**Deutsch:** Bekannte Scanpfade werden direkt bei Cloudflare blockiert. Der
Webzugang zum Server ist auf Cloudflare-Netze begrenzt. HTTP- und WebSocket-
Limits verwenden die verlässlich ermittelte Besucher-IP, während Länderangaben
weiter nur aus der geprüften Proxy-Kette übernommen werden. Profilseiten,
Anmeldung, Spielverbindungen und PWA-Updates bleiben erreichbar. Stiller
Release ohne Versions-Push oder neuen In-App-Hinweis.

**English:** Known scan paths are blocked at Cloudflare. The server's web
ingress is restricted to Cloudflare networks. HTTP and WebSocket limits use
the verified visitor IP, while country hints are accepted only through the
trusted proxy chain. Profiles, sign-in, game connections and PWA updates remain
accessible. Silent release without a version push or new in-app notice.

## 2.49.0 — PWA-Zähler in Mission Control / PWA counters in Mission Control — 2026-10-11

**Deutsch:** Mission Control zeigt im gewählten UTC-Zeitraum getrennte Zähler
für vom Browser bestätigte PWA-Installationen und erstmals erkannte Starts im
Appfenster. Safari und iOS liefern keine Installationsbestätigung; die
Startschätzung enthält auch bestehende Apps beim ersten Start seit Messbeginn
und zählt nach gelöschtem Speicher erneut. Die Werte werden nicht addiert.
Die Zuordnung folgt der installierten App auch beim Spielwechsel. Do Not Track,
Global Privacy Control und die begrenzte Telemetrie-Aufbewahrung gelten weiter.
Stiller Release ohne Versions-Push oder neuen In-App-Hinweis.

**English:** Mission Control shows separate counters for browser-confirmed PWA
installations and first detected app-window launches during the selected UTC
period. Safari and iOS do not confirm installations; the launch estimate also
includes existing apps on their first launch since measurement began and
counts again after storage is cleared. The values are not added together.
Attribution follows the installed app when switching games. Do Not Track,
Global Privacy Control and bounded telemetry retention remain in effect.
Silent release without a version push or new in-app notice.

## 2.48.2 — Verlässliche Prüfungen und stabile Ansichten / Reliable checks and stable screens — 2026-10-11

**Deutsch:** Der lokale Qualitätscheck umfasst jetzt dieselben Sicherheits- und
Abhängigkeitsprüfungen wie GitHub. Die vollständige Browsersuite läuft in vier
Hauptteilen sowie eigenen Jobs für Benutzername und Passkeys, damit sie innerhalb
des Zeitlimits abschließt. Die Runner installieren auch WebKit für die
bestehenden Safari-Prüfungen. Veraltete Admin-Erwartungen und voneinander abhängige
Anmeldetests sind korrigiert. Fehler beim anonymen Verkehrszähler werden
protokolliert, ohne erfolgreiche oder fehlerhafte Antworten zu verändern.
Gleichzeitige Kontozugriffe vergeben dieselbe Zilch-Auszeichnung nur einmal,
ohne eine bereits gespeicherte Aktion als fehlgeschlagen zu melden.
Auf kurzen Handybildschirmen bleibt die Classic-Schrift lesbar und der ganze
Spielzettel erreichbar. In der Zilch-Lobby verschiebt die nachgeladene
Kontoerstellung weder Spiele, Chat noch Ranglisten. Stiller Release ohne
Versions-Push oder neuen In-App-Hinweis.

**English:** The local quality check now includes the same security and
dependency checks as GitHub. The complete browser suite runs in four main
shards plus separate username and passkey jobs to finish within its time limit.
Runners also install WebKit for the existing Safari checks.
Outdated admin expectations and dependent sign-in fixtures have been corrected.
Anonymous traffic-counter failures are logged without changing successful or
error responses. Concurrent account requests unlock each Zilch award only once
without reporting an already recorded action as failed.
On short phone screens, Classic keeps readable lettering and
the whole score sheet within reach. Late account signup in the Zilch lobby no
longer moves games, chat or rankings. Silent release without a version push or
new in-app notice.

## 2.48.1 — Ruhigere Anzeige und mobile Dialoge / Calmer reveals and mobile dialogs — 2026-10-11

**Deutsch:** Automatisch gehaltene Würfel bei Zahlenansagen werden erst grün,
wenn die Wurfanimation die endgültigen Augen zeigt. Das gilt auch für Mitspieler
und Zuschauer; zuvor gehaltene Würfel bleiben ruhig und bedienbar. Mobile
Streich- und Ergebnisdialoge haben mehr Innenabstand unter den Buttons und
berücksichtigen die Geräte-Sicherheitszone. Am Spielende laufen Erfolgsprüfungen
ohne kurz aufblinkenden Prüfdialog. Freigeschaltete Erfolge, Rangaufstiege und
Ergebnisse erscheinen weiterhin im gewohnten Ablauf. Stiller Release ohne
Versions-Push oder neuen In-App-Hinweis.

**English:** Matching dice held automatically for number announcements turn
green only after the roll animation reveals their final faces. This also applies
to opponents and spectators; previously held dice stay still and editable.
Mobile strike and result dialogs have more padding below their buttons and
respect the device's safe area. Game completion checks achievements without a
briefly flashing progress dialog. Unlocked achievements, rank-ups and results
still follow their usual flow. Silent release without a version push or new
in-app notice.

## 2.48.0 — Einstellbarer ZDWA-Spielkomfort / Configurable ZDWA conveniences — 2026-10-10

**Deutsch:** Drei unabhängige Komforteinstellungen sind für neue und bestehende
Konten standardmässig aktiv. Ist nur ein Feld regelkonform auswählbar, entfällt
beim Streichen die Rückfrage; bei mehreren erlaubten Feldern und bei Korrekturen
bleibt sie erhalten. Zahlenansagen von 1 bis 6 halten passende Würfel sofort und
nach weiteren Würfen automatisch. Jeder Würfel bleibt abwählbar. Beim Aufheben
oder Ändern der Ansage werden automatische Haltepunkte gelöst, zuvor manuell
gehaltene Würfel bleiben gehalten. Ab dem zweiten Wurf wird der Ansage-Button
zu „Schreiben“ und trägt das angesagte Feld über den normalen Schreibablauf ein.
Weiterwürfeln bleibt möglich. Unter Konto → Einstellungen lässt sich jede
Funktion einzeln ausschalten. Gäste nutzen die aktiven Vorgaben; Offline-Spiele
bieten dieselben Schalter als lokale Browser-Einstellungen.

**English:** Three independent conveniences are enabled by default for new and
existing accounts. Strike confirmation is skipped when only one legal field is
available; it remains for multiple legal fields and corrections. Announcements
from 1 to 6 automatically hold matching dice immediately and after later rolls.
Every die remains deselectable. Cancelling or changing the announcement releases
automatic holds while keeping earlier manual holds. From the second roll, the
announcement button becomes “Write” and enters the announced field through the
normal write flow. You can still roll again. Each feature can be disabled under
Account → Settings. Guests use the enabled defaults; offline play provides the
same switches as local browser settings.

## 2.47.0 — Konto direkt mit Passkey / Direct passkey signup — 2026-10-05

**Deutsch:** Auf beiden Landingpages genügt ein Kontoname und die Bestätigung
eines neuen Passkeys. Das Konto entsteht erst nach erfolgreicher Bestätigung
und ist sofort angemeldet. E-Mail und Passwort sind für diesen Weg optional;
ein Backup-Passwort lässt sich später mit dem Passkey in den Einstellungen
festlegen. Die bisherige E-Mail-/Passwort-Registrierung bleibt als Alternative.
Konten ohne Passkey erhalten einen wegklickbaren Hinweis höchstens alle sieben
Tage, gemeinsam über beide Spiele und Geräte. Temporäre Passwortwechsel haben
Vorrang. Der letzte Passkey kann nur mit einem weiteren Passkey oder einem
Backup-Passwort entfernt werden.

**English:** Both landing pages let you create an account with an account name
and a new passkey. The account is created only after successful verification
and signs in immediately. Email and a password are optional for this flow;
you can later set a backup password in settings by confirming with your passkey.
Email/password registration remains an alternative. Accounts without passkeys
receive a dismissible reminder at most every seven days, shared across games
and devices. Required temporary-password changes take priority. Removing the
last passkey requires another passkey or a backup password.

## 2.46.0 — Mission Control: PWA, Browser & Sprachen / languages — 2026-10-05

**Deutsch:** Drei neue Analyse-Karten zeigen PWA-Starts gegenüber
Browser-Besuchen, Browserfamilien und die erste bevorzugte Browsersprache.
Gezählt werden anonyme Tab-Besuche, keine Personen oder Installationen.
Sprachen werden auf den Hauptsprachcode reduziert und unabhängig von der
im Spiel gewählten Sprache gemessen. Chrome und nicht unterscheidbare
Chromium-Browser teilen eine Gruppe; die Erkennung ist näherungsweise.
Ältere Besuche bleiben unbekannt. Beide Dashboard-Designs bieten die Karten
auf Handy, Tablet und Laptop. Zugriffsrechte bleiben unverändert; nur der
Gründer darf sie vergeben. Stiller Rollout ohne neue Push- oder Release-Einträge.
Eine separate Länder-Auswertung zählt anonyme HTTP-Requests und Statusklassen
der gesamten Anwendung, auch Bots, Dateien und API-Aufrufe. Healthchecks und
Dashboard-Statistikabrufe sind ausgeschlossen. Requests aus dem Cloudflare-Cache
oder dort blockierte Anfragen erreichen die App nicht und zählen daher nicht.
Clientkennungen zeigen gemeldete Bots wie Googlebot sowie typische API-Clients,
ohne Verifizierung zu behaupten. Ein gezielter Cloudflare-Burstschutz für
Anmelde- und E-Mail-APIs begrenzt mehr als 50 Anfragen je IP in 10 Sekunden
mit einer 10-Sekunden-Sperre; verifizierte Bots sind ausgenommen.

**English:** Three new analysis cards show PWA launches versus browser visits,
browser families and the first preferred browser language. Counts represent
anonymous tab visits, not people or installations. Languages retain only their
primary code, independently of the language selected in the game. Chrome and
indistinguishable Chromium browsers share a group; recognition is approximate.
Older visits remain unknown. Both dashboard themes offer the cards on phones,
tablets and laptops. Access rights are unchanged; only the founder can grant
them. Silent rollout with no new push or release entries.
A separate country breakdown counts anonymous HTTP requests and status classes
across the application, including bots, assets and APIs. Health checks and
dashboard statistics polling are excluded. Requests served from Cloudflare
cache or blocked there never reach the app and are outside this count.
Agent families show declared bots such as Googlebot and typical API clients
without claiming verification. A targeted Cloudflare authentication/email API
burst rule blocks over 50 requests per IP in 10 seconds for 10 seconds,
excluding verified bots.

## 2.45.0 — Mission Control: LCARS & Geräte / devices — 2026-10-05

**Deutsch:** Berechtigte Konten können Mission Control im bisherigen Design
oder als LCARS-Konsole verwenden. Der Designwechsel wird lokal für das
Dashboard gespeichert. Globus, Weltkarte, Diagramme und Analysen bleiben in
beiden Ansichten nutzbar; Daten und Zugriffsrechte folgen denselben Regeln.
Die Darstellung der Spiele wird dadurch nicht verändert. Stiller Rollout
ohne neue Push- oder Release-Einträge.
Geräteanalyse ergänzt feste Betriebssystem- und Geräteklassen wie iPad,
iPhone, Android-Tablet, Fire-Tablet, Mac und Windows-PC. Die Erkennung ist
näherungsweise; ältere und nicht erkannte Besuche bleiben unbekannt. Die
Analytics-Nutzdaten enthalten keine Browser-Rohdaten, Versionsnummern,
genauen Modelle oder Gerätekennungen.

**English:** Authorized accounts can use Mission Control in its existing
design or as an LCARS console. The theme choice is saved locally for the
dashboard. Globe, world map, charts and analysis remain available in both
views, with the same data and access rules. Game appearance preferences are
unaffected. Silent rollout with no new push or release entries.
Device analysis adds fixed operating-system and device categories such as
iPad, iPhone, Android tablet, Fire tablet, Mac and Windows PC. Recognition is
approximate; older and unrecognized visits remain unknown. Analytics payloads
contain no raw browser data, version numbers, exact models or device identifiers.

## 2.44.0 — Mission Control Deep Dive — 2026-10-05

**Deutsch:** Die private Analyse-Konsole erhält einen animierten Globus und
eine Weltkarte mit Länder-Details. Interaktive Verlaufsgrafiken, ein
UTC-Aktivitätsraster, grafische Seitenanalyse und beobachtete Seitenwege
machen Besuchsmuster sichtbar. Animation lässt sich pausieren und respektiert
reduzierte Bewegung. Herkunft bleibt auf Länderebene; Rechte vergibt weiterhin
allein der Gründer. Stiller Rollout ohne neue Push- oder Release-Einträge.

**English:** The private analysis console adds an animated globe and world map
with country details. Interactive time-series charts, a UTC activity heatmap,
visual page engagement and observed page journeys reveal visit patterns.
Animation can be paused and respects reduced motion. Origin remains country
level; only the founder can grant access. Silent rollout with no new push or
release entries.

## 2.43.0 — Mission Control — 2026-10-04

**Deutsch:** Ein privates Dashboard verbindet Besucher- und Klick-Trends,
aktive Seitenzeit, Herkunft, Geräte, Spielmodi und abgeschlossene Partien mit
CPU, RAM, Speicherplatz und Uptime. Zeitraum und Spiel lassen sich filtern.
Nur der Gründer vergibt oder entzieht einzelnen Konten den Dashboard-Zugang
in der Nutzerverwaltung; Rollen allein berechtigen nicht dazu. Anonyme
Besuchermessung startet mit diesem Release, respektiert DNT/GPC und speichert
keine Namen, Chat-Inhalte oder IP-Adressen. Offline-Partien bleiben lokal.
Stiller Rollout ohne Push- oder In-App-Versionsmeldung.

**English:** A private dashboard combines visitor and click trends, active page
time, sources, devices, game modes and completed games with CPU, memory, disk
capacity and uptime. Filter by time range and game. Only the founder can grant
or revoke individual dashboard access in user administration; roles alone do
not grant it. Anonymous visitor measurement starts with this release, respects
DNT/GPC and stores no names, chat content or IP addresses. Offline games remain
local. Silent rollout with no push or in-app release announcement.

## 2.42.6 — Abbrüche erst nach dem Anschreiben / Count abandonments after the first score entry — 2026-09-28

**Deutsch:** In beiden Spielen zählt ein selbst ausgelöster Abbruch erst,
wenn mindestens ein Teilnehmer einen Wert geschrieben hat. In ZDWA genügt
ein ausgefülltes Feld; in Zilch zählt ein abgeschlossener Zug im Punktebuch.
Auch ein Eintrag mit 0 oder ein Zilch ohne Punkte zählt. Bloßes Würfeln oder
Halten ohne Eintrag reicht nicht. Alle bisherigen Abbruchzähler beider Spiele
werden auf null zurückgesetzt. Spielstände, abgeschlossene Ergebnisse und
private Solo-Historie bleiben erhalten. Stiller Rollout ohne Push- oder
In-App-Versionsmeldung.

**English:** In both games, an abandonment initiated by a player counts only
after at least one participant has written a score. A filled field qualifies
in ZDWA; in Zilch, a completed turn in the scorebook qualifies. A written zero
or a zero-point Zilch also counts. Rolling or holding dice without a score
entry is not enough. All existing abandonment counters for both games are
reset to zero. Scores, completed results and private Solo history are kept.
Silent rollout with no push or in-app release announcement.

## 2.42.5 — LCARS: Buttons sofort sichtbar / LCARS: Buttons visible from the start — 2026-09-28

**Deutsch:** Auf Handys bleiben die Buttons zum Würfeln und Sichern im
LCARS-Design bereits beim Spielstart sichtbar, auch mit eingeblendeten
Browserleisten. Eine zu große Mindesthöhe konnte sie zuvor unter den
sichtbaren Bildschirmrand schieben. Der erste Wurf lässt sich wieder direkt
über den Würfeln-Button starten. Stiller Rollout ohne Push- oder
In-App-Versionsmeldung.

**English:** On phones, the Roll and Bank buttons in LCARS are visible from
game start, including with the browser bars open. An oversized minimum
height could previously push them below the visible screen edge. The first
roll can once again start directly with the Roll button. Silent rollout
with no push or in-app release announcement.

## 2.42.4 — LCARS: Würfel zum Start antippen / LCARS: Tap dice to start — 2026-09-28

**Deutsch:** Im Bereit-Zustand sind alle sechs LCARS-Würfel echte
Roll-Buttons: Tippe einen davon an, um sofort zu würfeln. Nach dem Wurf bleiben
nur gültige Punktewürfel auswählbar. Die Konsole verwendet ein sanftes,
weiterhin klar schwarzes Anthrazit statt absolutem Schwarz. Spielregeln,
Wertung und Bedienablauf bleiben unverändert. Stiller Rollout ohne Push- oder
In-App-Versionsmeldung.

**English:** When ready to roll, all six LCARS dice are real roll controls:
tap one to roll immediately. After the roll, only valid scoring dice remain
selectable. The console now uses a softer near-black graphite instead of
absolute black. Rules, scoring, and gameplay flow are unchanged. Silent
rollout with no push or in-app release announcement.

## 2.42.3 — LCARS: Würfel klar im Blick / LCARS: Dice clearly in view — 2026-09-28

**Deutsch:** Die Würfel bleiben im mobilen LCARS-Dock sichtbar, auch vor dem
ersten Wurf. Die Konsole verwendet ruhigere, weniger gesättigte Farben; Text,
Auswahl, Aktionen und Tastaturfokus behalten ausreichend Kontrast. Spielregeln,
Wertung und Bedienablauf bleiben unverändert. Stiller Rollout ohne Push- oder
In-App-Versionsmeldung.

**English:** Dice remain visible in the mobile LCARS dock, including before the
first roll. The console now uses calmer, lower-saturation colors while text,
selections, actions, and keyboard focus retain sufficient contrast. Rules,
scoring, and gameplay flow are unchanged. Silent rollout with no push or
in-app release announcement.

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
