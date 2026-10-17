# Einsteigertouren für alle Spiele

Status: Produktplan. Umsetzung nach dem produktiven Release von Version 3.x.

Neue Spieler sollen direkt am Spieltisch verstehen, was sie als Nächstes tun
können, wo sie es tun und warum. Die Tour erklärt jeweils den nächsten sinnvollen
Schritt und lässt die Spieler selbst handeln. Sie bleibt kurz; die vollständigen
Regeln sind bei Bedarf erreichbar.

## Start und Reihenfolge

Nach dem bestätigten V3-Release einen eigenen Worktree vom dann aktuellen,
veröffentlichten Stand anlegen. Vorgeschlagener Branch: `codex/game-guides`.
Zuerst Zock die Wand an vollständig umsetzen und prüfen, danach Zilch, danach
Hausdepp. Die gemeinsame Toursteuerung wiederverwenden; die Schritte richten sich
nach dem jeweiligen Spiel. Noch nicht verfügbare Touren werden nicht angeboten.

## Erstes Spiel und freie Wahl

Beim ersten eigenen Spiel wird einmal pro Spiel eine kurze Tour angeboten.
Ein Lobbybesuch oder Zuschauen gilt noch nicht als erstes Spiel. Das Angebot
erscheint an einem ruhigen Einstiegspunkt vor der ersten eigenen Aktion.
Die Tour beginnt erst nach einer bewussten Zustimmung.

Wer ohne Tour spielt, sie beendet oder abschliesst, bekommt sie beim nächsten
Spiel nicht ungefragt erneut geöffnet. Ein kleiner Textwechsel oder ein Release
setzt diese Entscheidung nicht zurück. Die Wahl wird pro Konto und Spiel
geräteübergreifend gespeichert; Gäste erhalten dieselbe Funktion im jeweiligen
Browser. Ein Gastwechsel zu einem Konto darf eine bereits getroffene Ablehnung
nicht sofort wieder übergehen.

Jeder Schritt bietet ein dauerhaft sichtbares **Tour beenden**, zusätzlich ein
Schliessen-Symbol und Escape. Das beendet nur die Tour; die Partie läuft weiter.
Es gibt keine erneute Bestätigung und keinen automatischen Neustart. Unter den
Einstellungen lassen sich automatische Tourangebote zusätzlich ausschalten;
manuelles Starten und Anschauen bleiben möglich.

## Kurze Hinweise am passenden Ort

- Etwa fünf bis sieben kurze Lernmomente pro Spiel, je ein bis zwei Sätze.
- Das betroffene Element hervorheben und die konkrete Handlung samt Zweck
  erklären. Fortschritt zeigen, etwa „2 von 6“ / “2 of 6”.
- Nur gerade verfügbare Aktionen erklären. Bei fremdem Zug, Verbindungsabbruch,
  Pause oder verschwundenem Ziel den Hinweis passend ausblenden und bei einem
  gültigen Spielzustand fortsetzen. Nie Mitspieler oder einen Zug blockieren.
- Die Spieler klicken echte Spielaktionen selbst. „Weiter“ / “Next” löst keine
  Würfe, Einträge, Kartenaktionen oder sonstigen Spielzüge aus.
- Eine erfolgreiche Aktion kann den nächsten passenden Hinweis freigeben.
  Sonderregeln erscheinen erst, wenn sie gebraucht werden; Details bleiben in
  den Regeln. Niemand muss absichtlich einen Fehler machen, um weiterzukommen.
- Auf Smartphone, Tablet, Desktop und in der installierten App bleiben das
  erklärte Element und das Beenden erreichbar. Tastatur, Screenreader und
  reduzierte Bewegung werden berücksichtigt.

## Erste Tour für Zock die Wand an

Die Reihenfolge ist an den tatsächlichen Spielzustand gebunden. Die folgenden
Momente sind der Ausgangspunkt für die Umsetzung:

| Moment | Was und wo erklären | Warum |
| --- | --- | --- |
| Am Tisch ankommen | Eigenen Zettel und Zuganzeige zeigen; im Team den gemeinsamen Zettel erklären. | Das eigene Ziel und den richtigen Zeitpunkt zum Handeln erkennen. |
| Erster eigener Wurf | Würfel und Halten erklären, sobald der Wurf fertig ist. | Passende Würfel behalten und mit den übrigen weiter auf ein Ergebnis spielen. |
| Nochmals würfeln | Würfelknopf und verbleibende Würfe zeigen. | Verstehen, wann noch eine Verbesserung möglich ist. |
| Ergebnis eintragen | Ein gültiges Feld und die Spalten abwärts, frei und aufwärts erklären. | Punkte festhalten und verstehen, dass der Eintrag den Zug beendet. |
| Ansage wird möglich | Beim passenden ersten Wurf die Ansage und ihre Bindung ab dem zweiten Wurf erklären. | Die Entscheidung treffen, bevor man weiterwürfelt. |
| Selbständig weiterspielen | Regeln und erneuten Toureinstieg zeigen. | Mit wenigen Grundschritten selbst weiterspielen können. |

