# Offline-Modus: Entscheidungsgrundlage

Stand: 20.09.2026. **Nur Bewertung, kein implementierter Offline-Spielmodus.**

Ein Solo-Modus bzw. Zilch gegen den Würfelwirt ist technisch möglich. Die
entscheidende Grenze liegt bei der Vergleichbarkeit mit online gespielten
Partien. Meine Empfehlung: Offline zunächst als Übungsmodus mit persönlichem
Verlauf und eigenen Bestwerten planen. Bei einer späteren öffentlichen
Offline-Liste muss ihre geringere Prüfbarkeit sichtbar sein. Offline-Ergebnisse
sollten die Online-Rangliste und wettbewerbliche Erfolge nicht beeinflussen.

## Ausgangslage im Projekt

- ZDWA würfelt und wertet serverseitig (`app/game_engine.py`).
- Zilch erzeugt Würfe mit `secrets.randbelow` in `app/zilch_engine.py` und prüft
  Spielzüge in `app/zilch_gameplay.py`.
- Auch der Würfelwirt läuft derzeit auf dem Server
  (`app/zilch_cpu_runner.py`, `app/zilch_cpu_strategy.py`).
- ZDWAs Service Worker bietet eine Offline-Hinweisseite. Zilchs Service Worker
  speichert keine privaten Spielstände oder Kontoseiten für Offline-Zugriff.

Echtes Offline-Spiel braucht daher lokale Regeln, Würfel, CPU-Logik und eine
versionierte lokale Speicherung. Es ist mehr als das Zwischenspeichern der
bisherigen Oberfläche. Regeln und CPU-Entscheidungen dürfen dabei nicht von
den Serverregeln abweichen.

## Was sich absichern lässt — und was offen bleibt

Der Browser gehört dem Spieler. Lokale Spielstände und ausführbarer Code können
verändert werden. Die grundsätzliche Vertrauensgrenze zwischen Client und
autoritativer Serverwertung beschreibt auch das
[OWASP Game Security Framework, Abschnitte 1.2–1.3](https://owasp.github.io/www-project-gamesec-framework/OGSF#12-trust-boundaries).

Für diese Würfelspiele folgt daraus: Ein nachträglicher Server-Replay kann
illegale Züge, falsche Summen und veränderte CPU-Entscheidungen erkennen. Er
beweist aber nicht, dass ein Lauf nur einmal gespielt wurde. Offline kann man
Spielstände kopieren, nach ungünstigen Würfen zurücksetzen, zahlreiche Varianten
simulieren und nur den besten gültigen Verlauf hochladen.

Ein vorab signierter Start mit einmaliger Spiel-ID, Regelversion und Server-Seed
verhindert erfundene Starttickets und doppelte Übermittlungen. Er verhindert
keine Simulation oder Auswahl des besten Verlaufs: Der Client muss die lokale
Zufallsfolge berechnen können. Eine bloße Prüfsumme oder ein in JavaScript
eingebauter geheimer Schlüssel schützt nicht gegen den Besitzer des Clients.
Auch eine Passkey-Signatur beweist die Kontobestätigung, nicht die Fairness des
Spielverlaufs. Dies sind Schlussfolgerungen aus der geprüften Projektarchitektur.

## Optionen

| Variante | Bewertung |
| --- | --- |
| Lokales Training, persönliche Offline-Bestwerte | Empfohlener erster Schritt; kein Einfluss auf gemeinsame Ranglisten. |
| Getrennte öffentliche Offline-Bestenliste | Möglich, mit Kennzeichnung und Serverprüfung; bleibt leichter manipulierbar. |
| Gemischte Bestenliste mit Offline-Symbol | Nicht empfohlen: Die Kennzeichnung verhindert keine Verdrängung fairer Online-Ergebnisse. |
| Serverentscheidungen für jeden Wurf | Hält die bisherige Kontrolle, benötigt aber Verbindung und ist kein vollständig nutzbarer Offline-Modus. |

Bei späterer Synchronisation: Kontozuordnung nach erneuter Anmeldung, eindeutige
Spiel-ID gegen Mehrfachimporte, Größen-/Ratenlimits, vollständiges Aktionsprotokoll,
serverseitige Nachberechnung, gespeicherte Regel- und CPU-Version und ein
unveränderliches Offline-Merkmal. Herkunft beim Upload serverseitig festlegen;
kein vom Client wählbares `online=true`. Auch Statistiken, Serien, Rangabzeichen
und Erfolgsfortschritt brauchen diese Trennung, nicht nur die sichtbare Tabelle.

Vor einer Umsetzung entscheiden: nur lokale Bestwerte oder separate öffentliche
Liste, welche Solo-/CPU-Varianten, Verhalten bei Netzverlust in einer Online-Partie,
Synchronisierung auf mehreren Geräten und Umgang mit gelöschten Browserdaten.
Eine laufende Online-Partie sollte beim Verbindungsverlust pausieren; ein
offline fortgesetzter Lauf darf später nicht als unverändert online gelten.

## English summary

This is an assessment, not an enabled feature. Offline solo/CPU play is feasible
but needs a local engine, CPU strategy and versioned storage. Start with practice
and personal offline records. Server replay and signed one-use game tickets can
reject invalid moves or duplicate imports, but cannot prove that a player did
not rewind, simulate alternatives or upload only the best run. Keep offline
results outside online leaderboards and competitive progression; a separate
public offline board would still carry lower assurance. A passkey verifies the
account, not fair gameplay.
