# Hausdepp – Produkt- und Regelgrundlage / Product and rules specification

**Status / Status:** bestätigte Hausregeln und Umsetzungsstand der privaten
Entwicklungsfassung auf `codex/hausdepp-dev`. **UI und UX sind noch nicht vom
Owner abgenommen.** Die Weiterentwicklung ist freigegeben; das ist keine
Produktionsfreigabe. / Confirmed house rules and implementation status of the
private development build on `codex/hausdepp-dev`. **The owner has not accepted
the UI or UX yet.** Continued development is authorized; production release is
not implied.

## Deutsch

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

### Produkt und erste Etappe

Das Spiel heisst **Hausdepp**, so wie es in der Spielrunde des Owners genannt
wird. Es wird eine eigenständige Erweiterung der bestehenden ZDWA-/Zilch-Suite
und über deren Spielauswahl erreichbar. Die folgenden Regeln beschreiben diese
Hausvariante. Regeln eines anderen, ebenfalls „Hausdepp“ genannten Spiels dürfen
nicht ohne ausdrückliche Entscheidung übernommen werden.

- Üblich sind **2–5 Spieler**, die Obergrenze beträgt **6 Spieler**.
- Es gibt keinen eigenständigen Solomodus. Ein Computer-Mitspieler ist bereits
  für die erste spielbare Etappe erforderlich und führt seine Züge selbst aus.
- Die erste Etappe umfasst eine echte Mehrspieler-Lobby und einen vollständig
  spielbaren Tisch nach diesen Regeln, keine reine Designvorschau.
- Anfangs ist der Zugang ausschliesslich an das bestehende Owner-/Founder-Konto
  gebunden. Die Freigabe gilt für das Konto, nicht nur für einen ausgeblendeten
  Link. Andere echte Konten erhalten dadurch keine Freigabe. Mehrspielertests
  mit mehreren menschlichen Sitzen verwenden lokale Testkonten.
- Ein Konto belegt einen Sitz; ein weiteres Gerät desselben Kontos übernimmt
  denselben Sitz und erzeugt keinen zusätzlichen Spieler.
- Die Suite-Integration verwendet bestehende Konten, Spielauswahl, Chat,
  Reaktionen und Wiederaufnahme. Der private Tisch kann über seinen Link mit
  zugelassenen lokalen Testkonten geteilt werden; der Link erteilt selbst
  keine Zugangsberechtigung.

Der gewählte eigene Hostname ist **`hausdepp.zockdiewandan.online`**. Am
**16.10.2026** wurde dafür in Cloudflare ein A-Eintrag auf `217.154.16.72`
reserviert, mit aktiviertem Proxy und TTL **Auto**. Das ist noch kein
Spiel-Rollout: Die dedizierte Host-Zuordnung in der Anwendung, die Nginx-Freigabe
und die Aufnahme des Hostnamens in das Origin-Zertifikat stehen aus. Das
produktive Origin-Zertifikat deckt derzeit nur die vier bestehenden Hosts ab.
Der erste Zugang bleibt auch auf der eigenen Subdomain Owner-/Founder-gebunden.

### Gestaltung und Plattformen

Die Gestaltung wird mit Impeccable entwickelt. Hausdepp bekommt ein eigenes
visuelles Erscheinungsbild; die Wirtshaustisch-Atmosphäre von Zilch und die
angegebenen Karten bilden die gestalterischen Bezugspunkte. Die Bedienung wird
zuerst für Mobilgeräte entworfen und muss im Hoch- und Querformat auf
Smartphones, Tablets und Desktop-Geräten funktionieren.

Die Kartenreferenzen des Owners zeigen doppeldeutsche Karten im traditionellen
Tell-/Jahreszeitenbild und die rot-schwarz-weisse Blitz-Rückseite des gezeigten
Piatnik-Kartensatzes. Sie bestimmen die gewünschte Designsprache. Die
Entwicklungsfassung stellt diese Karten über einzeln ausgerichtete und abgerundete Bildausschnitte dar. Quellen, Lizenzen und
Bearbeitung stehen in [HAUSDEPP_ASSETS.md](HAUSDEPP_ASSETS.md). Die gestalterische
Richtung ist gewählt; die konkrete UI-/UX-Ausführung bleibt zur Abnahme offen.

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

