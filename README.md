# RollTheDice

Three games. One account. A table for your next game night. / Drei Spiele, ein Konto, dein nächster Spieleabend.

- [Play ZDWA — Zock die Wand an](https://zockdiewandan.online/)
- [Play Zilch — Zilch die Wand an](https://zilch.zockdiewandan.online/)
- [Play Hausdepp](https://hausdepp.zockdiewandan.online/hausdepp)

RollTheDice is a self-hostable, real-time game platform with German and English
interfaces. Play in your browser or install a game as a Progressive Web App.
Guests can play ZDWA and Zilch. Hausdepp has a public lobby and rules; playing
requires an active account. One account provides history, statistics, achievements
and community features across the suite.

## Navigation und Konto / navigation and account

**Deutsch:** Weiterführende Aktionen und Regelübersichten verwenden das
Button-Design des jeweiligen Spiels. «Konto» öffnet in Hausdepp direkt die
Kontoeinstellungen; Spielverlauf und Fortschritt bleiben separat erreichbar.
Die Kategorien der Kontoeinstellungen starten geschlossen und lassen sich einzeln
öffnen. Eine erforderliche Passwortänderung öffnet den passenden Bereich direkt.
Die Watten-Lobby erklärt Besetzung, Varianten und Spielziel auch nach der
Anmeldung; Gäste erhalten diese Inhalte bereits ohne JavaScript auf Deutsch
oder Englisch.

**English:** Navigation actions and rule contents use each game's button style.
In Hausdepp, “Account” opens account settings directly; match history and progress
remain separately accessible. Account settings categories start collapsed and
open individually. A required password change opens the relevant section directly.
The Watten lobby explains players, variants and the aim of the game after sign-in
as well; guests receive the same guide in German or English without JavaScript.

## Hinweise vor dem Rollout / advance rollout notices

**Deutsch:** Eine Meldung oben in der geöffneten App kündigt einen bevorstehenden
Rollout und kurzen Serverneustart an. «OK» quittiert genau diese Ankündigung.
Gespeicherte Partien können danach fortgesetzt werden. Das neue Image wird
zuerst gebaut; vor dem ersten Stopp wartet der Deploy nach der Ankündigung
30 Sekunden. Die Anzeige benötigt diese App-Version; bereits geöffnete ältere
Versionen erhalten sie erst nach dem nächsten Laden. Stille Releases
unterdrücken den Vorabhinweis nicht. Rein lokale Offline-Übungen führen keine
Rollout-Abfragen aus.

**English:** A notice at the top of the open app announces an upcoming rollout
and brief server restart. “OK” acknowledges that announcement. Saved games can
continue afterwards. Deployment builds the new image first and waits 30 seconds
after announcing before the first stop. The display requires this app version;
already open older versions receive it after their next load. Silent releases
still show the advance notice. Fully local offline practice makes no rollout
requests.

## Einsteigertouren / beginner tours

**Deutsch:** Alle vier Spiele bieten beim ersten eigenen Spiel eine kurze,
freiwillige Einführung. ZDWA und Zilch zeigen die Bedienung Schritt für Schritt
am Tisch. In Hausdepp und Watten liest du die Hinweise unabhängig vom nächsten
Spielzug und quittierst sie einmalig mit **Verstanden**. **Später**, × oder
Escape schliessen sie für diesen Besuch; ohne Quittierung bleibt sie beim
nächsten Einstieg verfügbar. Die Partie läuft weiter, die Einführung führt
keine Spielaktion aus.
Die kurzen Schlag-/Farbe-Sprechblasen verschwinden mit der ersten gelegten
Karte und lassen den Stich frei; das automatische «Danke» bleibt davon getrennt.

Hausdepp erklärt besonders die versteckten Gesten: Eine spielbare Handkarte
lange berühren wählt alle spielbaren Karten desselben Werts zur gemeinsamen
Auswahl. Den offenen Stapel lange berühren zeigt alle Karten, die aktuell darin
liegen. Watten erklärt Hand, Schlag/Farbe, Bieten und die privaten Partnersignale
im blinden Vierer. Unter **Konto → Einstellungen → Hilfe & Neuigkeiten →
Einsteigertouren** kannst du Einführungen erneut starten, mit Beispielen ansehen
oder automatische Angebote ausschalten. Gäste erreichen dieselbe Auswahl in
den **Einstellungen** der ZDWA- oder Zilch-Lobby. Konten speichern ihre Auswahl
je Spiel auf allen Geräten, Gäste in ihrem Browser. Die
[Produktspezifikation](docs/GAME_GUIDES_PLAN.md) beschreibt Ablauf und Abnahme.

**English:** All four games offer a short, optional introduction on your first
game as a player. ZDWA and Zilch explain controls step by step at the table.
In Hausdepp and Watten, read the hints independently of the next move and
acknowledge them once with **Understood**. **Later**, × or Escape close them
for this visit; without acknowledgement, they remain available next time.
The game continues and the introduction performs no game actions.
Brief strike/suit speech bubbles clear when the first card is played, leaving
the trick unobstructed. The automatic “Thanks” keeps its separate display.

Hausdepp highlights the hidden gestures: hold a playable hand card to select
all playable cards of the same rank for a group play. Hold the open pile to
inspect every card currently in it. Watten explains your hand, strike/suit,
bidding and private partner signals in blind four-player play. Under
**Account → Settings → Help & updates → Beginner tours**, restart introductions,
view examples or switch automatic offers off. Guests find the same controls in
**Settings** in the ZDWA or Zilch lobby. Account choices are saved per game across
devices; guest choices stay in that browser. The
[product specification](docs/GAME_GUIDES_PLAN.md) defines the flow and acceptance
criteria.


## Als Nächstes: Watten / Next game: Watten

Öffentliche Gastgeber können im normalen Warteraum bewusst «Mitspieler benachrichtigen» wählen. Nur angemeldete Empfänger mit passender Einwilligung werden berücksichtigt; feste Revanchen bleiben davon ausgenommen. / Public hosts can explicitly notify players from a normal waiting room. Only eligible opted-in accounts are considered; fixed-roster rematches are excluded.

**Öffentliche Beta / public beta:** `ROLLTHEDICE_WATTEN_PUBLIC_BETA=1` öffnet Watten
für alle Konten unter `https://watten.zockdiewandan.online/watten`. Lobby und
Regeln sind ohne Anmeldung lesbar, zum Spielen ist ein Konto nötig. Der
Schalter hat Vorrang vor der älteren Founder-Vorschau und ist standardmässig aus.
Die öffentliche Beta ermöglicht native Kontoseiten und Kontomails, Installation
sowie freiwillige Push-Mitteilungen mit den bestehenden Kontoeinstellungen.
`/watten` und `/watten/regeln` sind DE/EN-Suchseiten (`?lang=en`); Konto-, Tisch-
und Ergebnisansichten bleiben `noindex`. Ein Rückrollen des Schalters schliesst
den festen Watten-Host wieder und stoppt Watten-Push sowie CPU-Autoplay.

`ROLLTHEDICE_WATTEN_PUBLIC_BETA=1` opens Watten to every account on its dedicated
origin. Guests may read the lobby and rules; playing requires an account. This
explicit switch defaults to off and takes precedence over the older founder
preview. Native account pages and emails, installation and optional push use
the existing account system. Only the DE/EN lobby and rules are indexable;
personal pages and tables stay `noindex`. Turning the switch off restores the
reserved-host gate and stops Watten push delivery and CPU autoplay.

**Ältere private Webvorschau / older private web preview (ohne öffentliche Beta):** Ein eigener, standardmässig
ausgeschalteter Schalter `ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW` kann die Vorschau
unter `https://zockdiewandan.online/watten` ausschliesslich für das bereits
dauerhaft gebundene Founder-Konto öffnen. Die bestehende Suite-Anmeldung wird
verwendet; andere Konten, Admins und delegierte Owner erhalten keinen Zugriff.
Der feste Watten-Host, Installation, Watten-Kontomails und Push-Zustellung
bleiben geschlossen. [Betriebsvertrag](docs/DEPLOYMENT.md#private-watten-webvorschau--private-watten-web-preview).

The separate `ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW` switch defaults to off and
can open the apex web preview exclusively to the existing immutable founder
account. It uses the normal suite login; other accounts, administrators and
delegated owners receive no access. The fixed Watten host, installation,
Watten account emails and push delivery remain closed.

**Privates Monitoring / private monitoring:** Das bestehende Dashboard bietet
Watten nur an, wenn die aktuelle Analytics-Antwort es für das Konto freigibt.
Es unterscheidet abgeschlossene Partien, gespeicherte Plätze einschliesslich
Computern und verbundene Menschen. Unbekannte Besuchs-, Installations- und
Herkunftswerte bleiben unbekannt; sie werden nicht als Nullmessung ausgegeben.
Partiedauern nennen ihre belegte Stichprobe. HTTP-Anfragen und Serverlast
bleiben als Messungen der gesamten Website gekennzeichnet.

The existing dashboard offers Watten only when the current analytics response
authorizes it for the account. It distinguishes completed matches, recorded
seats including computers, and connected people. Unknown traffic, installation
and geography values stay unknown rather than becoming measured zeros. Match
duration states its evidenced sample. HTTP requests and server load remain
labelled as measurements for the entire website.

**Freunde und Spielerauswahl / friends and player selection:** Die native Lobby
zeigt bei eigener Zustimmung kurz den Spielstart ausgewählter Menschen.
Zuschauen braucht einen Klick; am laufenden Tisch erscheint nur Text ohne
Kartenhinweise. Die lokalen nativen Kontoeinstellungen speichern Zustimmung,
die gemeinsame Spielerauswahl und den Einladungs-Empfängerkreis. Beim Suchen
bleiben höchstens100 Treffer sichtbar; weitere Seiten ersetzen ältere Treffer.
Die Auswahl bleibt dabei erhalten. Diese Einstellungen aktivieren kein Push.

With consent, the native lobby briefly shows selected humans starting games.
Watching requires a click; an active table shows text without card information.
Local native account settings save consent, the shared player selection and the
invitation audience. Search keeps at most100 results visible, replacing older
pages while retaining the selection. These settings do not activate push.

**Lobby und Erstellung / lobby and creation:** Die kompakte Lobby öffnet die
Spieleinstellungen in einem Dialog wie Hausdepp. 50 eigene Rundennamen werden
mit dem Benutzernamen kombiniert. Freie Sitze lassen sich mit CPUs auffüllen;
ein optionales Passwort aktiviert den Schutz. Favoriten speichern Einstellungen,
keine Passwörter. Die Teambildung bleibt bewusst im Warteraum.
Im Warteraum entfällt der grosse Seitenkopf. Rückweg, Regeln, Sprache und
Sprachchat sind kompakt innerhalb der Wartefläche erreichbar; beim Wechsel
zurück zur Lobby kehrt deren normale Navigation wieder.
The compact lobby opens settings in a dialog like Hausdepp. Fifty original round
names combine with the username. CPU fill is optional; a nonempty password
protects the table. Favorites save settings, never passwords. Teams are chosen
in the waiting room.
The large page header is hidden in the waiting room. Back navigation, rules,
language and voice chat are compactly available inside it; returning to the
lobby restores its normal navigation.

Ein Kontowechsel lädt den Watten-Tisch frisch für das neue Konto, auch wenn
Karten noch geladen werden oder die Seite aus dem Browser-Zwischenspeicher kommt.
Switching accounts reloads the Watten table for the new account, including while
cards load or when the browser restores a cached page.

**Spieltisch / game table:** Mobile zuerst: die helle Tiroler Schnitzstube bleibt
mit grösseren Schnitzecken sichtbar. Vor dem Aufdecken erscheint kein leerer
Handkartenfächer. Bei der ladinischen Ansage werden die beiden zulässigen Karten
von den Ansagenden flach zur freien Tischmitte geschoben, bis sich ihre
kurzen Kopfkanten treffen. «Schlag» und «Farbe» bleiben jeweils direkt an der
Kante der zugehörigen Karte lesbar. Teamstand, Stichzahl und gemeinsames Ziel stehen oben.
«Mir» ist immer deine Seite, «Dir» die gegnerische; Zuschauer sehen
die neutralen Teamnamen. Karten- und Teamzeilen unter den Namen entfallen.
Auf dem Handy bleiben die Teamstände schmal; Sprachchat, Verlassen und Tischchat
stehen als geordnete Symbole daneben. Das Verlassen-Symbol öffnet weiterhin
die Bestätigung zum Pausieren der Partie.
Der dauernde Zug-Hinweis entfällt. Abgeschlossene Stiche bleiben
rund drei Sekunden sichtbar, mit Siegerrahmen und Spielernamen. Der letzte Stich
kann lokal erneut angesehen werden. Im Hochformat nutzt der geschlossene
Verlauf einen freien Platz auf dem Tisch; offene Rückschau und Gebotsentscheidung
bleiben bei den eigenen Karten. Gegnerische Karten und Stichpakete sind grösser. Die kompaktere
Rückschau lässt sich während der Partie dauerhaft einblenden. Nach Spielende
öffnet sie die bis zu fünf Stiche der letzten Gabe ohne zusätzlichen
Anheftschalter; Schlag, Farbe und der Rechte bleiben für alle aufgedeckt.
Gewonnene Stichpakete bleiben pro Spieler direkt neben seinem Namen sichtbar.
Das Kreuz schliesst die Rückschau und löst ihre Anheftung; ungepinnt schliesst
sie auch beim Antippen ausserhalb.
Ansager sind am Spielernamen mit «Schlag» oder «Farbe» markiert. «Danke!» erscheint
grösser und bleibt höchstens bis zum Abschluss des ersten Stichs sichtbar. Einsatz und Bieten stehen
im Hochformat bei den eigenen Karten, im mobilen Querformat in der linken
Leiste. Auf Desktop bleibt der eigene Fächer mittig;
im Tablet-Querformat sitzt der Aktionsbereich darüber. Stichgewinne sind für die
eigene Seite grün, für die andere rot markiert. Im blinden Vierer darf jeder
Spieler ein eigenes Drei und spätere eigene Erhöhungen ausschliesslich am eigenen
Kartenzug bieten; das gilt auch für den wissenden Spieler und seinen blinden Partner. Über
Halten, Gehen und Aufbieten als Antwort entscheidet weiterhin nur der Wissende,
auch ausserhalb seines eigenen Kartenzugs.
Bei einem gegnerischen Gebot kann nur der blinde Partner ihm
einmal privat sein Gefühl mitteilen; die Auswahl schliesst den Dialog. Der
wissende Entscheider sendet kein Gegensignal. In offenen Spielen bleibt die
gegenseitige Abfrage.
Die Meldung steht mit dem Namen des Partners direkt über Halten, Gehen und
Aufbieten, zum Beispiel «Markus meint: Keine Ahnung»; bis dahin steht dort
«Von Markus noch keine Auskunft». Beim ladinischen Einschauen genügt der einzelne
Button «Schlag zeigen» beziehungsweise «Farbe zeigen» am eigenen Kartenplatz. Im Hochformat bleiben Punkte,
Verlassen und Chat in einer Reihe. Im mobilen Querformat sitzen Kopfzeile und
Spielstand links; gegenüberliegende Spieler und der mittige Stichstapel bilden
einen symmetrischen Tisch. Grössere Hand- und Stichkarten nutzen im Querformat
die freie Fläche zwischen den Spielern. Alle Handfächer öffnen sich zur
Tischmitte; ihre gedachte Griffseite zeigt zum jeweiligen Bildschirmrand.
Die optionale Rechter-Anzeige erscheint erst nach
der Ansage beziehungsweise dem Einschauen, ohne zusätzliche verdeckte Karte
während der Vorbereitung. Ausgespielte Karten bilden ab der zweiten Karte einen zusammenhängenden,
überlappenden Stapel in Kleeblatt-Anordnung. Jede Karte liegt in Richtung
ihres Spielers, ohne sichtbare Nummern oder Namensschilder. Neue Karten liegen
über früheren und machen dadurch die Spielreihenfolge erkennbar. Die Gewinnerkarte erhält
einen klaren Rahmen und bleibt an ihrer Position und in derselben Überlappungsreihenfolge.
Nach vollständiger Ansage oder abgeschlossenem Einschauen darf am eigenen
Kartenzug schon vor der ersten Karte geboten werden. Ein nach Halten vereinbartes
Schöneres bleibt bis zur ersten Karte möglich und setzt den Einsatz auf zwei zurück.
Mobile first: the light Tyrolean carved table keeps its larger corners visible.
No empty hand appears before cards are revealed. Ladinisch cards slide flat from
their callers into the clear table centre until their short top edges meet.
Strike and Trump suit labels stay readable at the edge of their respective card. Scores,
trick counts and one shared target sit above the table. “Us” always means your side,
“Them” the other side; spectators see neutral team names. Card-count and team
labels below player names are removed.
The mobile scores stay narrow, with orderly voice-chat, leave and table-chat
icons beside them. The leave icon still asks for confirmation before pausing.
Completed tricks stay for
about three seconds with a winner outline and player names; the last trick can
be reviewed locally. In portrait, the closed review uses a clear space on the
table; open review and bid decisions remain beside your hand. Desktop
centre cards, opponent hands and captured piles are larger. The compact review
can stay pinned open during play. At match end, history opens with up to
five tricks from the final deal and no extra pin control; everyone can see the
strike, trump suit and Rechter. Every player keeps their won trick
packets beside their name. The close button also unpins the review; when
unpinned, tapping outside closes it. Announcers are labelled beside their
names; the larger “Thanks!” remains visible until the first trick is complete. The stake and
raising control sit beside your cards in portrait and in the left rail in mobile
landscape. Your desktop hand stays centred;
landscape tablets place the action area above it. Trick wins are green for your side
and red for the other side. In blind four-player play, every player may open
three or initiate a later raise only on their own card turn, including the
informed player and their blind partner. Only the informed player handles hold, fold and counterbid
responses, including outside their own card turn. When receiving an
opposing bid, only the blind partner may send them one private feeling signal;
answering closes the prompt. The informed decision maker sends no signal back.
Open games retain the mutual prompt.
Partner advice sits directly above hold, fold and counterbid with the partner’s
name, for example “Markus says: No idea”, or “No advice from Markus yet” before a signal arrives. Ladinisch inspection starts with a single “Show strike” or
“Show trump suit” button beside your own hand. Portrait scores, leave and chat share one row. In mobile landscape, navigation
and scores are pinned to the left; opposing players and the central trick pile
form a symmetrical table. Larger hand and trick cards use the free space between
the players in landscape. Every hand fan opens toward the table centre, with
its imaginary grip pointing toward that player's screen edge.
The optional Rechter reference appears after calling
or inspection, without an extra face-down placeholder during preparation. Played cards
form one connected, overlapping cloverleaf pile from the second card onward.
Each card points toward its player, without visible numbers or name labels.
New cards overlap earlier ones to preserve the play order.
The winning card is outlined in its original position and overlap order.
Once calling or inspection is complete, the player on their card turn may bid
before the first card. An agreed redeal after holding remains possible until
the first card and resets the stake to two.
Der Spielabschluss stellt Sieg oder Niederlage in den Mittelpunkt; die Nockerl
bleiben als kleine Kugelschreiberzeichen oben beim Teamstand sichtbar.
Ansage und Stichverlauf bleiben aufklappbar, Revanche und Lobby direkt erreichbar;
Kontofortschritt steht daneben zurückhaltend bereit.
The result puts victory or defeat first; subtle pen-style loss marks remain
beside the header score. The call and trick
history remain available to open, with rematch and lobby within reach and
account progress shown as a secondary link.

**Vor dem Ausspielen / before play:** «Schöneres erlauben» ist eine eigene,
standardmässig ausgeschaltete Tischoption für zwei oder vier Spieler. Bis zur
ersten ausgespielten Karte können die beiden Ansagenden zustimmen, auch nach dem
Einschauen: Ihre bisherigen Blätter werden mit dem Reststapel gemischt und beide
bekommen je fünf neue Karten; andere Blätter bleiben gleich. Das ist mit erneuter
beidseitiger Zustimmung wiederholbar. Bei normaler offener Ansage zu zweit oder
viert können beide vor der Ansage Schlag und Farbe tauschen; Vorhand bleibt.
Beim blinden Vierer sehen beide Nicht-Einschauer sofort **Blödeln?**, ohne
zuerst ein Menü zu öffnen. Fragt einer an, sieht der andere **XYZ will blödeln**
mit Ja/Nein. Bis zur Antwort darf keine Karte gespielt und kein Gebot eröffnet
werden; die Ansagenden können weiterhin zeigen und einschauen. Ohne Anfrage
beginnt das Ausspielen nach dem Einschauen normal. Ein Nein verhindert Blödeln
für dieses Blatt; ein zusätzlicher Hinweis «Kein Blödeln» entfällt. Bei Ja wird
bei beiden die ursprüngliche unterste Karte automatisch im ersten Stich
ausgespielt, sobald sie am Zug sind, auch wenn eine andere Farbe ausgespielt wurde.
Eine Kartenauswahl gibt es dabei nicht. Jede
Pflichtkarte wird für die anderen erst beim tatsächlichen Ausspielen sichtbar.
Sind beide Nicht-Einschauer CPUs, ist ungefähr in jedem dritten Blatt mindestens
eine anfragebereit; jede CPU entscheidet sich mit rund 18 % dafür und antwortet
weiterhin mit 50 % mit Ja. Die Anfrage muss vor dem ersten Ausspielen erfolgen;
die sichtbare Quote kann deshalb niedriger liegen. Diese Wahl bleibt pro Blatt
gleich und verwendet keine verdeckten Karten. Status und Anfrage nennen die tatsächlich Beteiligten;
Warten ersetzt keine menschliche Antwort.
“Allow a redeal” is a separate table option for two or four players, off by
default. Until the first card is played, both callers may agree, including after
inspection: their old hands are shuffled into the remaining stock, then each
gets five new cards. Other hands stay the same. They may repeat this by agreeing
again. In normal open two- or four-player games, the callers can agree to swap
strike and suit before the announcement; the opening player stays the same.
In blind four-player games, both non-lookers immediately see **Blödeln?**
without opening a menu. When one asks, the other sees **XYZ wants to play
Blödeln** with yes/no. Until they answer, no card may be played and no bid opened;
callers may still show and inspect. With no request, card play starts normally
after inspection. A no declines Blödeln for this hand without an extra status
message. A yes automatically plays each original bottom card on its owner's
first turn, even when a different suit is led; there is no card choice.
Others see each forced card only when it is actually played.
With two CPU non-lookers, at least one is willing to request Blödeln in roughly
one in three deals: each CPU chooses to ask about 18% of the time and still
answers yes with a 50% chance. The request must precede the first play, so the
visible rate can be lower. The choice stays stable for the deal and uses no hidden cards. Requests and
status messages name the actual participants; waiting never replaces a human answer.

Nach einer Gabe wird zuerst der letzte Stich abgeräumt. Schlag, Farbe und der
Rechte werden anschliessend etwa drei Sekunden für alle aufgedeckt; danach
startet die nächste Gabe automatisch. Eine Pause oder offene Retourschneider-
Entscheidung hält den Wechsel an. Auch das Endergebnis eines ganzen Spiels
erscheint erst nach dem Abräumen und der kurzen Rückschau.
After a deal, the final trick is collected first. Strike, suit and the Rechter
are then revealed to everyone for about three seconds before the next deal
starts automatically. A pause or pending Retourschneider decision stops that
transition. A completed match's result likewise waits for collection and review.

**Tischdeko / table decorations:** Getränke, Snacks und Dekowürfel liegen frei
auf dem Tisch. Antippen benutzt sie, Ziehen oder Pfeiltasten verschieben sie.
Desktop-Deko ist grösser. Deko-Ecke, Stern und Kontextmenüs entfallen vollständig;
die Gegenstände werden direkt bedient, Spielbereiche bleiben frei.
Acht seltene Überraschungen können gemeinsam auftreten. Auslösung und Miterleben
werden serverseitig einmal je Runde belegt und erst mit dem gültig abgeschlossenen
Spiel als Erfolge verbucht; mindestens zwei Menschen müssen verbunden mitspielen.
Drinks, snacks and decoration dice scatter over the table. Tap to use, drag or
use arrow keys to move. Desktop props are larger. The decoration corner, star
and item context menus are removed; props are controlled directly and play areas
stay clear. Eight rare surprises can occur together at the table.
Server evidence records activation and connected witnesses once per round;
achievements are granted only after a valid completed match with at least two
connected human players at the time of the event.

**CPU-Taktik / CPU tactics:** Computer bieten bei subjektiv guten Chancen und
berücksichtigen den Spielstand. Mit mehr abgeschlossenen Watten-Spielen der
menschlichen Mitspieler werden ihre Entscheidungen genauer; bei gemischter
Erfahrung zählt der unerfahrenste aktive Mensch. «Zweiter Stich ist Partnerstich»
bleibt im blinden Ladinisch eine abwägbare Hilfe. Im ersten blinden Stich bevorzugt sie neue sichtbare Werte und Farben. Die CPU kennt nur ihre eigene
erlaubte Sicht. Die [Strategiedokumentation](docs/WATTEN_CPU_STRATEGY.md) nennt
Stufen, Quellen und Grenzen; eine neue Stärkeprüfung steht noch aus.
CPUs bid on subjectively strong chances and account for the score. More completed
Watten games by the human participants sharpen their decisions; mixed tables use
the least experienced active human. Leaving the second trick to the partner
remains a soft tactic in blind Ladinisch. The blind opening prefers new visible ranks and suits. The CPU only knows its own permitted
view. The [strategy notes](docs/WATTEN_CPU_STRATEGY.md) document tiers, sources and
limits; the new strength has not been benchmarked.

**Wertung / scoring:** Eine Runde endet mit drei Stichen oder Gehen; das Spiel
endet am Ziel. Verlierer bekommen ein Nockerl, ohne Punkte zwei (Schneider).
Im Vierer kann das zurückliegende Team beim erstmals gestrichenen Gegner die
Anschrift löschen und einen Retourschneider versuchen: alle weiteren Runden
gewinnen bringt den bisherigen Führenden vier Nockerl; einmal verlieren beendet
das Spiel sofort mit zwei Nockerl für die Herausforderer. Beide Teammitglieder
müssen getrennt zustimmen; ein Nein behält die Anschrift. Nach dem eigenen Ja
zeigt der Tisch, auf wen noch gewartet wird. Erst nach beiden Ja kündigt ein
kurzer bildschirmfüllender Auftritt den Retourschneider an, ohne die Bedienung
zu sperren. Er erscheint je Einstieg einmal, auch nach erneutem Laden nicht nochmals.
A round ends with three tricks or a fold, the match at its target. Losers receive
one Nockerl, or two without scoring (Schneider). With four players, the trailing
team may erase its score when the other team first becomes gestrichen. Winning
every remaining round gives the former leaders four loss marks; losing once ends
the match immediately and gives the challengers two. Both teammates must consent
separately; one refusal keeps their score. After your yes, the table shows whose
answer is pending. Once both agree, a brief full-screen announcement introduces
the Retourschneider without blocking controls. Each entry is announced once,
including across reloads.

**8+3-Erfolge / milestones:** «8+3 isch Mittag» gibt es nach zehn normalen
Spielsiegen bis elf, bei denen die letzte Drei-Punkte-Runde genau von acht
auf elf führt. Gewonnene Retourschneider zählen separat: «8+3 isch Feiertag»
nach drei solchen Abschlüssen, «8+3 isch a Wunder» nach zehn.
“8+3 means lunchtime” requires ten regular match wins to eleven, moving from
exactly eight to eleven in the final three-point round. Successful
Retourschneider wins count separately: “8+3 means a holiday” after three such
finishes and “8+3 means a miracle” after ten.

**Nockerl-Serien / tournaments:** Revanchen mit gleicher Besetzung und gleichen
Teams übernehmen die Nockerl. Bei zwei oder vier Spielern kannst du ein Turnier
bis 3, 5, 8, 10, 15, 20 oder einer eigenen positiven Nockerlzahl erstellen.
Wer das Limit erreicht oder überschreitet, verliert das Turnier. Konten,
Teams und CPU-Sitze bleiben über seine Revanchen fest. Ein neues Turnier
beginnt mit einem neuen Tisch. Der Bierblock zeigt gewertete Runden und die
laufende Anschrift, einschliesslich Retourschneider-Löschung. Er öffnet nur per
Tipp auf «Mir»/«Dir» beziehungsweise den Punktestand und schliesst über Kreuz,
Esc oder Antippen ausserhalb. Gestrichen beginnt zwei Punkte vor dem Spielziel;
dann sind Teamname und alle Zahlen der Anschrift durchgestrichen.
Rematches with the same participants and teams carry their loss marks. With
two or four players, choose a tournament limit of 3, 5, 8, 10, 15, 20 or a
custom positive integer. Reaching or exceeding it loses the tournament.
Accounts, teams and CPU seats stay fixed across its rematches; a new table
starts a new tournament. The score notebook shows scored rounds and running
totals, including Retourschneider erasure. Tap a team score to open it; the
close button, Escape or an outside tap closes it. Gestrichen starts two points
before the match target, crossing out the team label and every number on the pad. [Details](docs/WATTEN_TOURNAMENT.md).

**Audiochat / voice chat:** Hausdepp und Watten bieten beim Erstellen einen
standardmässig aktiven Audiochat-Schalter. Er erlaubt Audio für den Tisch;
Zuhören und Mikrofon bleiben freiwillige getrennte Entscheidungen. Watten nutzt
nur einen gemeinsamen Raum für zugelassene menschliche Mitspieler, ohne
Teamkanäle und ohne Zuschauer oder CPUs. Die bestehende SFU-/TURN-Konfiguration
wird wiederverwendet; echtes Audio über den Anbieter wurde hier noch nicht geprüft.
Both creators offer an audio-chat checkbox, on by default. It allows audio for
the table; listening and microphone are separate voluntary choices. Watten has
one global room for admitted human players, with no team channels, spectators
or CPUs. The existing SFU/TURN configuration is reused; provider audio has not
been verified in this change.

**PWA-Stand / PWA status:** Ein eigenes Spielsymbol und PNG-Icons in32/180/192/512
Pixeln sind vorhanden. Die öffentliche Beta öffnet Manifest, Service Worker,
Push-Empfang und sichere Benachrichtigungsziele. Push benötigt die bestehende
VAPID-Konfiguration und die ausdrückliche Einwilligung im Konto. Mitspieleraufrufe
prüfen den gespeicherten öffentlichen Warteraum und beide Flutbremsen vor dem
Versand. Eine echte Provider-Zustellung wird durch serverseitige Tests nicht belegt.
An original mark and PNG icons at32/180/192/512 pixels are present. Public beta
enables its manifest, worker, push reception and safe notification targets.
Push needs the existing VAPID configuration and explicit account consent.
Open-seat calls validate the stored public waiting room and both durable
cooldowns before sending. Backend tests do not prove real provider delivery.

**Lokaler Kontofortschritt / local account progress:** Die lokale Watten-Vorschau
verbucht neue abgeschlossene Partien zusammen mit Ergebnis und Fortschritt in
einer Transaktion. `/watten/konto/fortschritt`, `/watten/konto/verlauf` und
`/watten/rangliste` zeigen ausschliesslich verbuchte XP, die eigenen Ergebnisse,
belegte Erfolge und erklärbare Ranglisten. XP, Titelstufen und Erfolgswerte sind
vorerst als Entwurf gekennzeichnet. Ältere Resultate bleiben sichtbar und
erhalten beim Lesen keine nachträglichen XP. Für lokale Tests sind beide lokalen
Vorschauflags erforderlich; die öffentliche Watten-Domain bleibt geschlossen.

New locally completed Watten matches atomically store results and progress.
The native progress, history and leaderboard pages show stored XP, owned
results, evidenced achievements and explicit ranking definitions. XP, title
levels and award values remain labelled as a proposal. Reading older results
never retrospectively grants XP. Local tests require both local preview flags; the
public Watten domain remains closed.

**Spieltag / play day:** Akzeptierte menschliche Ansagen, Karten und Gebots-
entscheidungen zählen im lokalen Watten für die kontoweite Tagesaktivität.
Der Spieltag wird atomar mit dem Spielstand gespeichert. Beitreten, Zuschauen,
Einschauen, Partnergefühl, Computerzüge und wiederholte Befehle zählen nicht.
Eigene abgeschlossene Wattenresultate zählen auch für die Reminderprüfung;
das schaltet keine Wattenbenachrichtigungen frei.
Accepted human calls, card plays and bidding decisions count towards the
account's play day, atomically with the checkpoint. Joining, watching,
inspection, partner feedback, CPU turns and command replays do not count.
Owned completed Watten results also inform reminder eligibility; this does
not enable Watten notifications.

**Favorit / favorite:** Im lokalen Erstellformular lässt sich ein vollständiges
Tischrezept je Konto speichern und bewusst wieder anwenden, einschliesslich
Computerplätzen. Passwörter werden nicht mitgespeichert. Bei einem geschützten Favoriten
entscheidet das neu eingegebene Passwort über den Schutz; Anwenden erstellt und startet keine Partie.

The local creator saves one complete table recipe per account, including CPU
seat wishes. Passwords are never saved. The fresh password entered when using a protected favorite
determines whether the new table is protected; applying
a favorite neither creates nor starts a match.

**Ruhiger Tisch / calmer table:** Ansagekarten treffen sich zwischen den beiden
Ansagenden und bleiben auch im Querformat lesbar. Auf kleinen Bildschirmen dürfen
sie sich überlappen; beide Karten bleiben erkennbar. Blödeln hat einen festen
Bedienplatz; Unbeteiligte sehen nur den kurzen Status. Beim Ansehen des letzten
Stichs bleiben neue Würfe und Kartenanimationen verborgen. Am Spielende stehen
Ergebnis, schnelle Reaktionen und Revanche oben; Tischverlauf und kompakte
Erfolge & Titel findest du darunter bei den Details.
Auch während des Austeilens bleiben die Kartenplätze reserviert, damit bereits
liegende Stichkarten ihre Größe behalten.
Inspection cards meet between the two announcers and remain readable in
landscape. On small screens they may overlap while both remain identifiable.
Blödeln controls keep a stable dock, with only a short status for
others. Reviewing the last trick hides live throws and card animations. At match
end the result, quick reactions and rematch come first; table history and compact
achievements and titles are available below in the details.
Card slots remain reserved during dealing so played trick cards keep their size.

**Verlassene Tische / abandoned tables:** Nach einer Stunde ohne Spielaktivität
werden laufende oder pausierte Watten-Spiele ohne Wertung beendet. Spielaktionen
und bewusstes Fortsetzen verlängern die Frist; Chat, Zuschauen und blosses
Neuverbinden nicht. Bis dahin kannst du auf deinen bisherigen Platz zurückkehren.
Running or paused Watten games end without scoring after one hour without game
activity. Game actions and deliberate resume renew the deadline; chat, viewing
and reconnecting alone do not. Until then you can return to your previous seat.

**Revanche / rematch:** Nach dem Ende genügt «Revanche starten». Menschen,
Sitze, Teams, CPUs, Modus und Einstellungen bleiben unverändert, eure Nockerl
laufen weiter. Ein Passwort wird nicht erneut verlangt: Nur die ursprünglichen
Konten dürfen ihre festen Plätze besetzen. Beim freiwilligen Beitritt wird der
bisherige Platz automatisch besetzt; eine erneute Teamwahl entfällt. Der Gastgeber
startet ausdrücklich. Neue Teams oder Regeln legst du mit einem neuen Spiel über
die Lobby fest. Erneutes Öffnen führt auch nach verlorener
Antwort oder Neustart zur selben Revanche, ohne frühere Ergebnisse oder XP
zu verändern.

After the match, one “Start rematch” click continues with the same people,
seats, teams, CPUs, mode and settings, carrying loss marks. No new password is
needed: only the original accounts may take their assigned seats. Joining is
voluntary and automatically restores the previous seat and team, without another
team choice. The host starts explicitly. Use a new game in the lobby for new
teams or rules. Reopening returns to the same rematch after a lost response
or restart, without changing earlier results or XP.

**Chat und Emojis / chat and emoji:** Am Tisch lesen alle Mitspieler und
zugelassenen Zuschauer den öffentlichen Tischchat. Nachrichten und zwölf Emojis
bleiben auch bei einem offenen Gebot, während einer Pause und gestrichen
erlaubt; Kartenhinweise sind verboten. «Gut/Schlecht/Unsicher» bleibt die
separate private Partnerfunktion. Chat und Reaktionen verändern keine Karten
oder Spielpunkte.

The public table chat is visible to players and admitted spectators. Messages
and twelve emoji remain available during a pending bid, a pause and when
gestrichen; card hints are forbidden. “Good/Bad/Unsure” remains separate private
partner advice. Chat and reactions never change cards or match points.

Der gemeinsame Lobbychat wird in der öffentlichen Watten-Beta bewusst geöffnet
und respektiert die kontoweite Chat-Einstellung. Auf den vier kanonischen
Produkt-Hosts braucht er eine frisch bestätigte öffentliche Watten-Freigabe;
die lokale Entwicklung und die private Founder-Vorschau bleiben verfügbar.
Sein persönlicher Dreitagesverlauf
enthält nur Nachrichten, bei deren Versand das Konto zum Empfängerkreis gehörte.
Eine Deaktivierung beendet den Empfang; erneutes Aktivieren ergänzt keine
verpassten Nachrichten. Der öffentliche Tischchat bleibt davon unabhängig.
Die Spieleauswahl kennzeichnet nur die öffentliche Freigabe als «[BETA]» und
beschreibt die geschlossene Vorschau ausdrücklich als privat.

Opening the shared lobby chat in the public Watten beta is explicit and respects
the account-wide chat preference. The four canonical product hosts require a
freshly confirmed public Watten capability; local development and the private
founder preview remain available. Its personal three-day history contains only
messages addressed to that account at send time. Disabling stops delivery;
enabling again never adds missed messages. The public table chat is independent.
The game picker marks only public availability as “[BETA]” and labels the closed
preview as private.

**Deko-Bedienung / decoration controls:** Acht lokale Gegenstände können
zufällig am Tisch erscheinen. Antippen isst, trinkt oder würfelt, Ziehen oder
Pfeiltasten verschieben. Deko-Ecke, Stern und Kontextmenü sind entfernt.
Spielbereiche bleiben frei. Auch mit reduzierter Bewegung bleibt
die Bedienung verfügbar.
Eight local items can appear randomly at the table. Tap to eat, drink or roll;
drag or use arrow keys to move. The decoration corner, star and context menus
are removed. Play areas remain clear, and controls work with reduced motion.

**Deutsch:** Watten ist als nächstes Spiel vorgemerkt: üblicherweise 4er
ladinisch bis 11 Punkte («8+3 isch zmittag»), mit blindem Einschauen durch den
Geber und den im Uhrzeigersinn nachfolgenden Spieler. Die identischen
Hausdepp-Kartendesigns werden wiederverwendet. Die
[Recherche](docs/WATTEN_RESEARCH.md) dokumentiert Quellen, Regelvarianten und
offene Hausregeln. Zusätzlich sind Varianten für zwei und drei Spieler,
taktisch spielende CPUs mit typischen Tiroler Namen und freie Teamwahl vor
Spielbeginn ohne Zufallszuweisung gewünscht. Ein gestrichener Spieler darf
kein eigenes Einsatzgebot eröffnen; massgeblich ist sein eigener Punktestand,
auch bei unterschiedlich gestrichenen Dreierpartnern. Der zuständige Entscheider
darf auf ein gegnerisches Gebot weiterhin Halten, Gehen oder Aufbieten wählen.
Die bestätigten Profile und Ansagerrollen stehen im
[Owner-Protokoll](docs/WATTEN_OWNER_DECISIONS.md).
Achievements, dauerhafte wirtshaustaugliche Titel, Ranglisten und das
Fortschrittsumfeld gehören verbindlich dazu: anfangs schnellere Aufstiege,
danach zunehmend längere Etappen für ausdauernde Watter. Der
[Fortschrittsplan](docs/WATTEN_PROGRESSION_PLAN.md) enthält erreichbare Ziele
und einen vorläufigen Kurvenentwurf. Vollständige Tests laufen soweit möglich
lokal auf dem Mac; GitHub prüft nur den schlanken Integrationsnachweis.
Hoch- und Querformat bleiben vollständig spielbar; Querformat wird mit
einem dezenten, schliessbaren Hinweis empfohlen. Die Umsetzung ist jetzt
freigegeben und startet gemäss [Übergabe](docs/WATTEN_EXECUTION_HANDOFF.md)
in einem separaten Chat. Zielhost: `watten.zockdiewandan.online`, inklusive
SEO, robots.txt, Sitemap und Search-Console-Einreichung nach öffentlicher Freigabe.

Der [vertiefte Regelabgleich](docs/WATTEN_RULES_AUDIT.md) trennt Ladinisch,
Blind-/Offen-Ansage, Varianten mit Kritischen, Trumpfzwang und Einsatzbieten.
Die endgültigen Modi müssen jeden Regelfall eindeutig festlegen; die
veröffentlichten Quellen enthalten unterschiedliche Profile und noch nicht
alle Kombinationen lückenlos. watten.org dient als Regelquelle; seine
Kartendesigns werden nicht übernommen.

Die [Gestaltungsreferenzen](docs/WATTEN_DESIGN_REFERENCES.md) sichern die vom
Owner gelieferten UltraWatten-Bilder und Beobachtungen der Live-Oberfläche.
Sie dienen als Ideen für die Bedienung, ohne 1:1-Kopie; die eigenen
Hausdepp-Kartendesigns bleiben gesetzt.

Die [Hausdepp-Retrospektive](docs/HAUSDEPP_RETROSPECTIVE_2026-10-18.md)
untersucht die Erstimplementierung und 20 spätere PRs. Alle 81 Befunde und
Prüfverträge sind mit konkreter Vorbeugung und Abnahme in den
[Watten-Umsetzungsplan](docs/WATTEN_IMPLEMENTATION_PLAN.md) übertragen:
Regeln, CPUs, Teamwahl, Konto, Einladungen, Wiederaufnahme, Darstellung und
Auslieferung. Offene Regelentscheidungen bleiben vor der davon abhängigen
Implementierung zu klären.

Die Umsetzung ist gestartet: Der [Ausführungsstand](docs/WATTEN_EXECUTION_LOG.md)
führt die Arbeitspakete und alle 81 Erkenntnisse weiter. Der feste Host
`watten.zockdiewandan.online` bleibt während der Vorbereitung geschlossen;
er liefert weder ein anderes Spiel noch dessen PWA oder persönliche Daten.
Die [P1-Verträge](docs/WATTEN_P1_CONTRACTS.md) halten Konto, Routen, Passkeys,
PWA und Suite-Dienste gemeinsam fest. Eine spielbare Wattenpartie ist noch
nicht veröffentlicht.

Für isolierte lokale Entwicklung gibt es bereits die native Kontoreise unter
`/watten`: gemeinsame Registrierung/Anmeldung, Passkeys, Einstellungen und
Recovery. Sie benötigt `ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW=1` sowie einen
konfigurierten **und** angefragten Loopback-/localhost-Ursprung. Auf echten
Produktionshosts bleibt sie auch mit diesem Flag geschlossen. Die vorhandene
isolierte Passkey-Browsersuite prüft den Ablauf mit Wegwerfkonten. Die lokale
Kontovorschau hat eigene DE/EN-Manifeste, Icons und einen schmalen Worker ohne
Offline-Speicherung privater Daten. Sie lässt sich bei Browserunterstützung
lokal installieren; die vorhandene installierte Suite-Identität bleibt beim
Spielwechsel erhalten. Automatisierte Tests prüfen echte Worker und simulierte
Standalone-Kontexte, keine physische iPhone-Installation oder echten Konten.

Die [reine Engine-Grundlage](docs/WATTEN_ENGINE.md) enthält inzwischen
unveränderliche Karten-, Biet-, Zug- und Phasenübergänge, Warteraum und Rezept
sowie getrennte private Speicherformate und erlaubte Spieler-/CPU-/Zuschauersichten.
Ein separater lokaler Spieladapter bindet diese Grundlagen inzwischen an die
bestehenden Konten, HTTP/WebSocket und dauerhafte Datenbankzustände an.
`ROLLTHEDICE_WATTEN_GAME_PREVIEW=1` benötigt ebenfalls einen konfigurierten
und angefragten lokalen Ursprung; der feste Wattenhost bleibt gesperrt.
Die lokale Spieloberfläche bietet Zwei-, Drei- und Vierertische, manuelle
Sitz-/Teamwahl, Einsatzbieten, einmaliges Einschauen und ausdrückliches
Fortsetzen pausierter Partien. Der Gastgeber kann freie Plätze gezielt mit
benannten Computergegnern besetzen und wieder freigeben. Diese spielen mit
ihrer eigenen erlaubten Sicht und gespeichertem Gedächtnis; sie erhalten keine
gegnerischen Hände oder einen verdeckten Schlag aus dem Serverzustand.
Rechter-Referenz und Stichhistorie sind standardmässig aus; ohne Referenz wird
die einmalig erlaubte Ansage nicht dauerhaft angezeigt. Partnerblatt ist nur
im offenen Spiel mit Partnern wählbar; Guter/Schlechter bleiben aus. Die lokalen
Grundlagen, native Runtime und integrierter Spieltisch mit CPUs haben die
vollständigen lokalen Prüfungen in PR #53, #54 und #55 bestanden.
Physische Mehrgeräte- und vollständige Produktabnahme bleiben offen. Neu festgelegt ist:
Wer eine laufende Partie bewusst verlässt, pausiert sie bis zur Rückkehr.
Die lokale Runtime speichert diese Pause samt Sitz, Hand, offenem Gebot und
Punkten; nur die frisch angemeldete betroffene Person kann ausdrücklich
fortsetzen. Der feste Produktionshost bleibt geschlossen.

**English:** Watten is the next planned game: usually four-player Ladinisch
to 11 points, with private bottom-card inspection by the dealer and the next
clockwise player. It will reuse the same card designs as Hausdepp. The
[research notes](docs/WATTEN_RESEARCH.md) record sources, variants and unresolved
house rules. Two- and three-player variants, tactical CPUs with Tyrolean names
and manual team selection before play without random assignment are also
wanted. A gestrichen player cannot initiate a stake bid; eligibility follows
that player’s own score, including mixed three-player partners. The designated
decider may still hold, fold or counter an opposing bid. Confirmed profiles
and announcement roles are recorded in the
[owner decisions](docs/WATTEN_OWNER_DECISIONS.md). Achievements, permanent
pub-style titles, leaderboards and the surrounding progress features are
required, with faster early promotions and growing later gaps rewarding
persistence. The [progression plan](docs/WATTEN_PROGRESSION_PLAN.md) sets out
achievable goals and a provisional curve. Full tests run locally on the Mac
wherever possible; GitHub only validates integration evidence. Implementation
is now authorized in a separate chat; see the
[execution handoff](docs/WATTEN_EXECUTION_HANDOFF.md). The target host is
`watten.zockdiewandan.online`, including SEO, robots.txt, sitemap and Search
Console submission after public release. Both orientations remain fully
playable, with a discreet, dismissible landscape recommendation.

The [detailed rules audit](docs/WATTEN_RULES_AUDIT.md) separates Ladinisch,
blind/open announcements, critical-card variants, trump obligations and bidding.
Each final mode must define every rule case unambiguously; published sources
describe different profiles and do not fully cover every combination. watten.org
is a rules reference; its card designs are not adopted.

The [design references](docs/WATTEN_DESIGN_REFERENCES.md) preserve the owner's
UltraWatten screenshots and observations of the live interface. They provide
interaction ideas for an independent design; the existing Hausdepp card artwork
remains required.

The [Hausdepp retrospective](docs/HAUSDEPP_RETROSPECTIVE_2026-10-18.md)
examines the first implementation and 20 later PRs. All 81 findings and
contracts have concrete preventive actions and acceptance scenarios in the
[Watten implementation plan](docs/WATTEN_IMPLEMENTATION_PLAN.md), covering
rules, CPUs, team selection, accounts, invitations, recovery, presentation and
delivery. Outstanding rule decisions must be settled before dependent work.

Implementation has started. The [execution log](docs/WATTEN_EXECUTION_LOG.md)
tracks the work packages and all 81 findings. The fixed host
`watten.zockdiewandan.online` stays closed during preparation; it cannot serve
another game, its PWA or personal data. The [P1 contracts](docs/WATTEN_P1_CONTRACTS.md)
cover accounts, routes, passkeys, PWA and suite services together. Playable
Watten has not been publicly released.

Isolated local development already has native shared-account journeys at
`/watten`: signup/sign-in, passkeys, settings and recovery. They require
`ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW=1` and both a configured and requested
loopback/localhost origin. Real production hosts stay closed even with the
flag. The existing isolated passkey browser suite uses disposable accounts.
The local account preview has its own DE/EN manifests, icons and a narrow worker
without offline private-data storage. Supporting browsers can install it locally;
existing installed suite identity survives game switching. Automated tests cover
real workers and simulated standalone contexts, not physical iPhone installation
or real accounts.

The [pure engine foundation](docs/WATTEN_ENGINE.md) now provides immutable
card, bidding, play and phase transitions, waiting rooms and recipes, with
separate private storage schemas and allowed player/CPU/spectator views.
A separate local game adapter now connects these foundations to existing
accounts, HTTP/WebSocket transport and durable database state.
`ROLLTHEDICE_WATTEN_GAME_PREVIEW=1` also requires both configured and requested
local origins; the fixed Watten host stays closed. The local gameplay UI
supports two-, three- and four-player tables, manual seat/team choice, bidding,
one-time inspection and explicit return to paused matches. Hosts can place
named computer opponents on specific free seats and remove them again. CPUs
use their own permitted views and durable memory; they do not receive opposing
hands or a hidden call from server state.
The matching Rechter reference and trick history default off; without the
reference, the once-permitted call is not kept visible. Partner hands are
an explicit option only in open games with partners; Guter/Schlechter stay off.
The foundations, native runtime and integrated UI/CPUs passed full local checks
in PR #53, #54 and #55. Physical multiple-device and complete product acceptance
remain open. A newly confirmed rule
pauses a running match after an intentional departure until that player
returns. The local runtime preserves that pause, seat, hand, pending bid and
scores; only the freshly authenticated affected person can explicitly resume.
The production host remains closed.

## Hausdepp — öffentlicher V3-Start / public V3 launch

**Gemeinsame Tischdeko / Shared table props:** Snacks essen, Getränke benutzen
und andere Dekoaktionen werden für alle am Tisch synchronisiert. Die Platzierung
bleibt passend zum jeweiligen Bildschirm; Drag-Bewegungen bleiben lokal.
Verbrauch, Gegenstandszustände und Würfel-/Münzergebnisse kommen vom Server.
Wiederverbinden zeigt den aktuellen Zustand ohne alte Animationen; jede neue
Runde beginnt frisch. Die Deko verändert weder Spielkarten noch EP.

Eating snacks, using drinks and other prop actions are shared with everyone
at the table. Placement adapts to each display and dragging stays local.
Consumption, prop states and dice/coin results come from the server.
Reconnecting shows current state without replaying old animations; each new
round starts fresh. Props affect neither cards nor XP.

**Einzeln aussteigen / Individual departure:** „Partie verlassen“ öffnet eine
Bestätigung im Hausdepp-Design. „Am Tisch bleiben“, Schliessen oder Escape
bricht den Ausstieg ab. Erst die ausdrückliche Bestätigung beendet die eigene
Teilnahme. Die Handkarten verlassen das
Spiel endgültig, die übrigen spielen weiter. Bei nur einem Spieler mit Karten
endet die Runde ohne Hausdepp mit regulären EP für die Verbleibenden. Wer eine
laufende Hand aufgibt, erhält keine Runden-EP oder normalen Erfolge; der neue
Zonk-Erfolg gibt 0 EP. Bereits regulär fertig gespielte Hände behalten ihre
Vergütung. Im Turnier gilt der Ausstieg für die ganze Sitzung, frühere Runden
und EP bleiben erhalten. Zuschauer können den Tisch über denselben Schalter
sofort zur Lobby verlassen, auch ohne Verbindung. Das beendet nur das Zuschauen.

Leave game opens a confirmation in the Hausdepp design. Stay at the table,
closing the dialog or Escape cancels leaving. Only explicit confirmation ends
your own participation. Your
hand cards leave play permanently; everyone else continues. With just one player
with cards left, the round ends without a Hausdepp and remaining players receive
normal XP. Giving up an unfinished hand awards no round XP or ordinary
achievements; the new Zonk achievement is worth 0 XP. Hands already finished
normally remain credited. Tournament departure applies to the whole session;
earlier rounds and XP remain intact. Spectators can use the same button to
return to the lobby immediately, even when disconnected. This only stops watching.

**Schneller CPU-Abschluss / Faster CPU finish:** Spielst du allein gegen CPUs
und hast deine Karten regulär fertig gespielt, erscheint an ihrer bisherigen
Stelle «CPUs schneller». Einmal antippen verkürzt die verbleibenden CPU-Pausen
dieser Runde um 70 %, mit mindestens 400 ms zum Mitverfolgen. Kartenbewegungen
passen sich an; Entscheidungen und Wertung bleiben gleich. Die nächste Runde
beginnt wieder im Normaltempo. Mit weiteren Menschen am Tisch gibt es den
Schalter nicht.

When you are the only human and have finished your hand normally, “Speed up
CPUs” appears where your cards were. Tap once to shorten the remaining CPU
pauses in this round by 70%, with a 400 ms minimum so you can follow play.
Card movement adapts; decisions and scoring stay the same. The next round
returns to normal speed. The control is unavailable with other humans at the
table.

**Lokale Wirtshauskulisse / Local tavern ambience:** Der Notenschalter startet
freiwillig eine sehr leise Kulisse aus Stimmengewirr, Gläsern, Geschirr und
gelegentlichem Lachen, auch bei CPU-Partien. Bei jedem Einschalten wird eine
von zehn Raumkulissen zufällig gewählt. Nur diese Aufnahme und drei gemeinsame
Detaildateien werden geladen, zusammen höchstens etwa 1.62 MiB. Der normale
HTTP-Cache wird wiederverwendet; im Arbeitsspeicher bleibt höchstens eine
decodierte Raumaufnahme. Die Wiedergabe bleibt lokal, ohne Cloudflare Realtime.
Kurze Töne bestätigen Sound-/Sprachchat-/Mikrofonschalter nur bei aktiviertem
Sound; beim Ausschalten erklingt ein letzter Abschaltton. Systemlautstärke und
Audiogeräte gelten. Turniere und Neu erstellen auf derselben Seite behalten
die Einstellung; Verlassen, Abmelden oder Schliessen beendet sie.
[Aufnahmen, CC0-Lizenzen und Bearbeitung](docs/HAUSDEPP_AUDIO_ASSETS.md).

The music-note switch opts into very quiet pub ambience, including CPU games.
Each time it is switched on, one of ten ambience mixes is chosen at random.
Only that room loop and three shared detail clips load, at most about 1.62 MiB
in total. They reuse the normal HTTP cache; memory retains at most one decoded
room recording. Playback stays local without Cloudflare Realtime. Short tones
confirm sound, voice and microphone changes only while sound is enabled;
switching sound off plays one final acknowledgement. Use system volume and
audio devices. Tournaments and Create again on the same page retain the
setting; leaving, signing out or closing ends it.

**Sprachchat / Voice chat:** Bei aktivierter Sprachfunktion können angemeldete
Mitspieler am Wartetisch freiwillig Audio einschalten und ohne Mikrofonfreigabe
zuhören. Das Mikrofon wird separat eingeschaltet. Audio aus schaltet auch das
Mikro stumm; Audio wieder ein startet ausschliesslich das Zuhören. Einzelne
Mitspieler lassen sich nur für sich selbst stummschalten. Systemlautstärke und
die Audiogeräte des Betriebssystems gelten. Turnierrunden, Zwischenstände und
erneute Partien derselben Gruppe behalten die Sprachsitzung. Verlassen,
Abmelden und Schliessen beenden sie; ein neuer Einstieg startet ausgeschaltet.
Gäste, Computer und Zuschauer nehmen nicht teil. Es gibt keine Aufzeichnung.
Der Mikrofonzugriff funktioniert auf der Hausdepp-Subdomain und in bestehenden
Suite-PWAs; die Gerätefreigabe bleibt erforderlich.
Bei Partien nur gegen Computer werden die Sprachchat-Schalter ausgeblendet.
Die PWA wird empfohlen; Hintergrundbetrieb und Geräteschaltung hängen von
Browser und Betriebssystem ab. Die Funktion bleibt ohne eingerichteten
Cloudflare-Audiodienst deaktiviert; siehe [Betrieb](docs/DEPLOYMENT.md#hausdepp-sprachchat--voice-chat).

When voice is enabled, signed-in players can opt into audio in the waiting
room and listen without granting microphone access. Enable the microphone
separately. Switching audio off also mutes the microphone; switching audio back
on starts listening only. Mute individual players for yourself. Use system
volume and the operating system's audio devices. Tournament rounds, standings
and rematches with the same group retain the voice session. Leaving, signing
out or closing ends it; a fresh visit starts off. Guests, CPUs and spectators
cannot participate. No conversations are recorded. Microphone access works on
the Hausdepp subdomain and in existing suite PWAs; device permission is still
required. Voice controls are hidden
in games against CPUs only. Installing the PWA is recommended; background
operation and routing depend on browser and OS. Voice
stays disabled until Cloudflare media services are configured.

Mission Control zeigt dem Gründer die vom Browser gemeldeten Audio-Nutzdaten
getrennt nach Empfang und Versand, als UTC-Tagesverlauf und mit laufendem
Monatswert. Aktiver Sprachchat meldet etwa alle zehn Sekunden; das Dashboard
aktualisiert sich alle 30 Sekunden. Dauerhaft bleiben nur anonyme Tagessummen
für 400 Tage erhalten, ohne Audioinhalte, Konto- oder Raumkennungen. Fehlende
Meldungen und Netzwerk-Overhead werden nicht nachgerechnet. Die Messung ist
keine Cloudflare-Abrechnung und kein Kosten-Cap; TURN wird nicht doppelt gezählt.

Mission Control shows the founder browser-reported audio payload, split into
received and sent bytes, UTC daily history and a current-month total. Active
voice reports about every ten seconds; the dashboard refreshes every 30 seconds.
Only anonymous daily totals are retained for 400 days, without audio content,
account or room identifiers. Missing reports and network overhead are not
estimated. These measurements are not Cloudflare billing or a spending cap;
TURN is not counted twice.

**Deutsch:** Mit V3 ergänzt Hausdepp die Suite als öffentliches drittes Spiel.
Die Lobby unter `/hausdepp` und die vollständigen Hausregeln unter
`/hausdepp/regeln` sind ohne Anmeldung erreichbar. Zum Eröffnen, Mitspielen und
Zuschauen genügt jedes aktive angemeldete Suite-Konto; die frühere
Founder-Freigabe entfällt. Spieltische unter `/hausdepp/spiel/{id}`, Konto,
Rangliste und persönliche APIs bleiben an eine gültige Anmeldung gebunden.
Die sichtbare Veröffentlichung von V3 ist vom Owner freigegeben; die Gestaltung
wird nach weiteren Spieltests verfeinert. Die gemeinsame Anmeldung kehrt zum
gewählten Hausdepp-Ziel zurück und verwendet das bestehende Konto.
Die angemeldete Lobby zeigt Tischstatus und belegte Plätze; ein Wartetisch
zeigt fehlende Mitspieler und bietet einen teilbaren Tischlink.
Ein neuer Tisch erhält automatisch einen von 50 Wirtshausnamen mit deinem
aktuellen Kontonamen, etwa „Manis Gsuff“. Ein Namensfeld ist dafür nicht nötig.

Zwei bis fünf, höchstens sechs Teilnehmer spielen mit 36 doppeldeutschen Karten;
Computer sind echte Mitspieler mit eigenen verdeckten Händen. Gleiche Ränge oben auf dem offenen Paket
sind leicht aufgefächert, das Rundenende zeigt Platzierungen, Runden-EP und neue
Erfolge. Längere Ergebnisstatus bleiben auch auf kleinen Displays von Avatar und
Spielername getrennt. Die Gegenstände am Tisch lassen sich benutzen: Münze werfen, würfeln,
vom Bier trinken (zu wild, und es kippt um) oder die Nüsse verputzen. Sie kaufen kleine
wertvolle Pakete statt ihre 10 zu verbrennen, auch ein Ass im Zweikampf, legen von Ober, König und Ass
zunächst nur eine Karte und halten den Rest zurück, spielen mal besser, mal schlechter
und in den ersten 50 Runden neuer Konten spürbar sanfter; neuere Spieler sehen
dazu kurze Tipps in ihrer Zugzeile. Die Serverregeln
schützen fremde Karten und den Nachziehstapel. Ein Tipp auf den verdeckten Stapel
zockt vor dem Ablegen. Danach füllt das Spiel für alle automatisch alle
fehlenden Karten bis auf drei auf, sobald die eigene Auffüllung an der Reihe
ist; eine Einstellung dafür gibt es nicht mehr. Computer füllen unabhängig von
laufenden Kartenanimationen und anderen CPU-Wartezeiten auf. Der nächste Spieler darf schon
Handkarten legen; ziehen oder zocken kann er erst, wenn ältere
Auffüllpflichten erledigt sind. „Du musst ziehen“ mit sanft rotem Rahmen zeigt,
wessen Auffüllung an der Reihe ist. Ein Tipp auf
eine Handkarte legt sie sofort, ein Tipp auf das offene Paket nimmt es auf.
Der Tipp gilt nur für die beim Aufsetzen bereits spielbare Karte. Rückt eine
andere Karte nach oder wird sie erst während des Tipps freigegeben, tippe erneut.
Langes Halten einer Handkarte (oder der Schalter Mehrfachauswahl) wählt alle
gleichrangigen Karten für genau einen Wurf, ein Tipp nimmt einzelne wieder heraus. Der erste Geber jedes Tisches wird ausgelost,
gegen Computer wie gegen Menschen; im Turnier gibt danach reihum der nächste
Spieler im Uhrzeigersinn. Erfolglos angeschaute Karten bleiben für den
Abhebenden direkt am Stapel sichtbar, solange sie noch darin liegen.
Ass und Folgekarte erscheinen direkt am Stapel; nach einem Fehlversuch bleiben
sie noch drei Sekunden lesbar. Die Abhebehistorie öffnet sich nur auf Wunsch in
der Tischhilfe und wird vor jeder neuen Turnierrunde geleert.

Aces and the following card appear directly at the deck; an unsuccessful
sequence stays readable for three seconds. Cut history opens only on request
in table help and is cleared before each new tournament round.

Vor dem aktiven Abheben zeigt eine kurze einmalige Mischanimation die
Kartenrückseiten. Neuladen und Wiederverbinden wiederholen sie nicht; sie
sperrt keine Aktion und entfällt bei reduzierter Bewegung. Das Austeilen wird
ebenfalls kurz animiert. Die Hand liegt
als sortierter Fächer mit den 10ern ganz rechts. Gegnerische Hände zeigen genau
ihre Kartenanzahl als verdeckte Rückseiten. Einzeln ausgerichtete Ausschnitte
geben den Karten saubere Ränder. Ziehen, Geben und Aufnehmen bewegen Karten
sichtbar vom jeweiligen Stapel zur Hand; reduzierte Bewegung zeigt die Ankunft
am Ziel ohne Flug. Chat, schnelle Reaktionen und Wiederaufnahme verwenden
die gemeinsame Infrastruktur. Hoch- und Querformat auf Smartphone, Tablet und
Desktop werden unterstützt, mit Mobilgeräten als Ausgangspunkt.

**Deutsch – Karten besser verfolgen:** Gespielte Karten kommen sichtbar an und
bleiben kurz liegen, bevor eine 10 oder vier Gleiche das Paket abräumen.
Computer lassen zwischen diesen sichtbaren Aktionen Zeit zum Mitverfolgen;
Aufnehmen und Zocken werden nach der Landung freigegeben. Kartenlagen machen die
tatsächliche Grösse des Nachziehstapels und offenen Pakets erkennbar. Tablet und
Desktop nutzen grössere Karten, auf dem Handy rücken grosse Hände und besonders
gleiche Werte enger zusammen. Der Fächer bleibt horizontal verschiebbar; mit der
Tastatur fokussierte Karten liegen zum Lesen und Auswählen vorne. Karten auf
dem offenen Paket behalten während eines Zugs dieselbe zur Ansicht passende
Grösse; die Animation geht ohne Grössensprung in den Stapel über. Während des
Flugs siehst du die geworfene Karte nur einmal. Erst bei der Landung erscheint
sie mit aktualisierter Kartenzahl und passendem Fächer im offenen Paket.
Passende Karten kannst du im offenen Nachwurffenster sofort nachwerfen, auch
nach dem Auffüllen. Aufnehmen, Zocken und neue Stapelaktionen warten auf die Ankunft.
Bei reduzierter Bewegung entfällt die Flugwartezeit.

**English – follow the cards:** Played cards visibly arrive and rest briefly
before a ten or four matching ranks clear the pile. Computers leave time to
follow these visible actions; pickups and gambles become available after landing.
Layered cards convey the actual stock and open-pile sizes. Tablets and desktops
use larger cards, while large phone hands pack more tightly, especially matching
ranks. The fan still scrolls horizontally; keyboard-focused cards move to the
front for reading and selection. Open-pile cards keep the same size throughout
a play, matching the viewport; the animation joins the pile without a size jump.
A thrown card is visible only once during its flight. It joins the open pile
with its updated count and matching-rank fan when it lands. Matching cards can
be thrown immediately in the open follow-up window, including fresh refills.
Pickups, gambles and new pile actions wait for arrival. Reduced motion skips the
flight wait.

**Deutsch – Tisch lesen:** Verdeckter Stapel und offenes Paket bleiben auch
zwischen den Zügen hell; was gerade angetippt werden kann (zocken, abheben, Paket
nehmen), leuchtet golden. Name und Kartenzahl der Mitspieler stehen auf dunklen
Schildern, der Spieler am Zug auf einem goldenen, und die Statuszeile wird bei
deinem Zug gold. Tischtexte sind mindestens 11 px gross; „Aus dem Spiel“ zeigt eine
durchgestrichene Karte mit Zahl.

**English – reading the table:** The stock and the open pile stay bright between
turns; whatever can be tapped right now (gamble, cut, take the pile) lights up in
gold. Opponents' names and hand sizes sit on dark plates, the player on turn on a
gold one, and the turn line turns gold on your turn. Table captions are at least
11px; "Out of play" shows a crossed-out card with its count.

Die [Regel- und Produktspezifikation](docs/HAUSDEPP.md) hält die bestätigten
Details fest; [Karten und Quellen](docs/HAUSDEPP_ASSETS.md) dokumentiert das
Tellbild und die Blitz-Rückseite. Die Regelseite ergänzt Schnellstart,
Sprungmarken, Beispiele und Begriffe. Rundenausgänge werden getrennt gespeichert.
Der private Kontobereich zeigt eigene abgeschlossene Runden, Runden als Hausdepp
und Runden mit leerer Hand sowie einen nachladbaren Verlauf tatsächlicher
Ergebnisse; allgemeine Einstellungen sind direkt unter
`/hausdepp/konto/einstellungen` erreichbar und gelten für das gemeinsame Konto.
Das Konto enthält **136 Erfolge und 24 Ränge**, mit Suche, Filtern und der ganzen
Rangleiter. Innerhalb jeder Gruppe stehen erreichte Erfolge vor den noch offenen.
Häufige Kartenaktionen benötigen mehrere passende abgeschlossene Runden;
jede Runde zählt je Ziel höchstens einmal. Seltene Kunststücke bleiben direkt
erreichbar. Eine abgeschlossene Runde nur mit Menschen gibt 10 Erfahrungspunkte.
Sobald mindestens ein Computer mitspielt, wird die Basis um 75 % reduziert
und je Runde auf ganze EP abgerundet: **2 EP**,
auch an gemischten Tischen und für jede einzelne Turnierrunde. Jeder Erfolg
gibt weiterhin einmalig seine vollen 10, 25, 50, 100, 250 oder 500 EP;
der Ausstiegs-Zonk gibt ausdrücklich 0 EP. Runden, Siege und
die Anzahl bereits freigeschalteter Erfolge bleiben dabei erhalten.
Die acht seltenen Tischfunde haben zwei Sammelreihen: selbst ausgelöst und
miterlebt, mit je acht Einzelerfolgen sowie Boni für vier und alle acht
verschiedenen Funde. Beim Auslösen müssen mindestens zwei Menschen verbunden
mitspielen; wer auslöst, sammelt beide Reihen. Die Runde muss regulär enden.
Die Komplettsammlungen geben zusätzlich 500 beziehungsweise 250 EP. Solo mit
Computern, Zuschauer, Offline-Spiel und lokale Vorschauen zählen nicht.
Von **Einstein** bei 0 EP geht es mit
einem Augenzwinkern bis **Hausdepp** bei 9’000 EP. Jeder Rang hat einen eigenen
Aufstiegsspruch, etwa Newtons „Ab jetzt geht’s bergab. Ganz nach den
Naturgesetzen.“ Der dauerhafte Rang ist vom Hausdepp einer Runde getrennt.
Rundenpunkte und freigeschaltete Erfolge werden genau einmal gespeichert;
Neue Erfolge und Rangaufstiege erscheinen nach Rundenende als einzeln
bestätigbare Meldungen mit Name, EP, Bedingung und eigenem Rundennachweis.
Beim nächsten Hausdepp-Einstieg werden auch früher erreichte Erfolge und
Aufstiege einmalig nachgezeigt; bestätigte Meldungen bleiben kontoweit erledigt.
Schliessen oder „Später ansehen“ vergibt keine Bestätigung und keine neuen EP.
Aktive Partien und Einsteigertouren haben Vorrang. Bestehende Ergebnisse
belegen Teilnahme- und Ergebniserfolge; besondere Kartenaktionen benötigen die
neu erfassten Spielereignisse. Der [vollständige Katalog](docs/HAUSDEPP_ACHIEVEMENTS.md)
enthält alle Bedingungen, Punkte und Rangschwellen. Der öffentliche Start wird
als gemeinsamer Major-Release **V3.0.0** geführt; die historische Versionsfolge
bleibt unverändert. Ein Build allein belegt noch keinen erfolgreichen Deploy.
Der [lokale Prüfbericht vom 16.10.2026](docs/HAUSDEPP_LOCALHOST_TEST_2026-10-16.md)
hält Regeln, Punkte, Browsernachweise und verbleibende Gerätetests fest.
Mehrere menschliche Sitze prüft `tests/test_hausdepp_local_multiplayer.py` mit
zwei echten Konten in einer temporären lokalen Datenbank. Die aktuelle
öffentliche Freigabe gilt unabhängig von diesem Test für aktive Konten.

Die private Rangliste unter `/hausdepp/rangliste` zählt Rundensiege: Alle ausser
dem Hausdepp einer abgeschlossenen Runde erhalten einen Sieg. Gleiche
Siegzahlen teilen sich einen Rang; Tischgrössen von zwei bis sechs lassen sich
filtern. Computer erscheinen nicht als Konten. Darunter zeigt „Neueste erreichte
Erfolge“ die jüngsten Freischaltungen aktiver Konten, neueste zuerst, nach
Leicht/Mittel/Schwer filterbar und zu je 20 Einträgen geblättert. Sichtbar sind
nur Kontoname, Erfolg, EP und Zeitpunkt; keine Konto-IDs, Runden oder Karten.
Im **HAUSDEPP-Turnier** bleiben
Tisch und Plätze über mehrere Runden erhalten. Jede Niederlage ergänzt einen
Buchstaben. Wer zuerst **HAUSDEPP** vollständig hat, ist der Tages-Hausdepp;
damit endet das Turnier sofort. Der Host teilt die nächste Runde aus, der Geber
wechselt im Uhrzeigersinn. Ein Abbruch lässt bereits abgeschlossene Runden und
EP bestehen, vergibt aber keine abschliessenden Turniererfolge.

**English:** V3 adds Hausdepp as the suite's public third game. The lobby at
`/hausdepp` and full house rules at `/hausdepp/regeln` are available without
sign-in. Any active signed-in suite account can create, join or watch a table;
the previous founder-only restriction is removed. Game rooms at
`/hausdepp/spiel/{id}`, the account, standings and personal APIs still require
sign-in. The owner approved the visible V3 release; the appearance will
continue to improve through playtests. Existing shared sign-in returns to the
chosen Hausdepp destination using the same account. The signed-in lobby shows
table status and occupied seats; waiting tables explain missing players and
provide a shareable table link.
A new table automatically receives one of 50 tavern-style names built around
your current account name, such as “Mani’s nightcap”; no name field is needed.

Two to five participants, six at most, play with 36 double-headed German cards.
Computers are real participants with their own private hands. Server rules
protect opposing cards and the draw pile. Tapping the face-down pile takes a
chance before playing. After playing, the game automatically draws all missing
cards up to three for everyone as soon as their refill is due. Computers refill
independently of card animations and other computers' reaction times.
The next player may already play hand cards; drawing or
gambling waits for earlier refill obligations. “You must draw” with a gentle
red frame shows whose refill is due. Refilling keeps any still-open opportunity
to add matching cards and never reopens one that has already ended.
Tapping a hand card plays it immediately; tapping the face-up pile takes it.
A tap applies only to the card already playable when you touch it. If another
card moves into its place or becomes playable during the tap, tap again.
In multi-select, one tap selects every card of that rank and another tap takes
single cards out. The first dealer of every table is drawn at random, against
computers and people alike; in tournaments the deal then passes clockwise. Cards
seen in a failed bottom inspection stay visible to that player at the stock
while they remain in it. Before active bottom inspection,
a brief one-time shuffle shows only card backs, without blocking actions; reload,
reconnection and reduced-motion mode do not replay it. Dealing is briefly
animated, and hands form a sorted fan with tens on the right.
Opponents show exactly their hand size as face-down backs. Individually aligned
crops give cards clean edges. Drawing, dealing and picking up visibly move cards
from their source pile to the hand; reduced motion marks arrival without travel.
Chat, quick reactions and reconnection use the shared suite.
Phone, tablet and desktop work in portrait and landscape, designed mobile first.

The [rules and product specification](docs/HAUSDEPP.md) records confirmed
requirements; [card assets and credits](docs/HAUSDEPP_ASSETS.md) documents the
Tell pattern and lightning back. The rules page adds a quick start, anchors,
examples and terminology. Round outcomes are stored separately. The private
account area shows your completed rounds, rounds as the Hausdepp and rounds
finished with an empty hand, plus a loadable history of actual results. General
settings at `/hausdepp/konto/einstellungen` manage the shared account. The account includes **136 achievements
and 24 ranks**, with search, filters and the complete rank ladder. Each group
shows earned achievements before locked ones. Common card actions require
several qualifying completed rounds, with each round counting at most once per
goal; rare feats can still unlock immediately. A completed all-human round earns
10 experience points. Any computer seat reduces the base round reward by 75%,
rounded down per round to **2 XP**, including mixed tables and each individual
tournament round. Achievements still grant their full 10, 25, 50, 100, 250 or 500 XP once each;
the departure Zonk is explicitly worth 0 XP.
Round and win counts and the number of existing unlocks are retained.
The eight rare table finds have two collection tracks: trigger them yourself
and witness them, each with eight single achievements and bonuses for four
and all eight different finds. At least two humans must be connected when a
find is triggered; its activator collects both tracks. The round must finish
normally. Full collections add another 500 and 250 XP respectively. Solo
computer tables, spectators, offline play and local previews do not count.
The ironic ladder runs from **Einstein** at 0 XP to **Hausdepp**
at 9,000 XP. Each rank has its own saying, including Newton's gravity-inspired
downhill greeting. The lasting title stays separate from a round's Hausdepp.
Round points and unlocks are stored once. After a round, individual achievement
and rank popups show the name, XP, condition and your own saved round evidence.
Your next Hausdepp entry also presents previously earned achievements and ranks
once; confirmed items stay confirmed across the account. Closing or choosing
“View later” keeps the item pending without granting XP again. Active games and
beginner tours take priority. Existing outcomes can prove participation and outcome achievements;
detailed card feats require newly recorded gameplay evidence. The
[complete catalogue](docs/HAUSDEPP_ACHIEVEMENTS.md) records conditions, points and
thresholds. The public launch uses the shared major version **V3.0.0** without
renumbering historical releases. A build alone does not prove deployment.
The [local verification report dated 2026-10-16](docs/HAUSDEPP_LOCALHOST_TEST_2026-10-16.md)
records rules, accounting, browser evidence and remaining device checks.

The private standings at `/hausdepp/rangliste` count round wins: everyone except
a completed round's Hausdepp earns a win. Equal totals share a place, and table
sizes two through six can be filtered. Computers have no ranked accounts.
Below, “Latest achievements earned” lists active accounts' newest unlocks,
newest first, filterable by easy/medium/hard and paged 20 at a time. Only the
account name, achievement, XP and time are shown; no account IDs, rounds or cards.
**HAUSDEPP tournaments** keep the same table and seats over multiple rounds.
Each loss adds a letter. The first player to complete **HAUSDEPP** becomes the
day's Hausdepp and immediately ends the tournament. The host deals the next
round; the dealer rotates clockwise. Ending a tournament preserves completed
rounds and XP but grants no final tournament achievements.
`tests/test_hausdepp_local_multiplayer.py` verifies multiple human seats using
two real accounts in a temporary local database. Public access for active
accounts is independent of that test.


## Hausdepp — Spielfenster, Computer und Konto / game window, computers and account

**Deutsch:** Langes Halten einer Handkarte oder **Mehrere Karten auswählen**
markiert gleiche Handkarten, die du gemeinsam in einem Zug spielst; die Auswahl
gilt für einen Wurf, ein normaler Tipp legt weiterhin sofort.
Computer lassen sich im variablen Normaltempo rund 12,5 % mehr Zeit. Nach einer
beendeten oder abgebrochenen Partie erstellt **Neu erstellen** einen gemeinsamen
Folgetisch mit derselben Platzanzahl, Computerzahl, Spielart und Schutzoption.
Die bisherigen Menschen erhalten eine persönliche Einladung und wechseln erst
nach ausdrücklichem Annehmen in den Wartebereich. Plätze bleiben 15 Minuten
reserviert. Ein wartender Hausdepp-Tisch schliesst nach einer Stunde ohne neuen
menschlichen Sitz; Zuschauen, Wiederverbinden und Chat verlängern diese Frist
nicht. Abgeschlossene Turnierrunden behalten ihre Wertung. Die Lobby wartet vor
dem Zeichnen der Karten auf dekodierte Motive und wiederholt vorübergehend
fehlgeschlagene Bildabrufe. Öffentliche Kartenbilder verwenden beim PWA-Neuladen
den normalen Browsercache; private Spiel- und Kontodaten bleiben online.
In allen drei Spielen reagieren die Tourknöpfe in den Kontoeinstellungen auch
auf einen unmittelbaren Klick, während die gespeicherten Einstellungen noch laden.

**English:** **Select multiple cards** lets you mark matching hand cards and play
them together as one move; a normal tap still plays immediately. Computers take
about 12.5% longer within their varied normal timing. After a completed or
aborted game, **Create again** makes one shared follow-up table with the same
seat count, computer count, format and protection option. Previous human players
receive personal invitations and enter the waiting room only after explicitly
accepting. Seats are reserved for 15 minutes. A waiting Hausdepp table closes
after one hour without a new human seat; spectators, reconnections and chat do
not extend this deadline. Completed tournament rounds keep their scores. The
lobby waits for decoded artwork before drawing cards and retries temporary
image failures. Public card images use the ordinary browser cache on PWA
reload; private game and account data remain online-only. In all three games,
the tour buttons in account settings respond even to an immediate click while
saved preferences are still loading.

**Deutsch:** Der mobile Hausdepp-Tisch bleibt im Hoch- und Querformat in einem
festen Spielfenster. Gegner, grössere Kartenstapel, Zugstatus, eigene Hand und
Reaktionen bleiben erreichbar; grosse Hände scrollen nur innerhalb des Fächers.
Spielhilfe, Einladungen und Chat öffnen sich als begrenzte Ablagen. Ein wartender
Sitz lässt sich aktiv verlassen: Der Tisch bleibt für andere Menschen erhalten,
das Hostrecht wandert weiter. Ohne Menschen wird er ohne Ergebnis oder EP geschlossen.
Die Rangliste zeigt neben Siegen den aktuellen, aus denselben gewichteten Punkten
wie im Konto abgeleiteten Hausdepp-Rang. Der Erfolgsfeed nennt nur Kontoname,
Erfolg und Zeitpunkt; Runden, Karten und Fortschritt anderer bleiben privat.

Computer nutzen sichere Abräum- und Schlussketten, sparen weitere 10er und wägen
Zocken gegen Aufnehmen ab. Ihr Tempo schwankt; nach einer Denkpause prüfen sie
den aktuellen Zustand erneut. Sie kennen keine fremden Hände oder verdeckte
Stapelreihenfolge. Der [reproduzierbare CPU-Vergleich](docs/HAUSDEPP_CPUS.md)
dokumentiert Stärken, Grenzen und Prüfungen. Hausdepp hat eigene Anmelde- und
Kontoeinstellungsseiten unter `/hausdepp/anmelden` und
`/hausdepp/konto/einstellungen`: Passkey zuerst, gemeinsame Konten und
Sicherheitsprüfungen, sichere Rückwege auch für E-Mail-Aktionen. Die vorhandenen
Einsteigertouren lassen sich auch dort verwalten. Im gemeinsamen Lobby-Chat stehen
Hausdepp-Tag und Schnellfilter in allen drei Spielen bereit.

Öffentliche Kartenbilder werden vor dem Tisch dekodiert und unter versionierten
URLs im Browser zwischengespeichert. Private Hände, Spielstände und Kontoinhalte
bleiben ungespeichert. Die PWA nutzt eindeutige Herz-Zehner-Icon-URLs, explizite
180-Pixel-Apple-Icons und die üblichen öffentlichen Apple-Fallbackpfade. Ein
Browser- oder Manifesttest ersetzt keine Abnahme des iPhone-Startbildschirmdialogs.

**English:** Hausdepp stays within a fixed mobile game window in portrait and
landscape. Opponents, larger piles, turn status, your hand and reactions remain
reachable; large hands scroll only inside their fan. Help, invitations and chat
open as bounded panels. Release a waiting seat with Leave table: other people
keep the table, with host rights transferred. The last person closes it without
scoring a result or XP. Standings include each player's current Hausdepp title,
derived from the same weighted ledger as the account without revealing unlock details.

Computers use safe clearances and finishing chains, retain extra tens and weigh
gambling against pickup. Timing varies; decisions are checked against current
state after each pause. They never know opposing hands or stock order. The
[reproducible CPU comparison](docs/HAUSDEPP_CPUS.md) records strengths, limits
and checks. Dedicated sign-in and settings at `/hausdepp/anmelden` and
`/hausdepp/konto/einstellungen` use passkeys first, shared accounts and security,
and safe return paths for email actions. Existing beginner tours can also be
managed there. All three lobbies offer a Hausdepp chat tag and quick filter.

Public card artwork is decoded before the table opens and cached at versioned
browser URLs. Private hands, game state and account content are never stored
for offline use. The PWA uses fresh heart-ten icon URLs, explicit 180-pixel
Apple icons and standard public Apple fallback paths. Browser and manifest
checks cannot replace acceptance of the iPhone Home Screen dialog.

**Deutsch:** Das offene Paket lässt sich vor dem Nehmen mit langem Druck,
Rechtsklick oder Umschalt+Enter auffächern; eine beschriftete Aktion steht auch
in der Spielhilfe. Ein normaler Tipp nimmt weiterhin sofort. Ausgeschiedene
Karten landen auf einem eigenen, mit „Aus dem Spiel“ beschrifteten Stapel.
Zocken, Paket und Aus dem Spiel zeigen Titel und Anzahl auf gleicher Höhe; ein
Hinweis am Paket erklärt Antippen und Halten. Beim Abheben gesehene Karten
liegen als kleiner Fächer links neben dem Stapel. Am Computer stehen
„Mehrere Karten auswählen“ und „n Karten legen“ direkt unter der Hand,
„Spielhilfe und Einladen“ sitzt in der Seitenleiste.
Tischgegenstände behalten ihren Platz, auch wenn die eigene Hand darüberwächst.
Jeder Gegenstand reagiert beim Antippen auf eigene Art (Kronkorken drehen sich,
Pralinen rollen, Snacks hüpfen und krümeln, Getränke kräuseln sich) und lässt
sich mit Maus oder Finger ein Stück über den Tisch schieben; auf Karten, Stapeln
oder Knöpfen bleibt er nie liegen. Seltene automatische Gesten und alle Klickeffekte respektieren
reduzierte Bewegung und beeinflussen keinen Spielzug.

**English:** Inspect the open pile before picking it up with a long press,
right-click or Shift+Enter; a labelled action is also available in table help.
A normal tap still picks it up immediately. Cleared cards land on a separate
pile labelled “Out of play”. Stock, pile and out-of-play cards show title and count at one
height, and a hint on the pile explains tap and hold. Cards seen while lifting
the deck lie as a small fan left of the stock. On computers, “Select multiple
cards” and “Play n cards” sit right below the hand and help and invitations
live in the sidebar. Table props keep their positions as your hand grows
over them. Every object reacts to a tap in its own way (caps spin, chocolates
roll, snacks hop and drop crumbs, drinks ripple) and can be pushed a little with
mouse or finger; it never comes to rest on cards, piles or buttons. Rare automatic gestures and all tap effects respect reduced motion and never
perform a game action.

## The games

**Hausdepp – Runde eröffnen:** Der kompakte Einstieg bietet deinen gespeicherten
Favoriten oder „Modus definieren“. Wähle eine feste Spielerzahl (2–6) oder einen
offenen Warteraum bis sechs, Schnellspiel oder Turnier und optional ein Passwort.
Im Warteraum zeigen Platzkarten die Besetzung. Der Gastgeber fügt CPUs einzeln
hinzu, entfernt sie und startet selbst; offene Runden sind ab zwei Teilnehmern
startbereit. Menschen nehmen freie Plätze und ersetzen bei einem vollen
Wartetisch einen CPU. Die aktuelle Besetzung lässt sich kontoweit als Favorit
speichern; für geschützte Favoriten wird das Passwort jedes Mal neu festgelegt.
Mitspieler-Ruf, Teilen und Link-Kopieren bleiben verfügbar. Vier persönliche
häufige Reaktionen stehen direkt bereit; der Pfeil öffnet zwölf Symbole,
einschliesslich 💩. Ihre Positionen bleiben während der Partie gleich.

**Hausdepp – creating a game:** The compact entry offers your saved favourite or
“Define a mode”. Choose a fixed count (2–6) or an open waiting room for up to six,
a quick game or tournament, and an optional password. Place cards show the
roster. The host adds and removes CPUs one at a time and starts explicitly;
open rooms are ready with two participants. People take free seats first and
replace a CPU when the waiting table is full. Save the current setup as an
account-wide favourite; password-protected favourites ask for a fresh password.
Player calls, sharing and copying remain available. Four personal frequent
reactions stay visible; the arrow opens twelve choices, including 💩. Positions
stay stable throughout the game. Personal reaction frequency stays in this
browser and is separate for each account.


**Hausdepp – Gestaltung:** Holz und die originalen Tellkarten bleiben der
Mittelpunkt. Tannengrün, Kartenrot und kräftige Serifentitel geben dem Spiel eine
eigene Gestaltung; Navigation und wichtige Wege erscheinen als Buttons. Gegner
sitzen im Halbkreis, Profilbilder und Reaktionen bleiben am jeweiligen Spieler
erkennbar. 50 urige Männer- und Frauennamen werden Computern ohne doppelte Namen
im Tisch zugeteilt; im laufenden Turnier bleiben die Namen stabil. Grössere
Bildschirme erhalten wechselnde, rein dekorative Tischgegenstände aus zwölf
grossen Varianten und zehn kleinen Streuteilen wie Kronkorken, Pralinen,
Bierdeckel mit Strichliste oder Bleistift; auch auf dem Handy liegen einige
davon auf freiem Holz. Dampf, Schaum und Kerzenlicht
bewegen sich geringfügig und berücksichtigen reduzierte Bewegung. Die kompakte
Lobby-Hand rechts neben dem Titel zeigt ruhige lokale Kartenwechsel.
Auf Mobilgeräten bilden grössere offene und verdeckte Stapel die Tischmitte.
Ihre Breite passt sich Hoch- und Querformat an; auch mit sechs Spielern bleiben
Karten, Sitze und Hinweise getrennt und beide Stapel direkt antippbar.

**Hausdepp – appearance:** Walnut and the original Tell cards remain central.
Forest green, card red, strong serif headings and button-shaped navigation give
the game its own identity. Opponents form a semicircle; avatars and reactions
identify their players. Computers draw unique names from a pool of 50 male and
female names, stable during tournaments. Twelve large props and ten small scatter
pieces (bottle caps, chocolates, a beer mat with tally marks, a pencil and more)
use free table space, phones included, with minimal steam, foam and candle motion and
reduced-motion support. A compact right-of-title lobby hand changes cards calmly.
Larger face-up and face-down piles give the centre of the table more room on
mobile. Their width adapts to portrait and landscape; even with six players,
cards, seats and captions remain separate and both piles can be tapped directly.

**Hausdepp – Tischspielereien (3.11):** Getränke werden mit jedem Schluck sichtbar
leerer. Schnelles Tippen verschüttet den Rest, noch mehr Tippen kippt das Glas;
ein karierter Putzlumpen wartet darauf, dass du die Pfütze selbst wegwischst
(per Ziehen oder mehreren Tipps). Leere Gläser lassen sich wieder
aufstellen und nachfüllen. Nüsse, Marend und andere Snacks verschwinden in
einzelnen Portionen; leere Schalen und Bretter bleiben liegen. Der Bierdeckel
zählt Striche in Fünfergruppen und wird nach zwanzig umgedreht; der Bleistift
schreibt mit, wenn ein Deckel daliegt. Verschobene Gläser hinterlassen kurz
Kondensringe. Die Bierdose öffnet sich mit Schaum und platzt bei heftigem
Hin-und-her-Schütteln; auch diese kleine Stelle lässt sich wegwischen.
Das Windlicht geht beim Schütteln aus und zündet sich selbst wieder an.
Seit 3.18 teilen alle am Tisch Verbrauch, Nutzungszustände und Zufallsergebnisse;
Platzierung und Ziehbewegungen bleiben passend zum jeweiligen Display lokal.
Die Deko bleibt leise und ausserhalb der Karten und Aktionen. Reduzierte Bewegung
deaktiviert die Bedienung und Animationen, zeigt aber den gemeinsamen Endzustand.
Ungefähr jede 50. Runde bietet zusätzlich
einen von acht seltenen Funden: Stern, Runenhammer, UFO, Portal, Drache, Kraken,
Taschenuhr oder schwarzes Loch. Ein Tipp löst einmalig eine
opulente Überraschung für den ganzen Tisch aus: Karten und Gegenstände wirbeln,
werden optisch entführt und kehren zurück. Die magische Maus holt die Taschenuhr
ab, das schwarze Loch schluckt sogar den Holztisch. Der Drache hinterlässt für
den Rest des Tisches angesengte Kartenränder. Kartenwerte und Züge bleiben korrekt. Nur der eigene Hammer kann auf
unterstützten Geräten kurz vibrieren. Nach 42 geschriebenen Bierdeckelstrichen
gibt es eine kleine Antwort auf alles. Nach der Runde bleibt die Punkteübersicht
ohne zusätzlichen Quittierungsbutton sichtbar. Das kompakte Ergebnisblatt nennt
die Tischbesetzung, Platzierungen und nur die EP und Erfolge dieser Runde.
Rundengutschrift und Erfolgs-EP werden aufgeschlüsselt; der eigene aktuelle Rang,
Gesamt-EP und Abstand zum nächsten Rang geben dem Fortschritt einen Kontext.
Allgemeine Glückwünsche und Wiederholungs-Erklärungen entfallen.
Der Endstand erscheint erst,
wenn die letzte Karte liegt und weitere 750 ms verstrichen sind. Turnierbuchstaben
stehen am Gegnerplatz in einer eigenen Zeile, auch bei sechs Spielern. Das erste
vollständige HAUSDEPP beendet das Turnier; Endstand, Tischkopf und Lobby zeigen
das ausdrücklich an.

**Hausdepp – table play (3.11):** Drinks visibly empty sip by sip. Rapid taps spill
the rest, further taps topple the glass, and a checked cloth lets you wipe the
puddle yourself by dragging or repeated taps.
Empty glasses can be stood up and topped up. Nuts, the snack board and other
food disappear in individual portions, leaving their bowls and boards behind.
The beer mat counts tally marks in groups of five and flips after twenty; the
pencil adds a mark if a mat is present. Moving a glass leaves a brief condensation
ring. Repeated taps open the beer can with foam; vigorous back-and-forth shaking
bursts it and leaves another small spot to wipe up. Shaking the lantern puts it
out before it relights itself. Since 3.18, consumption, usage state and random
results are shared by everyone at the table; placement and dragging remain local
to each display. Props stay quiet and keep cards and controls clear. Reduced
motion disables interaction and animation while showing the shared end state.
About one round
in 50 also offers one of eight rare finds: star, rune hammer, UFO, portal, dragon,
kraken, pocket watch or black hole. One tap triggers a brief
lavish scene for the whole table, once per round. Cards and objects scatter,
are visually abducted and return. A magical mouse retrieves the watch; the
black hole even swallows the wooden table. The dragon leaves singed card edges
for the rest of the table session. Card values and turns remain correct. Only the local hammer may briefly
vibrate on supported devices. Forty-two beer-mat strokes reveal a small answer
to everything. After a round, the points
summary stays visible without an extra acknowledgement button. The compact
result sheet shows the table composition, finishing order and only this round’s
XP and achievements. Longer status labels stay separate from avatars and player
names on small screens. Round credit and achievement XP are broken down; your current
rank, total XP and distance to the next rank put progress in context. Generic
congratulations and rematch explanations are omitted. The final result
waits until the last card lands, then another 750 ms. Tournament letters have
their own line at each opponent seat, including six-player tables. The first
complete HAUSDEPP ends the tournament; the final result, table heading and lobby
explicitly show that it is complete.

Hausdepp lässt sich mit eigenem Icon direkt als PWA installieren. Spielwechsel
behalten die Identität der installierten App. Private Karten, Ergebnisse und
Kontoinhalte werden nicht offline gespeichert; offline ist eine Verbindung
erforderlich. / Hausdepp installs as its own PWA with dedicated icons. Suite
switching preserves the installed app identity. Private cards, outcomes and
account data are never cached offline; play requires a connection.

**Hausdepp – Mitspieler-Ruf:** Wartende, ungeschützte Tische mit einem freien
menschlichen Platz oder ersetzbaren CPU verwenden dieselben Push-Einstellungen wie ZDWA und Zilch.
Gerätefreigabe und die Kategorie „Mitspieler-Rufe“ müssen aktiv sein; die
private Absenderauswahl gilt weiterhin. Nur aktuell für Hausdepp freigegebene
Konten können senden oder empfangen. Eine Systembenachrichtigung trägt das
Hausdepp-Icon und öffnet den Tisch auf demselben Ursprung. Die Geräteanmeldung
ist direkt in den Hausdepp-Kontoeinstellungen erreichbar; eine eigene tägliche
Hausdepp-Erinnerung wird dadurch nicht aktiviert. Teilen und Kopieren des
Tischlinks sind getrennte, ausdrücklich ausgelöste Aktionen.

**Hausdepp – player calls:** Waiting, unprotected tables with an open human
seat use the same push settings as ZDWA and Zilch. Device permission and the
player-call category must both be enabled; the private sender allowlist still
applies. Sending and receiving require current Hausdepp access. The system
notification uses Hausdepp's icon and opens the table on the same origin.
Devices are registered in Hausdepp’s settings for the shared account; this does not enable a
separate daily Hausdepp reminder. Sharing and copying a table link remain
separate, explicitly triggered actions.

Die gemeinsame Spieleauswahl zeigt in DE/EN, wie viele verbundene Menschen an
laufenden Tischen spielen. Computer und Zuschauer zählen nicht; Konten zählen
pro Spiel einmal. Berechtigungen werden frisch geprüft, private Spiele bleiben
verborgen. / The shared picker shows current connected humans in running games,
excluding computers and spectators, deduplicated per account and game. Fresh
access checks keep private games hidden.

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

ZDWA offers three independent convenience settings, enabled by default for new
and existing accounts under **Account → Settings**: skip the zero-point prompt
when only one legal field is available, automatically hold dice matching a number
announcement (1–6) immediately and after later rolls, and turn the announcement
button into **Write** from the second roll. Automatically held dice remain deselectable;
cancel or change the announcement to release them, keeping prior manual holds.
After a roll, the green hold marker appears only once the dice animation finishes.
Correction mode retains zero-point confirmation. Guests use the enabled defaults.
Offline play offers the same three switches before starting, saved only in that browser.

**Deutsch:** Drei unabhängige Komforteinstellungen sind für neue und bestehende
Konten unter **Konto → Einstellungen** standardmässig aktiv: ohne Rückfrage
streichen, wenn nur ein regelkonform auswählbares Feld bleibt, passende Würfel
bei Zahlenansagen von 1 bis 6 sofort und nach weiteren Würfen automatisch halten und den
Ansage-Button ab Wurf 2 zu **Schreiben** ändern. Gehaltene Würfel bleiben
abwählbar; beim Aufheben oder Ändern der Ansage werden automatische Haltepunkte
gelöst und vorherige manuelle Haltepunkte bleiben erhalten. Bei Korrekturen
erscheint die Streich-Bestätigung weiterhin. Nach einem Wurf erscheint die grüne
Haltemarkierung erst, wenn die Würfelanimation beendet ist. Gäste nutzen
die aktiven Vorgaben. Offline sind die drei Schalter vor dem Start verfügbar
und werden nur in diesem Browser gespeichert.

**Deutsch – Dialoge und Spielende:** Auf Mobilgeräten haben die Dialogbuttons
zusätzlichen Abstand zur unteren Geräte-Sicherheitszone. In ZDWA und Zilch werden
am Spielende Erfolge im Hintergrund geprüft. Neue Erfolge, Rangaufstiege und das
Ergebnis erscheinen ohne kurz aufblinkenden Prüfdialog.

**English – Dialogs and game completion:** On mobile, dialog buttons have extra
space above the device's bottom safe area. In ZDWA and Zilch, achievements are
checked in the background at game completion. New achievements, rank-ups and the
result appear without a briefly flashing progress dialog.

## Contents

- [Quick start](#quick-start)
- [Playing together](#playing-together)
- [Accounts and progress](#accounts-and-progress)
- [Lobby chat](#lobby-chat)
- [Push notifications](#push-notifications)
- [Release notes and feedback](#release-notes-and-feedback)
- [Mission Control](#mission-control)
- [Progressive Web Apps](#progressive-web-apps)
- [Local development](#local-development)
- [Architecture](#architecture)
- [Data and deployment](#data-and-deployment)
- [Documentation](#documentation)
- [Product delivery gate](#product-delivery-gate)

## Mission Control

**Hausdepp:** Der gebundene Owner erhält einen eigenen Filter und eine Übersicht
über echte Runden, bekannte Spieldauer, aktive Tische, Menschen, Computer und
Turnierstände. Abbrüche werden ab dieser Messung erfasst. Historische fehlende
Dauer- und Browserdaten werden nicht erfunden. Andere Dashboard-Berechtigte
erhalten weder den Filter noch Hausdepp-Zahlen, auch nicht in „Alle“.

**Hausdepp:** The bound owner gets a dedicated filter and real round, known
duration, table, human/computer-seat and tournament metrics. Abort measurement
starts with this increment; missing historical duration/browser data stays
unknown. Other dashboard viewers receive neither the filter nor Hausdepp
figures, including in All.

The private dashboard at `/admin/dashboard` brings traffic, active page time,
fixed click actions, game modes, completed games and server capacity together.
The visual analysis console includes a rotating globe and world map with
country details, interactive traffic charts, a UTC activity heatmap, page
engagement and observed page journeys. Animation can be paused and respects
reduced motion. Country markers represent country-level aggregates, not
individual visitors or exact locations.
Choose **Mission Control**, **LCARS** or the new **NEXUS** with the dashboard's
own design switcher. Mission Control remains the default, and you can switch
back at any time. The choice is saved locally in this browser, independently
of game appearance preferences. All three designs offer the same charts,
analysis and access controls.
NEXUS presents prominent KPIs with their measurement context in a dark command
console, with layouts tailored to phones, tablets and desktops. Star metrics
or analysis panels to move them into the reserved **Favorites** area at the
top; removing the star returns them to their original section. These are the
live panels, so filters, refreshes and chart interactions still work. Favorites
are saved separately for each dashboard viewer in this browser, using only
stable panel identifiers rather than copies of metric values.
Device analysis groups anonymous tab visits by broad device class, operating
system and device family, such as iPad, iPhone, Android or Fire tablet, Mac
and Windows PC. Recognition is approximate. Older and unrecognized visits
remain unknown. Analytics payloads contain no raw user agents, OS versions,
exact models or device identifiers.
Three further panels compare PWA launches with browser visits, browser families
and the first preferred browser language. They count anonymous tab visits,
not people or installations. Languages such as `de-CH` are grouped as German,
independently of the language selected in the game. Chrome and indistinguishable
Chromium browsers share a group; recognition is approximate. Measurement starts
with 2.46.0 and older visits remain unknown.
Two separate PWA counters cover the selected UTC period: browser-confirmed
installations (`appinstalled`, unavailable in Safari/iOS) and first detected
standalone launches, including iOS. The launch estimate uses a local flag,
includes existing apps on their first launch after measurement starts, and
counts again if storage is cleared; unavailable storage skips this estimate.
The counters must not be added together and are not a complete installation
total. Attribution follows each PWA's manifest, even when it displays the other
game. Collection respects Do Not Track/Global Privacy Control and remains best
effort with the existing 90-day/200,000-event retention; no device ID is added.
A separate country breakdown counts HTTP requests reaching the application,
including bots, assets and APIs. It aggregates country and response status
without network or account identifiers. This is sitewide traffic, independent
of the game filter; Cloudflare cache hits and edge-blocked requests are outside
the count. Health checks and dashboard statistics polling are excluded.
Declared bot families and recognizable API clients are shown as unverified
self-declarations; automation can mimic a browser. The targeted Cloudflare
authentication burst rule is documented in [Cloudflare protection](docs/CLOUDFLARE_PROTECTION.md).
The same runbook records the active, host-scoped scan block rule and its
profile-name exceptions. The origin firewall now accepts web traffic only
from official Cloudflare networks; SSH remains unchanged. The trusted proxy
contract for 2.49.1 and the Real-IP activation checks are documented
separately there.
The **Design usage** section shows which look players spend their time with:
visible, active seconds for ZDWA in the 2026 design (light, dark, Classic) and
the previous design (light, dark, Classic), and for Zilch with the tavern table
or LCARS. It compares new against previous as shares, splits time at the game
table from other pages and follows the period and game filters; exact seconds
appear on hover and in the table. It also counts active accounts that keep the
new or the previous ZDWA design, marks how many of them never saw the
question (the default), and shows separately how accounts from before the
update answered the one-time question. While `ROLLTHEDICE_ZDWA_DESIGN` is
`owner` or `off`, a note says that the stored choice does not apply yet. Only
daily totals per look and area are stored, without visit, account or device
relation, for 400 days.
Open **Mission Control** from your account or administration. Only the founder
can grant or revoke individual **Dashboard access** in user administration;
admin and owner roles do not grant access automatically. Revocation applies to
the next page or API request, including sessions already signed in.

**Deutsch:** Mission Control zeigt Zugriffe, aktive Seitenzeit, Klick-Aktionen,
Spielmodi, abgeschlossene Spiele und den Serverzustand. Du öffnest es im Konto
oder in der Administration. Nur der Gründer darf einzelnen Konten in der
Nutzerverwaltung Dashboard-Zugriff erlauben oder entziehen. Admins und Owner
bekommen diesen Zugang nicht automatisch.

**Deutsch:** Der Bereich **Design-Nutzung** zeigt, mit welchem Erscheinungsbild
gespielt wird: sichtbare, aktive Sekunden für ZDWA im Design 2026 (Hell,
Dunkel, Classic) und im bisherigen Design (Hell, Dunkel, Classic) sowie für Zilch
mit Wirtshaustisch oder LCARS. Er vergleicht neu und bisher als Anteile, trennt
die Zeit am Spieltisch von übrigen Seiten und folgt Zeitraum und Spielfilter;
exakte Sekunden erscheinen beim Überfahren und in der Tabelle. Dazu kommt die
Zahl aktiver Konten mit neuem oder bisherigem ZDWA-Design, davon wie viele die
Frage nie gesehen haben (Standard), und getrennt, wie Konten von vor dem Update
auf die einmalige Frage geantwortet haben. Steht `ROLLTHEDICE_ZDWA_DESIGN` auf
`owner` oder `off`, weist ein Hinweis darauf hin, dass die gespeicherte Wahl
noch nicht greift. Gespeichert werden nur Tagessummen je Design und Bereich,
ohne Bezug zu Besuch, Konto oder Gerät, für 400 Tage.

**Deutsch:** Globus und Weltkarte machen die Herkunft sichtbar. Interaktive
Verlaufsgrafiken, UTC-Aktivitätsraster, Seitenzeit und beobachtete Seitenwege
helfen beim Vertiefen. Länderpunkte zeigen zusammengefasste Messwerte, keine
einzelnen Personen oder genauen Aufenthaltsorte. Animation lässt sich
pausieren und berücksichtigt reduzierte Bewegung.
Der eigene Designwechsel bietet **Mission Control**, **LCARS** und das neue
**NEXUS**. Mission Control bleibt der Standard; ein Rückwechsel ist jederzeit
möglich. Die Wahl wird lokal in diesem Browser gespeichert und verändert die
Darstellung der Spiele nicht. Alle drei Designs bieten dieselben Diagramme,
Analysen und Zugriffsregeln.
NEXUS stellt wichtige Kennzahlen samt Messkontext in einer dunklen
Kommandozentrale in den Vordergrund, mit eigenen Anordnungen für Handy, Tablet
und Desktop. Kennzahlen und Analysebereiche lassen sich mit einem Stern in den
reservierten **Favoritenbereich** oben verschieben; ohne Stern kehren sie an
ihren bisherigen Platz zurück. Es bleiben die aktuellen Bereiche mit
funktionierenden Filtern, Aktualisierungen und interaktiven Diagrammen.
Favoriten werden je Dashboard-Nutzer in diesem Browser gespeichert, nur als
stabile Bereichskennungen und ohne Kopien der Messwerte.
Die Geräteanalyse ordnet anonyme Tab-Besuche nach Geräteklasse,
Betriebssystem und Gerätefamilie ein, etwa iPad, iPhone, Android- oder
Fire-Tablet, Mac und Windows-PC. Die Erkennung ist näherungsweise. Ältere und
nicht erkannte Besuche bleiben unbekannt. Die Analytics-Nutzdaten enthalten
keine Browser-Rohdaten, Versionsnummern, genauen Modelle oder Gerätekennungen.
Drei weitere Karten zeigen PWA-Starts gegenüber Browser-Besuchen,
Browserfamilien und die erste bevorzugte Browsersprache. Gezählt werden anonyme
Tab-Besuche, keine Personen oder Installationen. `de-CH` zählt beispielsweise
als Deutsch, unabhängig von der im Spiel gewählten Sprache. Chrome und nicht
unterscheidbare Chromium-Browser teilen eine Gruppe; die Erkennung ist
näherungsweise. Die Messung beginnt mit 2.46.0, ältere Besuche bleiben unbekannt.
Zwei getrennte PWA-Zähler gelten für den gewählten UTC-Zeitraum: vom Browser
bestätigte Installationen (`appinstalled`, nicht in Safari/iOS verfügbar) und
erstmals erkannte Starts im Appfenster, auch auf iOS. Die Startschätzung nutzt
eine lokale Markierung, enthält bestehende Apps beim ersten Start nach
Messbeginn und zählt nach gelöschtem Speicher erneut; ohne verfügbaren Speicher
entfällt sie. Beide Werte werden nicht addiert und sind keine vollständige
Installationszahl. Die Zuordnung folgt dem PWA-Manifest auch beim Spielwechsel.
Do Not Track/Global Privacy Control und die bestehende Aufbewahrung von maximal
90 Tagen/200.000 Ereignissen gelten weiterhin; es entsteht keine Geräte-ID.
Eine eigene Länder-Auswertung zählt HTTP-Requests, die die Anwendung erreichen,
einschließlich Bots, Dateien und API-Aufrufen. Zusammengefasst werden Land und
Antwortstatus ohne Netzwerk- oder Kontokennungen. Gezählt wird unabhängig vom
Spielfilter die ganze Anwendung; Cloudflare-Cachetreffer und bereits am Edge
blockierte Requests sind nicht enthalten. Healthchecks und Dashboard-
Statistikabrufe werden ausgeschlossen.
Gemeldete Botfamilien und erkennbare API-Clients erscheinen als unbestätigte
Selbstangabe; Automatisierung kann Browser vortäuschen. Der gezielte Cloudflare-
Burstschutz für Anmelde-APIs steht im [Schutz-Runbook](docs/CLOUDFLARE_PROTECTION.md).
Das Runbook dokumentiert auch die aktive Scanpfad-Sperre auf den Produkt-Hosts
mit Profilnamen-Ausnahmen. Die Origin-Firewall lässt Webzugriffe jetzt nur aus
offiziellen Cloudflare-Netzen zu; SSH bleibt unverändert. Der Proxy-Vertrag ab
2.49.1 und die Real-IP-Aktivierungsprüfungen stehen dort
getrennt.

Visitor measurement starts with version 2.43.0; completed game history uses
existing server records. Sessions are anonymous tab visits, not unique people.
Only visible, recently active time counts. Tracking respects Do Not Track and
Global Privacy Control, uses no analytics cookies, and stores no names, emails,
chat content, raw IP addresses or private URL parameters. Events expire after
90 days; a 200,000-event limit can shorten history under high traffic.
Anonymous daily design usage totals (seconds per look and area) stay for 400
days. Filters
use UTC calendar days. Local offline games stay local and are not measured. Referrer sources
are hostnames only; countries come from trusted Cloudflare edge metadata, with
unavailable locations shown as unknown. Blocking tracking can reduce counts.

**Deutsch:** Besuchermessung beginnt mit Version 2.43.0. Bestehende
Spielergebnisse bleiben als eigene Datenquelle erkennbar. Sitzungen zählen
anonyme Tab-Besuche, keine eindeutigen Personen. Gemessen wird nur sichtbare,
zuletzt aktive Zeit. Keine Analytics-Cookies, Namen, E-Mails, Chat-Inhalte,
gespeicherten IP-Adressen oder privaten URL-Parameter. Do Not Track und Global
Privacy Control werden respektiert; Ereignisse werden nach 90 Tagen entfernt,
anonyme Tagessummen der Design-Nutzung (Sekunden je Design und Bereich) nach
400 Tagen.
Offline-Partien bleiben lokal. Herkunft zeigt die verweisende Domain und,
sofern verfügbar, das Land aus vertrauenswürdigen Cloudflare-Metadaten.

The dashboard runs inside the existing application and SQLite database,
without another service or subdomain. Compose mounts four host `/proc` counter
files read-only for CPU, memory and uptime. Disk capacity is the filesystem containing
the data directory. Host and application uptime are shown separately; missing
counters are unavailable rather than simulated. See
[the dashboard runbook](docs/ANALYTICS.md) for operation and rollback.

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

## Spiele auswählen / Choosing a game

**Deutsch:** Die gemeinsame Spielauswahl zeigt die freigeschalteten Spiele mit
eigenem Symbol und Namen. Der Einstieg nennt das aktuelle Spiel; die Auswahl
markiert es zusätzlich. Ein Tipp oder `Alt+Shift+Z` öffnet die Auswahl, ein
weiterer Tipp auf ein Spiel dessen Lobby. Escape schliesst sie. Auf dem Handy
öffnet sie sich als gut erreichbares Auswahlfenster am unteren Rand.
Hausdepp ist als drittes Spiel für alle sichtbar; Mitspielen erfordert eine
Anmeldung. Normale Browser öffnen den eigenen Hausdepp-Host, installierte Apps
behalten beim Wechsel ihren Ursprung und Service Worker.

**English:** The shared game picker shows available games with their own icon
and name. Its trigger names the current game, which is also marked inside the
picker. Tap or press `Alt+Shift+Z` to open it, then choose a game's lobby.
Escape closes the picker. On phones it opens as a reachable bottom sheet.
Hausdepp is visible as the third game to everyone; playing requires sign-in.
Regular browsers use its dedicated host, while installed apps retain their
origin and service worker when switching.

The [integration matrix](docs/GAME_SWITCHER.md) documents browser and installed
app destinations, account settings and access boundaries.

Der öffentliche kanonische Einstieg ist
**https://hausdepp.zockdiewandan.online/hausdepp**; `/` auf diesem Host leitet
dorthin weiter. Nur Lobby und Regeln stehen im Hausdepp-Sitemap. Konto,
Rangliste, Spieltische und APIs bleiben `noindex` beziehungsweise geschützt.
Strukturierte Daten beschreiben das kostenlose Kartenspiel mit 36 Karten und
zwei bis sechs Teilnehmern ohne Solomodus und verbinden die drei Spiele als
Suite. Die zweisprachigen Seiten teilen jeweils eine kanonische URL; es werden
keine zusätzlichen Sprachseiten oder Bewertungen vorgetäuscht.
Die unveränderte historische [SEO/GEO-Prüfung](docs/SEO_GEO_2026-10-16.md)
beschreibt den damaligen privaten Entwicklungsstand.

The canonical public entry is
**https://hausdepp.zockdiewandan.online/hausdepp**; that host's `/` redirects
there. Its sitemap includes only the lobby and rules. Account, standings,
game rooms and APIs remain noindex or protected. The unchanged historical
[SEO/GEO report](docs/SEO_GEO_2026-10-16.md) describes the preceding private stage.
Structured data describes the free 36-card game for two to six participants,
without solo play, and connects the three games as a suite. Each bilingual page
has one canonical URL, without invented language pages or ratings.

## Playing together

- Create a table quickly, or add an optional room code.
- Share an invitation link without exposing room codes or resume credentials.
- Rejoin your seat after a disconnect; active games also survive server restarts.
- Chat and send quick reactions in the game room. An open chat keeps its draft
  while live messages, game updates, or a reconnect arrive.
- Watch eligible multiplayer tables in a read-only spectator view.
- Opponents and spectators see each accepted roll animate; held dice stay still.
  In normal ZDWA multiplayer games, a compact eraser beside **Roll** corrects
  your previous entry until the next player rolls. **Announce** uses the same
  space after the first roll, so correction no longer needs an extra row.
- Leave a game through **Pause**, **Return to Lobby**, or **Stay in Game**.
  Pausing preserves the table until its displayed deadline. Returning to the
  lobby ends the room for everyone without creating a completed result. A
  started table ended this way counts only for the signed-in account that
  actively ends it. Timeouts and disconnects do not count. ZDWA Fairplay
  reminders award zero rank points; scores and completed-game totals remain
  unchanged.
- Choose games from lobbies and app pages. Existing dice-game live tables retain
  their own leave flow before returning to the lobby's game picker.

Waiting, running and paused rooms expire after one hour without a
server-accepted room action. They are then aborted without a completed result.

Both lobbies group resumable, running and waiting tables in one compact games
section. Player names, ranks and progress appear together without repeating
the same identity. ZDWA’s online count, completed games and Normal/Hardcore
averages with trends appear under Players & Ranking. New-game forms take
less space, and ZDWA's Wall of Shame keeps both periods in a compact view.

**Deutsch:** Beide Lobbys bündeln fortsetzbare, laufende und wartende Partien
in einem kompakten Spielbereich. Name, Rang und Fortschritt stehen zusammen,
ohne dieselbe Person mehrfach aufzuführen. ZDWAs Onlinezahl, beendete Partien
und Normal-/Hardcore-Durchschnitte samt Trends stehen unter Spieler & Ranking.
Neue Spiele brauchen weniger Platz und ZDWAs Wall of Shame zeigt beide
Zeiträume kompakter.

**Deutsch:** Melde dich nach einem Gerätewechsel mit demselben Konto an, um
deinen vorhandenen Platz in ZDWA oder Zilch wieder aufzunehmen. Bei öffentlichen
ZDWA-Partien führt dich auch der geteilte Spiellink zurück auf deinen Platz,
ohne einen zweiten Spieler anzulegen. Bei passwortgeschützten ZDWA-Partien
nutzt du **Wieder aufnehmen** in der Lobby mit dem Spielpasswort.
Ein noch offener Spieltab auf dem vorherigen Gerät zeigt in beiden Spielen die
Übernahme an und verbindet sich nicht automatisch wieder als Spieler.
Bereits wartende Spielbefehle dieser vorigen Verbindung werden verworfen;
vor der Übernahme angenommene Abschlüsse werden weiterhin zugestellt.
In der ZDWA-Lobby bietet deine wartende Partie bereits
**Wieder aufnehmen**; Warteräume lassen sich auch über **Zuschauen** öffnen,
bei geschützten Spielen mit Passwort. Das gilt, solange die Partie noch nicht
beendet oder abgelaufen ist.

**English:** After switching devices, sign in to the same account to resume
your existing seat in ZDWA or Zilch. For public ZDWA games, the shared game link
also returns you to your seat without adding a second player. For protected
ZDWA games, use **Resume** in the lobby with the game password.
In both games, a game tab still open on the previous device shows that the
game continued elsewhere and stops reconnecting as a
player. Queued game commands from that previous connection are rejected;
finishes accepted before the takeover are still delivered. Your waiting game already offers
**Resume** in the ZDWA lobby; waiting rooms also offer **Watch**, with a
password required for protected games. This works while the game has not
ended or expired.

The game table stays within the visible screen in both apps, including the
installed PWA. Dice, actions and chat remain reachable. On smaller screens,
long score sheets, histories and dialogs scroll within their own areas without
moving the whole table. Browser zoom remains available.

**Deutsch:** Der Spieltisch bleibt in beiden Apps innerhalb des sichtbaren
Bildschirms, auch in der installierten PWA. Würfel, Aktionen und Chat bleiben
erreichbar. Auf kleineren Geräten lassen sich lange Spielzettel, Verläufe und
Dialoge in ihrem eigenen Bereich bewegen, ohne den ganzen Tisch zu
verschieben. Der Browser-Zoom bleibt verfügbar.

In ZDWA multiplayer games, the view follows the active player's score sheet.
If you swipe to or select another sheet, that view stays in place for the rest
of the current turn, including rolls, dice selections and announcements.
When the next player's turn begins, automatic following resumes. After a score
is entered, the brief reading pause remains before the view moves on.

**Deutsch:** In ZDWA-Mehrspielerpartien folgt die Ansicht dem Spielzettel des
aktiven Spielers. Wischst du zu einem anderen Zettel oder wählst ihn aus,
bleibt diese Ansicht für den laufenden Zug bestehen, auch beim Würfeln, Halten
und Ansagen. Sobald der nächste Spieler am Zug ist, folgt die Ansicht wieder
automatisch. Nach einem Eintrag bleibt die kurze Lesezeit erhalten, bevor
die Ansicht weiterwechselt.

Touch tablets have their own portrait and landscape table layouts, including
the 12.9-inch iPad. Readable score sheets and histories use the extra room,
while moderately sized dice and the main actions sit within reach near the
bottom. ZDWA adds a solo column guide with remaining fields and touch navigation
between score sheets. Zilch shows both players' histories together. Light,
Dark, Classic and LCARS retain their respective appearance; phone and mouse
desktop layouts stay unchanged.

**Deutsch:** Touch-Tablets erhalten eigene Spieltische für Hoch- und Querformat,
auch das 12,9-Zoll-iPad. Lesbare Spielzettel und Verläufe nutzen den zusätzlichen
Platz; maßvoll große Würfel und die Hauptaktionen liegen unten in Griffweite.
ZDWA ergänzt eine Solo-Spaltenhilfe mit offenen Feldern und eine Navigation
zwischen den Spielzetteln. Zilch zeigt beide Punkteverläufe gemeinsam. Hell,
Dunkel, Classic und LCARS behalten ihre Gestaltung; Handy- und Maus-Desktop-
Ansichten bleiben unverändert.

### Zilch at the table

Select scoring dice directly or use compact suggestions. Selections remain
reversible until **Roll again** or **Bank** commits them; **Combined score**
selects all currently scoring dice in one action. Hot Dice, the competitive
start roll and the final reply are handled by the server.

The score notebook returns to its latest entries on every roll and newly
recorded score. Reading older entries stays possible between rolls, including
while changing dice selections or receiving chat messages.
On phones and desktops, LCARS gives the active player's scrollable score history the large upper
sheet. The other player's name and total remain visible in a compact strip
below. When turns change, the newly active sheet slides from bottom to top;
the Classic notebook is unchanged. Opening rolls use the same miniature dice
as scoring suggestions; both results remain visible for 1.2 seconds before
play or a tied opening attempt continues. Rejoining a running game skips that
pause.

CPU opponents use the same dice and scoring path as humans, with conservative,
normal or aggressive decisions. Solo Sprint has no opponent or final reply;
its private metrics exclude pauses and server downtime.
The dice keeper's default action pause is 1.25 seconds, with at least 1.65
seconds after rolling to read the result and 1.5 seconds after the opening
result. The existing 1.9-second Zilch handoff remains; pauses are not added
together. Normal now starts from a 600-point bank goal and Aggressive from
700 points, with Conservative unchanged at 500. Remaining dice and match
position still adjust these goals; mandatory confirmation rolls, final
replies, randomness and scoring are unchanged.

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

One account works across all our games. Account and settings texts say so
without listing each game, so they stay accurate when another game joins the
suite. The ZDWA and Zilch settings pages follow the same four sections:
**Profile & sign-in**, **Language & play**, **Players & notifications**, and
**Help & updates**. Profile and sign-in open first, with passkeys as the
preferred sign-in method. Open profile editing or password changes when needed;
email settings appear only when email is enabled. Shared language and lobby-chat
preferences save separately from ZDWA gameplay options. An explicit language
choice takes priority over older account responses; rapid changes save in order
and keep the latest choice. Statistics and achievements keep their own tabs.

**Deutsch:** Ein Konto gilt für alle unsere Spiele. Konto- und
Einstellungstexte sagen das, ohne jedes Spiel einzeln aufzuzählen, und bleiben
so auch mit einem weiteren Spiel richtig. Die Einstellungen von ZDWA und Zilch
folgen derselben Reihenfolge:
**Profil & Zugang**, **Sprache & Spiel**, **Mitspieler & Hinweise** und
**Hilfe & Neuigkeiten**. Profil und Zugang sind zuerst geöffnet, mit Passkeys
als bevorzugter Anmeldung. Profilbearbeitung und Passwortwechsel öffnest du
bei Bedarf; E-Mail-Einstellungen erscheinen erst bei aktiviertem Versand.
Gemeinsame Sprache und Lobby-Chat werden getrennt von ZDWA-Spieloptionen
gespeichert. Eine bewusst gewählte Sprache hat Vorrang vor älteren
Kontoantworten; schnelle Wechsel werden der Reihe nach gespeichert, die letzte
Wahl bleibt erhalten. Statistik und Erfolge behalten eigene Tabs.

ZDWA offers locally saved Light, Dark and Classic appearances through its compact
header appearance button. Classic turns the table into a coffee-table score
sheet: softer, warm paper rests on irregular green felt, with blue ballpoint
lettering and loosely drawn lines. Bundled handwriting keeps the style
consistent across devices; smooth sepia dice have subtle, individual patina.
The felt also fills mobile landscape backgrounds. Short screens retain
scrollable access within the sheet while the actions stay in view. Newly recorded Classic scores
are drawn as blue ballpoint centre-line strokes, digit by digit, in about half
a second. Opponents see the same writing; existing scores, reloads and reconnects
do not replay it. Reduced-motion preferences show the final ink immediately.
The score and controls never wait for the animation, which needs no extra font
or network request. Controls, rules and scoring
are unchanged. Zilch remembers its separate Classic or LCARS choice locally in the
same browser. LCARS uses a near-black graphite canvas, flat segmented console rails,
rounded LCARS elbows and locally hosted condensed display lettering, including
in the installed PWA. Controls, rules, randomness and scoring stay the same.
Free rolls appear as a bright LCARS status band inside the scoring tile, with
the throw name and points remaining readable.
Inside LCARS game rooms, quieter frame and chat colours and reduced dice glow
keep selections clear. Positive scores use a light, muted apricot, and CPU
badges use flat LCARS colours with dark lettering. The near-black graphite background,
layout and sliding score sheets are unchanged.
LCARS now uses a calmer, lower-saturation console palette. On phones, each
unrolled die is a clear roll control, so the six-die dock never reads as empty.
The Roll and Bank buttons remain in the visible mobile viewport from game
start, including while the browser's address and navigation bars are open.

On short phone screens, Classic keeps a readable font size while fitting every
score row above the dice and actions. Its compact player avatar leaves the
extra room needed for score suggestions.

**Deutsch:** Auf kurzen Handybildschirmen bleibt die Classic-Schrift lesbar,
während alle Spielzettelzeilen über Würfeln und Aktionen Platz finden. Das
kompakte Profilbild lässt dabei Raum für Wertungsvorschläge.

**Deutsch:** LCARS nutzt jetzt eine ruhigere, weniger gesättigte
Konsolenpalette auf einer fast schwarzen Graphitfläche. Auf Handys ist jeder
ungeworfene Würfel ein klar umrandeter Roll-Button, damit die Sechserleiste
nicht leer wirkt. Die Buttons zum Würfeln und Sichern bleiben schon ab
Spielstart im sichtbaren Handy-Bereich, auch bei eingeblendeter Adress- und
Navigationsleiste des Browsers.
Under **Account → Settings → Profile & sign-in → Change username**, enter a new name and
confirm it with an existing passkey, or choose your current password as a fallback.
Names follow the registration rules (3–32 characters) and
are unique regardless of case. The new name applies to signing in, profiles
and new games across the whole suite. Sessions, statistics, achievements, avatars
and saved player selections remain attached to the same account. Completed
game views, history and leaderboards show the current account name, resolved
through the stored participant/account IDs. Reusing a released name never
transfers earlier games. Guest names, ambiguous unassigned legacy entries,
message text and game titles stay unchanged. Profile links change and the old
name becomes available again. In the private Zilch preview mode, names tied to
preview access require an administrator to adjust the access configuration first.

**Deutsch:** Unter **Konto → Einstellungen → Profil & Zugang → Benutzername ändern** kannst du
einen neuen Namen wählen und bevorzugt mit einem vorhandenen Passkey bestätigen.
Dein aktuelles Passwort bleibt als Alternative verfügbar. Der Name gilt für Anmeldung,
Profil und neue Partien in allen unseren Spielen. Konto, Statistiken, Erfolge und
Spielerauswahl bleiben erhalten. Auch abgeschlossene Partien und Bestenlisten
zeigen deinen aktuellen Kontonamen. Die Zuordnung erfolgt über feste IDs,
auch wenn jemand deinen alten Namen übernimmt. Gastnamen, nicht eindeutig
zugeordnete Altbestände, Nachrichtentexte und Spieltitel bleiben unverändert.
Dein Profillink ändert sich und der alte Name wird frei.

Administrators manage accounts and moderation.

**Deutsch:** Admins tragen in Lobby, Partie und Chat ein kleines Schild am
Profilbild; im Profil steht „Admin · Ansprechperson bei Fragen“. Angemeldete
Mitspieler können aus ihrer Partie **Admin rufen**. Ein offener Ruf pro Konto
verhindert doppelte Benachrichtigungen. Admins übernehmen den Ruf mit **Zum
Hilferuf** und erhalten für diese Partie Zuschauerzugang, auch bei privaten
oder Solo-Partien. Ihre eigene Partie pausiert mit einem Admin-Einsatz-Hinweis;
Sitz und Spielstand bleiben erhalten. Rückkehr oder Abschluss entfernen den
Hinweis. Einsätze laufen nach spätestens einer Stunde aus.

Berechtigte und versehentliche Rufe können ohne Sperre abgeschlossen werden.
Missbrauch sperrt nur weitere Hilferufe, bis ein Admin diese Sperre aufhebt.
Zusätzlich können Admins getrennte Spiel- oder Hilferufsperren für **3, 5, 7,
14, 30 oder 60 Tage oder dauerhaft** setzen und vorzeitig aufheben. Ablauf und
Grund stehen im Konto; Anmeldung bleibt möglich. Sperren gelten für das Konto,
nicht geräteübergreifend für unbekannte Gäste. Admin-Hilferuf-Push ist eine
eigene, standardmäßig aktivierte Einstellung für Admins; Browserfreigabe und
ein angemeldetes Push-Gerät sind weiterhin nötig.

**English:** A small shield on the avatar identifies admins in lobbies, games
and chat; profiles say “Admin · Contact for questions”. Signed-in participants
can **Call an admin** from their game. One open request per account prevents
duplicate notifications. Admins claim a request with **Go to help request**,
which grants spectator access to that game, including private and Solo games.
Their own game pauses with an admin-visit message, preserving their seat and
progress. Returning or closing the request clears the message; assignments
expire after one hour at most.

Valid or accidental requests can be closed without a penalty. Misuse blocks
further help requests until an admin lifts that restriction. Admins can also
apply separate playing or help-request bans for **3, 5, 7, 14, 30 or 60 days,
or permanently**, and lift them early. The account shows the reason and expiry;
sign-in stays available. Bans apply to the account, not to unidentified guests
across devices. Help-request push has a separate setting, enabled by default
for admins; browser permission and a registered push device are still required.

**Deutsch – Eigentümerschutz:** Der Gründer ist dauerhaft an eine feste
Konto-ID gebunden, unabhängig vom Spielernamen. Die Anwendung und
Datenbankregeln verhindern, dass Gründer oder Owner gesperrt, deaktiviert,
stummgeschaltet, ausgeschlossen oder zu normalen Nutzern herabgestuft werden.
Nur der Gründer kann weitere Owner ernennen oder deren Ownerrechte entziehen;
seine eigene Bindung ist unveränderlich. Owner verwalten normale Adminrechte.
Admins können keine anderen Mitarbeiterkonten übernehmen oder deren Rechte
ändern. Ein administrativer Passwort-Reset ist beim Gründer vollständig
gesperrt; persönliche Passwort- und Wiederherstellungswege bleiben verfügbar.
Weitere Owner behalten ihre Adminrechte, wenn ihre Ownerberechtigung entzogen
wird. Danach können sie wie andere Admins herabgestuft werden. Im Spiel sehen
alle dieselbe dezente Admin-Kennzeichnung, keine zusätzliche Statuskette.

Die einmalige Einrichtung erfolgt ausdrücklich mit der geprüften numerischen
Konto-ID: `FOUNDER_USER_ID=<id> scripts/deploy_zdwa.sh` oder beim Start mit
`ROLLTHEDICE_FOUNDER_USER_ID=<id>`. Der Zielaccount muss ein aktiver,
ungesperrter Admin sein. Ohne Angabe wird nichts automatisch zugeordnet.
Die Bindung bleibt in der Datenbank bestehen, auch wenn die Variable später
entfernt wird; eine widersprüchliche ID verhindert den Start. Erteilung und
Entzug weiterer Ownerrechte werden protokolliert. Server- und Datenbankzugang
sind davon getrennt: Wer beliebig Datenbankregeln oder Serverdateien ändern
kann, liegt außerhalb dieses Anwendungsschutzes.

**English – Ownership protection:** The founder is permanently bound to a
stable account ID, independently of their player name. Application checks and
database rules prevent bans, deactivation, chat restrictions and demotion of
the founder and owners. Only the founder can grant or revoke delegated
ownership; the founder binding cannot be removed. Owners manage ordinary
admin permissions. Admins cannot take over other staff accounts or change
their permissions. Administrative password resets are always blocked for the
founder; personal password and recovery flows remain available. Revoking
delegated ownership retains ordinary admin access, which can then be removed
separately. Games keep the same discreet admin badge for all support staff.

Initial binding requires an explicitly verified numeric account ID through
`FOUNDER_USER_ID=<id> scripts/deploy_zdwa.sh` or startup environment variable
`ROLLTHEDICE_FOUNDER_USER_ID=<id>`. The account must be an active, unrestricted
admin. No automatic assignment occurs without this setting. The database
retains the binding after the variable is removed; a conflicting ID prevents
startup. Delegated ownership changes are audited. Direct control over server
files or database definitions remains outside this application-level boundary.

**Deutsch – Benutzerverwaltung:** Admins finden Konten in einer kompakten,
durchsuchbaren Liste. Die Details jedes Kontos lassen sich einzeln aufklappen;
Kontorechte, Chat, Sperren und Passwort sind klar getrennt. Die Kontoanlage
hat beschriftete Felder, und Rückmeldungen erscheinen direkt bei der jeweiligen
Aktion. Die Verwaltung passt sich Desktop, Tablet und Smartphone an; bedienbare
Elemente bieten mindestens 44 Pixel große Touch-Ziele. Die bestehenden
Berechtigungen und der Eigentümerschutz gelten weiterhin.

**English – User management:** Admins find accounts in a compact, searchable
list. Each account opens individually, with separate groups for account
permissions, chat, bans and passwords. Account creation uses labelled fields,
and feedback appears next to the relevant action. The layout adapts to desktop,
tablet and phone screens, with touch targets of at least 44 pixels. Existing
permissions and ownership protection continue to apply.

The production account release enables email registration and recovery alongside
passkeys and public Fairplay counters. Resend sends from
`noreply@zockdiewandan.online`; the [mail setup record](docs/MAIL_SETUP_2026-09-12.md)
describes DNS, delivery checks and operating limits. Only account/address
confirmations, requested password resets and reset confirmations are sent.
There is no inbox, operator copy or newsletter. Email/password sign-up becomes usable
after following the confirmation link and choosing a password; existing
accounts can add a confirmed address under **Profile & sign-in**.

Both landing pages offer account creation directly with a passkey: enter an
account name, keep **Passkey (recommended)** selected and confirm on your device.
No email or password is required; the account is created only after successful
verification and signs in immediately. Set an optional backup password under
**Account → Settings → Profile & sign-in → Change password**, confirming with
your passkey. Until then, password verification is not offered, and the last
passkey cannot be removed without another passkey or a backup password.

Passkeys lead the sign-in screen. Password fields open only after choosing
**Sign in with password**, including on devices where passkeys are unavailable.
Accounts without a passkey see a dismissible setup reminder at most once every
seven days, shared across both games and all devices. Its link opens and focuses
the setup form; **Remind me in 7 days** snoozes it for seven days from dismissal.
The reminder disappears after a passkey is saved. Required password
changes take priority, and active games are not interrupted.

Passkeys are the preferred sign-in choice on supported devices. They use the
fixed ZDWA origin as the WebAuthn relying party and work across ZDWA and the
controlled Zilch and Hausdepp production subdomains. Hausdepp keeps shared
sign-in on its own origin, including in its installed PWA. Only the fixed
Hausdepp origin is added when it belongs to the configured RP; local development
retains its existing two trusted origins. Arbitrary origins are never accepted.
The server stores public credential material only;
passwords remain a fallback. Add, name or remove passkeys in account settings.
A password reset signs out every device and removes existing passkeys; enroll
them again after signing in. An ordinary password change keeps passkeys.
Account changes also prefer passkeys: username, email, password, adding another
passkey and removing a passkey. Each confirmation belongs to the current account,
session and requested action, expires after five minutes and can be used once.
Cancelling leaves the account unchanged; password confirmation is an explicit
fallback when a password has been set. Existing password accounts confirm their
first passkey once with their current password. Choosing a new password during initial email
registration or recovery and administrator-issued temporary passwords remain
bootstrap/recovery flows; room passwords are game access codes, not account
reauthentication. See the [password-flow audit](docs/PASSKEY_FLOW_AUDIT.md).
Simultaneous profile and account-statistics visits preserve one achievement
record and its original unlock time instead of failing on duplicate awards.
Disabling email through its deployment flag restores legacy password sign-up.
See the [email account plan](docs/EMAIL_ACCOUNTS_PLAN.md) and
[account security review](docs/ACCOUNT_SECURITY_REVIEW_2026-09-12.md).

**Deutsch:** Der Konto-Release aktiviert E-Mail-Registrierung und Wiederherstellung
zusätzlich zu Passkeys und öffentlichen Fairplay-Zählern. Resend versendet von
`noreply@zockdiewandan.online`; DNS, Versandprüfungen und Betriebsgrenzen stehen
im [Versandprotokoll](docs/MAIL_SETUP_2026-09-12.md). Die Anwendung verschickt nur
Konto-/Adressbestätigungen, angeforderte Passwort-Resets und die Bestätigung
nach einem Reset. Es gibt kein Postfach, keine Kopie an die Administration und
keinen Newsletter. E-Mail-/Passwort-Konten entstehen nach Bestätigungslink und eigener
Passwortwahl. Bestehende Konten können unter **Profil & Zugang** eine bestätigte
Adresse ergänzen.

Auf beiden Landingpages lässt sich direkt ein Konto mit Passkey erstellen:
Kontonamen eingeben, **Passkey (empfohlen)** ausgewählt lassen und am Gerät
bestätigen. E-Mail und Passwort sind optional. Erst nach erfolgreicher Prüfung
wird das Konto erstellt und sofort angemeldet. Ein Backup-Passwort lässt sich
unter **Konto → Einstellungen → Profil & Zugang → Passwort ändern** setzen,
bestätigt mit dem Passkey. Bis dahin erscheint keine Passwortbestätigung.
Der letzte Passkey kann erst entfernt werden, wenn ein weiterer Passkey oder
ein Backup-Passwort vorhanden ist.

Passkeys stehen beim Anmelden vorne. Die Passwortfelder erscheinen erst nach
**Mit Passwort anmelden**, auch wenn das Gerät keine Passkeys unterstützt.
Konten ohne Passkey erhalten in Lobby und Konto höchstens alle sieben Tage
einen wegklickbaren Einrichtungshinweis, gemeinsam über beide Spiele und Geräte.
Er führt direkt zum passenden Formular. **In 7 Tagen erinnern** verschiebt den
nächsten Hinweis um sieben Tage ab dem Wegklicken. Nach dem Speichern eines
Passkeys verschwindet er. Erforderliche
Passwortwechsel haben Vorrang, laufende Spiele bleiben ungestört.

Passkeys sind die bevorzugte Anmeldung auf unterstützten Geräten und gelten
für ZDWA sowie die kontrollierten Zilch- und Hausdepp-Produktionssubdomains.
Die gemeinsame Hausdepp-Anmeldung bleibt auf ihrem eigenen Ursprung, auch in
der installierten PWA. Nur der feste Hausdepp-Ursprung wird ergänzt, wenn er
zur konfigurierten RP-ID gehört; lokale Konfigurationen behalten ihre bisherigen
zwei vertrauenswürdigen Ursprünge. Beliebige Ursprünge werden nicht zugelassen.
Der Server speichert nur
öffentliche Credential-Daten; Passwörter bleiben eine Alternative. Passkeys
lassen sich in den Kontoeinstellungen hinzufügen, benennen und entfernen.
Ein Passwort-Reset meldet alle Geräte ab und entfernt bisherige Passkeys;
danach lassen sie sich neu hinzufügen. Ein normaler Passwortwechsel behält sie.
Auch Benutzername, E-Mail, Passwort und das Hinzufügen oder Entfernen von Passkeys
lassen sich bevorzugt mit einem vorhandenen Passkey bestätigen. Jede Bestätigung
gilt einmalig für das aktuelle Konto, die Sitzung und die gewählte Aktion und
läuft nach fünf Minuten ab. Abbrechen ändert nichts; das Passwort ist eine
bewusst wählbare Alternative, wenn eines hinterlegt ist. Bestehende Passwortkonten
bestätigen ihren ersten Passkey einmalig mit ihrem aktuellen Passwort.
Die erste Passwortwahl, Wiederherstellung und temporäre
Admin-Passwörter bleiben Einrichtungs-/Wiederherstellungswege; Spielraum-Passwörter
sind Zugangscodes. Details stehen im [Passwort-Flow-Audit](docs/PASSKEY_FLOW_AUDIT.md).
Gleichzeitige Profil- und Statistikaufrufe behalten einen gemeinsamen
Erfolgseintrag samt ursprünglichem Freischaltdatum und scheitern nicht an
doppelten Vergabeversuchen.
Bei deaktiviertem E-Mail-Feature ist die bisherige Registrierung mit
Benutzername und Passwort wieder verfügbar.

Outside game tables, all four games share a two-row header: game icon and
name, language, available design switch and game picker above; Lobby,
Players & Ranking, Rules and Account below. It stays at the top while scrolling,
on phones, tablets and desktops. Game tables retain their compact controls.
Quick page changes keep their chosen destination when an older sign-in check
is cancelled by navigation. Zilch sign-out owns one redirect to the correct
lobby; a late account response cannot start another redirect.

**Deutsch:** Alle vier Spiele nutzen ausserhalb des Spieltischs denselben
zweizeiligen Header: oben Spielsymbol und -name, Sprache, vorhandener
Darstellungswechsel und Spielauswahl; darunter Lobby, Spieler & Ranking, Regeln
und Konto. Er bleibt auf Handy, Tablet und Desktop beim Scrollen oben sichtbar.
Spieltische behalten ihre kompakten Bedienelemente.
Schnelle Seitenwechsel behalten ihr gewähltes Ziel, auch wenn dabei eine ältere
Anmeldungsprüfung abgebrochen wird. Zilch meldet mit einer einzigen Weiterleitung
zur passenden Lobby ab; eine verspätete Kontoantwort startet keine zweite.

Der mobile Zuschauerchat hält die Eingabe auch bei geöffneter Tastatur
erreichbar und zeigt Zuschauer mit ihrem Profilbild. Tablet-Spielblöcke nutzen
den verfügbaren Platz, ohne die Bedienelemente abzuschneiden.
Geschlossen bleibt nur der kompakte Chatbalken bündig am sichtbaren unteren
Rand; der Home-Indikator vergrößert ihn nicht. Antippen klappt den vollständigen
Chat auf. Der responsive ZDWA-Spielzettel passt alle Zeilen in den verfügbaren
Bereich ein und benötigt kein internes vertikales Scrollen. Zilch ordnet seine Vorschläge
überall untereinander an, mit dem stärksten direkt über **Alle Punktewürfel**.
Profilbilder im ZDWA-Zugstatus und in den Spielzettel-Überschriften bleiben bei
Würfel-, Halte- und Schreibaktionen ruhig und werden nur bei einem tatsächlichen
Spielerwechsel ausgetauscht.
Bereits geladene Profilbilder bleiben auch bei Aktualisierungen der Lobbys,
Bestenlisten und Chats sowie während Zilch-Spielaktionen erhalten. Das
verhindert wiederholtes Neuladen derselben Bilder auf Desktop, Tablet und Handy;
Spielerwechsel und neu hochgeladene Profilbilder werden weiterhin angezeigt.
Nach dem Drehen zwischen Hoch- und Querformat bleiben Header, Spielzettel und
Chat an ihren sichtbaren Tippflächen. Die Tastatur kann den Chat weiterhin
verkleinern; ein begonnener Text bleibt beim Drehen erhalten.
ZDWA, Zilch und Hausdepp vermeiden dabei eine auf iOS anfällige Fixierung der
gesamten Seite. Würfel, Spielzettel und Karten bleiben auch nach mehrmaligem
Drehen direkt an ihrer sichtbaren Position bedienbar.
Hausdepp erkennt auch von Safari aus Touch erzeugte Mausklicks korrekt als
denselben Karten-Tipp.
Mobile spectator chat keeps the input reachable with the keyboard open and
shows spectators with their profile picture. Tablet score sheets use the
available space without clipping the controls.
Collapsed chats show only a compact bar flush with the visible bottom edge;
the home-indicator inset does not make it taller. Tapping opens the full chat.
The responsive ZDWA score sheet fits every row into its available space without
internal vertical scrolling.
Zilch stacks suggestions vertically everywhere, with the strongest directly
above **All scoring dice**.
Profile pictures in ZDWA's turn status and score sheet headers stay steady
through rolls, holds and score entries, changing only when the displayed
player actually changes.
Loaded profile pictures also survive lobby, leaderboard and chat refreshes
and Zilch game actions. This avoids repeatedly reloading the same pictures
on desktop, tablet and phone; player changes and newly uploaded pictures
still appear.
After rotating between portrait and landscape, headers, score sheets and chat
remain aligned with their visible touch targets. The keyboard can still resize
the chat, and drafts survive rotation.
ZDWA, Zilch and Hausdepp avoid a fixed page root that can displace touch targets
on iOS. Dice, score cells and cards remain usable at their visible positions
after repeated rotations.
Hausdepp also recognizes Safari's mouse clicks synthesized from touch as the
same card tap.

Unter **Spieler & Ranking → Neueste Erfolge** zeigt jedes Spiel die jüngsten
Freischaltungen der Community mit Spieler, Zeitpunkt und Schwierigkeit, fest
auf 20 Einträge pro Seite begrenzt. **Leicht**, **Mittel** und **Schwer** lassen
sich einzeln ein- und durch erneutes Antippen wieder ausschalten. In ZDWA öffnet
ein Erfolg seine Details mit einem Link zur konkreten öffentlichen Partie,
sofern sie eindeutig zugeordnet ist. Jeder Eintrag zeigt eine Kurzbeschreibung
und ist antippbar, auch Konto- und Sammelerfolge ohne Spiellink. Private
Zilch-Ergebnisse werden nie aus dem Feed offengelegt. Menüs und Dialogaktionen
behalten ganze Wörter bei und trennen bei Bedarf passend zur gewählten Sprache.

Under **Players & Ranking → Latest achievements**, each game shows the newest
community unlocks with player, time and difficulty, limited to 20 entries per
page. **Easy**, **medium** and **hard** can each be selected and toggled off by
tapping again. Tapping any achievement opens its details, with a link to the
specific public ZDWA game when one is proven. Every entry includes a short
description, including account and aggregate achievements without a game link;
private Zilch results are never exposed by the feed. Menus and dialog actions
keep words intact and hyphenate according to the selected language when needed.

**Offline spielen** steht in beiden Lobbys bereit: ZDWA als normales Solospiel,
Zilch solo oder gegen den Würfelwirt. Jeder Einstieg und jedes Fortsetzen nach
einer Pause oder einem Neustart verlangt eine Bestätigung: keine Erfolge,
keine Ranglistenwertung und keine Übertragung an das Konto. Auch der Rückweg
zu Online-Spielen wird bestätigt. Netzverlust schaltet bestehende Online-Partien
nicht um. Spielstände und persönliche Bestwerte bleiben ausschließlich im
Browser auf diesem Gerät; gelöschte Browserdaten entfernen sie. Die Seite muss
einmal online geöffnet werden, bis sie die Offline-Bereitschaft bestätigt.

**Play offline** is available in both lobbies: normal solo ZDWA, and solo Zilch
or Zilch against the Dice Innkeeper. Every entry and resume after a pause or
reload requires confirmation: no achievements, leaderboard entries or account
uploads. Returning online also requires confirmation. Losing the connection
never converts an online game. Saves and personal records stay in this browser
on this device and disappear when its data is cleared. Open the page online
once and wait for the offline-ready message before using it without internet.
See the [offline-mode design and boundaries](docs/OFFLINE_MODE_ASSESSMENT.md).

The public Zilch lobby paints its heading directly from HTML and shows its
controls without waiting for the account check. Creating a game, account data
and chat still require the confirmed identity. LCARS preloads its versioned,
immutable-cached font only when selected; a slow font keeps the fallback for
that page instead of moving the layout later. Private preview routes retain
their access checks. See the [loading-performance audit](docs/ZILCH_LOADING_AUDIT_2026-09-08.md)
for measured frontend improvements and the separate production transport issue.

Guest account creation appears below the chat and rankings so a delayed account
check cannot move those lobby sections. The account entry beside the game
controls remains available.

**Deutsch:** Die Kontoerstellung für Gäste steht unter Chat und Ranglisten,
damit eine verzögerte Kontoprüfung diese Lobbybereiche nicht verschiebt. Der
Kontozugang neben den Spielaktionen bleibt erreichbar.

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

**Deutsch – Regeln im Spiel:** In ZDWA kannst du die Spielregeln während einer
Partie im Regeldialog nachlesen und danach direkt am Spieltisch weitermachen.

**English – In-game rules:** In ZDWA, you can read the rules in a dialog during
a game, then return directly to the table.

Find Zilch history at **Account → Statistics → Your history**, and ZDWA history
under **Account → Statistics**. Looking Back is earned only when your history
is opened; loading a hidden tab does not count. Collections refresh after new
interactions. GitHub clicks are recorded in the signed-in app before an external
browser handoff. Styler Full and Styler Show now require recorded five-of-a-kind
Full entries; ambiguous older Full scores never grant new awards. Both Styler
awards and their progress were reset for all accounts on 13 September 2026.
Only new evidence counts after its game finishes: 4 points for the first Full,
another 8 at ten Fulls. Current points and ranks follow the remaining awards;
other achievements and all game scores stay intact. No historic re-grants.

**Deutsch:** Zilchs Historie findest du unter **Konto → Statistiken → Deine
Historie**, ZDWAs Verlauf unter **Konto → Statistik**. Rückblick gibt es erst
beim Öffnen der eigenen Historie. Versteckte Bereiche zählen nicht. Die Sammlung
aktualisiert sich nach neuen Aktionen; GitHub-Klicks werden vor dem Wechsel in
einen externen Browser dem angemeldeten Konto zugeordnet. Styler Full und
Styler-Show erfordern künftig belegte Full-Einträge aus fünf gleichen Würfeln.
Beide Styler-Erfolge und ihr Fortschritt wurden am 13. September 2026 für alle
Konten zurückgesetzt. Nur neue Belege zählen nach Abschluss ihrer Partie:
4 Marken für den ersten Full, weitere 8 bei zehn Fulls. Punkte und Rang folgen
den verbleibenden Auszeichnungen; andere Erfolge und Spielpunkte bleiben
erhalten. Alte Einträge vergeben Styler nicht erneut.
Details: [Achievement-Erreichbarkeit / reachability audit](docs/ACHIEVEMENT_REACHABILITY_2026-09-12.md).

Achievements award **Ehrenberg-Marken**, which contribute to titles and star insignia. Newly earned
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
and Zilch. An abandonment counts only after any participant has written a
score: a filled field in ZDWA or a completed turn in Zilch's scorebook. A
written zero also counts, including a zero-point Zilch; rolling or holding
dice alone does not. Only the account that explicitly ends the game receives
the count. With v2.42.6, all existing abandonment counters for both games are
reset to zero. Scores, completed results and private Solo history are kept.
Timeouts, disconnections, waiting-room cancellations and opponents' aborts do
not count. Scores and completed-game rankings remain based on finished games.
Six ZDWA Fairplay reminders mark 1, 5 and 10 deliberate aborts, separately for
Solo and multiplayer, with **zero rank points**. Old private Solo history is
not reclassified. Waiting for a timeout deliberately also remains uncounted;
the app cannot reliably distinguish intent from a connection failure.

The ZDWA lobby's **Wall of Shame**, below the score leaderboards, lists the
three active accounts with the most self-initiated abandonments in the last
ten days (a rolling 240 hours) and all time since the counter reset in v2.42.6. Normal and
Hardcore, Solo and multiplayer count together. Entries use account IDs and
current names, so renaming an account keeps its counts and reusing an old name
does not transfer them. Equal counts share a rank; a stable account-ID tie
break keeps each list to at most three accounts. The lists refresh with the
existing leaderboards and show an empty state until there are eligible games.

**Deutsch:** Öffentliche Profile zeigen selbst abgebrochene gestartete Partien
getrennt für ZDWA und Zilch. Ein Abbruch zählt erst, wenn ein Teilnehmer einen
Wert geschrieben hat: ein ausgefülltes Feld in ZDWA oder ein abgeschlossener
Zug in Zilchs Punktebuch. Auch eine eingetragene 0 zählt, einschließlich eines
Zilchs ohne Punkte; bloßes Würfeln oder Halten genügt nicht. Nur das
ausdrücklich abbrechende Konto erhält den Zähler. Mit v2.42.6 werden alle
bisherigen Abbruchzähler beider Spiele auf null zurückgesetzt. Spielstände,
abgeschlossene Ergebnisse und private Solo-Historie bleiben erhalten.
Timeouts, Verbindungsabbrüche, abgesagte Warteräume und Abbrüche durch
Mitspieler zählen nicht. Punkte und Ergebnisranglisten beruhen weiter auf
abgeschlossenen Partien. Sechs ZDWA-Fairplay-Hinweise erinnern bei 1, 5 und 10
Abbrüchen getrennt für Solo und Mehrspieler daran, Partien zu Ende zu spielen –
mit **null Rangpunkten**. Alte private Solo-Historie wird nicht umgedeutet.
Bewusstes Warten auf einen Timeout bleibt ebenfalls ungezählt; die Anwendung
kann Absicht nicht sicher von einer Verbindungsstörung unterscheiden.

Die **Wall of Shame** unter den Punkte-Bestenlisten der ZDWA-Lobby zeigt die
drei aktiven Konten mit den meisten selbst ausgelösten Abbrüchen: in den
letzten zehn Tagen (rollierende 240 Stunden) und insgesamt seit dem Zurücksetzen
der Zähler mit v2.42.6. Normal und Hardcore sowie Solo und Mehrspieler zählen zusammen.
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
when a selected account starts a public, watchable ZDWA, Zilch or Hausdepp game,
connected users who enabled the account setting see a short live banner in the lobbies.
It links to spectator mode unless the recipient is already in a game. These
notices are neither push notifications nor persisted history; recipient consent,
selection membership, room access and account status are rechecked at delivery.

## Push notifications

Push is optional. Register each device from account settings and grant browser
permission. Registering a device only prepares it; invitations, reminders and
app update alerts are separate switches and **all start off** until the player
chooses them. In ZDWA, Zilch and Hausdepp lobbies, a signed-in player with no ready Push
device or no enabled category may see a friendly invitation to review the
settings at most once per 14 days across the account. An active subscription
on another device does not hide this device’s missing registration. It never opens the system permission sheet on its own: only the
player's explicit **Allow push on this device** click does that, then the player
chooses the categories. The account-wide off switch removes every stored device
subscription, even when used from a browser that cannot itself receive push.

**Geräteprüfung / device check:** Die Push-Auswahl gilt für das Konto; die
Anmeldung wird zusätzlich für dieses Gerät und seinen tatsächlichen Spiel-
Worker geprüft. Ein anderes Gerät oder Spiel zeigt deshalb kein falsches
«bereit» mehr. Mit **Dieses Gerät für Push anmelden** lässt sich ein fehlendes
oder veraltetes Abo bewusst erneuern; die gewählten Kategorien bleiben erhalten.
Statusprüfungen melden keine Geräte an und heben keinen Opt-out auf.

The category choices apply to the account. Readiness additionally checks this
browser's subscription, keys, account and actual game worker against the server.
Use **Enable push on this device** to repair a missing or stale registration
without changing category choices. Reading status neither registers a device
nor reverses an opt-out. Identical registration requests preserve pending
release deliveries; actual key or account changes invalidate old snapshots.

**Regelmässige Hinweise / recurring offers:** Push fragt höchstens alle 14 Tage
kontoweit nach, wenn auf diesem Gerät Push fehlt oder keine Kategorie gewählt
ist. Das gilt auch in Hausdepp. Ein im Browser ausdrücklich blockiertes Push
bleibt ohne automatische Nachfrage. Die Installation wird je Produktversion
neu angeboten, sofern diese App noch nicht als installiert erkannt ist:
mit der nativen Browserfunktion oder auf iPhone/iPad als Hinweis auf
Teilen → Zum Home-Bildschirm. Schliessen pausiert die Installation für sieben
Tage innerhalb derselben Version. Beide Hinweise bleiben auf die Lobby
beschränkt und warten aufeinander sowie auf andere Dialoge.

Push uses a shared 14-day account cooldown when the current device is missing
or no category is enabled. Browser-blocked permission stays quiet. Installation
is offered again for a new product version, using the native browser flow or
an iPhone/iPad Home Screen hint. Dismissal snoozes the same release for seven
days. Known installed apps stay quiet; lobby-only offers do not overlap with
other dialogs or one another. After bumping a version, rebuild the static
assets so the PWA offer includes the current product version.

The invitation is deliberately useful rather than generic: **player calls**
make it easy to join a public room with a free seat. A player can restrict those
calls to their private, account-bound player selection, while daily play ideas
and release notes remain separate choices.

| | Player invitations | Daily play reminders |
| --- | --- | --- |
| Trigger | A seated player clicks **Notify players** in a public waiting room | The server, only after a separate opt-in |
| Eligibility | Room still has an open seat; recipient opted in and is not already seated | Account has played none of the games today |
| Timing | Any time, including after the recipient has already played | A new random time between 17:00 and 21:00, Europe/Zurich |
| Limits | One attempt per sender per minute across both games; one dispatch per room per ten minutes | At most one reminder attempt per account per Swiss calendar day |
| Click destination | The specific room, with normal join/rejoin checks | The selected game's lobby |

A valid human move (a roll, a scoring action or a played card) counts as playing; finishing a game is not
required. Login, chat, spectating and CPU actions do not count. Existing
completed results are also checked. Activity and opt-out are checked again
immediately before dispatch.

Reminder schedules are stable across restarts. There is no overnight catch-up,
and durable daily claims prevent repeat attempts after failures or preference
changes. Each game has **32 German/English variants**: pub-table banter for
Zilch, cheerful challenges for ZDWA, card-table humour for Hausdepp. The rotation
advances with reminder attempts, so skipped days do not skip texts. If several
products are registered, they alternate; the chosen game's subscribed devices receive the same message.

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

**Find players** opens a searchable directory in the current game, including
accounts without completed games. Use **Show all players** and **Load more
players** to browse beyond the first 20 accounts. After adding someone on their
profile, **Manage player selection in account** opens the exact settings section.

**Deutsch:** **Spieler finden** öffnet die Suche im jeweiligen Spiel, auch für
Konten ohne abgeschlossene Partien. **Alle Spieler anzeigen** und **Weitere
Spieler laden** machen auch Konten nach den ersten 20 Treffern erreichbar.
Nach dem Hinzufügen im Profil öffnet **Spielerauswahl im Konto verwalten**
direkt den passenden Einstellungsbereich.

The [navigation audit](docs/NAVIGATION_AUDIT.md) records the page inventory and
repaired entry points, including PWA game links and account recovery pages.
This navigation rollout is silent: no version push or new in-app announcement.

The private, one-way list is shared across games and devices and affects only
player invitations. It is the foundation for a future friendlist; mutual friend
requests and public friendship profiles are not implemented.

### Zilch Classic

**Deutsch – Spieltisch:** Die Spielweise des Würfelwirts wird bei jeder neuen
Online- oder Offline-Partie gleichverteilt ausgelost. Revanchen losen neu;
laufende und wiederaufgenommene Partien behalten ihre Spielweise. Alle drei
Siegeserfolge bleiben erreichbar, ihre IDs und Punkte sowie bisherige
Statistiken bleiben unverändert. Eine Legacy-Markierung ist deshalb nicht nötig.
Die Tablet-Hilfe nennt die nächste konkrete Entscheidung. „Stand beim Sichern“
addiert geschriebene Punkte, bereits gehaltene Rundenpunkte und die gültige
aktuelle Auswahl; im Gegenzug hilft die Vorschau beim Vergleich. Beide
Papierblöcke haben ihre eigene Bindung und zeigen den Stand nur noch oben.
Der Startwurf bleibt auch auf Tablets im Querformat vollständig erreichbar.
Würfe aller Teilnehmer sind länger und deutlicher animiert, gehaltene Würfel
bleiben ruhig. Reduzierte Bewegung wird respektiert. Der letzte Wurf bleibt
nach seiner Animation etwa eine Sekunde sichtbar, bevor das Ergebnis öffnet.

**English – Game table:** Every new online or offline Dice Host game draws one
of the three play styles with equal probability. Rematches draw again;
ongoing and resumed games retain their style. All three win achievements remain
available with unchanged IDs, points and past statistics, so no legacy label
is needed. Tablet guidance describes the current decision. “Total if banked”
adds the recorded score, committed turn points and valid current selection,
making the final reply easier to judge. Each paper pad has its own binding and
shows its total only at the top. Opening rolls remain fully reachable on
landscape tablets. Every participant's rolls animate more clearly and for
longer; held dice stay still and reduced motion is respected. The final roll
remains visible for about a second after its animation before the result opens.

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

### ZDWA design

ZDWA has two designs: the 2026 design (default) and the previous one. Both come
in Light, Dark and Classic. The 2026 design is a scoped stylesheet
(`frontend/styles/zdwa-design-2026.css` with its parts in
`frontend/styles/design-2026/`) that applies only with `data-design="2026"`.
After the first roll, your own score sheet shows the points each allowed field
would score, computed by the server with the normal rules. One field is marked
as the suggestion when writing now is worth it: the server (`app/zdwa_advice.py`)
compares each field with what that field usually scores, keeps flexible fields
in reserve, and before the last roll suggests only when writing beats rolling
on. Tiles at the top show each player (in 2v2 each team) with avatar, name and
score; tapping one opens that score sheet, and the roll count sits on the roll
button.

- Accounts choose under **Account → Settings → Language & play →
  Appearance**; the choice is stored on the account (`users.zdwa_design`) and
  applies on every device.
- Accounts that existed before version 2.51.0 are asked once after the update,
  with a switch that previews the design live; however the question is closed,
  the design the switch shows is kept. New accounts are not asked; a guest who
  switched back keeps the previous design when creating an account.
- Guests use the switch at the bottom of the lobby; the choice stays in that
  browser.
- `?design=classic` forces the previous design in one browser, `?design=2026`
  lifts that again.
- Server switch: `ROLLTHEDICE_ZDWA_DESIGN=all` (default), `owner` or `off`,
  followed by a container restart. Rules, scoring and stored games are
  identical in both designs.

**Deutsch:** ZDWA hat zwei Designs, das neue Design 2026 (Standard) und das
bisherige, beide in Hell, Dunkel und Classic. Konten wählen unter **Konto →
Einstellungen → Sprache & Spiel → Aussehen**; die Wahl gilt auf allen Geräten. Konten, die es vor
Version 2.51.0 gab, werden nach dem Update einmal gefragt, neue Konten nicht.
Gäste nutzen den Schalter unten in der Lobby. `?design=classic` erzwingt in
einem Browser das bisherige Design, `?design=2026` hebt das wieder auf. Auf dem
Server schaltet `ROLLTHEDICE_ZDWA_DESIGN=all|owner|off` mit Neustart; Regeln,
Wertung und gespeicherte Partien sind in beiden Designs gleich. Ein
markiertes Feld schlägt den Eintrag vor, wenn sich Schreiben lohnt: Der Server
vergleicht jedes Feld mit seinem üblichen Ertrag, hält flexible Felder zurück
und schlägt vor dem letzten Wurf nur vor, wenn Schreiben besser ist als
Weiterwürfeln. Oben zeigt je Spieler (im 2-gegen-2 je Team) eine Kachel
Profilbild, Namen und Punkte; ein Tipp öffnet diesen Zettel. Die Würfe des
laufenden Zuges stehen auf dem Würfeln-Knopf.

## Progressive Web Apps

Each game has its own installable PWA, manifest and versioned assets.

- ZDWA stays on `zockdiewandan.online`, preserving existing installations,
  bookmarks and origin-bound resume data.
- Zilch uses `zilch.zockdiewandan.online` and its own service worker. Both
  workers cache only the explicit, anonymous offline-play package; online
  room, account and API data remain network-only.
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
  uvicorn app.asgi:create_application --factory --no-proxy-headers \
  --host 127.0.0.1 --port 8000 --reload
```

Environment variables are read by the application; Compose loads `.env`
automatically, while a direct Uvicorn launch requires exporting the variables
you need. Leave Turnstile, transactional email, passkeys and VAPID settings
disabled for ordinary local work.
Never use production push subscriptions for tests.

### Branch workflow

**Lieferweg / Delivery path:** `develop → master → prod`.

**Deutsch:** `develop` sammelt die nächste Version; `master` enthält geprüfte
Release-Stände. Neue Funktionen entstehen in eigenen Worktrees auf `codex/*`
vom aktuellen `origin/develop`. Vor der Übergabe den aktuellen Develop-Stand im
eigenen Branch integrieren, Konflikte lösen, Assets bauen und testen; Pull Requests
gegen `develop` werden nacheinander integriert. Nach grüner
CI und Releasefreigabe wird `develop` nach `master` übernommen; Produktion
wird weiterhin ausdrücklich von `master` gebaut und ausgerollt. Gemeinsame
Versionsnummern, Releasehinweise und generierte Assets werden bei der Integration
abgestimmt. Der [Releaseablauf](docs/DEPLOYMENT.md#entwicklung-und-releasebranches)
beschreibt Historie und Hotfix-Rückfluss.
Unmittelbar vor jedem Push wird `origin/develop` erneut abgerufen und mit dem
zuletzt integrierten und geprüften Stand verglichen; neue Änderungen werden
zuerst integriert und geprüft. Gemeinsame Branches werden nicht per Force-Push
überschrieben.
Nach Abschluss und verifizierter Sicherung auf `origin/develop` nicht mehr
benötigte eigene Worktrees aufräumen; aktive oder fremde Worktrees erhalten und
ungesicherte Dateien vorher sichern. Verwaltete Codex-Worktrees archivieren.

**English:** `develop` integrates the next version; `master` holds verified
release revisions. Start features in separate worktrees on `codex/*` branches
from current `origin/develop`. Before handoff, integrate current develop into
the feature branch, resolve conflicts, rebuild assets and test; integrate PRs
targeting develop sequentially. After CI
passes and the release is approved, promote `develop` into `master`; production
is still explicitly built and deployed from `master`. Coordinate shared versions,
release notes and generated assets during integration. The
[release workflow](docs/DEPLOYMENT.md#entwicklung-und-releasebranches) explains
history preservation and hotfix integration.
Immediately before every push, fetch `origin/develop` again and compare it with
the integrated, tested revision. Integrate and verify new changes first; never
force-push shared branches.
Once work is complete and verified on `origin/develop`, clean up unused worktrees
you own. Preserve active or other agents' worktrees, save unprotected files first,
and archive managed Codex worktrees.

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
npm run hooks:install                   # once per repository
npm run push:checked -- -u origin codex/my-feature
# Or verify first, then use a normal git push:
npm run verify:local
```

Commit changes before verification. The pre-push hook requires a complete local
check for the exact clean commit, current `origin/develop` base and installed
environment. A successful receipt remains valid for 24 hours; changing any of
those inputs requires a new run. An unchanged normal develop PR merge can inherit
its feature parent's complete proof after strict tree/base/ancestry checks; this
avoids repeating the same local suites for master and its release tag. The receipt
lives in Git metadata; the raw file is never
accepted as GitHub CI evidence. The full check runs quality/security checks, Node tooling
tests, backend coverage, the production Docker build and offline container smoke
test, every browser suite and `git diff --check`. Docker must use a local socket.
See [local checks](docs/LOCAL_CHECKS.md) for prerequisites, focused commands and
logs. Check for another agent's full test pool before starting one.

`npm run test:browser` runs the main suite on four parallel, isolated servers,
each with its own free port, SQLite database, legacy JSON data and report files.
Each server keeps one worker. Public Watten language navigation
(`playwright.watten-public.config.js`), username changes in public Zilch mode
(`playwright.username.config.js`), passkeys and Hausdepp passkeys then run
separately, even if an earlier suite failed. All eight browser pools are required
for verification; the public Watten cases run against real public SSR documents
and fail if that mode is missing. Use `npm run test:browser -- --suite watten-public`
for those cases alone. Servers are never reused; interruption
cleans up only this run's processes and temporary data. Filtered runs are marked
incomplete and cannot authorize a push. `npm run check:quality` includes lint,
dependency consistency, Bandit and the dependency vulnerability audit, matching
the backend checks in [the quality workflow](.github/workflows/quality.yml).
All expensive checks run locally. GitHub performs only the remote integration
check: an owner-issued **Local verification** commit status must prove the full
local check for the exact tree and base, and the PR or release merge must contain
exactly those verified sources. Missing, failed, stale or untrusted evidence
blocks the gate and requires local verification; it never launches duplicate
backend, browser, container, lint or tooling suites on GitHub.

Feature branches run only through their pull request. Pushes start the lightweight
**Quality result** check only on `develop` and `master`; release tags do not start
another run. Newer commits cancel only the older run of the same PR or branch.
A changed integration tree must be tested locally again. The same verified tree
can pass through a normal PR merge and a master fast-forward without repeating
the expensive suites. GitHub verifies the actual remote event, status issuer,
commit/tree/base and ancestry; this part belongs on GitHub.

`push:checked` publishes the local status automatically after a successful push.
With a normal `git push`, follow it with `npm run checks:publish`. Publication
requires the repository owner's authenticated `gh` account and a still-valid
receipt; raw receipt files in a PR are never trusted. Local reports remain on
this machine, while the status links the verified commit.

**Deutsch – Qualitätsprüfung:** Einmal `npm run hooks:install` ausführen, dann
mit `npm run push:checked -- <git-push-Argumente>` pushen. Der vollständige lokale
Prüfer läuft vor dem Push; der Hook akzeptiert nur einen erfolgreichen Nachweis
für den exakten, sauberen Commit mit aktueller `origin/develop`-Basis und
unveränderter Umgebung. Der Nachweis gilt höchstens 24 Stunden und liegt nur in
den Git-Metadaten. Enthalten sind Lint, Sicherheit, Node-Tooltests,
Backend-Abdeckung, lokaler Produktionscontainer samt Offline-Prüfung und alle
Browser-Suiten. Die Hauptsuite läuft gleichzeitig auf vier eigenen Servern mit
je einem Worker, freiem Port, SQLite-Datenbank, JSON-Daten und eigenen Berichten.
Danach folgen der öffentliche Watten-Sprachpool und die drei Konto-Suiten
einzeln. Alle acht Browserteilgruppen sind verbindlich; fehlende öffentliche
SSR-Dokumente sind im Watten-Sprachpool ein Fehler. Gezielter Aufruf:
`npm run test:browser -- --suite watten-public`. Die sieben vollständigen
Prüfgruppen bleiben unverändert. Teilprüfungen berechtigen nie zum Push;
Abbruch beendet nur eigene Prozesse. Chromium, WebKit und ein lokaler Docker-Daemon
müssen bereitstehen. Bei einem fremden vollen Testpool zuerst abstimmen.
Details und Teilbefehle stehen in [Lokale Prüfungen](docs/LOCAL_CHECKS.md).

Alle aufwendigen Suiten laufen lokal. GitHub prüft nur den tatsächlichen
Remote-Stand: Der vom Repository-Eigentümer veröffentlichte Commitstatus
**Local verification** muss die vollständige lokale Prüfung für exakt denselben
Tree und dieselbe Basis belegen. PR-, Integrations- und Release-Merges dürfen
keine ungeprüften Quellen hinzufügen. Fehlende, rote, veraltete oder fremde
Nachweise blockieren **Quality result** und verlangen eine lokale Prüfung.
Auf GitHub werden keine vollständigen Backend-, Browser-, Container-, Lint-
oder Tool-Suiten wiederholt.

Feature-Branches laufen ausschliesslich über ihren Pull Request; Pushes lösen
nur auf `develop` und `master` den schlanken Integrationscheck aus. Tags erzeugen
keinen zusätzlichen Lauf. Überholte Läufe werden nur innerhalb desselben PRs
oder Branches abgebrochen. `push:checked` veröffentlicht den lokalen Status nach
dem Push automatisch; nach einem normalen Push ist `npm run checks:publish`
nötig. Dazu muss `gh` als Repository-Eigentümer angemeldet sein. Lokale
JSON-Dateien im PR gelten nicht als Nachweis; GitHub kontrolliert Aussteller,
Frische, Commit, Tree, Basis und Abstammung selbst. Neue Integrationsquellen
müssen zuerst wieder lokal geprüft werden.

Backend tests use `pytest-xdist`: pytest automatically selects up to six workers,
keeping tests from the same file together. This applies to Codex, the terminal,
CI and PyCharm pytest runs through `pyproject.toml`. Install the updated development
dependencies with `.venv/bin/python -m pip install -r requirements-dev.txt`.
Use `npm run test:backend -- -n 2` for two workers, or
`npm run test:backend -- -n 0` for a serial run. For a quick check without coverage,
run `.venv/bin/python -m pytest tests/test_scoring_logic.py -n 0`.

**Deutsch – Backend-Tests:** pytest verwendet automatisch bis zu sechs Worker
und führt Tests derselben Datei zusammen aus. Das gilt über `pyproject.toml`
auch für PyCharm, Terminal und CI. Mit `-n 2` sind es zwei Worker; `-n 0`
deaktiviert die parallele Ausführung, etwa für einzelne Tests oder Debugging.

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

Both apps share a `Major.Minor.Patch` product version in `app/version.json`.
The current version appears under **Account → Settings → Help & updates → News &
versions**, including silent releases. Published history entries show their
assigned version while retaining their existing acknowledgement state.
See the [complete version history](docs/VERSION_HISTORY.md) for all retrospective
assignments and [CHANGELOG](CHANGELOG.md) for player-facing descriptions.

**Deutsch:** Beide Apps teilen eine Version nach `Major.Minor.Patch`: große
Produktmeilensteine, neue Funktionen, Fehlerkorrekturen/Wartung. Die aktuelle
Nummer steht unter **Konto → Einstellungen → Hilfe & Neuigkeiten → Neuigkeiten
& Versionen**, auch bei stillen Updates. Bestehende Hinweise behalten ihre
Bestätigungen und erhalten ihre zugeordnete Versionsnummer.

Before committing the next release's changes, explicitly choose the increment,
then update the bilingual changelog and release notice. The current `HEAD` must
still identify the preceding version. For example, using the configured Python environment:

```bash
python scripts/product_versions.py bump patch --summary-de "Lesbare Aktionen" --summary-en "Readable actions"
```

The command archives the previous committed version and updates the history
document. Lint validates the sequence; deployment also rejects an unchanged or
older version for a new revision, including silent deployment. After a successful
rollout, tag the deployed commit as `v<Major.Minor.Patch>`. A redeploy of the same
commit keeps its version. Asset-cache hashes remain independent of product versions.

New or changed HTML paths must update `tests/test_navigation_contract.py` and
their concrete destination, login-return or browser-flow checks. The inventory
guard rejects unclassified routes, including routes added through routers;
public SEO pages are also checked for reachable links and fragment targets.
Existing path tests should be extended rather than duplicated.

Every visible change ships as a complete German/English product increment:
update this README, update player rules when behavior changes, and keep
canonical URLs, Open Graph metadata and indexing policy correct.

The mandatory [product delivery standard](docs/PRODUCT_DELIVERY.md) is enforced
through `npm run lint` and CI. Backend tests and, for visible changes, browser
tests are required before committing and deploying.
