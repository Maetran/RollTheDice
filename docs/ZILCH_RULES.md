# Zilch-Regelvertrag (intern)

Stand: `zilch-house-v1`. Dieses Dokument ist der verbindliche Regelvertrag für
die serverseitige Engine. Zilch bleibt eine geschützte `noindex`-Vorschau für
den Admin-Account `Mani`; es gibt ausdrücklich noch keine öffentliche
Regelseite und keine fertige Spieloberfläche.

## Begriffe

| Deutsch | English | Bedeutung |
| --- | --- | --- |
| Wurf | roll | Ein serverseitig erzeugtes Ergebnis für alle freien Würfel. |
| Halten | hold | Verbindlich ausgewählte Wertungswürfel; Halten kann nicht zurückgenommen werden. |
| Rundenpunkte | unbanked round points | Punkte eines noch nicht angeschriebenen Zuges. |
| Anschreiben / Sichern | bank | Rundenpunkte dauerhaft zum Gesamtstand hinzufügen. |
| Zilch | Zilch / no-score turn | Zugverlust; ungesicherte Punkte verfallen. |
| Bestätigungswurf | confirmation roll | Nach einer bestimmten starken Wertung erforderlicher weiterer Punktewurf. |
| Hot Dice | Hot Dice / free roll | Alle sechs physischen Würfel wurden gehalten; sie werden wieder frei, die Rundenpunkte bleiben bestehen. |
| Straße | straight | Einmal 1–6. |
| Drilling | three of a kind / triple | Drei gleiche Würfel als Wertungsgruppe. |
| Drei Paare | three pairs | Drei verschiedene Paare in einem Sechs-Würfel-Wurf. |

## Verbindliche Wertung

Es werden immer sechs Würfel verwendet; das Ziel beträgt mindestens 10.000
Punkte.

| Wertung | Punkte | Regel |
| --- | ---: | --- |
| Einzelne 1 | 100 | Jede einzeln gehaltene 1. |
| Einzelne 5 | 50 | Jede einzeln gehaltene 5. |
| Drei 1en | 1.000 | Ein Drilling; löst einen Bestätigungswurf aus. |
| Drei gleiche 2–6 | Augenzahl × 100 | Beispielsweise drei 4en = 400. |
| Vier oder fünf Gleiche | keine eigene Sonderwertung | Sie bestehen aus einem Drilling plus möglichen einzelnen 1en/5en. |
| Sechs Gleiche | zwei getrennte Drillinge | Beispielsweise sechs 1en = 2.000; kein Multiplikator. |
| Straße 1–6 | 2.000 | Alle sechs Würfel. |
| Drei Paare | 500 | Alle sechs Würfel, drei Paare. |
| Zwei Drillinge | Summe beider Drillinge | Beispielsweise 3×2 und 3×4 = 600. |
| „500 für nichts“ | 500 | Nur bei sechs freien Würfeln ohne sonstige wertbare Kombination, etwa 2-2-3-4-6-6. Dies ist **kein** Zilch. |

Es gibt in dieser Regelversion keine weiteren Sonderkombinationen.

### Auswahl und Kombination

- Der Spieler darf jeden gültigen, punktenden Teil eines Wurfs halten. Er darf
  etwa bei 3×5 nur eine 5 für 50 halten oder den Drilling für 500.
- Werden drei gleiche Würfel gemeinsam gehalten, zählen sie zwingend als
  Drilling und nicht als drei Einzelwürfel. Bei vier oder fünf gleichen
  1en/5en ergänzt ein Drilling die übrigen ausgewählten Einzelwürfel.
- Ein bereits bestätigter Hold ist endgültig; es gibt keine Unhold-Aktion.
- Mehrere wertende Gruppen dürfen gemeinsam gehalten werden, zum Beispiel
  3×1 (=1.000) plus zwei weitere einzelne 1en (=200). Die Engine liefert auch
  kombinierte Auswahloptionen.

Beispiele:

- `5-5-5-5-2-3`: ein Drilling 5 = 500; alle vier 5en zusammen = 550; nur
  eine 5 = 50.
- `1-1-1-5-5-2`: drei 1en und zwei einzelne 5en = 1.100. Wegen der drei 1en
  folgt ein Bestätigungswurf.
- `1-2-3-4-5-6`: Straße = 2.000. Alle Würfel sind gehalten, daher Hot Dice
  und ein Bestätigungswurf.
- `2-2-3-4-6-6`: „500 für nichts“ = 500. Alle Würfel werden danach für
  denselben Spieler wieder frei; auch hier ist ein Bestätigungswurf nötig.

## Zugablauf, Risiko und Sichern

1. Vor Spielbeginn würfeln die Teilnehmer jeweils einmal. Der höhere Wert
   beginnt; bei Gleichstand wird erneut gewürfelt. Im Einspieler-Modus wird
   der dokumentierte Startwurf ebenfalls serverseitig erzeugt.
2. Der aktive Teilnehmer würfelt ausschließlich auf dem Server alle noch
   freien Würfel und hält anschließend mindestens eine gültige Wertung.
3. Nach dem dritten Wurf müssen insgesamt mindestens 300 Rundenpunkte
   verbindlich gehalten sein. Ist das mathematisch nicht mehr möglich, tritt
   sofort Zilch ein. Gibt es eine erreichbare 300er-Auswahl, liefert der Server
   ausschließlich diese gültigen Fortsetzungs-Holds statt einer kleineren,
   unzulässigen Auswahl.
4. Anschreiben ist ab 400 Rundenpunkten möglich, solange kein
   Bestätigungswurf offen ist. Ein erfolgreiches Anschreiben überträgt die
   Punkte dauerhaft und setzt die eigene Zilch-Serie zurück.
