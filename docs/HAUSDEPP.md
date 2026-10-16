# Hausdepp – Produkt- und Regelgrundlage / Product and rules specification

**Status / Status:** bestätigte Produktentscheidungen und Hausregeln für den
Entwicklungsbranch `codex/hausdepp-dev`; keine Behauptung über bereits
ausgelieferte Funktionen. / Confirmed product decisions and house rules for the
`codex/hausdepp-dev` development branch; this document does not claim that these
features have already shipped.

## Deutsch

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
- Die Suite-Integration soll bestehende Konten sowie die gemeinsamen Lobby-,
  Einladungs-, Chat-, Reaktions- und Wiederaufnahmeabläufe verwenden. Ihre
  konkrete Einbindung ist Teil der Umsetzung und muss geprüft werden.

### Gestaltung und Plattformen

Die Gestaltung wird mit Impeccable entwickelt. Hausdepp bekommt ein eigenes
visuelles Erscheinungsbild; die Wirtshaustisch-Atmosphäre von Zilch und die
angegebenen Karten bilden die gestalterischen Bezugspunkte. Die Bedienung wird
zuerst für Mobilgeräte entworfen und muss im Hoch- und Querformat auf
Smartphones, Tablets und Desktop-Geräten funktionieren.

Die Kartenreferenzen des Owners zeigen doppeldeutsche Karten im traditionellen
Tell-/Jahreszeitenbild und die rot-schwarz-weisse Blitz-Rückseite des gezeigten
Piatnik-Kartensatzes. Sie bestimmen die gewünschte Designsprache. Die technische
Erstellung der Kartenbilder und die konkrete Einbindung der Bilddateien sind
Umsetzungsarbeit; diese Spezifikation behauptet keine bereits vorhandenen
Kartenassets.

### Karten und Begriffe

Es gibt **36 Karten**: die vier Farben Herz, Schellen, Laub und Eichel mit je
neun Rängen. Die Farben beeinflussen die hier bestätigten Legeregeln nicht.

Die Rangfolge von niedrig nach hoch lautet:

**6 < 7 < 8 < 9 < Unter < Ober < König < Ass < 10**

„Gleich“ bezeichnet denselben Rang, nicht dieselbe Farbe. Rang und Punktewert
sind unterschiedliche Begriffe; Punktewerte sind noch nicht festgelegt.

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

Der Spieler unmittelbar nach dem Geber im Uhrzeigersinn beginnt.

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

Gelingt ein normaler Lege- oder Zockzug ohne Abräumen, ist nach einem
gegebenenfalls erforderlichen Pflichtauffüllen der nächste noch beteiligte
Spieler dran. Das nachfolgend beschriebene Nachwerfen bleibt bis zur ersten
angenommenen Aktion dieses Spielers möglich.

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
Zuerst wird eine nötige Auffüllung abgeschlossen. Hat der Spieler danach noch
Handkarten, beginnt er auf dem leeren Tisch. Ist er stattdessen bereits fertig,
wird er übersprungen und der nächste noch beteiligte Spieler beginnt dort.

### Pflichtauffüllen per Stapeltipp und Nachwerfen

Nach einem vollständigen Ablegen muss eine Hand unter drei Karten von oben
aufgefüllt werden, solange Nachziehkarten vorhanden sind. **Das Auffüllen
geschieht nicht automatisch:** Ein Tipp auf den verdeckten Stapel nimmt
sämtliche fehlenden Karten bis zur Handgrösse drei auf einmal, oder alle noch
verfügbaren Karten, falls weniger übrig sind. Der nächste Spieler wartet, bis
dieses Pflichtauffüllen abgeschlossen ist. Bei drei oder mehr Handkarten ist
kein Auffüllen erforderlich.

Vor dem Ausspielen aus der Hand bedeutet ein Tipp auf den verdeckten Stapel
**Zocken**, nicht Auffüllen. Ein Auffüllen vor dem Ablegen ist nicht erlaubt.
Steht nach einem Ablegen dagegen das Pflichtauffüllen aus, bedeutet derselbe
Tipp ausschliesslich Auffüllen; währenddessen kann nicht gezockt werden.

Nach dem Pflichtauffüllen entscheidet das Ergebnis des vorherigen Ablegens:
Hat es das Paket abgeräumt, erhält derselbe Spieler einen **neuen vollständigen
Zug auf dem leeren Tisch**. Er darf ausspielen oder erneut zocken, sofern der
Nachziehstapel nicht leer ist. Beispiel: Nach einer abräumenden 10 hält er durch
das Auffüllen drei Asse und darf trotzdem zocken. Ohne Abräumen geht das Zugrecht
an den nächsten Spieler; das Nachwurffenster des bisherigen Spielers bleibt bis
zur nächsten angenommenen Aktion offen.

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
Spielers**. Dazu
zählen dessen Ablegen, Aufnehmen des Pakets oder Aufdecken zum Zocken. Bereits
angenommene Aktionen dürfen nicht nachträglich durch einen Nachwurf umgeordnet
werden. Die konkrete technische Gestaltung dieses Zeitfensters, einschliesslich
einer angemessenen Reaktionszeit beim Computer-Mitspieler, ist noch umzusetzen;
eine feste Sekundenzahl ist keine bestätigte Spielregel.

