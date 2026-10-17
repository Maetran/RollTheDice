# Watten – Recherche für das nächste Spiel

**Stand:** 16.10.2026, Europe/Zurich.
**Status:** vorgemerkt; Recherche und offene Hausregeln, keine Entwicklung.
**Ursprünglicher Branch:** `codex/watten-recherche`.
**Ausgangspunkt:** `62856e1` auf `master`.

Die Fortsetzung vom 17.10.2026 zur
[Gestaltungsreferenz](WATTEN_DESIGN_REFERENCES.md) liegt auf
`codex/watten-design-references`, begonnen vom aktuellen `origin/develop`.
Die ursprüngliche Recherchehistorie bleibt auf ihrem Branch erhalten.

## 1. Vorgaben aus dem Auftrag

Watten wird das nächste Spiel der Suite. Für die erste Planung gilt die vom
Owner beschriebene Spielrunde als Bezugspunkt:

- Üblicherweise **bis 11 Punkte**: «8+3 isch zmittag».
- Üblicherweise **4er ladinisch**.
- Zusätzlich sind **Spielversionen für zwei und drei Spieler** gewünscht.
- **Blindes Einschauen:** Der Geber und der im Uhrzeigersinn nachfolgende
  Spieler schauen die unterste Karte ein. Die anderen müssen durch
  raffiniertes Spielen herausfinden, welcher Schlag und Trumpf gelten.
- **Identische Kartendesigns wie Hausdepp verwenden.**
- **Ansagen gehören zum Spiel.** Die ausdrückliche Vorgabe lautet:
  «Gestrichen darf man nichts mehr sagen.»
- **CPU-Spieler** sind gewünscht: typische Tiroler Namen wie bei Hausdepp
  und nachvollziehbar taktisches Spielverständnis.
- **Team vor Spielbeginn selbst auswählen**, keine zufällige Teamzuweisung.
- **Weitere Modi:** zusätzlich mit Kritischen sowie nicht ladinisch/offen
  mit regulärer Ansage und regulärem Bieten berücksichtigen.
- **Trumpfzwang:** Im blinden Viererspiel müssen die beiden Einschauer Trumpf
  zugeben; Rechter und allenfalls Kritische sind ausgenommen. Auslöser und
  geschützte eigene Karten im Regelwerk getrennt definieren.
- **Keine Regelauslegung während des Spiels:** Jeder gewählte Modus muss
  vollständig und eindeutig bestimmt sein.
- Vorerst ausschliesslich recherchieren und dokumentieren. Es gibt noch keinen
  Auftrag für Spielengine, Oberfläche, Routen, Bots, Integration oder Release.

Die folgenden Quellen helfen beim Ausarbeiten dieser Hausvariante. Eine Regel
aus dem Internet ist damit noch keine bestätigte Regel unserer Spielrunde.
Insbesondere bedeutet «dieselben Karten» dieselben Designs, nicht automatisch
dieselbe Kartenanzahl oder Rangfolge wie bei Hausdepp.

### Weitere Produktgedanken vom 16.10.2026

Die Ergänzungen sind für die spätere Planung festgehalten. Sie erweitern den
gewünschten Produktumfang, geben aber noch keine Entwicklung frei.

