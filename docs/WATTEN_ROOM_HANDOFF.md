> **Historische Übergabe vom 18.10.2026.** Der folgende Auftrag ist wortgleich
> aus `a97a679` übernommen. Das Paket wurde als `bce2853` implementiert, mit
> `9bb783c` um die persistierte Mitgliedergrenze korrigiert und als
> `1299d9d`/`f0c17a5` integriert. Dies ist kein neuer Arbeitsauftrag und keine
> Runtime-/P2-Freigabe. Aktuelle Quellen und offene Anbindung:
> [WATTEN_ENGINE.md](WATTEN_ENGINE.md).

# Watten – reiner Warteraum und vollständiges Rezept

Nächstes abgegrenztes Claude-Paket. Codex koordiniert und integriert.
Worktree `/Users/manuel/.codex/worktrees/watten-room-foundation/RollTheDice`,
Branch `codex/watten-room-foundation`. P1 und die geprüften reinen P3-Module
einschliesslich `watten_play` sind hier als Ausgangspunkt vorhanden.

## Dateibesitz und Umfang

Nur vier neue Dateien schreiben: `app/watten_room.py`, `app/watten_recipe.py`,
`tests/test_watten_room.py`, `tests/test_watten_recipe.py`.
Reine unveränderliche Domäne und ihre JSON-Persistenz, noch ohne API, Socket,
DB-Modelle, Adapter/Registry, UI, Migrationen, Versionen oder Push.
Keine bestehende Datei ändern. Keine Abhängigkeiten installieren.

## Rezept

- Strikte versionierte Allowlist, unbekannte Felder ablehnen; echte Integer
  von Boolean unterscheiden. Bestehendes `PlayProfile` für gültige Kombinationen
  wiederverwenden, keine doppelte Regelnachbildung.
- Spielerzahl, normale/ladinische Bestimmung, offen/blind, Kritische,
  Ruleset-ID/-Version, Zielpunkte (Integer mindestens drei, Standard elf).
  Guter/Schlechter nicht anbieten. CPU-Platzwünsche als eindeutige gültige
  Sitzindizes; keine fremden Konten oder Teilnehmer-IDs in Favoriten.
- Bestätigte Optionen: `show_rechter` standardmässig aus, Stichhistorie
  standardmässig aus, Partnerblatt nur als ausdrückliche Option im offenen
  Spiel. Diese Optionen gelten für das ganze Rezept.
- `password_required` darf gespeichert werden; Passwort, Verifier, Einladung,
  Reservierungsdaten, Sitzung, Hände und Ansage gehören nie ins Rezept.
- Rezept und Raum haben explizite validierte `to_payload`/`from_payload`-
  Übergänge. Unbekannte Versionen und defekte Beziehungen ablehnen. Der
  generische bestehende `_json_safe` kann Dataclasses nicht zuverlässig speichern.

## Raum und Entscheidungen für dieses technische Paket

Diese Routineentscheidungen stammen von Codex, nicht aus neuen Hausregeln:

1. Feste geordnete logische Sitze für 2/3/4. Kontobindung, Teilnehmer-ID,
   Sitz-ID und CPU-Belegung unterscheiden; keine Socket-ID als Identität.
   Aufnahme als Mitglied und bewusste Platzwahl sind verschiedene Schritte.
2. Viererparteien sitzen gegenüber. Menschen wählen einen konkreten Sitz
   und bestätigen dessen Team ausdrücklich; niemals aus Beitrittsreihenfolge
   oder Mensch/CPU ableiten. Zweier Einzelspieler, Dreier feste Sitze mit
   später je Gabe rotierendem Solo, keine bleibenden Dreierteams erfinden.
3. Jeder Übergang prüft erwartete Raumrevision und vertrauenswürdig übergebenen
   Akteur. Abgelehnte Aktionen verändern nichts. Keine Änderung an laufender
   Sitz-/Teambelegung; CPU-Übernahme mitten in der Gabe gehört nicht hierher.
4. Kontorejoin findet vor Kapazitäts-/Belegungsprüfung statt und führt auf
   dieselbe Teilnehmer-/Sitz-ID. Rejoin erhöht weder Kapazität noch Frist und
   startet nicht. Alte Socketentmachtung bleibt später Aufgabe der Anbindung.
5. CPU-Verwaltung ist Hostrecht. Ein Mensch kann ausdrücklich einen bestimmten
   freien oder unreservierten CPU-Sitz beanspruchen; keine automatische Wahl
   der letzten CPU, keine Umsortierung. Eine gültige private Kontoreservation
   hat Vorrang. Ablauf wird über explizite Serverzeit geprüft.
6. Host-Leave im Warteraum überträgt an das älteste verbleibende menschliche
   Mitglied aus einer expliziten serverseitigen Berechtigtenliste. Kein Mensch:
   Raum schliessen. Netzwerkabbruch ist kein bewusster Leave; diese Funktion
   darf ihn nicht in eine Löschung oder einen Sitztausch umdeuten.
7. Wartefrist als explizite positive Konfiguration übergeben. Nur eine neue
   tatsächliche menschliche Sitzbelegung erneuert sie; Rejoin, CPU, Beobachter,
   Chat oder Ping nicht. Eigene Frist nur für Warten, nicht als Spieluhr verwenden.
8. Ausschliesslich Host startet bewusst, alle nötigen Sitze müssen belegt und
   Viererteams gültig bestätigt sein. Join/CPU-Änderung startet nie. Erster Geber
   wird später serverseitig gelost; ein übergebener Start-Geber muss ein gültiger
   Sitz sein. Start liefert unveränderliches Roster für den bestehenden P3-Kern.
9. Rematch erzeugt einen neuen Warteraum aus vollständigem Rezept. Menschen
   werden nicht automatisch umgesetzt; private Sitzvorschläge/Reservationen
   sind getrennt und erfordern bewusste Annahme. Die Quelltisch-ID und bereits
   erzeugte Folgetisch-ID müssen doppelte Erzeugung verhindern. Vorherige
   Ergebnisse/Punkte bleiben unverändert. Schutzverifier wird ausschliesslich
   ausserhalb des öffentlichen Rezepts serverseitig weitergegeben.

Alle persistenten Raumdaten sind serverintern; dies ist **keine** erlaubte
Spieler-/CPU-Projektion. Keine beliebigen Dataclass-Dicts an Clients senden.
Keine vorweggenommene vollständige P2-Abnahme.

## Nachweis und Übergabe

Nur eigene kleine serielle Tests mit vorhandenem Python:
`/Users/manuel/PycharmProjects/RollTheDice/.venv/bin/python -m pytest -n 0 tests/test_watten_room.py tests/test_watten_recipe.py`.
Gezieltes Ruff. Keine volle Suite, Browser, Container, Produktion oder Push.
Alle 2/3/4-Sitze, umgekehrte Joinfolgen, volle-Raum-Rejoins, CPU-Reservation,
alte Revisionen, bewusster Start, Leave/Frist und JSON-Roundtrips prüfen.
Die vier eigenen Dateien committen und Hash, tatsächliche Tests und Grenzen
kurz berichten. Bei Nutzungslimit Zustand erhalten; Codex übernimmt direkt.
