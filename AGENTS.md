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
  DE/EN-Usability-Hinweis und den betroffenen Spielen aktualisieren. Der Deploy
  prüft diesen Hinweis; reine Backend-Releases erhalten automatisch den
  Stabilitätstext. Versions-Push niemals manuell gegen echte Konten testen.