Der Geber mischt. Gespielt wird im Uhrzeigersinn. Der Spieler unmittelbar vor
dem Geber in dieser Reihenfolge schaut die unterste Karte des verdeckten
Stapels an. Das Anschauen, Weiterschauen nach einem Ass und Behalten bei Erfolg
sind verpflichtend; es gibt kein Auslassen, Ablehnen oder vorzeitiges Aufhören.
Der bestimmte Spieler hebt aktiv ab: Ein Tipp auf den verdeckten Stapel prüft
eine Karte. Nach jedem Ass löst er das Weiterschauen mit einem weiteren Tipp
aus. Ein Computer führt seine eigenen Abhebeaktionen aus.

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
   diese Karten weiterhin.

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

### Pflichtauffüllen per Stapeltipp und Nachwerfen

Nach einem vollständigen Ablegen muss eine Hand unter drei Karten von oben
aufgefüllt werden, solange Nachziehkarten vorhanden sind. **Das Auffüllen
geschieht nicht automatisch:** Ein Tipp auf den verdeckten Stapel nimmt
sämtliche fehlenden Karten bis zur Handgrösse drei auf einmal, oder alle noch
verfügbaren Karten, falls weniger übrig sind. Bei drei oder mehr Handkarten ist
kein Auffüllen erforderlich.

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
zusätzliche Bestätigung. Weitere gleiche Karten können schnell nacheinander
angetippt werden, solange das Nachwurfrecht noch besteht.

Ein Tipp auf das **offene Paket** bedeutet dagegen dessen bewusstes vollständiges
Aufnehmen auf die Hand. Aufnehmen beendet den Zug. Bei leerem Tisch ist keine
Aufnahme möglich.

Zum gerade gespielten Rang darf der Spieler weitere gleichrangige Karten
**nachwerfen**. Das dürfen gerade nachgezogene Karten oder zunächst
zurückbehaltene Handkarten sein. Nachwerfen ist freiwillig. Nach einem Nachwurf
wird erforderliches Pflichtauffüllen wieder per Stapeltipp abgeschlossen;
dieser Ablauf kann sich mehrfach wiederholen. Ein Nachwurf kann die vier
Gleichen vervollständigen und damit das erneute
Ausspielrecht auslösen.

Das Nachwurfrecht endet mit der **ersten angenommenen Aktion des nächsten
Spielers**. Dazu zählen dessen Ablegen, Aufnehmen des Pakets oder Aufdecken zum
Zocken. Bereits angenommene Aktionen dürfen nicht nachträglich durch einen
Nachwurf umgeordnet werden. Befehlsbestätigungen ordnen schnelle Kartenaktionen; eine feste
Sekundenzahl oder künstliche Sperre ist keine Spielregel. Computer reagieren
kurz verzögert, damit ein menschlicher Nachwurf möglich bleibt.

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

Die eigene Hand bleibt offen und sortiert. Bei anderen Spielern ist für jede
Handkarte eine Rückseite sichtbar; die genaue Anzahl steht zusätzlich beim
Namen. Kartenwerte und Farben gegnerischer Hände bleiben privat. Sehr grosse
Hände werden dichter gefächert, ohne Karten wegzulassen.

Geben und Pflichtziehen zeigen den Weg vom verdeckten Stapel zur Hand. Beim
Aufnehmen wandert das offene Paket zur Hand. Misslingt Zocken, geht zuerst die
gezockte Karte vom verdeckten zum offenen Stapel und danach das ganze Paket zur
Hand. Handkarten bewegen sich beim Legen zur Mitte. Diese Darstellung sperrt
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
- Wiederverbinden und weitere Geräte desselben Kontos müssen denselben
  autoritativen Spielzustand und denselben Sitz wiederherstellen.

### Lobby, Konto und Suite-Integration

Die gemeinsame Spielauswahl zeigt die freigeschalteten Spiele mit Symbolen und
Namen; das aktuelle Spiel ist markiert. Der Einstieg nennt Hausdepp, solange
Hausdepp geöffnet ist. Ein Tipp oder `Alt+Shift+Z` öffnet die Auswahl; erst die
Wahl eines Spiels führt zu dessen Lobby. Auf dem Handy erscheint ein
Auswahlfenster am unteren Rand. Hausdepp bleibt Owner-gebunden; installierte
Apps behalten beim Wechsel ihren bestehenden Ursprung und Service Worker.

