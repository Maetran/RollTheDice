# Hausdepp – Produkt- und Regelgrundlage / Product and rules specification

**Status / Status:** bestätigte Hausregeln und öffentlicher V3-Produktstand.
Der Owner hat die sichtbare Veröffentlichung von **V3.0.0** freigegeben.
Die Gestaltung wird anhand weiterer Spieltests verfeinert. / Confirmed house
rules and public V3 product scope. The owner approved the visible **V3.0.0**
release. Further playtests will continue to refine the appearance.

## Deutsch

### Gemeinsame Deko nutzen / Shared prop use

Normale Deko hat pro Tisch und Runde gemeinsame Gegenstände und Nutzungszustände.
Jeder Browser platziert die sichtbaren Gegenstände weiterhin passend zur eigenen
Bildschirmgrösse und freien Fläche. Essen, Trinken, Nachschenken, Verschütten,
Umfallen/Aufstellen, Dose, Windlicht, Bierdeckel, Würfeln und Münzwerfen werden
für alle übernommen. Andere Spieler sehen die zugehörige Animation an der
jeweiligen lokalen Position; verschobene Pixelkoordinaten werden nicht geteilt.
Gleichzeitige Nutzungen werden serverseitig nacheinander angewendet, ohne Bisse
doppelt zu zählen oder zu verlieren. Zuschauer sehen gemeinsame Zustände und
Ereignisse, bedienen die Gegenstände aber nicht.

Der Server begrenzt Gegenstände und Meldungen, prüft aktuelle Teilnahme und
Runde und bestimmt Zufallsergebnisse. Die Deko verändert weder Karten,
Zugversion, Nachwurfrecht noch Erfolge/EP. Wiederverbinden und Neustart stellen
den aktuellen Verbrauch wieder her; vergangene Animationen werden nicht erneut
abgespielt. Neue Runden und neue Tische beginnen mit frischer Deko. Seltene
Tischfunde und ihre bisherigen Vergaberegeln bleiben erhalten. Reduzierte
Bewegung übernimmt denselben Endzustand ohne die zusätzliche Bewegung.

Ordinary props share identities and usage state per table and round. Each browser
places the visible props according to its own screen and free space. Eating,
drinking, refilling, spills, falling/standing glasses, the can, lantern, coaster,
dice and coins update for everyone. Other players see the action at their local
prop position; dragged pixel coordinates are not shared. Concurrent use is
serialized by the server without duplicating or losing bites. Spectators see
states and events but cannot use props. The server validates current membership,
rounds and bounded messages and chooses random outcomes. Props never affect
cards, turn versions, follow-ups, achievements or XP. Reconnects and restarts
restore current consumption without replaying old animations. New rounds and
tables start fresh. Rare finds retain their existing shared behavior and award
rules. Reduced motion applies the same end state without the extra animation.

### Partie verlassen / Leave game

Beim Zuschauen führt „Tisch verlassen“ oben am Tisch sofort zurück zur Lobby,
auch im Warteraum, zwischen Turnierrunden und ohne Verbindung. Die laufende
Partie und ihre Wertung bleiben davon unberührt.

While spectating, Leave table at the top of the table returns to the lobby
immediately, including waiting rooms, tournament breaks and disconnected views.
The current game and scoring are unaffected.

Ein eigener Schalter neben den eigenen Karten öffnet eine Bestätigung im
Hausdepp-Design. „Am Tisch bleiben“ ist vorausgewählt; auch Schliessen oder
Escape bricht ab. Erst die ausdrückliche Bestätigung führt den Ausstieg aus. Aussteigen
beendet ausschliesslich die eigene Teilnahme, auch bei Verbindungs-/Pausenproblemen.
Eigene Handkarten kommen endgültig aus dem Spiel, nicht auf das aufnehmbare
Paket. Eigene offene Auffüllpflichten und Nachwurfrechte entfallen; die
verbleibende Gruppe spielt weiter. Bei nur einem verbleibenden Spieler mit
Karten endet die Runde ohne Hausdepp. Die verbleibenden Teilnehmer erhalten
reguläre Runden-EP; es entsteht kein erfundener erster Ausstieg oder Hausdepp.

Ein aufgegebener Spieler erhält für diese Hand keine Runden-EP und keine normalen
Erfolge. Ein eigener dauerhafter Ausstiegsbeleg verhindert spätere Nachvergütung
bei Kontowiederherstellung. Der erste Zonk-Erfolg für freiwilliges Aufgeben gibt
0 EP und beeinflusst den Rang nicht. Wer seine Karten bereits regulär
losgeworden ist, behält die normale Rundenvergütung.

Im Turnier gilt der Ausstieg für die ganze Sitzung. Historische Teilnehmer,
Verluste, abgeschlossene Runden und bereits verdiente EP bleiben erhalten;
weitere Runden spielen nur die Verbleibenden. Bei weniger als zwei verbleibenden
Turnierteilnehmern endet das Turnier vorzeitig ohne erfundenen Tageshausdepp.
Bleiben nur CPUs übrig, spielen sie die laufende Runde noch fertig; danach
endet das Turnier ohne Folgerunde. So bleiben regulär fertige Hände vergütbar.
Hostwechsel und Neu erstellen verwenden die verbleibende Gruppe. Ein blosses
Disconnect bleibt wiederaufnehmbar und zählt nicht als freiwilliger Ausstieg.

Leave game opens a confirmation in the Hausdepp design, with Stay at the table
focused first. Closing it or Escape also cancels; leaving requires explicit
confirmation and ends only the leaving person's participation,
including while paused. Their hand leaves play permanently, never entering the
pick-up pile. Their refill obligations and follow-up rights are removed; everyone
else continues. With just one player holding cards, the round ends without a
Hausdepp. Remaining participants earn normal round XP, without inventing a first
finish or loser. Giving up an unfinished hand earns no round XP or ordinary
achievements, including through later account reconciliation. A separate durable
departure record awards only the new Zonk achievement, worth 0 XP without rank
progress. Players who finished their hands normally retain their credit. Tournament departure covers the
whole session; historical participants, losses, rounds and XP stay intact. With
fewer than two remaining tournament participants, it ends early without inventing
a day's Hausdepp. If only CPUs remain, they finish the current round, then the
tournament ends without another round so normally finished hands can retain
their credit. Host transfer and rematch use the remaining group. A disconnect
remains resumable and never counts as voluntary departure.

### Schneller CPU-Abschluss / Faster CPU finish

Ist am Tisch genau ein Mensch und hat er seine Hand regulär beendet, erscheint
an der bisherigen Kartenposition «CPUs schneller». Der Schalter verkürzt
CPU-Denk- und öffentliche Kartenpausen für den Rest dieser Runde auf 30 % des
Normalwerts, mit mindestens 400 ms. Die Kartenbewegungen passen sich an, damit
keine alten Animationen auflaufen. Spielentscheidungen und Wertung ändern sich
nicht. Das schnellere Tempo übersteht Wiederverbinden und Neustarts; eine neue
Runde beginnt wieder im Normaltempo. Andere Menschen, Zuschauer und noch nicht
fertige Spieler können es nicht aktivieren.

With exactly one human at the table, finishing their hand normally reveals
“Speed up CPUs” where their cards were. It reduces CPU thinking and public-card
pauses to 30% of normal for the rest of this round, with a 400 ms minimum.
Card motion adapts so animations do not build up. Decisions and scoring stay
unchanged. The faster pace survives reconnects and restarts; a new round starts
at normal speed. Other humans, spectators and players who have not finished
cannot activate it.

### Lokale Wirtshauskulisse / Local tavern ambience

Der separate Notenschalter aktiviert eine sehr leise Wirtshauskulisse mit
Stimmengewirr, Gläsern, Geschirr und gelegentlichem Lachen. Standardmässig ist
sie aus, auch am CPU-Tisch ist sie verfügbar. Bei jedem Einschalten wird eine
von zehn Kulissen aus echten CC0-Aufnahmen zufällig gewählt. Nur diese und die drei gemeinsamen
Details werden geladen, zusammen höchstens etwa 1.62 MiB. Die Aufnahme bleibt
bei Turnierrunden und Neu erstellen auf derselben Seite erhalten, solange der
Sound eingeschaltet bleibt. Der normale HTTP-Cache wird wiederverwendet;
höchstens ein decodierter Raum bleibt im Speicher. Alles wird ausschliesslich
lokal wiedergegeben und dem
Mikrofonsignal und dem Sprachchat nicht zugemischt und gehören nicht zu dessen Verbrauchsmessung.
Systemlautstärke und System-Audiogeräte gelten. Bei aktiviertem Sound bestätigen
kurze Töne die manuellen Sound-, Sprachchat- und Mikrofonschalter. Sound aus
stoppt die Kulisse sofort und spielt noch einen letzten Abschaltton; danach
bleiben auch Mikrofon- und Sprachchatbestätigungen still. Automatische
Verbindungs-/Statusänderungen erzeugen keine Töne. Turniere und Neu erstellen
auf derselben Seite behalten die Einstellung; Verlassen, Abmelden und Schliessen
beenden sie. Browser/PWA-Gerätetests bleiben für die akustische Mischung nötig.
Quellen und Bearbeitung: [Audio assets](HAUSDEPP_AUDIO_ASSETS.md).

The separate music-note switch opts into very quiet pub ambience with room
chatter, glasses, dishes and occasional laughter, including CPU tables. It
starts off. Each activation randomly chooses one of ten mixes of real CC0 recordings.
Only that room loop and three shared detail clips load, at most about 1.62 MiB
in total. Keeping sound enabled through tournament rounds or Create again
retains the selection. Clips reuse the normal HTTP cache; memory retains at
most one decoded room. Playback stays local, without microphone/voice transmission or
voice usage telemetry. Use system volume and audio devices. Short tones confirm
manual sound, voice and microphone changes while sound is enabled. Sound off
stops ambience immediately, plays one final acknowledgement, then keeps further
voice/microphone confirmations silent. Automatic status changes stay silent.
Tournaments and Create again on the same page retain the setting; leaving,
signing out or closing ends it. Acoustic mixing still needs real device/PWA
acceptance.

### Freiwilliger Sprachchat

Bei aktivierter Funktion gibt es am Tisch zwei dauernd erreichbare Schalter:
Lautsprecher für Audioausgabe und Mikrofon für das eigene Sprechen. Ein neuer
Einstieg beginnt mit beiden aus. Zuhören braucht keine Mikrofonfreigabe.
Das Mikrofon lässt sich erst bei eingeschalteter Ausgabe aktivieren. Ausgabe
aus schaltet sofort auch das Mikro aus; Ausgabe wieder ein lässt das Mikro aus.
Einzelne Mitspieler stummschalten wirkt nur lokal und bleibt innerhalb derselben
Sprachsitzung erhalten. Teilnehmerstatus und tatsächliches Sprechen werden
angezeigt. Die Systemlautstärke und System-Audiorouten gelten, mit Echo- und
Geräuschunterdrückung soweit vom Browser unterstützt. Alle Teilnehmer können
gleichzeitig sprechen und hören. Es gibt weder Aufzeichnung noch Push-to-talk.

