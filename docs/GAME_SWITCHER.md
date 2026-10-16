# Spieleauswahl und Verknüpfung / Game picker and integration

## Deutsch

Die gemeinsame Spieleauswahl führt in die Lobby des gewählten Spiels. Die
Anmeldung gehört zur Suite; Runden, Regeln und Spielstatistiken gehören zum
jeweiligen Spiel. Ein Wechsel startet keine Runde und beendet keine bestehende
Partie.

### Ziele nach Umgebung

`frontend/multigame/routes.js` bestimmt die Ziele. Browser dürfen die bestehenden
Produktdomains verwenden. Installierte Apps bleiben beim Wechsel auf ihrem
eigenen Ursprung, damit der Wechsel innerhalb der App erfolgt.

| Ausgangsumgebung | ZDWA | Zilch | Hausdepp |
| --- | --- | --- | --- |
| Produktionsbrowser auf ZDWA | `https://zockdiewandan.online/` | `https://zilch.zockdiewandan.online/` | `/hausdepp` |
| Installierte ZDWA-App | `https://zockdiewandan.online/` | `/zilch` | `/hausdepp` |
| Produktionsbrowser auf Zilch | `https://zockdiewandan.online/` | `/` | `/hausdepp` |
| Installierte Zilch-App | `/zdwa` | `/` | `/hausdepp` |
| Localhost oder Vorschau | `/` | `/zilch` | `/hausdepp` |

Alle relativen Ziele verwenden den aktuellen Ursprung. Die vorgesehenen
Produktionsaliase von ZDWA verwenden dieselbe Umschaltlogik. Die reservierte
Hausdepp-Subdomain ist noch kein aktives Ziel der Spieleauswahl.
Hausdepp kann mit eigenem Symbol und DE/EN-Manifest installiert werden. Sein
Worker steuert nur `/hausdepp`, speichert keine Karten oder privaten Inhalte
und zeigt offline einen Verbindungshinweis. Bereits installierte ZDWA- und
Zilch-Apps behalten beim Wechsel ihre eigene App-Identität. Eine installierte
Hausdepp-App behält umgekehrt ihr Manifest beim Wechsel zu anderen Spielen;
auf der Hausdepp-Subdomain nutzt ZDWA dafür die geschützte `/zdwa`-Brücke.

### Grenzen und gemeinsame Kontoeinstellungen

- Die Spieleauswahl verwendet die vom Server bestätigten Fähigkeiten aus
  `/api/auth/me`. Zilch berücksichtigt den öffentlichen oder ausdrücklich
  freigegebenen Zugriff. Hausdepp erscheint ausschliesslich mit
  `hausdepp_preview`; der Server prüft weiterhin das feste Gründerkonto mit
  Administratorrolle. Ein gespeicherter Spielname gewährt keinen Zugriff.
- Am laufenden Zilch-Tisch bleibt der bestehende Verlassen-Ablauf verbindlich.
  Dort gibt es keine zusätzliche Spieleauswahl. Nach dem regulären Verlassen
  steht sie in der Lobby wieder zur Verfügung.
- Konto und Regeln öffnen die Inhalte des aktuellen Spiels. Hausdepp hat seine
  eigene Übersicht und Rundenhistorie unter `/hausdepp/konto`. Der dortige Link
  `/konto#settings` öffnet auf dem aktuellen Host die gemeinsamen
  Kontoeinstellungen in der passenden ZDWA- oder Zilch-Oberfläche.
- Die ZDWA-Brücke auf dem Zilch-Host passt gewöhnliche Dokumentlinks an
  `/zdwa/...` an. Bereits aufgelöste Spieleauswahl-Links tragen
  `data-game-entry="zdwa|zilch|hausdepp"` und werden davon ausgenommen: Ein
  beabsichtigter Zilch-Link auf `/` muss auf diesem Host Zilch bleiben.
- Hausdepp-Dokumente und persönliche Kontodaten bleiben geschützt, mit
  `no-store` und `noindex`. Die Spieleauswahl erweitert keine öffentliche
  Suchmaschinenfläche und aktiviert keine neue Domain.

### Wer spielt gerade?

Jede Spielzeile zeigt die Zahl der gerade verbundenen menschlichen Spieler in
gestarteten, noch nicht beendeten oder abgebrochenen Partien. Ein Konto zählt
pro Spiel einmal, auch mit mehreren offenen Geräten oder Tischen. Gäste zählen
pro Tisch und Sitz; Computer, Zuschauer, wartende Tische und Turnierpausen
zählen nicht mit. Eine manuell pausierte Partie zählt weiterhin, solange die
Spieler verbunden sind.

`GET /api/game-activity` liefert ausschliesslich diese Summen für die aktuell
freigegebenen Spiele, ohne Namen, Konto-, Sitz- oder Raumkennungen und ohne
spielübergreifende Gesamtsumme. Die Freigabe wird bei jeder Anfrage frisch
geprüft; Dashboard-Zugriff öffnet keine privaten Spielzahlen. Hausdepp bleibt
an das Gründerkonto mit Administratorrolle gebunden. Zilch verwendet dieselbe
öffentliche oder kontobasierte Freigabe wie die Spieleauswahl.