Die Lobby zeigt eigene offene Tische mit Spielstatus und belegten Plätzen.
Beim Erstellen zählen Menschen und Computer gemeinsam zur gewählten Tischgrösse;
das eigene Konto belegt genau einen menschlichen Platz. Ein Wartetisch zeigt,
wie viele Menschen noch fehlen. Der Tischlink kann kopiert werden; die
Owner-Freigabe wird beim Öffnen weiterhin serverseitig geprüft. Wiederaufnahme
führt an denselben Sitz zurück.

Unter **`/hausdepp/konto`** verwendet Hausdepp das bestehende Suite-Konto und
zeigt ausschliesslich dessen eigene gespeicherte Ergebnisse. Die Übersicht
zählt abgeschlossene Runden, Runden als Hausdepp und Runden mit leerer eigener
Hand. Die private Historie zeigt Tischname, Zeitpunkt, eigenes Ergebnis und
Mitspieler einschliesslich Computer; ältere Runden können nachgeladen werden.
Laufende oder abgebrochene Partien sind keine abgeschlossenen Ergebnisse.
Fehlende Ergebnisse werden als leerer Verlauf erklärt, nicht durch Beispieldaten
ersetzt. Allgemeine Kontoeinstellungen bleiben unter **`/konto#settings`**.

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
zusätzlichen wiederholbaren EP: Es zählen weiterhin 10 EP je abgeschlossener
Runde und die jeweils einmaligen Erfolge. Die neuen Comeback-, Karten- und
Turniererfolge ergänzen die ursprünglichen 64 zum Gesamtkatalog von 100.

### Noch offene Entscheidungen

Die technische Umsetzung ist kein Ersatz für die ausstehende UI-/UX-Abnahme.
Die Bereiche sind wie folgt abgegrenzt:

| Bereich | Stand der Entwicklungsfassung | Noch offen |
| --- | --- | --- |
| Lobby und Tisch | Echte Mehrspielerpartien, Computer-Mitspieler, Owner-Freigabe, Tischstatus, direkte Aktionen | UI-/UX-Abnahme und weitere Verfeinerungen nach Spieltests |
| Regeln | Vollständige DE-/EN-Hausregeln mit Schnellstart, Beispielen und Sprungmarken | Verständlichkeitsprüfung durch den Owner |
| Punkte | 10 EP je abgeschlossener Runde und einmalige Erfolgsbelohnungen von 10/25/50/100 EP | Weiteres Balancing nach Spieltests |
| Achievements | Bestätigter Katalog mit 100 Erfolgen, 24 Rängen und eigenen Aufstiegssprüchen | UI-/UX-Abnahme und weitere Spieltests |
| Konto | Private Statistik und Historie, EP, Rangfortschritt, Rangleiter und filterbare Erfolgssammlung | UI-/UX-Abnahme |
| Chat und Reaktionen | Gemeinsame Suite-Funktionen am Tisch und Lobbychat | Weitere Verfeinerungen nach Spieltests |
| Weitere Runden | Einzelrunden über die Lobby; Turnierserie am selben Tisch mit Geberrotation und Buchstabenstand | UI-/UX-Abnahme und weitere Spieltests |
| Vorbereitung | Aktives Anschauen und kurze, nicht sperrende Austeilbewegungen | Weitere Verfeinerungen nach Spieltests |

### Bestätigte Punkte, Erfolge und Ränge

Der Owner hat den [Katalog mit 100 Erfolgen und 24 Rängen](HAUSDEPP_ACHIEVEMENTS.md)
freigegeben. Jede regulär abgeschlossene Runde gibt dem beteiligten Konto
**10 Erfahrungspunkte (EP)**, unabhängig davon, ob es fertig oder Hausdepp der
Runde geworden ist. Jeder Erfolg gibt einmalig **10, 25, 50 oder 100 EP**.
Mehrere Erfolge können in derselben Runde freigeschaltet werden. Es gibt keine
Minuspunkte und keinen wiederholbaren Zusatzbonus fürs Verlieren. Runden mit
Computer-Mitspielern zählen; Computer selbst haben kein Punktekonto.