Nur aktive Account-Mitspieler nehmen teil; Gäste, Zuschauer und CPUs sind
ausgeschlossen. Bei Partien nur gegen CPUs sind die Sprachchat-Schalter nicht
verfügbar. Der freiwillige Status vom Wartetisch bleibt beim Spielstart,
über Turnier-Zwischenstände und nächste Runden sowie beim erneuten Spielen mit
derselben Gruppe bestehen. Ein Gruppenwechsel, Abmelden oder Schliessen beendet
die Teilnahme. Ein neues Gerät übernimmt die Teilnahme erst nach erneuter
Freigabe; das alte verliert seinen Medienzugang. Verbindungsprobleme werden
angezeigt. Hintergrundbetrieb und Audiogerätewechsel sind geräteabhängig und
brauchen echte Browser-/PWA-Tests; eine Installation garantiert kein dauerhaftes
Mikrofon im Hintergrund.

Die Mikrofonfreigabe verwalten Browser und Betriebssystem auf dem jeweiligen
Gerät, auch bei einer installierten PWA. In Chrome für Android speichert
„Beim Besuch der Website zulassen“ die Erlaubnis auch für weitere Besuche.
Bei blockiertem Zugriff in Chrome unter Einstellungen → Website-Einstellungen
→ Mikrofon den verwendeten Hausdepp-/Suite-Host zulassen. Chrome braucht
zusätzlich die Android-Mikrofonberechtigung. Ausschalten unseres Mikrofons
beendet die Aufnahme, löscht aber keine gespeicherte Browserfreigabe.

Für die Betriebsübersicht werden gemeldete Audio-Datenmengen regelmässig in
anonymen UTC-Tagessummen gespeichert (400 Tage), keine Gesprächsinhalte oder
dauerhaften Konto-/Raumkennungen. Die unvollständige Browsermessung ist keine
Cloudflare-Abrechnung und kein Kosten-Cap.

### Optional voice chat (English)

Two persistent controls switch audio output and your microphone on or off.
A fresh visit starts with both off. Listening never requests microphone access.
The microphone requires enabled output. Output off immediately disables the
microphone; output on again keeps it muted. Individual muting is local and
persists within the voice session. Show participants' voice state and speaking
activity. Use system volume and routing, with browser-supported echo/noise
suppression. Everyone can speak and hear simultaneously. No recording or
push-to-talk. Only active signed-in players may join; guests, spectators and
CPUs are excluded. Voice controls are unavailable in games against CPUs only.
Opt-in persists through waiting, play, tournament standings,
further rounds and rematches with the same group. Changing groups, signing out
or closing ends participation. A replacement device must opt in again and
revokes the old device's media. Show connection problems. Background operation
and audio routing require actual browser/PWA device tests; installation alone
does not guarantee background microphone operation.

Browser and operating-system permissions are managed on each device, including
installed PWAs. In Chrome for Android, Allow while visiting the site also saves
permission for future visits. If access is blocked, allow the current Hausdepp
or suite host in Chrome Settings → Site settings → Microphone. Chrome also
needs Android microphone permission. Switching our microphone off ends capture
without deleting a saved browser permission.

For operations, reported audio payload is regularly stored as anonymous daily
UTC totals for 400 days, without conversation content or durable account/room
identifiers. Incomplete browser measurements are neither Cloudflare billing nor
a spending cap.

### Schnellstart für Spieler

1. **Mindestens gleich hoch legen.** Tippe eine erlaubte Handkarte an. Gleiche
   Ränge dürfen gemeinsam oder schnell nacheinander gespielt werden. Eine 10
   oder vier unmittelbar aufeinanderliegende Gleiche räumen das Paket ab; du
   darfst selbst erneut ausspielen.
2. **Auf drei auffüllen.** Hast du nach dem Legen weniger als drei Karten,
   tippe den verdeckten Stapel an. Ein Tipp nimmt alle fehlenden Karten. Der
   nächste darf bereits Handkarten legen; der Stapel wartet auf die älteste
   offene Auffüllpflicht.
3. **Erst bei leerem Nachziehstapel fertig werden.** Ohne Handkarten bist du
   erst dann fertig. Der letzte Spieler mit Karten ist der Hausdepp der Runde.

Der verdeckte Stapel bedeutet vor dem Ablegen **Zocken**, danach bei offener
Auffüllpflicht **Auffüllen**. Das offene Paket anzutippen bedeutet **alles
aufnehmen**. Beim Zocken muss die aufgedeckte Karte gespielt werden; ist sie
zu niedrig, nimmst du das ganze Paket samt dieser Karte.

### Produkt und öffentliche Freigabe

Das Spiel heisst **Hausdepp**, so wie es in der Spielrunde des Owners genannt
wird. Es ist eine eigenständige Erweiterung der bestehenden ZDWA-/Zilch-Suite
und über deren Spielauswahl erreichbar. Die folgenden Regeln beschreiben diese
Hausvariante. Regeln eines anderen, ebenfalls „Hausdepp“ genannten Spiels dürfen
nicht ohne ausdrückliche Entscheidung übernommen werden.

- Üblich sind **2–5 Spieler**, die Obergrenze beträgt **6 Spieler**.
- Es gibt keinen eigenständigen Solomodus. Ein Computer-Mitspieler ist bereits
  für die erste spielbare Etappe erforderlich und führt seine Züge selbst aus.
- Die erste Etappe umfasst eine echte Mehrspieler-Lobby und einen vollständig
  spielbaren Tisch nach diesen Regeln, keine reine Designvorschau.
- Ab V3 sind Lobby und Regeln ohne Anmeldung öffentlich. Jedes aktive
  angemeldete Konto kann Tische eröffnen, mitspielen und zuschauen. Die frühere
  Founder-/Owner-Bindung gilt nicht mehr für das Spiel. Konto, Rangliste,
  Spielseiten und persönliche APIs erfordern weiterhin eine Anmeldung;
  fremde Handkarten und persönliche Ergebnisse bleiben geschützt.
- Ein Konto belegt einen Sitz; ein weiteres Gerät desselben Kontos übernimmt
  denselben Sitz und erzeugt keinen zusätzlichen Spieler.
- Die Suite-Integration verwendet bestehende Konten, Spielauswahl, Chat,
  Reaktionen und Wiederaufnahme. Ein Tischlink kann geteilt werden; wer noch
  nicht angemeldet ist, verwendet zuerst die bestehende Anmeldung und kehrt
  danach zum Tisch zurück. Der Link erteilt keine zusätzlichen Berechtigungen.

Der kanonische Einstieg ist
**`https://hausdepp.zockdiewandan.online/hausdepp`**, die öffentliche Anleitung
liegt unter **`/hausdepp/regeln`**. Der Host-Einstieg `/` leitet zur Lobby weiter.
Nur diese beiden Dokumente sind indexierbar und im eigenen Sitemap enthalten.
Die bisherigen `/hausdepp`-Wege auf den anderen Suite-Ursprüngen bleiben für
installierte Apps erhalten. Ein normaler Browser verwendet beim Spielwechsel
den eigenen Host; installierte Apps behalten ihren Ursprung und Worker.
Die gemeinsame Anmeldung führt über den bestehenden sicheren Suite-Login zum
freigegebenen Hausdepp-Ziel zurück; es entstehen keine zweiten Spielerkonten.
Der Mission-Control-Bereich und seine Hausdepp-Details bleiben wie bisher
separat an die Founder-/Dashboard-Berechtigungen gebunden.

### Gestaltung und Plattformen

Die Gestaltung ist ursprünglich mit Impeccable geplant. Das Plugin ist in der
aktuellen Sitzung nicht verfügbar; die jetzige Ausführung wird direkt im Browser
geprüft und im Designvertrag dokumentiert. Hausdepp bekommt ein eigenes
visuelles Erscheinungsbild; die Wirtshaustisch-Atmosphäre von Zilch und die
angegebenen Karten bilden die gestalterischen Bezugspunkte. Die Bedienung wird
zuerst für Mobilgeräte entworfen und muss im Hoch- und Querformat auf
Smartphones, Tablets und Desktop-Geräten funktionieren.

Die Kartenreferenzen des Owners zeigen doppeldeutsche Karten im traditionellen
Tell-/Jahreszeitenbild und die rot-schwarz-weisse Blitz-Rückseite des gezeigten
Piatnik-Kartensatzes. Sie bestimmen die gewünschte Designsprache. Die
Anwendung stellt diese Karten über einzeln ausgerichtete und abgerundete Bildausschnitte dar. Quellen, Lizenzen und
Bearbeitung stehen in [HAUSDEPP_ASSETS.md](HAUSDEPP_ASSETS.md). Die gestalterische
Richtung ist gewählt; die konkrete UI-/UX-Ausführung wird nach Spieltests weiter verfeinert.

### Karten und Begriffe

Es gibt **36 Karten**: die vier Farben Herz, Schellen, Laub und Eichel mit je
neun Rängen. Die Farben beeinflussen die hier bestätigten Legeregeln nicht.

Die Rangfolge von niedrig nach hoch lautet:

**6 < 7 < 8 < 9 < Unter < Ober < König < Ass < 10**

„Gleich“ bezeichnet denselben Rang, nicht dieselbe Farbe. Die Schellen 6
(Weli) ist hier eine gewöhnliche 6; es gibt keine Sonderfunktion. Rang und
Erfahrungspunkte sind unterschiedliche Begriffe. Karten haben keine eigenen
Strafpunkte; Erfahrung wird für abgeschlossene Runden und Erfolge vergeben.

- **Nachziehstapel:** die verdeckten, noch verfügbaren Karten. Nachgezogen wird
  immer von oben.
- **Offenes Paket:** die in der Tischmitte abgelegten Karten. Zum Vergleichen
  zählt dessen oberste Karte.
- **Abgeräumte Karten:** Karten eines Pakets, das durch eine 10 oder vier Gleiche
  „wegfliegt“. Diese Karten sind für den Rest der Runde aus dem Spiel.
- **Fertig:** Ein Spieler hat keine Handkarten mehr, nachdem ein gegebenenfalls
  notwendiges Auffüllen abgeschlossen ist, und der Nachziehstapel ist leer.

### Vorbereitung: verpflichtendes Anschauen von unten

Der Geber mischt. Der erste Geber eines Tisches wird zufällig bestimmt, gegen
Computer ebenso wie gegen Menschen; die Sitzreihenfolge spielt dafür keine
Rolle. Im Turnier gibt nach jeder Runde der nächste Spieler im Uhrzeigersinn.
Gespielt wird im Uhrzeigersinn. Der Spieler unmittelbar vor
dem Geber in dieser Reihenfolge schaut die unterste Karte des verdeckten
Stapels an. Das Anschauen, Weiterschauen nach einem Ass und Behalten bei Erfolg
sind verpflichtend; es gibt kein Auslassen, Ablehnen oder vorzeitiges Aufhören.
Der bestimmte Spieler hebt aktiv ab: Ein Tipp auf den verdeckten Stapel prüft
eine Karte. Nach jedem Ass löst er das Weiterschauen mit einem weiteren Tipp
aus. Ass und Folgekarte erscheinen direkt am Stapel. Nach einem Fehlversuch
bleiben alle angeschauten Karten drei Sekunden lang lesbar, auch bei reduzierter
Bewegung. Die Tischhilfe öffnet sich nicht automatisch; ihre Abhebehistorie wird
vor jeder neuen Turnierrunde vollständig geleert. Ein Computer führt seine
eigenen Abhebeaktionen aus.

