# Produkt-Lieferpflicht

Bei jeder sichtbaren Seite oder Funktion gilt zusätzlich zur technischen
Implementierung der Standard in [docs/PRODUCT_DELIVERY.md](docs/PRODUCT_DELIVERY.md).

- Neue sichtbare Texte vollständig Deutsch/Englisch ausliefern.
- README und bei spielrelevanten Änderungen die Spielanleitung aktualisieren.
- Öffentliche, dauerhafte Seiten in `app/site_seo.py` registrieren; persönliche
  oder kurzlebige Seiten mit `noindex` halten.
- Vor dem Abschluss `npm run lint`, relevante Backend-Tests und bei sichtbaren
  Änderungen Browser-Tests ausführen.
- Bei sichtbaren Releases `app/release-notice.json` mit einem neuen, kurzen
  DE/EN-Usability-Hinweis, spielerfreundlichen `player_notes` und den betroffenen
  Spielen aktualisieren; die ausführlichere Historie steht in `CHANGELOG.md`.
  Der Deploy prüft diese Inhalte; reine Backend-Releases erhalten automatisch den
  Stabilitätstext. Versions-Push niemals manuell gegen echte Konten testen.
- Neue oder geänderte Seitenpfade in `tests/test_navigation_contract.py` mit
  passender Ziel-, Anmeldungs- und gegebenenfalls Browserprüfung erfassen.
  Bereits vorhandene Flowtests weiterverwenden; neue Routen dürfen den Guard
  nicht ohne begründete Prüfzuordnung passieren.
- Beide Spiele teilen eine Produktversion aus `app/version.json`:
  Major für große Produktmeilensteine, Minor für neue Funktionen, Patch für
  Korrekturen/Wartung. Vor einem neuen Release mit
  `scripts/product_versions.py bump major|minor|patch` erhöhen und den
  bilingualen Changelog ergänzen; auch stille Releases benötigen eine Version.
  Bestehende Zuordnungen in `app/version-history.json` niemals umnummerieren.

# Test-Prozedere und gemeinsame Rechner-Ressourcen

Diese Vorgaben gelten für alle Agenten in diesem Projekt. Die Befehle und
Details stehen in [README.md – Quality checks](README.md#quality-checks).
Massgeblich für die automatische Workerwahl sind `pyproject.toml`,
`conftest.py`, `scripts/test_resources.py` und `tests/browser-config.js`.

## Vor einem Testlauf

- Vor grossen Testläufen laufende Test-/Build-Prozesse anderer Projekte und
  Worktrees sowie die aktuelle CPU-/Speicherlast read-only prüfen.
  Die automatische Workerwahl berücksichtigt Hardware- und Containerlimits,
  aber **keine gemeinsame Reservierung für parallel laufende Projekte**.
- Läuft bereits ein ressourcenintensiver Test-/Build-Lauf, keinen weiteren
  Volltest mit vollem automatischem Pool starten. Warten oder notwendige,
  gezielte Prüfungen mit bewusst begrenztem Pool ausführen, beispielsweise
  Backend `-n 2` oder Browser `PLAYWRIGHT_WORKERS=2`. Das gemeinsame Budget
  anhand der tatsächlich freien Ressourcen wählen.
- Fremde Prozesse, Testserver und Projekte nicht stoppen oder umkonfigurieren.
  Keine globalen Energie-, Cache- oder Tool-Einstellungen für dieses Projekt
  verändern. Für Laufzeitvergleiche vergleichbare Lastbedingungen herstellen;
  verbleibende Nebenlast und Unsicherheit im Ergebnis nennen.
- Zuerst die zur Änderung passenden Tests wählen. Reine Dokumentationsänderungen
  benötigen keine Backend-/Browser-Volltests. Wiederholungen oder zusätzliche
  Volltests durch Änderungen, Fehler oder eine konkrete offene Frage begründen.

## Backend

- Standard: `npm run test:backend` für die vollständige Suite mit Coverage.
  Der Befehl wählt die Projekt-`.venv` automatisch. Direkte pytest-/IDE-Läufe
  müssen denselben Projektinterpreter und dieselben Projektvorgaben verwenden.
- Automatische Workerwahl und `--dist=worksteal` beibehalten. Keine feste
  Maschinenzahl wie 18 als allgemeine Vorgabe eintragen. Explizite `-n N` und
  `PYTEST_XDIST_AUTO_NUM_WORKERS` bleiben bewusste Overrides.
- Gezielt und bei geteilter Maschine beispielsweise:
  `npm run test:backend -- tests/test_scoring_logic.py --no-cov -n 2`.
  Für Debugging oder einzelne schnelle Tests ist `-n 0` sinnvoll.
  Coverage bei der vollständigen Qualitätsprüfung beibehalten.
- Lange unabhängige Simulationen parametrisieren, wenn dabei alle Szenarien,
  Seeds und Assertions erhalten bleiben. Produktive Passwortparameter und
  fachliche Prüfungen nicht für bessere Laufzeiten abschwächen.

## Browser

- `npm run test:browser` umfasst die Hauptsuite sowie die separaten Konfigurationen
  für Benutzernamen, native Passkeys und Hausdepp-Passkeys. Bei gezielten Läufen
  die passende `playwright*.config.js` ausdrücklich wählen.
- Neue Browser-Specs verwenden `tests/browser-fixture.js` statt eines direkten
  Imports von `test` aus `@playwright/test`. Jeder Worker benötigt seinen eigenen
  Testserver, temporäre SQLite-Datenbank, Ranglistendateien und dynamischen Port.
  Diese Isolation auch in neuen Tests und Konfigurationen erhalten.
- Automatische Browser-Poolgrösse beibehalten; bei Nebenlast begrenzen, etwa mit
  `PLAYWRIGHT_WORKERS=2 npm run test:browser` oder `--workers=2` bei direkten
  Playwright-Aufrufen. Ein über `PLAYWRIGHT_BASE_URL` geteilter Server bleibt
  zwingend seriell. `fullyParallel` nur nach belegter Unabhängigkeit aktivieren.
- Backend- und Browser-Volltests nacheinander ausführen. Keine echten Konten,
  Produktionsdatenbanken oder echten E-Mail-/Push-Zustellungen zum Testen nutzen;
  die isolierten Server-Einstellungen und Netzwerksperren erhalten.
- Ergebnisse unter `test-results/browser/<suite>` ablegen; vorhandene Bundles
  und andere Artefakte nicht durch Bereinigung des gesamten `test-results/`
  löschen. Anhänge möglichst mit `testInfo.outputPath()` isolieren.
- Fehlende Browser mit `npx playwright install chromium webkit` wiederherstellen.
  Ein eigener `PLAYWRIGHT_BROWSERS_PATH` muss bei Installation und Testlauf
  identisch sein. Caches anderer Projekte nicht bereinigen.
- Im Abschluss bestandene, fehlgeschlagene und übersprungene Prüfungen sowie
  ausgelassene Bereiche nennen. Fehler am aktuellen Stand untersuchen und
  belegen; frühere Fehlerberichte sind keine dauerhafte Ausnahme. Keine höheren
  Toleranzen, pauschalen Retries oder übersprungenen Assertions zum Verbergen
  von Produkt- oder Parallelisierungsfehlern einführen.