Die dauerhafte Leiter beginnt bei **Einstein mit 0 EP** und endet bei
**Hausdepp mit 5’000 EP**. Der dauerhafte Titel bleibt getrennt vom **Hausdepp
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
Fortschritt. Jeder Rang hat einen eigenen ursprünglichen DE-/EN-Spruch, keine
als historisch ausgegebenen Zitate. Der allgemeine Aufstiegstext lautet
**„Gratuliere! Dem Hausdepp wieder einen Schritt näher.“** Newton ergänzt
**„Ab jetzt geht’s bergab. Ganz nach den Naturgesetzen.“**, der Schlussrang
**„Geschafft. Mehr Hausdepp geht nicht.“** Mehrere übersprungene Stufen und neue
Erfolge werden zusammengefasst. Eine Bestätigung gilt kontoweit nur für den
angezeigten Stand; neue Punkte werden durch eine alte Bestätigung nicht verdeckt.

### Entwicklung und Lieferung

Hausdepp wird lokal auf einem Entwicklungsbranch weiterentwickelt. Die
UI-/UX-Abnahme steht ausdrücklich aus. Die Produktversion
bleibt während dieser Entwicklung innerhalb von **2.x**; **V3** ist dem späteren
grossen Release vorbehalten. Daraus folgt weder ein sofortiger Deploy noch ein
erzwungener Versionssprung für die reine Vorbereitung. Bei tatsächlichen
Releases gelten weiterhin die gemeinsamen Versions- und Lieferregeln aus
[PRODUCT_DELIVERY.md](PRODUCT_DELIVERY.md), einschliesslich vollständiger
DE-/EN-Texte, Dokumentation, geeigneter Prüfungen und unveränderter historischer
Versionszuordnungen. Owner-geschützte Seiten bleiben `noindex`.

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

### Product and first milestone

The game is called **Hausdepp**, the name used by the owner's own gaming group.
It becomes a distinct addition to the existing ZDWA/Zilch suite and is reached
through its game switcher. The rules below describe this house variant. Rules
from another game also called “Hausdepp” must not be imported without an
explicit decision.

- The usual player count is **2–5**, with an absolute maximum of **6**.
- There is no separate solo mode. The first playable milestone already needs
  a computer opponent that takes its own turns.
- That milestone includes a real multiplayer lobby and a table at which these
  rules can be played in full, rather than a design preview alone.
- Access is initially bound exclusively to the existing owner/founder account.
  This is account authorization, not merely a hidden link. Other real accounts
  do not gain access through this decision. Multiplayer tests with several
  human seats use local test accounts.
- One account occupies one seat. Another device using that account resumes the
  same seat instead of creating another player.
- Suite integration uses existing accounts, game selection, chat, reactions
  and reconnection. A private table can be shared by link with approved local
  test accounts; the link itself grants no access.

The chosen dedicated hostname is **`hausdepp.zockdiewandan.online`**. On
**2026-10-16**, an A record pointing to `217.154.16.72` was reserved in
Cloudflare with the proxy enabled and TTL **Auto**. This does not deploy the
game: dedicated application host routing, the Nginx host allowlist and adding
the hostname to the origin certificate remain pending. The production origin
certificate currently covers only the four existing hosts. Initial access on
the dedicated subdomain will also remain bound to the owner/founder account.

### Design and platforms

The design is developed with Impeccable. Hausdepp receives its own visual
identity, drawing on Zilch's tavern-table atmosphere and the specified playing
cards. Interaction is designed mobile first and must work in portrait and
landscape on phones, tablets and desktop devices.

The owner's card references show traditional double-headed German-suited cards
in the Tell/seasons pattern and the red, black and white Blitz back of the
pictured Piatnik deck. They establish the desired visual language. The
development build renders these cards using individually aligned, rounded image crops. Sources, licences and adaptations
are recorded in [HAUSDEPP_ASSETS.md](HAUSDEPP_ASSETS.md). The design direction is
chosen; the actual UI and UX still await acceptance.

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

The dealer shuffles. Play proceeds clockwise. The player immediately before
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
   inspecting player retains knowledge of those cards.

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
Computers react after a brief delay, leaving room for a human additional card.

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

Your own hand stays face up and sorted. Other players show one card back for
every hand card, with the exact count also beside their name. Opposing ranks and
suits remain private. Large hands use a denser fan without omitting any cards.

