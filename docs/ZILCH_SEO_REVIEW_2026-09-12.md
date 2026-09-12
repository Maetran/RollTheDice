# Zilch: Auffindbarkeit und öffentliche Inhalte

Stand: 12. September 2026. Die Produktionsprüfung war ausschließlich lesend.
Die unten beschriebenen Verbesserungen liegen im Branch
`codex/zilch-classic-remaster`; diese Prüfung löst keinen Deploy aus.

## Befund auf Produktion vor der Änderung

| Prüfung | Ergebnis |
| --- | --- |
| `https://zilch.zockdiewandan.online/` | HTTP 200, genau ein echtes H1, eigenständiger Titel und Beschreibung, richtige Canonical- und Open-Graph-URL. Wirtshaus-Intro bereits im initialen HTML. |
| `/regeln` | HTTP 200 und passende Metadaten, aber initial nur „Zilch-Spielregeln werden geladen …“. Die Anleitung entstand erst nach JavaScript und erfolgreichem Abruf von `/api/zilch/rules`. |
| `/robots.txt` | HTTP 200, Googlebot darf öffentliche Seiten und statische Ressourcen crawlen. Die Anwendung sperrt `/api/`, `/docs` und `/openapi.json`; Cloudflare ergänzt separate Regeln für weitere Crawler. |
| `/sitemap.xml` | HTTP 200, genau die kanonische Zilch-Lobby und `/regeln`; keine persönlichen Seiten. |
| Konto und unbekannte Routen | `/konto` für Gäste HTTP 401; unbekannte Seite und erfundener Spielraum HTTP 404. Jeweils `X-Robots-Tag: noindex, nofollow`. Keine erfundenen echten Konten oder Partien aufgerufen. |
| Weiterleitungen | HTTP → HTTPS: 308. `/zilch` auf dem Zilch-Host → `/`: 308. `/regeln/` → `/regeln`: 307. Die Anmeldung führt mit 303 zur bestehenden gemeinsamen Anmeldeseite. |
| Legacy auf dem Haupthost | `/zilch` und `/zilch/regeln` funktionieren und bleiben `noindex`. Die indexierbaren Produktseiten gehören zur Zilch-Subdomain. |
| Vorschau-Bild | Das vorhandene Zilch-Icon war erreichbar (HTTP 200, PNG), erhielt aber pauschal `noindex, nofollow`, ebenso das Favicon. |
| Strukturierte Daten | Kein `WebSite`-Markup zur eigenständigen Zilch-Website vorhanden. |

Die wesentliche Lücke ist die Anleitung: Ihr initialer Inhalt bestand nur aus
einem Ladehinweis, während die zum Rendern benötigte Regeln-API unter der
Crawler-Sperre `/api/` liegt. Das erschwert eine verlässliche Erfassung des
tatsächlichen Regeltexts. Google empfiehlt vorgerenderte Inhalte auch für
JavaScript-Seiten; sie helfen ebenso Menschen ohne funktionierendes JavaScript
oder bei ausgefallenen Nachlade-Anfragen.
[Google: JavaScript und SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)

## Im Branch umgesetzt

- **Regeln sofort lesbar:** Die bestehende öffentliche Regelseite enthält schon
  in der HTTP-Antwort Ziel, zwölf Wertungszeilen, Würfeln/Sichern, freien Wurf,
  Bestätigungswurf, Zilch-Serie, Schlussrunde und Solo-Sprint. Die Texte und
  Wertungen entsprechen der bestehenden Spielhilfe. Der Browser lädt weiterhin
  die vollständige Hilfe; scheitert die Regeln-API, bleibt der öffentliche
  Kerntext sichtbar. Die API-Sperre in `robots.txt` bleibt bestehen.
