# Historischer Umsetzungsplan: Benutzerkonten, Profile und Spielerstatistiken

Status: Kernumfang implementiert (Stand 28. August 2026)
Ursprünglicher Planungsbranch: `plan/user-accounts-and-profiles`

Dieses Dokument hält die ursprüngliche Architekturentscheidung und deren
Begründung fest. Benutzerkonten, serverseitige Sessions, Rollen, Präferenzen,
Profile, Rankings, vollständige Spielergebnisse, Zuordnungen und das Audit für
Löschungen sind inzwischen implementiert. Die produktive App verwendet
SQLAlchemy, Alembic und `data/rollthedice.sqlite3`; laufende Partien werden
ebenfalls restart-sicher gespeichert. Die nachfolgende „Ausgangslage“ ist daher
historisch und beschreibt den Stand vor der Umsetzung.

## Zielbild

- Gäste können spielen sowie Spieler, Rankings und öffentliche Profile ansehen.
- Benutzer melden sich mit einem unveränderlichen Benutzernamen und Passwort an.
- Gäste können über die Lobby selbst ein Benutzerkonto registrieren.
- Angemeldete Benutzer können spielen, ihr Passwort ändern und ihre persönlichen
  Statistiken auf einer neuen Landingpage sehen.
- Administratoren verwalten Benutzer, setzen Passwörter zurück und ordnen alte
  beziehungsweise unzugeordnete Spielergebnisse einem Benutzer zu.
- Bestenlisten verlinken registrierte Teilnehmer einzeln auf deren Profil.
- Neue vollständige Spiele werden dauerhaft und vollständig gespeichert. Daraus
  werden Profile, Rankings und Bestenlisten berechnet.

## Historische Ausgangslage vor der Umsetzung

Die Anwendung hatte zu Beginn keine dauerhafte Benutzeridentität. Ein Spieler war
nur eine zufällige sechsstellige ID innerhalb eines laufenden Spiels; der frei
eingegebene Name und ein Resume-Token liegen im Local Storage. Das ist für die
Wiederaufnahme eines Spiels ausreichend, aber nicht für Konten oder belastbare
Statistiken.

Die damalige JSON-Persistenz speicherte nur begrenzte Ausschnitte:

- Top 10 der letzten sieben Tage
- Top 10 Alltime, getrennt nach Normal und Hardcore
- Hall of Shame und letzte zehn Spiele
- globale, nicht benutzerbezogene Durchschnittswerte

Damit lassen sich die bisher gezählten Spiele nicht vollständig pro Benutzer
rekonstruieren. Aus den noch vorhandenen Snapshots können einzelne alte Spiele
importiert und anschließend durch einen Administrator zugeordnet werden. Eine
vollständige historische Benutzerstatistik beginnt jedoch erst mit dem neuen
Speichermodell.

Backend, WebSocket-Logik und Persistenz liegen derzeit weitgehend gemeinsam in
`app/main.py`. Der Umbau sollte Authentifizierung, Datenzugriff und Statistik in
eigene Module auslagern, ohne gleichzeitig die funktionierende Spiellogik neu zu
schreiben.

## Empfohlene technische Lösung

### Persistenz

SQLite passt zur einzelnen Docker-Instanz und zum vorhandenen Volume. Empfohlen
sind SQLAlchemy und Alembic für ein explizites Schema und wiederholbare
Migrationen. Die Datenbank liegt in `data/rollthedice.sqlite3` und wird zusammen
mit den bisherigen Produktionsdaten gesichert.

Kernentitäten:

- `users`: ID, Benutzername, normalisierter Benutzername, Passwort-Hash, Rolle,
  aktiv, Passwortwechsel erforderlich, Zeitstempel
- `sessions`: Hash des zufälligen Session-Tokens, Benutzer-ID, Ablauf,
  Erstellung und letzte Nutzung
- `completed_games`: bisherige Game-ID, Zeitpunkt, Modus, Hardcore, vollständiger
  Replay-Snapshot