Beim Öffnen werden die Zahlen neu geladen, danach alle 15 Sekunden während
die Auswahl sichtbar ist. Schliessen oder ein ausgeblendeter Browser-Tab stoppt
die Abfragen. Laden und fehlende Verbindung haben eigene Hinweise; eine
fehlgeschlagene Aktualisierung zeigt keine alte Zahl oder erfundene Null.
Antworten werden mit `no-store` ausgeliefert.

### Prüfnachweis

`tests/browser/suite-picker-routes.spec.js` prüft die Zielmatrix und die
Zusammenarbeit zwischen Spieleauswahl und ZDWA-Brücke. Bestehende PWA-Prüfungen
stehen in `tests/browser/pwa-product-isolation.spec.js`; Zugriffs- und
Seitenprüfungen in `tests/test_hausdepp_integration.py`,
`tests/test_zilch_product_routes.py` und `tests/test_navigation_contract.py`.
`tests/test_game_activity.py` prüft die Summen, aktuelle Berechtigungen und
Privatgrenzen; `tests/browser/game-picker-activity.spec.js` prüft die Zähler
in allen drei Spielen einschliesslich Laden, Fehlern und veralteten Antworten.

## English

The shared game picker opens the selected game's lobby. Sign-in belongs to the
suite; rounds, rules and game statistics belong to their game. Switching starts
no round and ends no existing game.

### Destinations by environment

`frontend/multigame/routes.js` resolves destinations. Regular browsers may use
the existing product domains. Installed apps stay on their own origin so that
the handoff remains inside the app.

| Starting environment | ZDWA | Zilch | Hausdepp |
| --- | --- | --- | --- |
| Production browser on ZDWA | `https://zockdiewandan.online/` | `https://zilch.zockdiewandan.online/` | `/hausdepp` |
| Installed ZDWA app | `https://zockdiewandan.online/` | `/zilch` | `/hausdepp` |
| Production browser on Zilch | `https://zockdiewandan.online/` | `/` | `/hausdepp` |
| Installed Zilch app | `/zdwa` | `/` | `/hausdepp` |
| Localhost or preview | `/` | `/zilch` | `/hausdepp` |

All relative destinations use the current origin. The established ZDWA
production aliases use the same switching rules. The reserved Hausdepp
subdomain is not yet an active game picker destination.
Hausdepp can be installed with its own icon and DE/EN manifest. Its worker
controls only `/hausdepp`, stores no cards or private content, and shows a
connection notice offline. Existing installed ZDWA and Zilch apps retain
their app identity when switching games. An installed Hausdepp app likewise
keeps its manifest across game switches; on its dedicated host, ZDWA uses
the protected `/zdwa` bridge.

### Boundaries and shared account settings

- The picker uses server-confirmed capabilities from `/api/auth/me`. Zilch respects
  public or explicitly granted access. Hausdepp appears only with
  `hausdepp_preview`; the server still requires the fixed founder account with
  an administrator role. A remembered game name grants no access.
- The existing leave flow remains authoritative at a live Zilch table. No
  additional picker is shown there. It becomes available in the lobby after
  leaving through that flow.
- Account and rules navigation opens the current game's content. Hausdepp has
  its own overview and round history at `/hausdepp/konto`. Its
  `/konto#settings` link opens shared account settings on the current host,
  using the appropriate ZDWA or Zilch interface.
- The ZDWA bridge on the Zilch host adapts ordinary document links to
  `/zdwa/...`. Already resolved picker links carry
  `data-game-entry="zdwa|zilch|hausdepp"` and are excluded: an intentional
  Zilch link to `/` must still open Zilch on this host.
- Hausdepp documents and personal account data remain protected, with
  `no-store` and `noindex`. The picker neither expands the public search
  surface nor activates a new domain.

### Who is playing now?

Each game row shows connected human players at started tables that have not
finished or been abandoned. An account counts once per game, even across
several devices or tables. Guests count by table and seat. Computers,
spectators, waiting tables and tournament breaks are excluded. A manually
paused game still counts while its players remain connected.

`GET /api/game-activity` returns only these totals for games currently available
to the viewer, without names, account, seat or room identifiers and without a
cross-game total. Every request checks current access. A dashboard grant never
opens private game counts. Hausdepp still requires the founder account with an
administrator role; Zilch uses the same public or account-based audience policy
as the picker.

Counts reload when the picker opens, then every 15 seconds while it is visible.
Closing the picker or hiding the browser tab stops requests. Loading and a
failed connection have distinct messages; a failed refresh never displays an
old count or an invented zero. Responses use `no-store`.

### Verification

`tests/browser/suite-picker-routes.spec.js` covers the destination matrix and
the interaction between the picker and the ZDWA bridge. Existing PWA checks
live in `tests/browser/pwa-product-isolation.spec.js`; access and page checks
in `tests/test_hausdepp_integration.py`, `tests/test_zilch_product_routes.py`
and `tests/test_navigation_contract.py`.
`tests/test_game_activity.py` covers totals, fresh permissions and privacy;
`tests/browser/game-picker-activity.spec.js` covers counts across all three
games, including loading, errors and stale responses.