5. Es gibt kein gewöhnliches Wurflimit: Nach erfüllter 300er-Regel darf der
   Spieler weiterwürfeln, bis er anschreibt oder Zilch erleidet.

## Bestätigungswurf und Hot Dice

Ein weiterer Punktewurf mit mindestens 50 Punkten muss gehalten werden, wenn

- ein Drilling aus 1en gehalten wurde; oder
- durch die Holds alle sechs physischen Würfel gehalten wurden.

Der zweite Fall umfasst insbesondere Straße, drei Paare, zwei Drillinge,
sechs Gleiche und „500 für nichts“. Hot Dice setzt die sechs Würfel wieder auf
frei; die Rundenpunkte und die Hold-Historie bleiben erhalten. Während ein
Bestätigungswurf offen ist, darf nicht angeschrieben werden. Erzeugt der
Bestätigungswurf erneut drei 1en oder Hot Dice, beginnt die Bestätigung erneut.

## Zilch, Serien und Spielende

Ein Zilch tritt ein, wenn

- ein Wurf keine gültige Wertung liefert (ausgenommen das bestätigte „500 für
  nichts“ bei sechs freien Würfeln); oder
- die 300er-Schwelle am dritten Wurf nicht verbindlich erreicht werden kann.

Ungesicherte Rundenpunkte verfallen; das eigene Board protokolliert den Zug
als `zilch`. Beim **dritten aufeinanderfolgenden** Zilch werden 500 Punkte
abgezogen, niemals unter 0. Ein erfolgreiches Anschreiben setzt die Serie
zurück. Die bestätigte Regel bestimmt den Übergang zur dritten Serie; ob nach
einem vierten oder weiteren Zilch ohne Anschreiben weitere Abzüge in einer
festen Kadenz folgen sollen, ist bewusst noch nicht festgelegt. Die aktuelle
Engine zieht daher genau beim Übergang `2 → 3` einmal 500 Punkte ab und erfindet
keine weitere Straflogik.

Ab mindestens 10.000 angeschriebenen Punkten wird die mögliche Schlussrunde
begonnen. Der andere Teilnehmer erhält einen vollständigen normalen Zug mit
beliebig vielen Würfen nach diesen Regeln. Danach gewinnt der höchste
Gesamtstand; bei Gleichstand gibt es keinen Sieger und keinen Stechwurf.

Manuelle Punkteingabe ist nicht vorgesehen. Eine spätere manuelle
Würfelauswahl kann zusätzlich zu Quick Holds entstehen, bestimmt aber niemals
Punkte auf dem Client.

## Serververtrag für spätere Bedienung

Nach jedem Wurf liefert der Snapshot strukturierte Quick-Hold-Optionen unter
`_zilch_quick_holds`. Jede enthält mindestens eine stabile, rollgebundene ID,
Kombinationstyp, Würfelindizes/-werte, Punkte, Übersetzungs-Key samt Parametern,
Komponenten, Hot-Dice-/Free-Roll-Information und Folgeaktionen. Der Server
formatiert daraus keine deutschen Texte.

Die aktuell verfügbaren WebSocket-Aktionen sind:

- `zilch_roll_dice` mit `turn_id` und `version`;
- `zilch_select_hold` mit `turn_id`, `version`, `roll_id`, `option_id` sowie
  optional gegengeprüften Würfelindizes, Punkten und Kombinationstyp;
- `zilch_bank_points` mit `turn_id` und `version`.

Eine Quick-Hold-Auswahl wird für den aktuellen Turn und Roll erneut
berechnet. Alte IDs, falsche Indizes/Punkte, ein falscher Spieler, falscher
Spieltyp sowie doppelte oder veraltete Versionsstände werden ohne
Zustandsänderung abgewiesen. Der ältere Platzhalter `zilch_submit_score` wird
explizit als nicht unterstützte manuelle Punkteingabe abgelehnt.

## Technische und Produktgrenzen

- Die Engine verwendet für Menschen und spätere CPU-Teilnehmer denselben
  injizierbaren, serverseitigen Zufallsweg. Clients liefern nie
  Würfelergebnisse.
- Aktive Zustände samt Turn-ID, Holds, Rundenpunkten, Boards und
  Quick-Hold-Grundlage bleiben über die bestehende aktive Persistenz
  restart-sicher. Ein abgeschlossenes Zilch wird nicht in ZDWA-Ergebnisse,
  Statistiken, Achievements oder Bestenlisten geschrieben.
- Noch offen bleiben insbesondere eine präzise Strafkadenz nach mehr als drei
  aufeinanderfolgenden Zilchs, CPU-Entscheidungen, ein echtes Solo-Ziel,
  manuelle Würfelauswahl, fertige Interaktion, Ergebnisdatenbank und
  Zilch-spezifische Auswertung.

## Spätere Designrichtung

Die spätere eigene Zilch-Oberfläche darf die vorhandene `data-game="zilch"`
Grenze nutzen: warme Holz-/Spieltischflächen, physisch wirkende Würfel mit
Tiefe, deutlich leuchtende ausgewählte Würfel, große papierartige
Quick-Hold-/Würfel-/Sichern-Karten, gut lesbare Standardschrift mit
handschriftlichen Akzenten und große Touch-Ziele. Zilch, Hot Dice und besondere
Erfolge sollen klar als Risiko- oder Erfolgszustand inszeniert werden.

Das ist ausschließlich eine eigene Designrichtung. Es werden keine Grafiken,
Sounds, Fonts, Logos, Award-Designs, Quellcodes oder pixelgenauen Vorlagen von
Bubblebox oder anderen Dritten übernommen.
