# Offline-Modus / Offline mode

Stand: 20.09.2026, Version 2.38.0. Implementiert als bewusst aktiviertes,
rein lokales Spielangebot. Die zuvor geprüfte öffentliche Offline-Bestenliste
wird nicht umgesetzt.

## Produktverhalten

- ZDWA: normales Solospiel mit vollständigem Spielzettel.
- Zilch: Solo bis 10’000 Punkte oder gegen den Würfelwirt mit normaler Strategie.
- Einstieg über **Offline spielen** in Lobby und Regeln. Jeder Einstieg und
  jedes Fortsetzen nach Pause, Reload oder erneutem Öffnen braucht die
  Bestätigung: keine Erfolge, keine Ranglistenwertung, keine Kontoübertragung.
- **Online spielen**, einschließlich Browser-Zurück, öffnet die Gegenbestätigung.
  Erst bei erreichbarem Server geht es zur Online-Lobby. Bei Verbindungsproblemen
  bleibt der lokale Spielstand spielbar.
- Netzverlust wandelt keine laufende Online-Partie um. Offline-Fallbacks zeigen
  ausschließlich den bestätigungspflichtigen Einstieg. Wiederkehrendes Netz
  beendet einen Offline-Modus nicht automatisch.
- Spielstand und eigene Bestwerte bleiben im Browser auf dem Gerät. Die
  Übersichten trennen Solo und Würfelwirt; es gibt keine öffentliche Liste.
  Löschen von Browserdaten entfernt die lokalen Spiele. Keine Gerätesynchronisation.
- Vor dem ersten Start ohne Netz den Bereich einmal online öffnen, bis die
  vollständige Offline-Bereitschaft angezeigt wird.

## Technische Trennung

`frontend/offline/` enthält lokale Regeln, Oberfläche, versionierte Speicherung
und Cache-Vorbereitung. Es importiert keine Konto-, Erfolgs-, Präsenz-, WebSocket-
oder Ergebnisclients. Die Sprachwahl bleibt lokal. Der einzige API-Aufruf der
Oberfläche ist die Readiness-Prüfung nach bestätigtem Rückwechsel zu Online.

Beide Service Worker speichern ausschließlich ein festes Paket öffentlicher
Offline-Dokumente und Assets. Kontoseiten, Online-Spielstände und APIs werden
nicht gecacht. Alte App-Caches werden entfernt. Ein passendes vollständiges Paket
und dessen Versionshash werden vor der Bereitschaftsmeldung geprüft. Updates
laden keine anderen geöffneten Online-Partien neu.

Lokale Regeln werden automatisch mit den Python-Serverregeln verglichen:
alle ZDWA-Würfelkombinationen, Zilch-Wertungsmengen, Ansage-/Poker-/Bestätigungs-
und Schlussrundenregeln sowie vollständige Solo-/CPU-Verläufe. Pfad-, Speicher-,
Browser- und echte Offline-Worker-Tests sichern den Produktflow ab.

## Manipulationsgrenze

Der Besitzer eines Browsers kann lokalen Code und gespeicherte Ergebnisse
verändern. Dagegen wird kein unwirksamer Client-Schutz behauptet. Lokale
Validierung fängt beschädigte oder inkompatible Spielstände ab; sie beweist
keine ehrliche Partie. Weil weder Ergebnisse noch Erfolgsfortschritte an das
Online-System übertragen werden, beeinflusst eine solche lokale Änderung keine
Rangliste und keine anderen Spieler. Ein späterer Upload würde eine neue
Produkt- und Sicherheitsentscheidung verlangen.

## English

Offline play is implemented for normal solo ZDWA and solo Zilch or the normal
Dice Innkeeper. Each entry/resume requires explicit acknowledgement that there
are no achievements, leaderboards or account uploads. Returning online also
requires confirmation and a reachable server. Network changes never convert
an online game or upload a local result.

Games and personal records remain in this browser on this device. Clear browser
data to remove them; there is no synchronization or public offline leaderboard.
Open the offline area online once and wait for the ready message. Service
workers cache only the fixed public offline package, never account or online
game responses. Local rules are checked against server scoring and complete
playthroughs. Browser tests cover mode changes, storage, zero account/result
requests, both languages, all themes and actual offline launches.

Local records can be edited by the device owner. Validation protects recovery
from corrupt saves, not competitive fairness. No local result reaches online
rankings, achievements or statistics, so this cannot affect other players.