1. Ist die unterste Karte eine **10**, erhält der Spieler diese eine Karte.
2. Ist sie ein **Ass**, schaut der Spieler die nächste Karte darüber im
   verbleibenden Stapel an. Jedes weitere Ass setzt dieses Anschauen fort.
3. Folgt auf die Asse eine **10**, erhält der Spieler sämtliche angeschauten
   Asse und genau diese eine 10. Die erhaltenen Karten werden kurz allen offen
   gezeigt und kommen anschliessend auf seine Hand. Auch eine allein erhaltene
   10 wird gezeigt.
4. Sobald die 10 erreicht ist, endet das Anschauen. Die nächste Karte wird
   nicht mehr angeschaut.
5. Erscheint vor einer 10 eine Karte, die weder Ass noch 10 ist, endet der
   Versuch erfolglos. Der Spieler erhält **keine** Karte. Alle angeschauten
   Karten bleiben in ihrer ursprünglichen Reihenfolge unten im Stapel. Sie
   werden den anderen Spielern nicht gezeigt. Der anschauende Spieler kennt
   diese Karten weiterhin: Solange sie im Stapel liegen, sieht nur er sie als
   kurzes Etikett („Unten: Ass · König“) direkt auf dem verdeckten Stapel; die
   Karten selbst bleiben zusätzlich in der Tischhilfe einsehbar.

Beispiele: `10` ergibt eine 10; `Ass → Ass → 10` ergibt drei Handkarten;
`Ass → Ass → König` ergibt keine Handkarte. Die Pfeile bezeichnen die
Anschau-Reihenfolge vom unteren Ende in den Stapel hinein.

### Austeilen und offene Startkarte

Nach dem Anschauen wird jeder Spieler von oben auf **mindestens drei
Handkarten** aufgefüllt. Wer bereits eine oder zwei Karten erhalten hat,
bekommt entsprechend zwei oder eine zusätzliche Karte. Wer bereits drei oder
mehr besitzt, bekommt keine zusätzlichen Karten. Drei ist die Mindesthand,
keine Höchstgrenze.

Danach wird die oberste Karte des verbleibenden Nachziehstapels offen in die
Mitte gelegt. Ist sie eine **10**, wird sie an einer zufälligen Position wieder
in den verdeckten Stapel geschoben und erneut dessen oberste Karte aufgedeckt.
Das wird bei jeder weiteren 10 wiederholt, bis eine andere Karte liegt. Jede
andere Karte ist als Startkarte erlaubt.

Das Austeilen wird durch kurze Kartenbewegungen vom Stapel zu den Sitzen
gezeigt. Die Animation sperrt keine Spielaktion und wiederholt sich beim
Neuladen nicht. Der Spieler unmittelbar nach dem Geber im Uhrzeigersinn beginnt.

### Standardzüge

Der aktive Spieler hat die folgenden Möglichkeiten:

1. **Aus der Hand legen:** Eine Karte oder mehrere Karten desselben Rangs
   spielen. Der Rang muss mindestens so hoch sein wie der Rang der obersten
   offenen Karte. Auf einen leeren Tisch darf jeder Rang gelegt werden.
2. **Das offene Paket aufnehmen:** Alle offenen Karten auf die Hand nehmen,
   auch freiwillig. Damit ist der nächste noch beteiligte Spieler dran. Ein
   leeres Paket aufnehmen und dadurch passen ist kein gültiger Zug.
3. **Zocken:** Die oberste Karte des Nachziehstapels aufdecken und zwingend auf
   das offene Paket spielen. Ist sie gleich hoch oder höher, gelingt der Zug.
   Ist sie niedriger, muss der Spieler das gesamte offene Paket einschliesslich
   der gezockten Karte auf die Hand nehmen; danach ist der nächste Spieler
   dran. Zocken folgt den Regeln des Ausspielens aus der Hand, einschliesslich
   der Abräumregeln. Bei leerem Nachziehstapel ist Zocken nicht möglich.
4. **Mit einer 10 abräumen:** Eine 10 spielen. Das gesamte offene Paket samt
   dieser 10 fliegt aus der Runde, unabhängig davon, was zuvor oben lag.

Gelingt ein normaler Lege- oder Zockzug ohne Abräumen, ist sofort der nächste
noch beteiligte Spieler dran. Er darf bereits aus seiner Hand legen, auch wenn
der Vorgänger noch auffüllen muss. Das nachfolgend beschriebene Nachwerfen
bleibt bis zur ersten angenommenen Aktion dieses Spielers möglich.

### Vier Gleiche und erneutes Ausspielen

Liegen oben auf dem offenen Paket **vier Karten desselben Rangs unmittelbar
aufeinander**, fliegt das gesamte Paket ebenfalls aus der Runde. Es ist egal,
ob die vorherigen Karten vom selben Spieler oder von anderen Spielern gelegt
wurden. Wer die vierte Karte ergänzt, hat das Paket komplettiert.

Die normale Rangregel gilt auch beim Herstellen eines Viererpakets: Vier
gleichrangige Karten dürfen auf einen leeren Tisch oder auf einen höchstens
gleich hohen Rang gespielt werden. Bereits oben liegende Karten desselben
Rangs dürfen durch die fehlenden Karten ergänzt werden.

Wer durch eine 10 oder vier Gleiche abräumt, darf **selbst erneut ausspielen**.
Das erneute Zugrecht gilt sofort; vorhandene Handkarten darf er bereits
spielen, auch wenn eine Auffüllpflicht offen ist. Die Auffüllpflicht bleibt
bestehen. Ist er bei leerem Nachziehstapel fertig, wird er übersprungen und der
nächste noch beteiligte Spieler beginnt dort.

### Pflichtauffüllen und Nachwerfen

Nach einem vollständigen Ablegen muss eine Hand unter drei Karten von oben
aufgefüllt werden, solange Nachziehkarten vorhanden sind. **Das Auffüllen
geschieht für alle automatisch:** Sobald die eigene Auffüllpflicht an der Reihe
ist, tippt das Spiel den verdeckten Stapel einmal an und nimmt sämtliche
fehlenden Karten bis zur Handgrösse drei auf einmal, oder alle noch verfügbaren
Karten, falls weniger übrig sind. Eine Einstellung dafür gibt es nicht mehr; ein
eigener Tipp auf den Stapel bleibt als Rückfallweg möglich. Bei drei oder mehr
Handkarten ist kein Auffüllen erforderlich. Regeln, Reihenfolge und
Nachwurfrecht ändern sich dadurch nicht; ein Nachwurf darf hinter dem
automatischen Auffüllen angetippt werden. Der gespeicherte Kontowert
`hausdepp_auto_refill` aus früheren Versionen wird nicht mehr ausgewertet.

**Langsames Ziehen hält Handzüge nicht auf.** Der nächste Spieler darf sofort
legen. Der verdeckte Stapel ist aber für die älteste noch offene Auffüllpflicht
bestimmt: Solange diese nicht erledigt ist, können spätere Spieler weder ziehen
noch zocken. Weitere Auffüllpflichten kommen hinten in diese Reihenfolge. Der
Spieler, der jetzt ziehen muss, sieht **„Du musst ziehen“** mit einem sanft rot
pulsierenden Rahmen. Bei reduzierter Bewegung bleibt der Rahmen statisch.
Andere Spieler sehen, auf wen der Stapel wartet.

Vor dem Ausspielen aus der Hand bedeutet ein Tipp auf den verdeckten Stapel
**Zocken**, nicht Auffüllen, sofern keine ältere Auffüllpflicht den Stapel
blockiert. Ein Auffüllen vor dem Ablegen ist nicht erlaubt. Steht nach einem
Ablegen die eigene Auffüllung aus, bedeutet derselbe Tipp ausschliesslich
Auffüllen, sobald diese Pflicht an der Reihe ist; Zocken ist dann gesperrt.

Hat ein Zug das Paket abgeräumt, behält derselbe Spieler einen **neuen
vollständigen Zug auf dem leeren Tisch**. Handkarten darf er sofort spielen;
zocken darf er erst, wenn keine Auffüllpflicht mehr offen ist und der Stapel
noch Karten enthält. Beispiel: Nach einer abräumenden 10 hält er durch das
Auffüllen drei Asse und darf trotzdem zocken. Ohne Abräumen geht das Zugrecht
sofort weiter. Spätes Auffüllen verändert weder das aktuelle Zugrecht noch ein
bereits geschlossenes Nachwurffenster.

Die eigene Hand ist von links nach rechts aufsteigend sortiert, mit den 10ern
ganz rechts. **Ein Tipp auf eine Handkarte legt sie unmittelbar.** Es gibt keine
zusätzliche Bestätigung. Ein Tipp gilt nur für die beim Aufsetzen bereits
spielbare Karte. Rückt eine andere Karte unter den Finger oder wird sie erst
während des Tipps freigegeben, ist ein neuer Tipp nötig.
Weitere gleiche Karten können schnell nacheinander
angetippt werden, solange das Nachwurfrecht noch besteht.

**Langes Halten einer spielbaren Handkarte** (rund 0,4 s; Rechtsklick oder
Umschalt + Enter mit Tastatur) oder der Schalter **Mehrere Karten auswählen**
markiert stattdessen alle spielbaren Karten dieses Rangs. Jeder weitere Tipp
nimmt eine einzelne Karte heraus oder wieder hinzu. Die Auswahl gilt nur für
diesen einen Wurf: Nach **Karten legen** legt ein Tipp wieder einzeln. Ausgewählte Karten heben sich an und tragen einen Haken. Die Auswahl führt keinen Zug aus;
erst **Karten legen** sendet alle ausgewählten Karten als einen atomaren Zug.
Das funktioniert auch bei gültigem Nachwerfen. Schliesst eine andere Aktion
das Nachwurffenster, verfällt eine noch nicht gespielte Auswahl sichtbar.
Computer reagieren im variablen Normaltempo rund 12,5 % langsamer als zuvor;
das schafft kein garantiertes Nachwurffenster.

Ein Tipp auf das **offene Paket** bedeutet dagegen dessen bewusstes vollständiges
Aufnehmen auf die Hand. Aufnehmen beendet den Zug. Bei leerem Tisch ist keine
Aufnahme möglich.

Vor einer freiwilligen Aufnahme lässt sich das öffentliche Paket auffächern:
lange auf das Paket drücken, rechtsklicken oder Umschalt + Enter verwenden.
In der Tischhilfe gibt es zusätzlich **Paket ansehen**. Der Dialog zeigt nur die
bereits offen gespielten Karten; Anschauen führt keinen Spielzug aus. Ein kurzer
Tipp bleibt die unmittelbare Aufnahme. Abgeräumte Karten landen auf einem
separaten, chaotisch gestapelten Rückseitenstapel **Aus dem Spiel** mit genauer
Kartenanzahl. Er ist kein Nachziehstapel und lässt sich nicht aufnehmen. Am Tisch
steht dafür eine durchgestrichene Karte mit der Zahl; „Aus dem Spiel“ bleibt als
Tooltip und für Screenreader erhalten.