Solo würfelt den ersten Wurf automatisch. Hardcore hat genau einen automatischen
Wurf und bietet weder Halten noch Ansagen oder Korrigieren. Diese Tourvarianten
überspringen unpassende Hinweise und zeigen eine passende Fortschrittszahl.

## Erneut starten oder anschauen

Unter **Konto → Einstellungen → Hilfe & Neuigkeiten → Einsteigertouren** werden
die verfügbaren Spiele mit **Tour starten** und **Tour anschauen** angeboten.
Hausdepp nutzt den bestehenden Einstieg in die gemeinsamen Kontoeinstellungen.
Gäste erhalten einen entsprechenden Einstieg in ihren lokalen Einstellungen.

**Starten** begleitet die nächste passende eigene Spielsituation. Ohne laufende
Partie erklärt der Einstieg, wie man zum Spiel gelangt; er erstellt keine Partie
und führt keine Spielaktion aus. **Anschauen** zeigt die gleichen Grundschritte
mit gekennzeichneten Beispielen, ohne echte Spielzüge, Ergebnisse oder Erfolge
zu erzeugen. Diese Ansicht lässt sich ebenfalls jederzeit schliessen.

## Danach Zilch und Hausdepp

Zilch führt durch Punktewürfel auswählen, Wertung verstehen und die Entscheidung
zwischen Weiterwürfeln und Sichern samt Zilch-Risiko.

Hausdepp führt durch eigene Hand, gültiges Ablegen, Nachziehen beziehungsweise
Zocken, offenes Paket und Rundenende. Ein Kartenklick spielt sofort: Hinweise
dürfen deshalb keine echten Kartenaktionen auslösen oder versehentlich überdecken.

## Kurze Texte auf Deutsch und Englisch

Entwürfe für die spätere Oberfläche; alle weiteren Tourtexte ebenfalls vollständig
in beiden Sprachen ausliefern.

| Deutsch | English |
| --- | --- |
| Dein erstes Spiel? Möchtest du eine kurze Tour? | Your first game? Would you like a quick tour? |
| Tour starten | Start tour |
| Ohne Tour spielen | Play without a tour |
| Tour beenden | End tour |
| Tour anschauen | View tour |
| Einsteigertouren | Beginner tours |
| Touren beim ersten Spiel anbieten | Offer tours on the first game |
| Tippe passende Würfel an, um sie zu behalten. Die anderen kannst du erneut würfeln. | Tap the dice you want to keep. You can roll the others again. |

## Abnahme der jeweiligen Spieltour

- Einmaliges Angebot, Zustimmung, Ablehnung, jederzeitiges Beenden und erneuter
  Einstieg über die Einstellungen funktionieren; Neuladen und Wiederverbinden
  öffnen eine beendete Tour nicht erneut.
- Konto, Gast und Spielwechsel erhalten die richtige Auswahl pro Spiel. Eine
  abgeschlossene ZDWA-Tour unterdrückt keine erste Zilch- oder Hausdepp-Tour.
- Eigener und fremder Zug, unterstützte Modi, Zugwechsel, Pause, Verbindungsabbruch
  und Spielende hinterlassen keine falschen Hinweise oder blockierten Aktionen.
- Deutsch und Englisch sowie mobile und grosse Ansichten sind im Browser geprüft.
  Die Anschaumöglichkeit verändert keine echte Partie und keine Spielstatistik.
- Vor dem jeweiligen Funktionsrelease gemäss [Produkt-Lieferstandard](PRODUCT_DELIVERY.md)
  README, Spielanleitungen und Übersetzungen ergänzen, passende Backend- und
  Browsertests ausführen und `npm run check:quality` bestehen. Neue Seitenpfade
  erhalten Navigationsprüfungen und die passende SEO-Einordnung.
- Das neue Feature erhält eine Minor-Version, bilingualen Changelog und einen
  spielerfreundlichen DE/EN-Releasehinweis für die tatsächlich betroffenen Spiele.