### Endspiel und Rundenende

Reichen die Nachziehkarten nicht mehr für drei Handkarten, zieht der Spieler
nur die noch vorhandenen Karten. Sobald der Nachziehstapel leer ist, entfällt
die Mindesthand und es kann nicht mehr gezockt werden.

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
Sieger und noch keine Punkteverteilung.

Hohe gleichrangige Karten und aufbewahrte 10er können im Endspiel helfen: Eine
10 räumt ab und gibt bei verbleibenden Handkarten einen weiteren Zug. Das ist
ein taktischer Hinweis, keine zusätzliche Sonderregel.

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

### Geplante weitere Bereiche und noch offene Entscheidungen

Die erste Etappe soll spätere Bereiche bereits gestalterisch und technisch
berücksichtigen. Das Vorsehen einer Erweiterung ist keine Zusage, dass sie
bereits funktioniert:

| Bereich | Bestätigte Richtung | Noch festzulegen oder umzusetzen |
| --- | --- | --- |
| Lobby und Tisch | Echte Mehrspielerpartien, Computer-Mitspieler, Owner-Freigabe, mobile Bedienung | Konkrete Oberflächen und geprüfte Suite-Integration |
| Regeln | Diese Hausvariante vollständig auf Deutsch und Englisch erklären | In-App-Regelseite und passende Hilfen am Tisch |
| Punkte | Eigener Bereich im Gesamtpaket | Sämtliche Punktewerte, Statistiken und Wertungsverfahren; nichts erfinden |
| Achievements | Ironische Rangentwicklung von clever bis zum höchsten Titel Hausdepp | Endgültige Rangliste, Bedingungen, Belohnungen und faire Erreichbarkeit |
| Konto | Bestehendes Suite-Konto weiterverwenden | Hausdepp-spezifische Anzeige und Daten im Kontobereich |
| Chat und Reaktionen | Gemeinsame Suite-Funktionen analog zu den anderen Spielen | Einbindung und Prüfung am Hausdepp-Tisch |
| Vorbereitung weiterer Runden | Mehrere Runden sind als Spielkontext vorgesehen | Rotation des Gebers und genaue Bedienung des Rundenwechsels |
| Feindetails der Vorbereitung | Obligatorisches Anschauen und Auffüllen stehen fest | Konkrete Animationen und Reihenfolge des Austeilens an die Sitze |

### Bestätigte Achievement-Richtung: vom klugen Kopf zum Hausdepp

Das Ziel der Erfolge ist ausdrücklich, den höchsten dauerhaften Erfolgsrang
**Hausdepp** zu erreichen. Mit mehr gesammelten Erfolgen schreitet der Spieler
voran, während die Rangtitel ironisch von clever zu immer weniger schmeichelhaft
führen. Beispiele des Owners sind **Einstein → Bohr → Newton → … → Ochse →
Hirni → Hausdepp**. Diese Namen und ihre Reihenfolge sind Vorschläge, noch keine
vollständige oder freigegebene Rangliste. Es sollen viele Zwischenstufen geben.

Der dauerhafte Achievement-Titel ist getrennt vom **Hausdepp einer einzelnen
Runde** zu modellieren. Die Rundenspielregeln ändern sich dadurch nicht.
Freischaltbedingungen, Schwellen, Punkte und konkrete Vergaberegeln sind noch
offen; der ironische Titelverlauf allein legt sie nicht fest.

### Entwicklung und Lieferung

Hausdepp entsteht zunächst auf einem Entwicklungsbranch. Die Produktversion
bleibt während dieser Entwicklung innerhalb von **2.x**; **V3** ist dem späteren
grossen Release vorbehalten. Daraus folgt weder ein sofortiger Deploy noch ein
erzwungener Versionssprung für die reine Vorbereitung. Bei tatsächlichen
Releases gelten weiterhin die gemeinsamen Versions- und Lieferregeln aus
[PRODUCT_DELIVERY.md](PRODUCT_DELIVERY.md), einschliesslich vollständiger
DE-/EN-Texte, Dokumentation, geeigneter Prüfungen und unveränderter historischer
Versionszuordnungen. Owner-geschützte Seiten bleiben `noindex`.

## English

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
- Suite integration should reuse existing accounts and the shared lobby,
  invitation, chat, reaction and reconnection flows. Their actual integration
  is implementation work and must be verified.

### Design and platforms

The design is developed with Impeccable. Hausdepp receives its own visual
identity, drawing on Zilch's tavern-table atmosphere and the specified playing
cards. Interaction is designed mobile first and must work in portrait and
landscape on phones, tablets and desktop devices.

The owner's card references show traditional double-headed German-suited cards
in the Tell/seasons pattern and the red, black and white Blitz back of the
pictured Piatnik deck. They establish the desired visual language. Creating the
card images and integrating the actual files remains implementation work; this
specification does not claim that those assets already exist.