Seit 3.8.1 werden verdeckter Stapel und offenes Paket nie abgedunkelt, auch wenn
andere am Zug sind. Ein goldener Leuchtrand markiert nur, was der Spieler selbst
antippen kann (zocken, abheben, Paket nehmen); das automatische Nachziehen
leuchtet nicht. Name und Kartenzahl stehen auf dunklen Schildern, der Spieler am
Zug auf einem goldenen; die Statuszeile ist eine Pille, gold beim eigenen Zug.
Auf dem Handy zeigt das Schild Name und Zahl in einer Zeile; ab vier Mitspielern
sitzen alle dort in einer gleichmässigen Reihe über den Stapeln.

Zum gerade gespielten Rang darf der Spieler weitere gleichrangige Karten
**nachwerfen**. Das dürfen gerade nachgezogene Karten oder zunächst
zurückbehaltene Handkarten sein. Nachwerfen ist freiwillig. Nach einem Nachwurf
wird erforderliches Pflichtauffüllen wieder automatisch abgeschlossen;
dieser Ablauf kann sich mehrfach wiederholen. Ein Nachwurf kann die vier
Gleichen vervollständigen und damit das erneute
Ausspielrecht auslösen.

Das Nachwurfrecht endet mit der **ersten angenommenen Aktion des nächsten
Spielers**. Dazu zählen dessen Ablegen, Aufnehmen des Pakets oder Aufdecken zum
Zocken. Bereits angenommene Aktionen dürfen nicht nachträglich durch einen
Nachwurf umgeordnet werden. Befehlsbestätigungen ordnen schnelle Kartenaktionen; eine feste
Sekundenzahl oder künstliche Sperre ist keine Spielregel. Computer reagieren
unterschiedlich schnell; auf eine zügige Reaktion können längere Denkpausen
folgen. Nach dem eigenen Abräumen spielen sie häufig schneller weiter.
Ein menschlicher Nachwurf hat deshalb kein garantiertes Zeitfenster.

### Endspiel und Rundenende

Reichen die Nachziehkarten nicht mehr für drei Handkarten, zieht der Spieler
nur die noch vorhandenen Karten. Sobald der Nachziehstapel leer ist, entfällt
die Mindesthand und es kann nicht mehr gezockt werden. Offene Auffüllpflichten
enden damit; alle inzwischen leeren Hände werden gemeinsam als fertig geprüft.

**Erst auffüllen, dann prüfen, ob jemand fertig ist.** Eine zwischenzeitlich
leere Hand ist kein Ausscheiden, solange noch nachgezogen werden muss. Das
gilt auch beim Ausspielen einer 10 oder beim Vervollständigen von vier Gleichen.

Wer danach bei leerem Nachziehstapel keine Handkarten mehr hat, ist für diese
Runde fertig und wird bei weiteren Zügen übersprungen. Das kann auch durch
Nachwerfen eintreten. Hat die letzte Karte abgeräumt, übernimmt der nächste
noch beteiligte Spieler den leeren Tisch.

Sobald nur noch **ein Spieler Handkarten** besitzt, endet die Runde sofort.
Dieser Spieler ist der **Hausdepp dieser Runde**. Ein noch offenes Paket in der
Mitte ändert daran nichts. Die übrigen Spieler müssen keine weiteren Aktionen
ausführen. Die Regeln bestimmen den letzten Spieler, nicht einen einzigen
Sieger. Erfahrungspunkte für Runden und Erfolge werden davon getrennt vergeben.

Hohe gleichrangige Karten und aufbewahrte 10er können im Endspiel helfen: Eine
10 räumt ab und gibt bei verbleibenden Handkarten einen weiteren Zug. Das ist
ein taktischer Hinweis, keine zusätzliche Sonderregel.

### Sichtbare Hände und Kartenbewegungen

Liegen oben auf dem offenen Paket zwei oder drei Karten desselben Rangs, fächern
sie sich leicht nach links oben auf. So sieht man auf einen Blick, wie viele
Gleiche schon liegen (bei vier räumt das Paket ab). Am Rundenende zeigt das
Ergebnisfenster alle Platzierungen in der Reihenfolge, in der die Spieler fertig
wurden, den Hausdepp zuletzt, und für jedes Konto die in dieser Runde verdienten
EP und neu erreichten Erfolge. Das kompakte Ergebnisblatt passt seine Höhe an
den Inhalt an. Es nennt die tatsächliche Tischbesetzung und trennt bei der
eigenen Gutschrift Runden-EP von Erfolgs-EP. Darunter stehen der aktuelle eigene
Kontorang, Gesamt-EP und der Abstand zum nächsten Rang. Kontohinweise aus früheren
Runden werden niemals als Gutschrift der gerade beendeten Runde ausgegeben.
Allgemeine Glückwünsche und Wiederholungs-Erklärungen entfallen. Längere
Statuswörter wie „Verblieben“ und „Ausgestiegen“ erhalten auch auf kleinen
Displays eigenen Platz neben Avatar, Spielername und Runden-EP.

Die eigene Hand bleibt offen und sortiert. Bei anderen Spielern ist für jede
Handkarte eine Rückseite sichtbar; die genaue Anzahl steht zusätzlich beim
Namen. Kartenwerte und Farben gegnerischer Hände bleiben privat. Sehr grosse
Hände werden dichter gefächert, ohne Karten wegzulassen.

Erfolgreich abgehobene Karten fliegen für alle offen vom verdeckten Stapel in
die Tischmitte. Dort steht gut eine Sekunde lang, wer sie bekommt („Liesl bekommt
Ass · 10“), danach fliegen sie zu dieser Hand; erst dann wird ausgeteilt. Ein
Computer wartet mit seinem ersten Zug, bis diese Vorführung vorbei ist. Bei
reduzierter Bewegung bleiben die Karten samt Beschriftung kurz statisch sichtbar. Geben und Pflichtziehen zeigen
den Weg vom verdeckten Stapel zur Hand. Beim
Aufnehmen wandert das offene Paket zur Hand. Misslingt Zocken, geht zuerst die
gezockte Karte vom verdeckten zum offenen Stapel und danach das ganze Paket zur
Hand. Handkarten bewegen sich beim Legen zur Mitte. Sobald ein Wurf, Nachwurf
oder erfolgreiches Zocken bestätigt ist, zeigt das wachsende offene Paket sofort
die aktuelle Kartenzahl und den Fächer gleicher Werte. Laufende Kartenflüge
verzögern diese Anzeige nicht. Diese Darstellung sperrt
keinen Zug, ändert kein Nachwurfrecht und wiederholt sich beim Wiederverbinden
nicht. Reduzierte Bewegung bestätigt die Ankunft ohne räumlichen Flug.

### Technische Leitplanken

- Der Server prüft Kartenbesitz, Zugrecht, Rangvergleich, Nachziehen,
  Nachwerfen, Abräumen und Rundenende. Gleichzeitige Aktionen benötigen eine
  eindeutige angenommene Reihenfolge.
- Private Ansichten enthalten nur die eigene Hand und die regelgemäss
  verfügbaren Informationen. Fremde Hände und die verdeckte Stapelreihenfolge
  dürfen nicht an andere Spieler übertragen werden. Erfolglose Anschauversuche
  bleiben privat; die verpflichtende Anzeige erfolgreicher Karten ist eine
  gezielte öffentliche Information.
- Der Computer-Mitspieler führt echte Züge aus und erhält dieselben
  regelgemässen Informationen wie ein menschlicher Spieler, einschliesslich
  gegebenenfalls selbst angeschauter Karten. Verdeckte Fremdkarten dürfen seine
  Entscheidungen nicht beeinflussen.
  Er berücksichtigt sichere eigene Schlusszüge, Viererpakete und einzelne
  10er als Reserve. Mit einer starken kleinen Hand kann er bei genügend
  Nachziehkarten zocken; kurz vor dem leeren Stapel wägt er Aufnehmen gegen
  das zusätzliche Risiko ab. Strategie und Tests stehen in
  [HAUSDEPP_CPUS.md](HAUSDEPP_CPUS.md).
- Wiederverbinden und weitere Geräte desselben Kontos müssen denselben
  autoritativen Spielzustand und denselben Sitz wiederherstellen.

### Lobby, Konto und Suite-Integration

Die gemeinsame Spielauswahl zeigt die freigeschalteten Spiele mit Symbolen und
Namen; das aktuelle Spiel ist markiert. Der Einstieg nennt Hausdepp, solange
Hausdepp geöffnet ist. Ein Tipp oder `Alt+Shift+Z` öffnet die Auswahl; erst die
Wahl eines Spiels führt zu dessen Lobby. Auf dem Handy erscheint ein
Auswahlfenster am unteren Rand. Hausdepp ist für alle auffindbar; Mitspielen
erfordert eine Anmeldung. Installierte Apps behalten Ursprung und Service Worker.

Die Lobby zeigt eigene offene Tische mit Spielstatus und belegten Plätzen.
Neue Tische erhalten beim Erstellen automatisch einen zufälligen Wirtshausnamen
aus 50 Varianten mit dem aktuellen Kontonamen, etwa „Manis Gsuff“. Es gibt kein
zusätzliches Namensfeld; im Turnier bleibt der einmal gewählte Tischname bestehen.
Der Einstieg bietet den kontoweit gespeicherten Favoriten oder „Modus definieren“.
Wählbar sind eine feste Spielerzahl (2–6) oder offen bis sechs, Schnellspiel oder
Turnier und optional ein Passwort. Menschen und CPUs zählen gemeinsam; das eigene
Konto belegt einen Platz. Im Warteraum stehen kompakte Platzkarten. Der Gastgeber
kann CPUs einzeln hinzufügen/entfernen und startet ausdrücklich: offen ab zwei
Teilnehmern, fix erst bei vollständiger Besetzung. Alle Menschen müssen verbunden
sein. Ein Mensch nimmt zuerst einen freien Platz und ersetzt bei vollem Wartetisch
einen CPU. Nach Spielstart ist die Besetzung fest.

„Als Favorit speichern“ übernimmt Spielerzahl, Offen/Fix, Spielart, aktuelle CPU-
Anzahl und die Wahl eines Passwortschutzes in das eigene Konto. Das tatsächliche
Passwort wird nie im Favoriten gespeichert und muss beim Erstellen neu festgelegt
werden. Der konkrete Tischzugang bleibt nur für diese Browsersitzung beim eigenen
Konto verfügbar; das Passwort erscheint weder im Tischlink noch in einer URL.
Teilen, Kopieren und Mitspieler-Ruf bleiben direkt erreichbar. Wiederaufnahme
führt an denselben Sitz zurück.

Vier schnelle Reaktionen starten mit 👍 😂 😮 💩. Der Pfeil nach oben öffnet zwölf
Symbole. Eigene bestätigte Sendungen bestimmen die persönliche Häufigkeit in
diesem Browser, getrennt nach Konto. Die vier Positionen bleiben während einer
Partie stabil; erst der nächste Einstieg übernimmt eine neue Rangfolge. Auswahl,
Escape und ein Tipp ausserhalb schliessen die Auswahl; der Schliess-Tipp spielt
keine darunterliegende Karte.