**Zwei, drei und vier Spieler:** Es sollen echte Varianten für die jeweilige
Spielerzahl entstehen. Zwei oder drei Menschen mit CPUs zu einem Vierertisch
aufzufüllen ersetzt diese Varianten nicht. Die bisherige Onlinerecherche
behandelte zunächst überwiegend Vierer-Ladinisch; die
[vertiefte Recherche](WATTEN_RULES_AUDIT.md#6-zwei-und-drei-spieler) dokumentiert
nun auch konkrete, teils unvereinbare Zweier-/Dreiermodelle. Die vollständige
Produktauswahl ist noch mit dem Hausbrauch abzugleichen.
Insbesondere Spielparteien, mögliche wechselnde Partnerschaften, Geben,
Einschauen, Ansagerrollen und Wertung bleiben dort offen. Die Viererregel nicht
einfach auf weniger Sitze verkürzen.

**Ansagen und gestrichen:** Ansagen sind ein eigener Teil des Spielablaufs und
sollen bei einer späteren Umsetzung genauso berücksichtigt werden wie die
Kartenaktionen. Die Vorgabe «Gestrichen darf man nichts mehr sagen» steht fest
und gilt auch für CPUs. Die genaue Bedeutung im Hausbrauch bleibt noch zu
präzisieren: Schlag/Trumpf bestimmen, bieten/erhöhen und sonstige Aussagen am
Tisch sind unterschiedliche Handlungen. Insbesondere den Beginn von
«gestrichen», zulässige Antworten auf gegnerische Gebote und den Fall zweier
gestrichener Parteien festlegen. Daraus jetzt weder eine globale Chatsperre
noch eine Sperre notwendiger Antworten ableiten. Die Verbote einzelner Quellen
im Rechercheteil ersetzen diese Owner-Vorgabe nicht.

**Teamwahl:** Spieler wählen vor Spielbeginn selbst, welchem Team sie
angehören. Keine Zufallszuweisung und kein anschliessendes zufälliges
Umverteilen. Die gewählte Zugehörigkeit muss vor dem Start erkennbar sein.
Für Viererpartien ist das die Wahl der Partnerschaft; was Teamwahl bei den
Zweier- und Dreierregeln bedeutet, bleibt bis zur Festlegung dieser Varianten
offen. Sitzreihenfolge, Teamkapazität, Startbereitschaft und die Besetzung von
CPU-Plätzen sind noch auszuarbeiten.

**CPUs mit Tiroler Namen:** Die Computer sollen zur gleichen Runde passen wie
bei Hausdepp, etwa Peppi, Seppl, Loisl, Hiasl, Resi, Vroni, Traudl oder Kathi.
Der vorhandene Namenspool `HAUSDEPP_CPU_NAMES` in
[`app/hausdepp_state.py`](../app/hausdepp_state.py) ist die konkrete Referenz.
Damit ist keine Übernahme der Hausdepp-Spielstrategie beschlossen.

**CPUs mit Taktik:** Nur irgendeine regelkonforme Karte zu legen genügt nicht.
Die CPUs sollen die gewählte Variante, die eigene Rolle und den Punktestand
verstehen, taktisch Karten spielen sowie sinnvoll ansagen, bieten und auf
Gebote reagieren. Ein blinder CPU-Sitz muss Schlag und Trumpf wie ein Mensch
aus den sichtbaren Aktionen erschliessen; nur der berechtigte Ansager kennt
die tatsächlich eingeschauten Informationen. Weder fremde Hände noch Wissen
anderer CPU-Sitze dürfen die Entscheidung beeinflussen.

Folgende Prüfideen machen diesen Qualitätsanspruch später konkret. Es sind
noch keine implementierten Tests oder festgelegten Algorithmen:

| Spielsituation | Erwartetes taktisches Verständnis |
| --- | --- |
| Eigener Partner führt den Stich | Nicht ohne taktischen Nutzen mit einer wertvolleren Karte überstechen. |
| Stichgewinn ist für die Runde entscheidend | Erkennen, wann eine starke Karte jetzt gebraucht wird und wann sie gespart werden kann. |
| CPU spielt blind | Aus gespielten Karten und Stichgewinnern Schlüsse ziehen und Unsicherheit berücksichtigen. |
| Punktestand und Gebot ändern sich | Annahme, Gehen, Erhöhung und gegebenenfalls Bluff zum Rundeneinsatz und Spielstand passend abwägen. |
| CPU ist gestrichen | Das festgelegte Ansageverbot beachten; keine verbotenen Aussagen oder Erhöhungen erzeugen. |
| Gleiche sichtbare Lage, andere fremde verdeckte Karten | Keine zusätzliche Kenntnis oder dadurch bevorzugte Entscheidungen erlangen. |
| Wechsel auf Zweier- oder Dreierpartie | Nach deren tatsächlichen Rollen und Regeln entscheiden, keine Vierer-Partnerschaft unterstellen. |

Die spätere Abnahme soll mehrere nachvollziehbare Beispielpartien und
Entscheidungen umfassen. Ein einzelner legaler Zug belegt noch keine
Spielstärke. Algorithmus, Schwierigkeitsstufen und messbare Mindestleistung
sind bislang nicht entschieden.

## 2. Vertiefte Recherche und Quellen

Der zweite Durchgang steht im
[Regelabgleich mit Modimatrix](WATTEN_RULES_AUDIT.md). Er dokumentiert
21 konkrete Quellen aus Betreiber-, Vereins-, Turnier-, Autoren- und
Verlagsregeln sowie einer unabhängigen Fachsammlung. watten.org ist eine
Hauptquelle; seine Regeln werden mit den anderen Profilen abgeglichen.
Die bisherigen Quellenbefunde sind dort zusammengeführt, damit widersprüchliche
Erstbefunde nicht als zweite, gleichzeitig gültige Spielregel stehen bleiben.

## 3. Stand der Regelsicherheit

**Noch keine lückenlose Regelfassung für alle gewünschten Modi.**
Ladinische Bestimmung, blinde Information, offene Ansage, Kritische,
Trumpfzugabe, Einsatzbieten und Spielerzahl werden getrennt betrachtet.
Innerhalb eines endgültig festgelegten Modus darf es keinen Ermessensspielraum
geben. Unterschiedliche Quellenregeln werden nicht zu einem erfundenen
Mischregelwerk zusammengesetzt.

Der [Regelabgleich](WATTEN_RULES_AUDIT.md) trennt belegte Regeln,
Owner-Vorgaben, echte Quellenkonflikte und verbleibende Lücken. Besonders
wichtig: Das Nicht-Zugeben-Müssen des eigenen Rechten ist eine andere Frage
als der Auslöser der Trumpfpflicht durch einen ausgespielten Rechten.

## 4. Noch abzuschliessende Regelfassung

Die [Restentscheidungen](WATTEN_RULES_AUDIT.md#9-restentscheidungen-vor-einer-lückenlosen-regelfassung)
betreffen die genaue Kombination der Modi, hohe Karten und Kollisionen,
vollständige Zugaberegel, Bieten/gestrichen, das konkrete Dreierprofil sowie
Sichtbarkeit und Nebenaktionen. Das sind fachliche Regeln, keine Freigabe,
diese während der Umsetzung nach Belieben zu bestimmen.

Teamwahl und taktische CPUs bleiben gewünschter Produktumfang. Die im ersten
Abschnitt festgehaltenen Gedanken gelten weiter; die endgültigen Varianten
müssen ihnen eine eindeutige fachliche Zuordnung geben.

## 5. Hausdepp-Kartendesigns wiederverwenden

**Owner-Entscheidung:** Die Designs sind identisch; für Watten keine neuen
Kartenmotive erstellen oder beschaffen. Das wurde ausdrücklich nochmals
bestätigt: watten.org liefert Regelhinweise, seine Kartenbilder und sein
Kartendesign werden nicht übernommen.

Im Ausgangscommit liegen bereits 36 darstellbare Karten vor:

| Bestandteil | Bestehende Datei / Referenz |
| --- | --- |
| Kartenidentitäten | [`app/hausdepp_engine.py`](../app/hausdepp_engine.py), `HAUSDEPP_SUITS`, `HAUSDEPP_RANKS`, `make_deck` |
| Darstellung und vermessene Ausschnitte | [`frontend/hausdepp/cards.js`](../frontend/hausdepp/cards.js), `CARD_CORNERS`, `cardArt` |
| Hauptfoto | [`app/static/hausdepp/cards-source.jpg`](../app/static/hausdepp/cards-source.jpg), 3996 × 2526 Pixel |
| Blendfreie Laub-10 | [`app/static/hausdepp/tell-leaves-reference-v1.jpg`](../app/static/hausdepp/tell-leaves-reference-v1.jpg), 3840 × 2887 Pixel |
| Blitz-Rückseite | [`app/static/hausdepp/card-back.png`](../app/static/hausdepp/card-back.png), 1254 × 1254 Pixel |
| Quellen, Bearbeitung und Lizenzen | [`docs/HAUSDEPP_ASSETS.md`](HAUSDEPP_ASSETS.md) |

Die Farb-IDs sind `hearts`, `bells`, `leaves`, `acorns`; die Rang-IDs sind
`6`, `7`, `8`, `9`, `U`, `O`, `K`, `A`, `10`. `bells-6` ist bereits als Weli
illustriert. Ein später bestätigtes 33er-Deck lässt sich aus diesen Motiven
auswählen: `hearts-6`, `leaves-6`, `acorns-6` auslassen, `bells-6` behalten.
Das ist eine Bestandsfeststellung, noch keine Änderung am Deck.

Die bestehende Assetdokumentation nennt für das Hauptfoto FUZxxl und Karl432
sowie **CC BY 3.0**, für die Laub-10 SZERVÁC Attila sowie **CC BY-SA 4.0**.
Die dort dokumentierten Credits, Quellen- und Lizenzlinks und die Lizenz der
Laub-10-Anpassung bei Wiederverwendung mitführen. Die Rückseite ist als
generierte Textur dokumentiert. Die vorhandene Dokumentation bleibt die
Referenz; diese Recherche enthält keine neue rechtliche Prüfung der Lizenzen.

**Nicht aus Hausdepp ableiten:** Dort ist die Zehn die höchste gewöhnliche
Karte und Weli eine normale Sechs. Das ist keine Watten-Rangordnung. Die
Wiederverwendung der Motive entscheidet auch noch nicht, ob später gemeinsame
Darstellungsmodule sinnvoll sind. Jetzt werden weder Assets kopiert noch
Renderer oder Spielregeln umgebaut.

## 6. Bedeutung für eine spätere digitale Umsetzung

Die folgenden Punkte sind eigene Folgerungen aus dem Informationsspiel,
keine zusätzliche Entwicklungsfreigabe und kein bereits beschlossener Entwurf:

- Beim beschriebenen Vierer-Ladinisch gehören die zwei Wissenden verschiedenen
  Teams an. Ein Partner darf nicht
  allein durch seine Teamzugehörigkeit dieselben Informationen erhalten.
- Verdeckte Informationen müssen serverseitig getrennt bleiben, auch bei
  Wiederverbindung, Zweitgerät, Zuschaueransicht, Verlauf und den geplanten CPUs.
- Eine automatisch vorsortierte Hand darf die ursprünglich unterste
  Ansagekarte nicht neu bestimmen. Zeitpunkt und Auswahl müssen eindeutig sein.
- Hinweise auf erlaubte Karten dürfen einem blinden Spieler nicht verraten,
  welcher Schlag oder Trumpf gilt. Ebenso darf ein Bot nur das Wissen seines
  eigenen Sitzes erhalten.
- Stichgewinner öffentlich anzuzeigen kann zum Spiel gehören; eine zusätzliche
  Begründung mit verborgenem Schlag/Trumpf würde mehr verraten. Den gewünschten
  Umfang vorab anhand der Hausregel entscheiden.
- Für Gebote braucht es später eindeutige Reihenfolge und Rundenschluss.
  Physische Tischregeln allein entscheiden keine gleichzeitig eintreffenden
  Aktionen eines Onlinespiels.

Vor einer Entwicklung zuerst die offenen Hausregeln mit konkreten
Beispielhänden schliessen. Für eine spätere Umsetzung gilt dann der bestehende
[Produkt-Lieferstandard](PRODUCT_DELIVERY.md), einschliesslich DE/EN,
Spielanleitung, Navigation, Tests und Versionierung.

## 7. Ergebnis dieses Rechercheauftrags

Gespeichert werden dieses Recherchepapier, der
[vertiefte Regelabgleich](WATTEN_RULES_AUDIT.md), die spätere
[Gestaltungsreferenz](WATTEN_DESIGN_REFERENCES.md) und ein DE/EN-Verweis im README.
Es gibt keine Spielimplementierung, neue Route oder sichtbare Produktänderung.
Die Produktversion bleibt bestehen; ein Release, Push oder Deployment ist
nicht Teil dieses Auftrags.

**Prüfung:** `npm run check:quality` einschliesslich `npm run lint` und
Sicherheitschecks erfolgreich. Die bestehenden Backend-Vertragstests
`tests/test_navigation_contract.py` und `tests/test_product_versions.py`
bestehen: 16 Tests und 115 Subtests. Browser-Tests entfallen, weil keine
sichtbare Anwendung geändert wurde. Es wurden keine neuen Tests oder
Produktdateien hinzugefügt.

**English brief:** Watten is the next planned game. The owner's usual variant
is four-player Ladinisch to 11 points with private bottom-card inspection by
the dealer and the next clockwise player. Reuse the existing Hausdepp card
designs. Two- and three-player variants are also wanted, together with tactical
CPU players using Tyrolean names like Hausdepp and manual team selection before
play, without random assignment. Calls are part of the game; the owner's rule
is that a player who is “gestrichen” must make no further calls. The precise
scope and variant rules still need to be defined. This document records sources,
product ideas and unresolved house rules. The detailed audit covers blind and
open announcements, Ladinisch, critical cards, trump obligations and two-/three-
player variants. Each final mode must have unambiguous rules. External card
designs are not adopted; development has not started.