- `game_participants`: Spiel, Position/Team, damaliger Anzeigename, optionale
  Benutzer-ID, Endpunktzahl und Zuordnungs-Audit

Bestenlisten und Statistiken werden aus `completed_games` und
`game_participants` abgefragt. Die bisherigen JSON-Dateien bleiben während einer
Übergangsphase lesbar und werden durch einen idempotenten Import mit
`game_id`-Deduplizierung übernommen.

### Authentifizierung und Sessions

- Passwort-Hashes mit Argon2id; niemals Passwörter oder wiederverwendbare
  Session-Tokens speichern oder protokollieren
- Serverseitige, widerrufbare Sessions mit zufälligem Token in einem
  `HttpOnly`-, `SameSite`- und in Produktion `Secure`-Cookie
- Login-Drosselung, generische Fehlermeldungen und Validierung der
  WebSocket-Origin
- CSRF-Schutz für zustandsändernde HTTP-Endpunkte
- Passwortänderung und Admin-Reset widerrufen alle bestehenden Sessions des
  betroffenen Benutzers
- Admin setzt ein temporäres Passwort; beim nächsten Login ist ein eigener
  Passwortwechsel erforderlich
- Kein Self-Service-Reset und kein E-Mail-Versand in dieser Ausbaustufe

JWT ist hier nicht erforderlich. Eine serverseitige Session ist für eine
einzelne Instanz einfacher sicher zu widerrufen, insbesondere nach
Passwortänderung oder Admin-Reset.

### Identität im Spiel

Beim Beitritt erhält jeder Teilnehmer zusätzlich zur kurzlebigen Spiel-ID eine
optionale `user_id` aus der authentifizierten Session. Statistiken werden nur
über diese ID zugeordnet, niemals über den sichtbaren Namen.

Ein Gast darf keinen registrierten Benutzernamen imitieren, oder muss in allen
Ansichten eindeutig als Gast gekennzeichnet werden. Empfohlen ist, registrierte
Benutzernamen für Gäste zu reservieren.

Bei einem Teamspiel wird der gemeinsame Teamwert beiden Teilnehmern als deren
Spielresultat angezeigt. Für globale Summen muss die API klar zwischen
`participant_points` und eindeutig gezählten `team_points` unterscheiden, damit
Teamwerte nicht versehentlich doppelt gezählt werden.

### Seiten und API-Bereiche

- Lobby: Registrierung, Login/Logout, angemeldeter Benutzer, Gastname und verlinkte Namen
- Benutzer-Landingpage: Gesamtübersicht sowie Normal/Hardcore getrennt
- Öffentliches Profil: gespielte vollständige Spiele, Summe, Maximum, Minimum,
  Durchschnitt; keine Kontodaten
- Spielersuche und Ranking mit Pagination und definierter Sortierung
- Kontoeinstellungen: eigenes Passwort ändern
- Adminbereich: Benutzer anlegen/deaktivieren, temporäres Passwort setzen,
  Rollen verwalten, unzugeordnete Teilnehmer suchen und zuordnen

Die vorhandene versteckte Superadmin-PIN für Scoreboard-Korrekturen sollte im
Zuge des Umbaus nicht als zweites Adminsystem bestehen bleiben. Empfohlen ist,
diese Berechtigung an die neue Adminrolle zu koppeln oder die beiden Rechte
explizit zu trennen.

## Statistikdefinitionen

Für eine eindeutige und testbare Umsetzung wird empfohlen:

- `gespielte Spiele`: nur regulär vollständig beendete Spiele; abgebrochene
  Spiele zählen nicht
- `Gesamtpunkte`: Summe der persönlichen Endwerte
- `Maximum` und `Minimum`: nur vollständige Spiele
- `Durchschnitt`: Gesamtpunkte geteilt durch vollständige Spiele
- alle Werte jeweils als Gesamt, Normal und Hardcore
- Ranking standardmäßig nach Anzahl vollständiger Spiele, weitere Sortierungen
  nach Gesamtpunkten, Durchschnitt und Maximum