An einem ungeschützten Wartetisch kann ein sitzender Spieler ausdrücklich per
**Mitspieler-Ruf** nach weiteren Menschen suchen. Ein voller Wartetisch mit
ersetzbaren CPUs bleibt dabei für menschliche Mitspieler offen. Es gelten dieselben Kontoeinstellungen wie
in ZDWA und Zilch: Browser-/Gerätefreigabe, aktivierte Mitspieler-Rufe und die
private Absenderauswahl. Sender und Empfänger müssen bei der Anfrage und vor
dem Versand weiterhin für Hausdepp freigegeben sein; Selbstbenachrichtigungen
sind ausgeschlossen. Der Ruf zeigt auf einem Push-fähigen Gerät eine
Systembenachrichtigung mit Hausdepp-Icon, die direkt zum Tisch führt.

Die gemeinsamen Einstellungen unter `/hausdepp/konto/einstellungen` übernehmen die
Geräteanmeldung und getrennten Push-Kategorien. Hausdepp-Installationen werden
mit dem Produktkontext `hausdepp` gespeichert, ohne das Gerät als ZDWA oder Zilch
auszugeben. Eine tägliche Hausdepp-Erinnerung
ist damit nicht zugesagt. Ein Konto kann höchstens einmal pro Minute rufen,
auch spielübergreifend. Nach einem Versandversuch gilt zusätzlich die
zehnminütige Raumsperre. Ohne erreichbare freigegebene Empfänger bleibt die
Minutensperre bestehen; es werden keine Namen oder Abonnentenzahlen angezeigt.
Teilen oder Kopieren des Tischlinks ist ein eigener aktiver Vorgang und löst
keinen automatischen Push aus. Der Link hebt die Zugangsbeschränkung nicht auf.

Unter **`/hausdepp/konto`** verwendet Hausdepp das bestehende Suite-Konto und
zeigt ausschliesslich dessen eigene gespeicherte Ergebnisse. Die Übersicht
zählt abgeschlossene Runden, Runden als Hausdepp und Runden mit leerer eigener
Hand. Die private Historie zeigt Tischname, Zeitpunkt, eigenes Ergebnis und
Mitspieler einschliesslich Computer; ältere Runden können nachgeladen werden.
Laufende oder abgebrochene Partien sind keine abgeschlossenen Ergebnisse.
Fehlende Ergebnisse werden als leerer Verlauf erklärt, nicht durch Beispieldaten
ersetzt. Allgemeine Kontoeinstellungen bleiben unter **`/hausdepp/konto/einstellungen`**.

Diese Zähler bleiben beschreibende Statistiken neben den Erfahrungspunkten. Hausdepp-
Ergebnisse bleiben von öffentlichen Ranglisten und Aktivitäten getrennt. Die
Regelseite unter **`/hausdepp/regeln`** bietet einen Schnellstart, direkt
anspringbare Regeln, Beispiele und Begriffe auf Deutsch und Englisch. Die
Detaillierung ändert keine der hier bestätigten Regeln.

### Rundensiege, Rangliste und Turniere

Alle Spieler ausser dem Hausdepp einer abgeschlossenen Runde erhalten einen
**Rundensieg**. Das bestimmt keinen alleinigen Sieger und keine Reihenfolge
gleichzeitig fertig gewordener Hände. Die private Rangliste unter
`/hausdepp/rangliste` zählt diese Siege pro menschlichem Konto. Gleiche
Siegzahlen teilen sich einen Rang; aktuelle Kontonamen, Rundenzahl und
Siegquote werden angezeigt. Tischgrössen von zwei bis sechs sind filterbar.
Computer und deaktivierte Konten erscheinen nicht in der Rangliste.
Der Bereich **Neueste erreichte Erfolge** (`/api/hausdepp/achievements/recent`,
nur angemeldet) listet die jüngsten Freischaltungen aktiver Konten mit
Kontoname, Erfolg, EP, Schwierigkeit (10 EP leicht, 25 EP mittel, 50/100/250/500 EP
schwer) und Zeitpunkt. Konto-IDs, Avatare, Quellrunden und Karten verlassen den
Server nicht.

Beim Erstellen kann der Host statt einer Einzelrunde ein **HAUSDEPP-Turnier**
wählen. Alle zwei bis sechs Teilnehmer behalten ihre Plätze am selben Tisch.
Nach jeder verlorenen Runde wächst nur beim betreffenden Spieler das Wort:
**H → HA → HAU → HAUS → HAUSD → HAUSDE → HAUSDEP → HAUSDEPP**.
Der erste Spieler mit acht Niederlagen ist der **Tages-Hausdepp**; das gesamte
Turnier endet sofort. „Tages-“ bezeichnet dieses Turnier, keine automatische
Gruppierung nach Kalendertagen. Es gibt keine feste Rundenzahl. Bei sechs
Teilnehmern sind höchstens 43 Runden möglich, bevor jemand acht Niederlagen hat.

Zwischen den Runden zeigt der Tisch Buchstaben und Niederlagen aller
Teilnehmer. Der Host startet die nächste Runde aktiv; der Geber wechselt im
Uhrzeigersinn. Es wird neu gemischt und nach den unveränderten Hausregeln
abgehoben und ausgeteilt. Tischadresse, Kontozuordnung und Wiederaufnahme bleiben
stabil; jede abgeschlossene Runde erhält einen eindeutigen Ergebnisbeleg.
Veraltete oder doppelte Befehle dürfen keine zweite Runde starten, Buchstaben
verdoppeln oder Punkte erneut vergeben. Ein Server-Neustart zwischen zwei
Runden stellt genau diesen Zwischenstand wieder her.

Der Host kann das Turnier zwischen Runden ausdrücklich beenden. Die bereits
abgeschlossenen Runden, Siege und EP bleiben bestehen; es entstehen kein
Tages-Hausdepp und keine abschliessenden Turniererfolge. Auch für die Wartezeit
zwischen Runden gilt die einstündige Inaktivitätsfrist. Ein Turnier gibt keine
zusätzlichen wiederholbaren EP: Jede abgeschlossene Runde gibt 10 EP nur mit
Menschen oder 2 EP, sobald mindestens ein Computer mitspielt (75 % Reduktion,
je Runde auf ganze EP abgerundet). Auch ein
gemischter Tisch zählt als Runde mit Computer. Abschliessende Turniererfolge
behalten ihre volle einmalige EP-Belohnung. Die neuen Comeback-, Karten- und
Turniererfolge ergänzen die ursprünglichen 64 zum Gesamtkatalog von 100.

### Gemeinsam neu erstellen und Wartefrist

Nach einer beendeten oder abgebrochenen Partie eröffnet **Neu erstellen** einen
Folgetisch mit derselben Platzanzahl, Computerzahl, Einzelrunde oder Turnier
und Schutzoption. Mehrere Klicks verschiedener bisheriger Teilnehmer führen
zum selben Folgetisch. Die Computer bekommen erneut zufällige Namen. Frühere
menschliche Teilnehmer erhalten eine kontogebundene Einladung; erst Annehmen
bringt sie in den gemeinsamen Wartebereich. Schliessen des Hinweises gilt nicht
als Annahme oder Ablehnung. Die reservierten Plätze gelten 15 Minuten, danach
können sie wieder anderweitig belegt werden. Ein angenommenes Angebot kann bis
zum Schliessen des Wartebereichs wieder aufgenommen werden. Das neue Spiel
startet nach den üblichen Regeln; ein laufendes Turnier behält zwischen Runden
stattdessen seine Aktion **Nächste Runde**.

Wartende Hausdepp-Tische schliessen nach einer Stunde seit Erstellung oder dem
letzten neu besetzten menschlichen Sitz. Zuschauer, Wiederverbindung, Ping und
Chat setzen die Frist nicht zurück. Der Abbruch erzeugt keine zusätzlichen
Siege, EP oder Erfolge; schon abgeschlossene Turnierrunden bleiben gewertet.

### Weitere Verfeinerungen

Der öffentliche V3-Start ist freigegeben. Weitere Spieltests können Gestaltung
und Verständlichkeit verfeinern; das führt keine erneute Zugangssperre ein.

| Bereich | Stand ab V3 | Noch offen |
| --- | --- | --- |
| Lobby und Tisch | Echte Mehrspielerpartien, Computer-Mitspieler, Zugang für aktive Konten, Tischstatus, direkte Aktionen | Weitere Verfeinerungen nach Spieltests |
| Regeln | Vollständige DE-/EN-Hausregeln mit Schnellstart, Beispielen und Sprungmarken | Verständlichkeitsprüfung durch den Owner |
| Punkte | Je abgeschlossener Runde 10 EP nur mit Menschen oder 2 EP mit mindestens einem Computer (75 % Reduktion, abgerundet); Erfolge einmalig volle 10/25/50/100/250/500 EP | Weiteres Balancing nach Spieltests |
| Achievements | Bestätigter Katalog mit 136 Erfolgen, 24 Rängen und eigenen Aufstiegssprüchen | Weitere Gestaltungs- und Spieltests |
| Konto | Private Statistik und Historie, EP, Rangfortschritt, Rangleiter und filterbare Erfolgssammlung | Weitere Gestaltungsverfeinerungen |
| Chat und Reaktionen | Gemeinsame Suite-Funktionen am Tisch und Lobbychat | Weitere Verfeinerungen nach Spieltests |
| Weitere Runden | Einzelrunden über die Lobby; Turnierserie am selben Tisch mit Geberrotation und Buchstabenstand | Weitere Gestaltungs- und Spieltests |
| Vorbereitung | Aktives Anschauen und kurze, nicht sperrende Austeilbewegungen | Weitere Verfeinerungen nach Spieltests |

### Bestätigte Punkte, Erfolge und Ränge

Der Owner hat den [Katalog mit 136 Erfolgen und 24 Rängen](HAUSDEPP_ACHIEVEMENTS.md)
freigegeben. Jede regulär abgeschlossene Runde nur mit Menschen gibt dem
beteiligten Konto **10 Erfahrungspunkte (EP)**. Sobald mindestens ein Computer
am Tisch mitspielt, wird die Basis um 75 % reduziert und **je Runde auf ganze
EP abgerundet: 2 EP**.
Das gilt auch für gemischte Tische und für jede einzelne abgeschlossene
Turnierrunde, unabhängig davon, ob das Konto fertig oder Hausdepp der Runde
geworden ist. Es gibt keine Bruchteile: Drei Runden mit Computer ergeben
zusammen 6 Runden-EP.

Jeder Erfolg gibt weiterhin einmalig seine vollen **10, 25, 50, 100, 250 oder 500 EP**,
auch mit Computer und bei Turniererfolgen. Mehrere Erfolge können in derselben
Runde freigeschaltet werden. Es gibt keine Minuspunkte und keinen wiederholbaren
Zusatzbonus fürs Verlieren. Abgeschlossene Runden und Siege zählen weiterhin
voll in der Statistik; bestehende Freischaltungen werden nicht erneut vergeben
oder durch die geänderte Rundenbelohnung entfernt. Computer selbst haben kein
Punktekonto.

Die neue Gewichtung gilt auch für belegte bereits abgeschlossene Runden mit
Computer. Deren Runden-EP werden neu berechnet; Rundenhistorie, Siege,
Erfolgsbelohnungen und erreichte Erfolgsanzahl bleiben erhalten.

