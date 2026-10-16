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
Hausdepp verwendet auf dem Zilch-Host dessen Service Worker und Manifest;
auf dem ZDWA-Host behält es den bestehenden ZDWA-Service-Worker.

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

### Prüfnachweis

`tests/browser/suite-picker-routes.spec.js` prüft die Zielmatrix und die
Zusammenarbeit zwischen Spieleauswahl und ZDWA-Brücke. Bestehende PWA-Prüfungen
stehen in `tests/browser/pwa-product-isolation.spec.js`; Zugriffs- und
Seitenprüfungen in `tests/test_hausdepp_integration.py`,
`tests/test_zilch_product_routes.py` und `tests/test_navigation_contract.py`.

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
Hausdepp uses the Zilch service worker and manifest on the Zilch host; on
the ZDWA host it keeps the existing ZDWA service worker.

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

### Verification

`tests/browser/suite-picker-routes.spec.js` covers the destination matrix and
the interaction between the picker and the ZDWA bridge. Existing PWA checks
live in `tests/browser/pwa-product-isolation.spec.js`; access and page checks
in `tests/test_hausdepp_integration.py`, `tests/test_zilch_product_routes.py`
and `tests/test_navigation_contract.py`.