- bei Gleichstand: zuerst höherer Sekundärwert, danach Benutzername

## Umsetzungsstand der Etappen

Die Etappen 1–9 wurden im Kern umgesetzt und durch Unit-, HTTP-, WebSocket- und
Browser-Tests abgesichert. Die JSON-Importe bleiben aus Kompatibilitätsgründen
erhalten. Offen bleiben nur betriebliche Daueraufgaben wie externe
Backup-Aufbewahrung, Restore-Proben und weitere UI-/Sicherheitsverbesserungen.

1. Produktentscheidungen festlegen und Datenmodell/API-Vertrag finalisieren.
2. Datenbankschicht, Migrationen, Backup-/Restore-Probe und Import der
   vorhandenen JSON-Snapshots bauen.
3. Login, Logout, Sessions, Rollen, Passwortänderung und Admin-Reset umsetzen.
4. Session-Identität sicher in HTTP- und WebSocket-Spielbeitritt integrieren.
5. Vollständige Spielergebnisse für alle Teilnehmer persistieren.
6. Statistik-, Ranking-, Such- und Profil-APIs implementieren.
7. Landingpage, Profile, Suche, Rankings und Adminoberfläche bauen.
8. Bestehende Leaderboards auf teilnehmerbezogene Links umstellen.
9. Unit-, API-, WebSocket- und Browsertests ergänzen; Produktionsmigration mit
   Backup und Rollback-Probe durchführen.

Jede Etappe sollte separat review- und deploybar bleiben. Bis zur validierten
Datenbankmigration werden die bestehenden JSON-Dateien nicht entfernt.

## Aufwandsschätzung

Schätzung für eine erfahrene Person, inklusive Tests und sauberem Deployment:

| Bereich | Personentage |
| --- | ---: |
| Detailkonzept und API-/Statistikdefinition | 1–2 |
| Datenbank, Modelle, Migrationen und JSON-Import | 3–4 |
| Login, Sessions und Sicherheitsmaßnahmen | 3–5 |
| Rollen, Passwortwechsel und Admin-Benutzerverwaltung | 2–3 |
| Spiel-/WebSocket-Identität und vollständige Ergebnisablage | 2–3 |
| Statistik, Suche, Ranking und Profile | 3–4 |
| Frontendseiten und Leaderboard-Verlinkung | 3–5 |
| Tests, Deployment, Backup-/Rollback-Probe | 2–4 |
| **Gesamt** | **19–30** |

Ein reduziertes MVP ohne Rollenverwaltung, ohne anspruchsvolle
Zuordnungsoberfläche und mit minimalem UI ist eher in 12–16 Personentagen
möglich. Der Login-Mechanismus allein wirkt klein, benötigt produktionsreif mit
Sessions, Hashing, Cookie-/CSRF-/WebSocket-Schutz, Passwortwechsel, Sperren und
Tests aber ungefähr 4–7 Personentage. Die Integration der Benutzeridentität in
Spiel und historische Daten ist ein zusätzlicher Aufwand.

## Ursprünglich offene Entscheidungen

Die folgenden Punkte sind historische Entscheidungsfragen. Der aktuelle Code
ist die maßgebliche Spezifikation; Änderungen daran sollten als eigene
Produktentscheidung dokumentiert werden.

1. Ist der Benutzername zugleich der sichtbare Spielername?
2. Sind Profile vollständig öffentlich oder sollen einzelne Statistikwerte nur
   dem Eigentümer angezeigt werden?
3. Wie sollen Teampunkte im Spieler-Ranking gewertet werden?
4. Darf ein Administrator eine bestehende Zuordnung später ändern, und braucht
   es dafür ein sichtbares Audit-Protokoll?
5. Soll die neue Adminrolle auch die bisherige Superadmin-PIN ersetzen?
6. Läuft der öffentliche Produktionszugriff bereits durchgehend über HTTPS?