Die dauerhafte Leiter beginnt bei **Einstein mit 0 EP** und endet bei
**Hausdepp mit 9’000 EP**. Der dauerhafte Titel bleibt getrennt vom **Hausdepp
einer einzelnen Runde**. „Fertig werden“ zählt erst bei leerem Nachziehstapel;
eine zwischenzeitlich leere Hand mit offenem Pflichtziehen reicht nicht.
Aufgenommene oder abgeräumte Paketgrössen zählen die dabei gespielte Karte mit.
Vierer-Erfolge betreffen die Ränge 6 bis Ass; Zehner räumen nach ihrer eigenen
Regel ab. Nachwürfe zählen nur innerhalb des tatsächlich offenen Nachwurfrechts.
Eine ununterbrochene Abräumfolge darf Pflichtziehen enthalten; ein fremder
Lege-, Zock- oder Aufnahmezug beendet sie.

Die Vergabe erfolgt erst nach Abschluss und Speicherung der Runde. Eindeutige
Runden- und Erfolgsbelege verhindern doppelte Punkte bei Wiederaufnahme oder
erneuter Finalisierung. Teilnahme-, Gesellschafts- und Ergebniserfolge können
aus vorhandenen gültigen Ergebnissen entstehen; besondere Kartenaktionen
werden ausschliesslich aus neu erfassten Spielereignissen abgeleitet. Alte
Runden oder bereits laufende Runden ohne vollständigen Beleg erhalten keine
erfundenen taktischen Erfolge. Verdeckte Abhebeinformationen und daraus
entstandene Erfolge bleiben im eigenen Konto.

Das Konto zeigt Runden- und Erfolgs-EP getrennt, den nächsten Rang, die ganze
Rangleiter sowie eine durchsuchbare Sammlung mit Status, Bedingungen und
Fortschritt. Innerhalb jeder Gruppe stehen erreichte Erfolge oben, offene
darunter. Häufige Ziele zählen passende unterschiedliche abgeschlossene Runden,
höchstens einmal je Runde und Ziel. Seltene Einzelkunststücke bleiben unmittelbar
erreichbar; es gibt kein pauschales Freischaltungslimit und keine spätere
Warteschlange von Erfolgen. Jeder Rang hat einen eigenen ursprünglichen DE-/EN-Spruch, keine
als historisch ausgegebenen Zitate. Der allgemeine Aufstiegstext lautet
**„Gratuliere! Dem Hausdepp wieder einen Schritt näher.“** Newton ergänzt
**„Ab jetzt geht’s bergab. Ganz nach den Naturgesetzen.“**, der Schlussrang
**„Geschafft. Mehr Hausdepp geht nicht.“** Neue Erfolge und jeder erreichte
Aufstieg ab Stufe 2 werden nach Rundenende einzeln gezeigt: Name, volle einmalige
Erfolgs-EP, Bedingung und belegbare eigene Qualifikationszahl mit Rundendatum und
Tischgrösse. Aufstiege zeigen die erreichte EP-Schwelle und geben keine Bonus-EP.
Beim nächsten Hausdepp-Einstieg erscheinen auch bereits früher verdiente Erfolge
und Ränge einmalig, unabhängig von früher bestätigten Sammelmeldungen. Nur
„Weiter“ bestätigt genau diese Meldung dauerhaft für das eigene Konto;
Schliessen, Escape oder „Später ansehen“ lassen sie offen. Punkte und Erfolge
werden dabei niemals erneut vergeben. Bestehende, vor einer Zielverschärfung
freigeschaltete Erfolge werden ehrlich als damaliger Freischaltstand erklärt.
Während aktiver Partien und Einsteigertouren warten die Meldungen; sie ändern
keine Spielaktion und kein Nachwurfrecht. Eine alte Bestätigung verdeckt keine
später hinzugekommenen Erfolge oder Aufstiege.

### Entwicklung und Lieferung

Hausdepp wird als öffentlicher **V3.0.0**-Major-Release der gemeinsamen Suite
geführt. Die Veröffentlichung ist ausdrücklich freigegeben; technische
Prüfungen, Deploy und anschliessende Produktionskontrolle bleiben getrennte
Nachweise. Es gelten die Versions- und Lieferregeln aus
[PRODUCT_DELIVERY.md](PRODUCT_DELIVERY.md): DE-/EN-Texte, Dokumentation,
geeignete Prüfungen und unveränderte historische Versionszuordnungen.
Persönliche Konto-, Ranglisten- und Spielseiten bleiben `noindex`; nur Lobby
und Regeln sind öffentliche Suchziele. Historische QA-Berichte behalten ihren
damaligen privaten Prüfstand und werden nicht nachträglich umgeschrieben.

## English

### Quick start for players

1. **Match or beat the top card.** Tap a permitted hand card. Matching ranks may
   be played together or in quick succession. A 10 or four consecutive cards of
   one rank clears the pile and lets you play again.
2. **Refill to three.** If fewer than three cards remain after playing, tap the
   face-down pile. One tap takes every missing card. The next player may already
   play from hand; the stock waits for the oldest pending refill.
3. **Finish only when the draw pile is empty.** Only then does an empty hand
   finish you. The last player still holding cards is the Hausdepp of the round.

Before playing, the face-down pile means **take a chance**; afterwards, while a
refill is pending, it means **refill**. Tapping the open pile means **pick it all
up**. Taking a chance commits the revealed card to play. If it is too low, you
must pick up the entire pile, including that card.

### Product and public access

The game is called **Hausdepp**, the name used by the owner's own gaming group.
It is a distinct addition to the existing ZDWA/Zilch suite and is reached
through its game switcher. The rules below describe this house variant. Rules
from another game also called “Hausdepp” must not be imported without an
explicit decision.

- The usual player count is **2–5**, with an absolute maximum of **6**.
- There is no separate solo mode. The first playable milestone already needs
  a computer opponent that takes its own turns.
- That milestone includes a real multiplayer lobby and a table at which these
  rules can be played in full, rather than a design preview alone.
- From V3, the lobby and rules are public without sign-in. Every active
  signed-in account can create, join and watch tables. The former owner/founder
  restriction no longer applies to playing. Account, standings, game pages and
  personal APIs still require sign-in; opposing hands and personal results stay
  protected.
- One account occupies one seat. Another device using that account resumes the
  same seat instead of creating another player.
- Suite integration uses existing accounts, game selection, chat, reactions
  and reconnection. A shared table link first takes signed-out visitors through
  the existing login and then back to the table. It grants no extra permission.

The canonical entry is
**`https://hausdepp.zockdiewandan.online/hausdepp`**, with public rules at
**`/hausdepp/regeln`**. The host's `/` redirects to the lobby. Only those two
documents are indexable and included in its sitemap. Existing `/hausdepp`
paths on other suite origins remain available for installed apps. Ordinary
browsers use the dedicated host when switching; installed apps retain their
origin and worker. Shared sign-in returns through the existing safe suite
login to the allowlisted Hausdepp destination, using the same account.
Mission Control and its Hausdepp details retain their separate
founder/dashboard authorization.

### Design and platforms

The design was originally planned with Impeccable. The plugin is unavailable in
this session; the current implementation is checked directly in the browser
and documented in the design contract. Hausdepp receives its own visual
identity, drawing on Zilch's tavern-table atmosphere and the specified playing
cards. Interaction is designed mobile first and must work in portrait and
landscape on phones, tablets and desktop devices.

The owner's card references show traditional double-headed German-suited cards
in the Tell/seasons pattern and the red, black and white Blitz back of the
pictured Piatnik deck. They establish the desired visual language. The
development build renders these cards using individually aligned, rounded image crops. Sources, licences and adaptations
are recorded in [HAUSDEPP_ASSETS.md](HAUSDEPP_ASSETS.md). The design direction is
chosen; further playtests will refine the actual UI and UX.

### Cards and terminology

There are **36 cards**: four suits—hearts, bells, leaves and acorns—with nine
ranks each. Suits do not affect the confirmed rules for playing a card.

The rank order, from lowest to highest, is:

**6 < 7 < 8 < 9 < Unter < Ober < King < Ace < 10**

“Equal” means the same rank, regardless of suit. The 6 of bells (Weli) is an
ordinary 6 here and has no special function. Card rank and experience points
are different concepts. Cards carry no penalty values; experience comes from
completed rounds and achievements.

- **Draw pile:** the face-down cards still available. Cards are always drawn
  from its top.
- **Open pile:** the cards played face up in the centre. Its top card determines
  the rank to beat or match.
- **Cleared cards:** a pile removed by a 10 or four equal ranks. These cards are
  out of play for the rest of the round.
- **Finished:** a player has no cards left after completing any required refill,
  and the draw pile is empty.

### Preparation: mandatory inspection from the bottom

The dealer shuffles. The first dealer at a table is drawn at random, against
computers and people alike; seat order plays no part. In a tournament the deal
passes clockwise to the next player after each round. Play proceeds clockwise.
The player immediately before
the dealer in that order looks privately at the bottom card of the face-down
deck. Looking, continuing after an ace and keeping cards on success are
mandatory. There is no opting out, declining or stopping early. The designated
player actively taps the face-down pile to inspect one card. After each ace,
another tap continues the inspection. A computer performs its own peek actions.

1. If the bottom card is a **10**, the player receives that single card.
2. If it is an **ace**, the player looks at the next card above it in the
   remaining deck. Each further ace continues this inspection.
3. If a **10** follows the aces, the player receives all inspected aces and
   exactly that one 10. These cards are briefly shown to everyone, then become
   part of the player's hand. A lone successful 10 is also shown.
4. Inspection stops at that 10. No further card is inspected.
5. If a card other than an ace or 10 appears before a 10, the attempt fails.
   The player receives **no** cards. All inspected cards stay at the bottom of
   the deck in their original order and are not shown to other players. The
   inspecting player retains knowledge of those cards: while they remain in
   the stock, only that player sees a short label (“Bottom: Ace · King”) on the
   face-down pile, and the cards stay viewable in the table help.

Examples: `10` gives one 10; `Ace → Ace → 10` gives three hand cards;
`Ace → Ace → King` gives no hand cards. The arrows show inspection order,
starting at the bottom and moving into the deck.

### Dealing and the opening card

After inspection, cards from the top of the deck bring each player to **at least
three hand cards**. A player who already received one or two cards gets two or
one additional cards respectively. A player with three or more receives no
additional cards. Three is the minimum hand size, not a maximum.

The top card of the remaining draw pile is then placed face up in the centre.
If it is a **10**, it is reinserted at a random position in the face-down draw
pile and the top card is revealed again. Repeat for every further 10 until a
different rank appears. Any other card is allowed as the opening card.

Short card movements from the stock to the seats show the deal. They do not
block gameplay and do not repeat after reloading. The player immediately after
the dealer clockwise takes the first turn.

### Standard turns

The active player has the following options:

1. **Play from hand:** Play one card or several cards of the same rank. That
   rank must match or exceed the top card of the open pile. Any rank may be
   played on an empty table.
2. **Pick up the open pile:** Take every open card into hand, including
   voluntarily. The next remaining player then takes their turn. Picking up
   an empty pile as a way to pass is not a valid action.
3. **Gamble:** Reveal the top draw-pile card and commit it to the open pile.
   An equal or higher card succeeds. A lower card makes the player pick up the
   entire open pile, **including the gambled card**; the next player then takes
   their turn. Gambling follows the same rules as playing from hand, including
   the clearing rules. Gambling is unavailable when the draw pile is empty.