Dealing and mandatory refills travel from the face-down stock to the hand.
Picking up moves the open pile into the hand. A failed gamble first moves the
new card from stock to pile, then the complete pile into the hand. Hand plays
travel to the middle. Presentation never blocks turns, changes additional-card
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
- Reconnection and additional devices using the same account must recover the
  same authoritative state and the same seat.

### Lobby, account and suite integration

The shared picker shows available games with icons and names, marking the
current game. Its trigger names Hausdepp while Hausdepp is open. Tap or press
`Alt+Shift+Z` to open the picker, then choose a game's lobby. Phones use a
bottom sheet. Hausdepp remains owner-bound; installed apps retain their
existing origin and service worker when switching.

The lobby shows your open tables with game status and occupied seats. Humans
and computers together fill the selected table size; your account occupies one
human seat. A waiting table shows how many humans are still needed. Its link
can be copied; opening it still requires server-side owner access. Resuming
returns to the same seat.

At **`/hausdepp/konto`**, Hausdepp reuses the existing suite account and shows
only that account's own saved results. The overview counts completed rounds,
rounds as the Hausdepp and rounds finished with an empty hand. Private history
shows the table name, time, own outcome and participants including computers;
older rounds can be loaded. Running or aborted games are not completed results.
An empty history is explained without sample data. General account settings
remain at **`/konto#settings`**.

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
no repeatable XP bonus: each completed round still grants 10 XP, with one-time
achievement rewards separately. The added comeback, card and tournament feats
extend the original 64 achievements to a catalogue of 100.

### Remaining decisions

Technical implementation does not replace the outstanding UI and UX acceptance.
The areas have the following boundaries:

| Area | Development build status | Still open |
| --- | --- | --- |
| Lobby and table | Real multiplayer rounds, computer opponents, owner access, table status, direct actions | UI and UX acceptance and further playtest refinements |
| Rules | Complete German/English house rules with quick start, examples and anchors | Owner review for clarity |
| Points | 10 XP per completed round and one-time achievement rewards of 10/25/50/100 XP | Further balancing after playtests |
| Achievements | Approved catalogue of 100 achievements, 24 ranks and individual sayings | UI and UX acceptance and further playtests |
| Account | Private facts/history, XP, rank progress, complete ladder and filterable achievement collection | UI and UX acceptance |
| Chat and reactions | Shared suite features at the table and lobby chat | Further playtest refinements |
| Further rounds | Single rounds through the lobby; same-table tournaments with dealer rotation and letter scores | UI and UX acceptance and further playtests |
| Preparation | Active inspection and short, nonblocking dealing movements | Further playtest refinements |

### Approved points, achievements and ranks

The owner approved the [100-achievement and 24-rank catalogue](HAUSDEPP_ACHIEVEMENTS.md).
Every regular completed round gives each participating human account **10
experience points (XP)**, regardless of the round outcome. Each achievement
grants **10, 25, 50 or 100 XP once**; multiple achievements may unlock together.
There are no negative points or repeatable losing bonus. Computer opponents
count as participants; computers have no XP account.

The lasting ladder runs from **Einstein at 0 XP** to **Hausdepp at 5,000 XP**.
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
Private bottom-inspection facts and their awards remain in the owner's account.

The account itemizes round and achievement XP, next-rank progress, the complete
ladder and a searchable collection with conditions, status and progress. Every
rank has original German/English flavour copy, with no fabricated historical
attribution. The general greeting celebrates another step closer to Hausdepp;
Newton adds the approved downhill/natural-laws joke. Skipped ranks and new
awards are consolidated. Acknowledgement applies account-wide only through the
displayed revision, so an old tab cannot hide newer progress.

### Development and delivery

Hausdepp continues locally on a development branch. UI and UX acceptance
explicitly remains outstanding. The product version stays within
**2.x** during this development; **V3** is reserved for the later major launch.
This does not require an immediate deployment or force a version bump for
preparatory work alone. Actual releases continue to follow the shared version
and delivery rules in [PRODUCT_DELIVERY.md](PRODUCT_DELIVERY.md), including
complete German/English text, documentation, appropriate checks and unchanged
historical version mappings. Owner-protected pages remain `noindex`.
