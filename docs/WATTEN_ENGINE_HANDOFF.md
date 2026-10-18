# Watten – nächste reine Engine-Aufgabe

Stand 18.10.2026, Ausführungs-Chat. Dieser eigene Worktree ist für das nächste
Engine-Paket vorbereitet. Keine Runtime-/Produktfreigabe ist damit verbunden.

## Eigentum und Übergabestand

- Worktree: `/Users/manuel/.codex/worktrees/watten-deal-engine/RollTheDice`.
- Codex führt, prüft und integriert; Claude erhält ab **17:15 Europe/Zurich**
  ein abgegrenztes Paket. Erst dann nach Liveprüfung der Sitzung und Woche
  vergeben. Alte 17:20-Startvorgabe ist durch den Owner vorgezogen worden.
- Claude schreibt ausschliesslich neue `app/watten_play.py` und
  `tests/test_watten_play.py`. Keine anderen Dateien oder fremden Worktrees
  ändern. Keine Migration, API, Oberfläche, Registry, Version, Abhängigkeiten,
  produktiven Änderungen oder Pushes.
- Die übrigen laufenden Pakete besitzen andere Dateien: PWA bei
  `p1_contracts`, Karten-/Vergleichsgrundlage `b432b8b`, Bieten/Punkte
  `9545edf`. Beide reinen Grundlagen sind hier integriert und unabhängig
  quergelesen. «Danke» braucht zusätzlich tatsächliche bestätigte Anzeigen.

## Konkretes Paket

Reine unveränderliche Zug-/Stichübergänge **nach abgeschlossener Ansage**,
noch ohne Inspektionsphasen und ohne Produktanbindung. Die festen ursprünglichen
Hände kommen aus `DealtCards`, Sitz-/Parteizugehörigkeit aus `DealParties`;
Teilnehmer-IDs nicht mit den numerischen Karten-Sitzindizes verwechseln.

1. Ein ausdrückliches Profil unterscheidet normale/ladinische Bestimmung,
   offen/blind und Kritische. Zweier immer offen; Dreier offen und normal;
   blind nur Vierer/Ladinisch. Guter/Schlechter bleiben aus.
2. Erste Zugrolle ist Uhrzeigernachfolger des Gebers. Danach im Uhrzeigersinn,
   der Stichsieger eröffnet den nächsten Stich. Nur eigene vorhandene Karte
   auf eigenem Zug; jede Ablehnung lässt den alten Zustand unverändert.
3. Trumpfpflicht gilt nur für offiziell Wissende: offen alle, blind genau
   Geber und Nachfolger. Erschlossene Kenntnis eines Blinden genügt nicht.
   Auslöser ist **die erste Stichkarte**, wenn gewöhnlicher Trumpf/Rechter.
   Kritische lösen nie aus, auch bei gedruckter Trumpffarbe/Überschneidung.
4. Hat ein verpflichteter Spieler gewöhnlichen Trumpf, darf er Trumpf,
   Rechten oder Kritischen legen; ein gewöhnlicher Schlag ist nur als
   tatsächlich gewinnender Stecher erlaubt. Für Trumpf, Rechten und Kritische
   gilt keine Stechpflicht. Rechter und
   Kritische werden nie erzwungen; ohne gewöhnlichen Trumpf bleibt freie Wahl.
   Späterer kritischer Überstich hebt ausgelöste Pflicht nicht auf.
5. Bestehende reine Stichbewertung benutzen. Dritter gewonnener Parteistich
   beendet sofort die Gabe; keine weitere Karte/kein weiteres Gebot danach.
   Der neue Zustand liefert den vertrauenswürdigen Abschluss an das bereits
   vorhandene Biet-/Punktemodul. Kein eigener zweiter Punktealgorithmus.
6. Offenes Gebot friert Kartenaktionen ein (`require_gameplay_allowed`).
   Deal-ID/Parteien müssen zum Bietzustand passen; alle Übergänge bleiben
   serverinterne Autorität, keine Clientbehauptung über Gewinner/Ende.
7. Kritischen-Vorrang aus `ComparisonRules` behalten. Freie Weli-Schlagwahl
   bei Kritisch EIN ist nach gewähltem Tiroler Quellenprofil verboten;
   ladinisch erzwungener Weli bleibt ausdrücklich erlaubt und zweithöchster
   Kritischer. Ohne Kritische ist Weli-Schlag alleiniger geschützter Rechter.

Tests müssen die bestätigten Grenzhände, alle 2/3/4-Rollen, kritischen
Überstich, Abweisung eines nicht gewinnenden gewöhnlichen Schlags,
alleinige geschützte Karten, Kartenerhalt,
Zugrecht, sofortigen Abschluss und Gebotssperre unabhängig prüfen.
Diese interne Struktur **niemals** unmittelbar an Spieler/CPU serialisieren;
Allowlist-Projektion und Inspektions-/Wiederholungsvertrag folgen separat.

## Prüfung und Ergebnis

Nur winzige serielle Tests mit dem vorhandenen Python:
`/Users/manuel/PycharmProjects/RollTheDice/.venv/bin/python -m pytest -n 0 tests/test_watten_play.py`.
Gezieltes Ruff erlaubt. Keine vollständige Suite, Browser-/Containerpools,
neue Installationen oder globalen Änderungen. Die separate P1-Vollprüfung
läuft im ersten Ausführungs-Worktree und darf nicht gestört werden.

Eigene zwei Dateien nach Prüfung committen, nicht pushen. Ergebnisort,
Commit, genaue Prüfungen und verbleibende Einschränkungen kurz zurückgeben.
Bei Nutzungslimit Zustand erhalten; Codex kann unmittelbar übernehmen.

Weitere Autorität: `docs/WATTEN_OWNER_DECISIONS.md` und Projekt-`AGENTS.md`.
All 81 findings remain required; this task only covers pure card transitions.