4. **Clear with a 10:** Play a 10. The entire open pile, including that 10, is
   removed from the round regardless of the previous top card.

After a successful ordinary play or gamble that does not clear the pile, play
passes immediately to the next remaining player. They may play from hand
before the previous player refills. The additional-card right described below
remains available until that player's first accepted action.

### Four equal ranks and playing again

If **four consecutive cards of the same rank** form the top of the open pile,
the entire pile is also removed from the round. It does not matter whether the
earlier cards came from this player or from others. The player who adds the
fourth card completes the set.

The normal rank rule still applies when making a four-card set: four matching
cards may be played on an empty table or on a rank no higher than their own.
Cards already at the top with the same rank may be completed with the missing
cards.

A player who clears the pile with a 10 or four equal ranks may **play again**.
This right applies immediately: they may play existing hand cards even while
a refill is pending. Refilling remains mandatory. If they have finished with
an empty draw pile, they are skipped and the next remaining player leads there.

### Mandatory refill by tapping the pile and adding matching cards

After a complete play, a hand below three cards must be refilled from the top
while draw cards remain. **Refilling is not automatic:** One tap on the face-down
pile takes all missing cards up to a hand of three at once, or all remaining
cards if fewer are available. A hand of three or more cards needs no refill.
As an optional convenience, each account may turn on **Refill to three
automatically** (table help or account settings, off by default). The game
then taps the pile once as soon as the player's own refill is due. Rules, order
and the additional-card window do not change; an additional card may be tapped
behind that refill.

**Slow drawing does not hold up hand plays.** The next player may play
immediately. Access to the face-down pile follows the oldest pending refill:
until it is complete, later players can neither draw nor gamble. Further refill
obligations join the end of that queue. The player who must draw now sees
**“You must draw”** inside a gently pulsing red frame. With reduced motion the
frame stays static. Other players see whose refill is holding the stock.

Before playing from hand, tapping the face-down pile means **gambling**, provided
no earlier refill blocks the stock. Refilling before playing is not allowed.
When the player's own refill is pending after a play, that tap only refills their
hand once their obligation reaches the front; gambling is unavailable.

If a play cleared the pile, the same player keeps a **new full turn on the empty
table**. They may play hand cards immediately, or gamble once no refill remains
pending and the stock still has cards. For example, after clearing with a 10 and
refilling to three aces, they may still gamble. Without a clearance, the turn
passes immediately. A delayed refill changes neither the current turn nor an
already closed additional-card window.

The hand is sorted in ascending order from left to right, with tens at the far
right. **Tapping a hand card plays it immediately**, without another confirmation.
Further matching cards can be tapped in quick succession while the additional-
card right remains open.

Alternatively, **Select multiple cards** marks cards of the same rank for one
combined play. The first tap selects every playable card of that rank; each
further tap removes or re-adds a single card. Selected cards lift and carry a
check mark. Selection itself sends no game action; **Play cards** submits
the complete selection atomically. This also works for a valid additional-card
play. When another accepted action closes that window, an unplayed selection
is visibly cleared. Computers take about 12.5% longer within their varied
normal timing; this never guarantees an additional-card window.

Tapping the **open pile** instead deliberately picks up the entire pile into
the player's hand. Picking up ends the turn. An empty table cannot be picked up.

The player may **add further cards of the rank they just played**. These may be
newly drawn cards or matching cards initially kept in hand. Adding them is
optional. Any required refill after an additional play is again completed by
tapping the pile; this sequence may repeat. An added card can complete four
equal ranks and therefore grant another lead.

This right ends with the **next player's first accepted action**, including
playing a card, picking up the pile or revealing a gamble card. Accepted
actions must not subsequently be reordered by an additional card. Command acknowledgements
order quick card actions; no fixed timer or artificial lock is a game rule.
Computers vary their reaction time, mixing quick responses with longer pauses.
Following their own clearance, they often play again more quickly. A human
additional card therefore has no guaranteed time window.

### Endgame and end of the round

If the remaining draw cards cannot refill a hand to three, the player draws
only the cards still available. Once the draw pile is empty, the minimum hand
size no longer applies and gambling is unavailable. Pending refill obligations
then end; all hands that have become empty are checked together for finishing.

**Refill first, then check whether the player has finished.** A temporarily
empty hand does not finish the round for a player who must still draw. This
also applies after playing a 10 or completing four equal ranks.

A player who then has no hand cards and faces an empty draw pile is finished
for this round and is skipped on subsequent turns. Adding matching cards can
also finish a player's hand. If their final card cleared the pile, the next
remaining player leads on the empty table.

As soon as only **one player still has hand cards**, the round ends immediately.
That player is the **Hausdepp of this round**. A remaining open pile does not
change this result. The other players need not take any further actions. These
rules identify the last player rather than one sole winner. Round and
achievement experience is awarded separately from that outcome.

High matching cards and saved 10s can help in the endgame: a 10 clears the pile
and grants another turn if the player still has hand cards. This is tactical
advice, not an additional special rule.

### Visible hands and card movement

Round results keep status labels, avatars, player names and round XP separate
and readable, including “Remaining” and “Withdrawn” on small screens.

Your own hand stays face up and sorted. Other players show one card back for
every hand card, with the exact count also beside their name. Opposing ranks and
suits remain private. Large hands use a denser fan without omitting any cards.

Dealing and mandatory refills travel from the face-down stock to the hand.
Picking up moves the open pile into the hand. A failed gamble first moves the
new card from stock to pile, then the complete pile into the hand. Hand plays
travel to the middle. Once a play, follow-up or successful gamble is accepted,
the growing open pile immediately shows its current count and matching-rank fan.
Active card flights never delay that display. Presentation never blocks turns, changes additional-card
rights or repeats missed actions after reconnecting. Reduced motion acknowledges
arrival without spatial travel.

### Technical boundaries

- The server validates card ownership, turn rights, rank comparisons, drawing,
  additional cards, clearing and round completion. Concurrent actions need a
  single accepted order.
- Private views contain only the player's own hand and information available
  under the rules. Other hands and the face-down deck order must not be sent
  to other players. Failed bottom inspections stay private; the mandatory
  reveal on success is an explicit public-information event.
- The computer opponent takes real turns using the same permissible information
  as a human player, including cards it inspected itself where applicable.
  Hidden opposing cards must not influence its decisions.
  It considers guaranteed finishes from its own cards, quartets and individual
  tens held in reserve. A strong small hand may gamble while enough stock
  remains; near depletion it weighs a pickup against the added risk.
  See [HAUSDEPP_CPUS.md](HAUSDEPP_CPUS.md) for the policy and tests.
- Reconnection and additional devices using the same account must recover the
  same authoritative state and the same seat.

### Lobby, account and suite integration

The shared picker shows available games with icons and names, marking the
current game. Its trigger names Hausdepp while Hausdepp is open. Tap or press
`Alt+Shift+Z` to open the picker, then choose a game's lobby. Phones use a
bottom sheet. Everyone can discover Hausdepp; playing requires sign-in.
Installed apps retain their origin and service worker when switching.

The lobby shows your open tables with game status and occupied seats. New
tables automatically receive a random tavern-style name from 50 variants built
around the current account name, such as “Mani’s nightcap”. No separate name
field is needed; the chosen table name remains throughout a tournament. Humans
and CPUs count together; your account occupies one seat. The entry offers your
account-wide favourite or Define a mode: fixed 2–6 or open up to six, quick game
or tournament, with an optional password. Place cards show the roster. The host
adds/removes CPUs and starts explicitly, with at least two participants in an
open room or every chosen seat filled in a fixed room. All humans must be
connected. People take free seats first, then replace one CPU at a full waiting
table. The roster becomes final on start.

Saving a favourite stores only the setup and the choice of password protection,
never the password. Protected favourites ask for a fresh password. The concrete
table password stays only in this browser session, separated by account; it
never enters a shared link or URL. Sharing, copying and player calls remain
available. Resuming returns to the same seat.

Four quick reactions begin with 👍 😂 😮 💩; the up arrow opens twelve symbols.
Only your own confirmed sends determine personal frequency in this browser,
separately for each account. Positions remain fixed during a game; the next room
uses the new ranking. Selecting, Escape or an outside tap closes the picker;
the dismissal tap never plays an underlying card.

At an unprotected waiting table, a seated player can explicitly **call for
players** while a human seat is available, including a full waiting table
with a replaceable CPU.
The same settings apply as in ZDWA and Zilch: browser/device permission,
enabled player calls and the private sender allowlist. Both sender and
recipient must retain Hausdepp access when requested and before dispatch;
self-notifications are excluded. On a push-capable device, the call displays
a system notification with Hausdepp's icon and a direct link to the table.

Shared settings at `/hausdepp/konto/einstellungen` handle device registration and separate
push categories. Hausdepp installations are saved with product context
`hausdepp`, without registering the device as ZDWA or Zilch. This does not
promise a daily Hausdepp reminder. An account
can call at most once a minute across games. A delivery attempt additionally
starts the table's ten-minute cooldown. With no reachable authorized recipients,
the account's minute cooldown remains; no names or subscriber counts are shown.
Sharing or copying a table link is a separate explicit action and never sends
an automatic push. The link does not bypass access restrictions.

At **`/hausdepp/konto`**, Hausdepp reuses the existing suite account and shows
only that account's own saved results. The overview counts completed rounds,
rounds as the Hausdepp and rounds finished with an empty hand. Private history
shows the table name, time, own outcome and participants including computers;
older rounds can be loaded. Running or aborted games are not completed results.
An empty history is explained without sample data. General account settings
remain at **`/hausdepp/konto/einstellungen`**.

These counters remain descriptive statistics alongside experience points. Hausdepp results
remain separate from public rankings and activity. The rules page at
**`/hausdepp/regeln`** provides a quick start, linked sections, examples and
terminology in German and English. Explaining the rules adds no new gameplay.

### Round wins, standings and tournaments

Every player except a completed round's Hausdepp earns a **round win**. This
does not create a sole winner or rank hands that finished simultaneously.
Private standings at `/hausdepp/rangliste` count wins per human account. Equal
win totals share a place; current account names, round counts and win rates are
shown. Table sizes two through six can be filtered. Computers and inactive
accounts are excluded.
The **Latest achievements earned** section (`/api/hausdepp/achievements/recent`,
signed in only) lists active accounts' newest unlocks with account name,
achievement, XP, difficulty (10 XP easy, 25 XP medium, 50/100/250/500 XP hard) and time.
Account IDs, avatars, source rounds and cards never leave the server.

When creating a table, the host can choose a **HAUSDEPP tournament** instead of
one round. The same two to six participants retain their seats. Every round
loss extends only that player's word:
**H → HA → HAU → HAUS → HAUSD → HAUSDE → HAUSDEP → HAUSDEPP**.
The first player with eight losses becomes the **day's Hausdepp**, immediately
ending the whole tournament. “Day's” names this tournament's outcome; it does
not group sessions by calendar day. There is no fixed round count. With six
participants, at most 43 rounds can occur before someone reaches eight losses.

