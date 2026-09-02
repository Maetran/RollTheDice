# Produkt-Lieferstandard

Jede sichtbare Änderung wird als vollständiges Produktinkrement ausgeliefert:
funktional korrekt, verständlich dokumentiert, in beiden Sprachen nutzbar und
für Suchmaschinen eindeutig eingeordnet.

## Geltungsbereich

Der Standard gilt für neue oder geänderte Spielregeln, Features, Seiten,
Kontobereiche, APIs mit sichtbarer Wirkung und Inhalte, die in Suche oder
geteilten Vorschauen auftauchen.

## Verbindliche Lieferung

1. **Produktdokumentation:** `README.md` beschreibt neue Kernfunktionen.
   Änderungen am Spielablauf, an Wertung oder Bedienung stehen zusätzlich in
   `app/static/rules.html`.
2. **Übersetzung:** Jeder neue sichtbare deutsche Text erhält eine natürliche
   englische Entsprechung in `frontend/i18n/catalog.js`. Serverseitig gelieferte
   Kataloge – etwa Achievements – werden ebenfalls vollständig übersetzt.
3. **SEO:** Jede dauerhafte, öffentliche Seite wird in
   `app/site_seo.py` registriert. Dadurch erhält sie eine Canonical- und
   Open-Graph-Prüfung und erscheint automatisch in `/sitemap.xml`. Persönliche,
   kurzlebige oder geschützte Seiten bleiben mit `noindex` aus dem Index.
   `/robots.txt` verweist immer auf die Sitemap und sperrt nur technische
   Endpunkte, nicht die Seiten, die ihr `noindex` selbst ausliefern müssen.
4. **Qualitätssicherung:** Vor Commit und Deploy mindestens `npm run lint`,
   die Backend-Tests und bei sichtbaren Änderungen die Browser-Tests ausführen.

`scripts/check_product_delivery.py` wird durch `npm run lint` und die CI
ausgeführt. Es verhindert Drift zwischen README, Spielanleitung,
Achievement-Übersetzungen, Canonicals, Open-Graph-Daten, `robots.txt` und
Sitemap.

## Entscheidung für neue Seiten

- **Dauerhaft und öffentlich:** in `PUBLIC_SEO_PAGES` registrieren, eine
  aussagekräftige Meta-Description sowie Canonical- und Open-Graph-Daten in der
  HTML-Seite ergänzen.
- **Persönlich, dynamisch oder geschützt:** Meta-Tag `robots="noindex, ..."`
  setzen; diese Seite gehört nicht in die Sitemap.

So bleibt die Suche auf hilfreiche Landing-, Regel- und Übersichtsseiten
fokussiert, während private Spiel- und Kontodaten geschützt bleiben.
