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