Between rounds the table shows everyone's letters and losses. The host actively
starts the next deal, and the dealer rotates clockwise. Each round reshuffles,
inspects and deals under the unchanged house rules. The table URL, account
membership and resume flow remain stable; every completed round has a distinct
result record. Stale or duplicate commands cannot start another round, double
letters or duplicate XP. Restarting the server between rounds restores that
exact session state.

The host can explicitly end the tournament between rounds. Completed rounds,
wins and XP remain, but there is no day's Hausdepp or final tournament award.
The one-hour inactivity deadline also applies between rounds. Tournaments add
no repeatable XP bonus: each completed all-human round grants 10 XP, or exactly
2 XP if any computer is at the table, including mixed tables: a 75% reduction
of the base reward, rounded down separately for each round. Final tournament
achievements retain their full one-time XP reward. The added comeback, card and tournament feats
extend the original 64 achievements to a catalogue of 100.

### Creating again together and the waiting deadline

After a completed or aborted game, **Create again** opens one follow-up table
with the same seat count, computer count, single-round or tournament format and
protection option. Multiple previous participants clicking it reach the same
table. Computers receive fresh random names. Previous human participants get
account-bound invitations; only Accept takes them into the shared waiting room.
Closing the prompt neither accepts nor declines. Seats are reserved for 15
minutes, then become available to others. An accepted invitation can be resumed
until the waiting room closes. The new game starts under the usual rules; an
ongoing tournament instead keeps its **Next round** action between rounds.

Waiting Hausdepp tables close one hour after creation or the last newly occupied
human seat. Spectators, reconnections, pings and chat do not reset the deadline.
An abort grants no extra wins, XP or achievements; already completed tournament
rounds keep their scores.

### Further refinements

The public V3 launch is approved. Further playtests may refine the appearance
and clarity without reinstating the former access restriction.

| Area | V3 status | Still open |
| --- | --- | --- |
| Lobby and table | Real multiplayer rounds, computer opponents, active-account access, table status, direct actions | Further playtest refinements |
| Rules | Complete German/English house rules with quick start, examples and anchors | Owner review for clarity |
| Points | Per completed round: 10 XP for all-human tables or 2 XP with any computer (75% reduction, rounded down); full one-time achievement rewards of 10/25/50/100/250/500 XP | Further balancing after playtests |
| Achievements | Approved catalogue of 136 achievements, 24 ranks and individual sayings | Further design and playtests |
| Account | Private facts/history, XP, rank progress, complete ladder and filterable achievement collection | Further design refinements |
| Chat and reactions | Shared suite features at the table and lobby chat | Further playtest refinements |
| Further rounds | Single rounds through the lobby; same-table tournaments with dealer rotation and letter scores | Further design and playtests |
| Preparation | Active inspection and short, nonblocking dealing movements | Further playtest refinements |

### Approved points, achievements and ranks

The owner approved the [100-achievement and 24-rank catalogue](HAUSDEPP_ACHIEVEMENTS.md).
Each regular completed all-human round gives every participating account **10
experience points (XP)**. Any computer seat reduces the base round reward by
75%, then rounds it down **per round to 2 XP**. This includes mixed tables and
every individual completed tournament round, regardless of the account's
outcome. No fractions are awarded: three rounds with a computer give 6 round XP.

Each achievement still grants its full **10, 25, 50, 100, 250 or 500 XP once**, including
computer and tournament achievements. Multiple achievements may unlock
together. There are no negative points or repeatable losing bonus. Completed
rounds and wins still count fully in statistics. Existing unlocks are neither
granted again nor removed by the changed round reward. Computers have no XP
account.

The new weighting also applies to proven previously completed rounds with
computers. Their round XP is recalculated; round history, wins, achievement
rewards and the number of unlocked achievements are retained.

The lasting ladder runs from **Einstein at 0 XP** to **Hausdepp at 9,000 XP**.
The lasting title remains separate from the **Hausdepp of an individual round**.
Finishing requires an empty stock; an empty hand with a pending refill is not
enough. Pile sizes include the card being played or unsuccessfully gambled.
Four-of-a-kind achievements use ranks 6 through ace; tens follow their own clear
rule. Additional throws count only within a still-open window. Consecutive
clears may include mandatory refills; another player's play, gamble or pickup
ends that sequence.

Awards are granted after a round is completed and saved. Unique round credits
and unlocks prevent duplicate points on reconnect or repeated finalization.
Valid existing outcomes can prove participation, social and outcome achievements;
detailed card feats require newly captured gameplay evidence. Old or already
running rounds without complete evidence receive no invented tactical feats.
Private bottom-inspection facts and their awards remain in the relevant player's own account.

The account itemizes round and achievement XP, next-rank progress, the complete
ladder and a searchable collection with conditions, status and progress. Earned
achievements lead each group. Common goals count distinct qualifying completed
rounds, at most once per round and goal; rare feats remain immediately attainable.
There is no artificial unlock cap or deferred award queue. Every rank has
original German/English flavour copy, with no fabricated historical
attribution. The general greeting celebrates another step closer to Hausdepp;
Newton adds the approved downhill/natural-laws joke. New achievements and each
reached rank from level 2 are presented individually after a round, with name,
full one-time achievement XP, condition and your own verified qualifying count,
round date and table size. Rank popups show their XP threshold and grant no
bonus XP. Your next Hausdepp entry also presents previously earned achievements
and ranks once, independently of older summary acknowledgements. Only Continue
confirms that specific item across your account; closing, Escape and View later
leave it pending. This never grants XP or achievements again. Retained unlocks
from before a harder goal are honestly explained as earned under the earlier
condition. Active games and beginner tours take priority, without changing any
game action or follow-up window. An old confirmation cannot hide newer items.

### Development and delivery

Hausdepp uses **V3.0.0**, a public major release of the shared suite. The visible
release is explicitly authorized; technical checks, deployment and subsequent
production verification remain separate evidence. Releases follow
[PRODUCT_DELIVERY.md](PRODUCT_DELIVERY.md), including complete German/English
text, documentation, appropriate checks and unchanged historical version
mappings. Personal account, standings and game pages remain noindex; only the
lobby and rules are public search destinations. Historical QA reports retain
the private development scope they originally verified.

## Ergänzte Bedienung / additional interaction contract

**Deutsch:** Der mobile Spieltisch ist ein festes Fenster ohne Seitenscroll.
Grosse eigene Hände dürfen im Fächer horizontal verschoben werden. Hilfen,
Einladungen, Chat und Ergebnisse nutzen interne Ablagen, ohne Hauptaktionen
zu verdecken. Ein beigetretener Mensch darf einen noch nicht gestarteten Tisch
aktiv verlassen. Sein Platz wird frei; das Hostrecht geht bei Bedarf an einen
verbleibenden Menschen. Der letzte Mensch schliesst den ungestarteten Tisch ohne
Ergebnis, EP, Turnierniederlage oder Abbruchwertung. Nach Spielbeginn gilt diese
Warteaktion nicht mehr. Ein Start-/Verlassen-Rennen darf keine laufende Runde verändern.

**English:** The mobile table is a fixed window without page scrolling. Large
hands may move horizontally inside their fan. Help, invitations, chat and results
use internal panels while the main actions stay reachable. A seated person may
actively leave an unstarted table. Their seat becomes free; host rights transfer
to a remaining person if needed. The last person closes the unstarted table
without a result, XP, tournament loss or abandonment score. This waiting action
is unavailable once play starts; a start/leave race must never change a live round.


### Inspecting and cleared cards

Hold the open pile, right-click it or use Shift + Enter to inspect its public
cards before pickup. **Inspect pile** in table help opens the same dialog.
Inspection does not play a turn; a short tap still picks up the pile immediately.
Cleared cards fly to a separate, untidy face-down **Out of play** stack with an
exact count. That stack is neither stock nor available for pickup. On the table it
shows a crossed-out card with the count; "Out of play" remains as the tooltip and
for screen readers.

Since 3.8.1 the stock and the open pile never fade, even while others are on turn.
A gold ring marks only what the player can tap (gamble, cut, take the pile); the
automatic refill does not light up. Names and hand sizes sit on dark plates, the
player on turn on a gold one; the turn line is a pill, gold on the own turn.
On phones the plate shows name and number in one line; with four or more
opponents all seats share one even row above the stacks.


### Seltene Funde und zwei Sammlungen / Rare finds and two collections (3.12.0)

Die acht seltenen Tischfunde haben je einen Erfolg fürs eigene Auslösen (50 EP)
und einen fürs Miterleben (25 EP). Vier unterschiedliche Funde bringen zusätzlich
100/50 EP, alle acht zusätzlich 500/250 EP. Der Auslöser sammelt beide Reihen.
Beim gültigen Auslösen müssen mindestens zwei menschliche Mitspieler verbunden
sein. Die damalige Teilnahme wird privat serverseitig festgehalten; ein späterer
Disconnect löscht sie nicht. Erst ein regulärer Rundenabschluss schreibt Erfolge
gut. Wiederholte Varianten erhöhen die Sammlung nicht. Zuschauer, Solo mit CPUs,
Offline-Spiel und Vorschauen zählen nicht. Alte Runden ohne diese Belege werden
nicht nachträglich als Fund interpretiert. Der Katalog umfasst 135 Erfolge und
5’605 Erfolgs-EP; die 24 Ränge bis 9’000 EP bleiben erhalten.

Each of the eight rare finds has an achievement for triggering it (50 XP) and
another for witnessing it (25 XP). Four different finds add 100/50 XP; all eight
add 500/250 XP. The activator collects both tracks. At least two human players
must be connected when the server accepts the activation. Their attendance is
recorded privately; a later disconnect does not erase it. Only a normally
completed round grants credit. Repeated variants do not grow either collection.
Spectators, solo CPU games, offline play and previews do not count. Old rounds
without these facts are not retroactively interpreted as discoveries. The
catalogue totals 135 achievements and 5,605 achievement XP; the 24 ranks ending
at 9,000 XP are retained.

### Einmaliger Bedienguide / One-time controls guide

Der erste eigene Spieltisch zeigt einen kurzen, ohne Spielaktion lesbaren Guide.
Langes Drücken auf eine **spielbare Handkarte** wählt die spielbaren Karten
ihres Werts für einen bestätigten Mehrfachwurf. Langes Drücken auf das **offene
Paket** zeigt nur die gerade darin liegenden öffentlichen Karten; abgeräumte
Karten bleiben ausser Sicht. Beide Gesten haben sichtbare Knopf- und
Tastaturalternativen. «Verstanden» bestätigt die Guide-Version einmalig im
Konto. «Später», × oder Escape schliessen nur für den aktuellen Besuch.
Automatische Guides lassen sich in den Einsteigertour-Einstellungen ausschalten;
dort ist auch die erneute Ansicht möglich. Der Guide steuert oder pausiert das
Spiel nicht und vergibt keine Punkte, Erfolge oder Spielaktionen.

The first own table shows a brief guide that needs no game action to read.
Holding a **playable hand card** selects playable cards of that rank for a
confirmed multiple-card throw. Holding the **open pile** reveals only the public
cards currently in it; cleared cards stay hidden. Buttons and keyboard shortcuts
provide alternatives. “Understood” acknowledges the guide revision once for the
account. “Later”, × or Escape closes it for this visit only. Beginner-tour
settings offer replay and automatic-guide opt-out. The guide neither controls
nor pauses play and grants no points, achievements or game actions.