- **Einstieg und Verlinkung:** Unter dem bestehenden Wirtshaus-Intro steht ein
  kurzer Hinweis zum Spielen im Browser als Gast und ein sichtbarer Link
  „Zilch-Regeln und Punktetabelle“. Er führt auch auf der Legacy-Lobby schon
  ohne JavaScript zur Zilch-Anleitung. Titel und Beschreibungen benennen die
  tatsächlichen Spielarten und Inhalte der beiden Seiten genauer.
- **Website-Identität:** Ein kleines `WebSite`-JSON-LD auf der kanonischen
  Startseite nennt ausschließlich den bestehenden Namen und die tatsächliche
  Homepage-URL. Es enthält keine erfundenen Bewertungen oder anderen
  unbelegten Angaben. Google unterstützt eigenständige Website-Namen auch für
  Subdomains. [Google: Website-Namen](https://developers.google.com/search/docs/appearance/site-names)
- **Öffentliche Bilder:** Nur das Favicon und vier ausdrücklich benannte
  Zilch-Produkticons erhalten bei öffentlichem Zugriff und erfolgreicher
  Bildantwort kein pauschales `noindex` mehr. Andere Assets, Konto-/Spielseiten,
  API-Antworten und die private Vorschau behalten ihre bisherige Einstufung.
  Ein HTTP-`X-Robots-Tag` kann auch die Indexierung von Bildressourcen steuern.
  [Google: Robots-Metadaten](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)

Die vorhandenen Canonicals, die Sitemap und die Zahl der öffentlichen Seiten
werden nicht erweitert. Stabile Canonicals im initialen HTML und konsistente
Links vermeiden widersprüchliche Signale.
[Google: Kanonische URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)

## Abnahme und Grenzen

Die gezielten Backend-Prüfungen liefen erfolgreich: **20 Tests und 89
Unterfälle** in `tests/test_zilch_seo.py` und
`tests/test_zilch_product_routes.py`. Darin sind fünf neue SEO-Tests enthalten:
initialer Inhalt/Metadaten, Abgleich der Punktetabelle und Schwellen gegen die
echte Regeln-API, Linkziele beider Produktrouten, eng begrenzte Bildfreigabe
einschließlich privater Vorschau sowie Sitemap/Robots/404-Verhalten. Ruff und
die JavaScript-Syntaxprüfung der geänderten Quellen waren erfolgreich.
Gesamt-Lint, finaler Asset-Build und Browserabnahme gehören zur gemeinsamen
Release-Abnahme des Branches; die Browserfälle prüfen insbesondere ohne
JavaScript und bei ausgefallener Regeln-API.

Deutsch bleibt die kanonische Sprache der HTTP-Dokumente. Die bestehende
englische Oberfläche wird im Browser übersetzt. Da es keine eigenen dauerhaft
adressierbaren Englisch-Seiten gibt, werden keine fiktiven `hreflang`-Ziele
eingetragen. Ohne JavaScript sind die deutschen Kernregeln lesbar; mit
JavaScript bleibt der Fallback auch auf Englisch nutzbar. Eine eigenständige
englische Suchpräsenz wäre ein späteres, separates Routing-/Inhaltsvorhaben.

Es wurden keine Search-Console-Daten, Indexierungsanträge oder echten
Suchpositionsmessungen verwendet. Die Änderungen beseitigen konkrete
technische und inhaltliche Hindernisse; sie garantieren keine Indexierung,
bestimmte Platzierung oder sichtbare Suchvorschau. Google priorisiert hilfreiche
Inhalte und entscheidet selbst über die Darstellung.
[Google: SEO-Einstiegsleitfaden](https://developers.google.com/search/docs/fundamentals/seo-starter-guide),
[Google: Richtlinien für strukturierte Daten](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)

Zur Interpretation der bestehenden Robots-Regeln: Google berücksichtigt die
spezifischste passende Pfadregel. Daher gewinnt `Disallow: /api/` gegen
`Allow: /`; eine allgemeine Freigabe hebt die API-Sperre nicht auf.
[Google: robots.txt-Spezifikation](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec)