### Cards and terminology

There are **36 cards**: four suits—hearts, bells, leaves and acorns—with nine
ranks each. Suits do not affect the confirmed rules for playing a card.

The rank order, from lowest to highest, is:

**6 < 7 < 8 < 9 < Unter < Ober < King < Ace < 10**

“Equal” means the same rank, regardless of suit. Rank and scoring value are
different concepts; scoring values have not been decided.

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
mandatory. There is no opting out, declining or stopping early.

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

The player immediately after the dealer clockwise takes the first turn.

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
passes to the next remaining player once any required refill is complete. The
additional-card right described below remains available until that player's
first accepted action.

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
They first complete any required refill. If cards remain in their hand, they
lead on the empty table. If they have instead finished, they are skipped and
the next remaining player leads there.

### Mandatory refill by tapping the pile and adding matching cards

After a complete play, a hand below three cards must be refilled from the top
while draw cards remain. **Refilling is not automatic:** One tap on the face-down
pile takes all missing cards up to a hand of three at once, or all remaining
cards if fewer are available. The next player waits until this mandatory refill
is complete. A hand of three or more cards does not need a refill.

Before playing from hand, tapping the face-down pile means **gambling**, not
refilling. Refilling before playing is not allowed. When a mandatory refill is
pending after a play, the same tap only refills the hand; gambling is unavailable
during that step.

After the mandatory refill, the preceding play determines what happens next.
If it cleared the pile, the same player receives a **new full turn on the empty
table**. They may play from hand or gamble again if the draw pile is not empty.
For example, after clearing with a 10 and refilling to three aces, they may still
gamble. Without a clearance, the turn passes to the next player while the previous
player's additional-card window remains open until the next accepted action.

Tapping the **open pile** instead deliberately picks up the entire pile into
the player's hand. Picking up ends the turn. An empty table cannot be picked up.

The player may **add further cards of the rank they just played**. These may be
newly drawn cards or matching cards initially kept in hand. Adding them is
optional. Any required refill after an additional play is again completed by
tapping the pile; this sequence may repeat. An added card can complete four
equal ranks and therefore grant another lead.

This right ends with the **next player's first accepted action**, including playing a
card, picking up the pile or revealing a gamble card. Accepted actions must
not subsequently be reordered by an additional card. The actual technical
handling of this window, including reasonable reaction time against a computer
opponent, remains implementation work. No fixed number of seconds is a
confirmed game rule.

### Endgame and end of the round

If the remaining draw cards cannot refill a hand to three, the player draws
only the cards still available. Once the draw pile is empty, the minimum hand
size no longer applies and gambling is unavailable.

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
rules identify the last player; they do not define a single winner or any
scoring distribution yet.

High matching cards and saved 10s can help in the endgame: a 10 clears the pile
and grants another turn if the player still has hand cards. This is tactical
advice, not an additional special rule.

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

### Planned areas and remaining decisions

The first milestone should anticipate later areas in both design and technical
structure. Planning an extension does not mean that it already works:

| Area | Confirmed direction | Still to decide or implement |
| --- | --- | --- |
| Lobby and table | Real multiplayer rounds, computer opponent, owner access, mobile interaction | Actual interfaces and verified suite integration |
| Rules | Explain this entire house variant in German and English | In-app rules page and appropriate table help |
| Points | A dedicated part of the complete package | All point values, statistics and scoring methods; do not invent them |
| Achievements | Ironic progression from clever to the highest title, Hausdepp | Final rank list, conditions, rewards and fair attainability |
| Account | Reuse the existing suite account | Hausdepp-specific account presentation and data |
| Chat and reactions | Shared suite features analogous to the other games | Integration and verification at the Hausdepp table |
| Further rounds | The game context anticipates multiple rounds | Dealer rotation and exact round-transition interaction |
| Preparation details | Mandatory inspection and refilling are settled | Actual animations and the order of dealing to seats |

### Confirmed achievement direction: from clever mind to Hausdepp

The explicit goal of achievements is to reach the highest lasting achievement
rank, **Hausdepp**. Collecting more achievements advances the player while the
rank titles ironically move from clever to increasingly unflattering. The
owner's examples are **Einstein → Bohr → Newton → … → Ox → Hirni → Hausdepp**.
These names and their ordering are suggestions, not a complete approved rank
list. There should be many intermediate ranks; final English rank wording also
remains to be decided.

Model the lasting achievement title separately from the **Hausdepp of one
round**. The round rules do not change. Unlock conditions, thresholds, points
and actual award rules remain open; the ironic title progression does not
determine them.

### Development and delivery

Hausdepp starts on a development branch. The product version stays within
**2.x** during this development; **V3** is reserved for the later major launch.
This does not require an immediate deployment or force a version bump for
preparatory work alone. Actual releases continue to follow the shared version
and delivery rules in [PRODUCT_DELIVERY.md](PRODUCT_DELIVERY.md), including
complete German/English text, documentation, appropriate checks and unchanged
historical version mappings. Owner-protected pages remain `noindex`.
