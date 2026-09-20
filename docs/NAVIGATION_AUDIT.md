# Navigation und Erreichbarkeit — 20. September 2026

Geprüft wurden die HTML-Routen, ihre Links im Frontend, die sechs registrierten
öffentlichen SEO-Seiten und die Bedienwege beider Spiele. Die Browserprüfungen
decken zusätzlich die beiden Produktions-Origins, die ZDWA-Brücke innerhalb
der Zilch-PWA, Deutsch/Englisch sowie Anmeldung und Spielerauswahl ab.
Ein zusätzlicher Browserdurchlauf über 24 Seiten beziehungsweise Tab-Ziele
hat 28 verschiedene interne Linkziele ohne HTTP-Fehler erreicht. Die beiden
externen GitHub-Ziele für Fehlermeldungen und Versionshistorie waren erreichbar.

## Nachgebesserte Wege

| Einstieg | Befund | Korrektur |
| --- | --- | --- |
| Konto → Einstellungen → Mitspieler & Hinweise → Spieler finden | Zilch zeigte nur Bestenlisten, keine Suche. | Beide Spiele öffnen die fokussierte Spielersuche. Auch Konten ohne Spiele sind auffindbar. |
| Spielersuche | ZDWA zeigte höchstens die ersten 20 Treffer; Fehler wirkten wie eine leere Suche. | Weitere Treffer, verständliche Leerzustände und erneutes Laden bei Fehlern. |
| Profil → Spielerauswahl im Konto verwalten | Der passende Einstellungsbereich blieb zugeklappt. | Direkter Einstieg in die geöffnete Spielerauswahl, auch aus der Suche. |
| Öffentliches Profil → Anmelden | Zilch führte zur Lobby ohne Anmeldeformular. | Anmeldung mit Rückweg zum Profil; ZDWA führt direkt zum Anmeldebereich. |
| Zilch `/spieler` und `/zilch/spieler` | Shell ohne passenden Inhalt beziehungsweise fehlende Route. | Weiterleitung zur Spielersuche in Spieler & Ranking. |
| Zilch-PWA → ZDWA → Ergebnis | Der Ergebnis-Renderer erkannte den `/zdwa`-Pfad nicht. | Ergebnis-ID und ältere `?id=`-Links behalten den richtigen Spielkontext. |
| Spielstart-Hinweis → Zuschauen | Eine ZDWA-Partie konnte in der Zilch-Oberfläche landen. | Zuschauerziel passend zum Spiel; installierte PWAs nutzen die interne Brücke. |
| Passwort vergessen, Reset, Registrierung, E-Mail-Bestätigung | Formulare und ungültige Links hatten teilweise keinen Rückweg. | Anmeldung erreichbar; beim Passwort-Reset auch ein neuer Anforderungslink. Bekannter Spiel- und Sprachkontext bleibt erhalten. |
| Passwort vergessen in der ZDWA-Brücke | Der Link zeigte auf eine nicht vorhandene Zilch-Seite. | Festes Ziel beim gemeinsamen Kontodienst. |
| Ungültige Zilch-Spiel- und Ergebnislinks | Im Browser erschien eine rohe JSON-404 ohne Navigation. | Allgemeine Fehlerseite mit Lobby und Anmeldungs-/Historienzugang; HTTP 404 und Datenschutz bleiben erhalten. |
| Persönliche Zilch-Seiten ohne Anmeldung | Direkte Links konnten mit einer rohen 401-Antwort enden. | Browser gelangen zur Anmeldung und danach zurück zum angefragten Konto-, Historien- oder Ergebnisziel. Der gewählte Kontoreiter bleibt auch beim Wechsel zwischen den Produkt-Adressen erhalten. |

## Seiteninventar

| Seite oder Gruppe | Sinnvoller Zugang | Einordnung |
| --- | --- | --- |
| ZDWA- und Zilch-Lobby | Marke, Lobby-Link, Spielwechsel | Öffentlich und direkt erreichbar |
| Regeln beider Spiele | Hauptnavigation und Lobby | Öffentlich und direkt erreichbar |
| ZDWA Spieler & Ranking, Zilch Bestenlisten | Hauptnavigation; zusätzlich Spielersuche aus der Spielerauswahl | Öffentlich erreichbar; personenbezogene Zilch-Oberflächen bleiben noindex |
| ZDWA Rangabzeichen | Verlinkte Rangabzeichen und Erklärung in den Regeln | Keine verwaiste Seite |
| Öffentliche Spielerprofile | Suche, Rankings, Chat und Spielernamen | Kontextbezogen erreichbar, noindex |
| Konto: Statistik, Erfolge, Einstellungen | Hauptnavigation und direkte Tab-Links | Persönlich, Anmeldung erforderlich |
| Zilch-Historie | Konto → Statistiken → Deine Historie | Persönlich, gezielt erreichbar |
| Ergebnisse und Spielansichten | Konto-Historie, Profil-Verläufe, Lobby-Ranking, laufende Partien | Dynamische beziehungsweise persönliche Ziele |
| Alte Zilch-Statistik- und Erfolgs-URLs | Weiterleitung auf passende Konto-Tabs | Beabsichtigte Aliase, keine zusätzlichen Menüpunkte nötig |
| Administration | Admin-Einstieg für berechtigte Konten | Bewusst nicht öffentlich beworben |
| Offline-Seite | Service Worker bei fehlender Verbindung | Bewusst nur im passenden Zustand erreichbar |
| Registrierung, Passwort-Reset, E-Mail-Bestätigung | Kontoaktionen und persönliche Links | Bewusst private, teilweise tokengebundene Seiten |
| Auth-Handoff und statische HTML-Dateien | Technische Weiterleitungen oder interne Auslieferung | Keine eigenständigen Navigationsziele |

Weitere verwaiste wichtige öffentliche Produktseiten wurden nicht gefunden.
Token-, Offline- und Verwaltungsseiten werden bewusst nicht in die allgemeine
Navigation aufgenommen. Das Audit prüft keine Verfügbarkeit beliebiger von
Nutzern geteilter alter Partien; solche Ziele erhalten einen hilfreichen
Rückweg, ohne Auskunft über fremde private Ergebnisse zu geben.

Der Rollout erfolgt mit `SILENT_RELEASE=1`: kein Versions-Push und kein neuer
In-App-Versionshinweis.
