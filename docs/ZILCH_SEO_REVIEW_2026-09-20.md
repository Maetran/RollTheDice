# Zilch: Prüfung der veröffentlichten SEO-Seiten

Stand: 20. September 2026, vor dem Release der kompakteren Lobbys und festen
Spieltische. Alle Produktionsabrufe waren ausschließlich lesend und anonym.

## Ergebnis

Die bisherigen SEO-Maßnahmen sind veröffentlicht. Beide dauerhaften
öffentlichen Zilch-Seiten sind erreichbar und für Suchmaschinen freigegeben.
Es gibt auf diesen Seiten weder `noindex` noch `nofollow` in HTTP-Headern,
Robots-Metadaten oder Links. Es wurde kein technischer Indexierungsblocker
gefunden; eine Änderung der Produktionslogik war daher nicht erforderlich.

| Prüfung | Live-Ergebnis |
| --- | --- |
| `https://zilch.zockdiewandan.online/` | HTTP 200; genau ein H1; eigener Titel und Beschreibung; Gast-Einstieg und Regeln-Link bereits im HTML. |
| `https://zilch.zockdiewandan.online/regeln` | HTTP 200; genau ein H1; Titel und Beschreibung zur Anleitung; Regelzusammenfassung und Punktetabelle bereits ohne JavaScript lesbar. |
| Robots-Metadaten | Beide öffentlichen Dokumente ohne `X-Robots-Tag`, ohne Robots-Meta-Sperre und ohne `rel="nofollow"` in Links. |
| Canonical und Open Graph | Beide Dokumente zeigen im HTML und im HTTP-`Link`-Header auf ihre eigene saubere HTTPS-Adresse. `og:url` stimmt jeweils überein. |
| Query-Varianten | `?lang=en&utm_source=seo-review` bleibt bei beiden Seiten HTTP 200 und verweist kanonisch auf die URL ohne Parameter; auch mit Googlebot-User-Agent keine Robots-Sperre. |
| Strukturierte Daten | Die Homepage enthält gültiges `WebSite`-JSON-LD mit Name „Zilch die Wand an“ und der tatsächlichen Homepage-Adresse. |
| `/robots.txt` | HTTP 200; öffentliche Seiten und statische Ressourcen sind crawlbar. Nur `/api/`, `/docs` und `/openapi.json` sind gesperrt. Die Zilch-Sitemap ist verlinkt. |
| `/sitemap.xml` | HTTP 200; enthält genau die kanonische Homepage und `/regeln`, passend zum Register in `app/site_seo.py`. |
| Produktbilder | Favicon sowie 32-, 192-, 512- und 180-Pixel-Zilch-Icons liefern HTTP 200 und `image/png`, ohne Robots-Sperre. Das Open-Graph-Bild ist damit ebenfalls freigegeben. |
| Weiterleitungen | HTTP → HTTPS: 308. Auf dem Zilch-Host `/zilch` → `/` und `/zilch/regeln` → `/regeln`: 308. `/regeln/` → `/regeln`: 307. Die Zielseiten sind öffentlich indexierbar. |
| Persönliche und ungültige Routen | `/konto` liefert anonym 401; unbekannte Seite und erfundener Spielraum liefern 404; jeweils `X-Robots-Tag: noindex, nofollow`. Statische HTML-Implementierungsdateien sind nicht als weitere Einstiegspunkte erreichbar. |
| Legacy auf dem Haupthost | `/zilch` und `/zilch/regeln` bleiben mit Robots-Meta `noindex, nofollow` aus dem Index. Die öffentlichen Suchziele liegen auf der Zilch-Subdomain. |

## Einordnung

Die Freigabe betrifft die dauerhaften Produktseiten. Konto-, Spielraum-,
Ergebnis- und andere persönliche oder kurzlebige Seiten behalten ihre
bewusste `noindex`-Einstufung gemäß `docs/PRODUCT_DELIVERY.md`. Die Robots-Datei
sperrt diese Seiten nicht pauschal, damit Crawler ihre Indexierungshinweise
lesen können. Google dokumentiert dieses Zusammenspiel ausdrücklich.
[Google: Indexierung mit noindex verhindern](https://developers.google.com/search/docs/crawling-indexing/block-indexing)

Ein explizites `index, follow` ist für die öffentlichen Seiten nicht nötig:
Das sind die Standardwerte. Die Abwesenheit einschränkender Regeln wurde
sowohl in der Antwort als auch im HTML überprüft.
[Google: Robots-Metadaten](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)

Die initialen Dokumente sind weiterhin deutsch; Englisch entsteht über die
bestehende Browserübersetzung. Auch `?lang=en` erzeugt keine eigenständige
englische HTTP-Seite. Deshalb gibt es weiterhin keine separaten
`hreflang`-Adressen. Eigene indexierbare Englisch-Seiten würden eigene
dauerhafte URLs mit entsprechender Auslieferung erfordern.
[Google: Sprachvarianten](https://developers.google.com/search/docs/specialty/international/localized-versions)

Die konsistenten Canonicals vermeiden widersprüchliche Signale bei
Query-Varianten. Die Sitemap nennt ebenfalls nur diese sauberen URLs.
[Google: Kanonische URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)

## Regression und Grenzen

`tests/test_zilch_seo.py` prüft zusätzlich, dass öffentliche Seiten auch keine
`nofollow`- oder `none`-Sperre erhalten und dass Parameter-URLs ihre saubere
Canonical-Adresse behalten. Die vorhandenen Prüfungen sichern weiterhin
initiale Regeln, echte Wertungsdaten, Verlinkung, öffentliche Produktbilder,
Sitemap und private Routen ab.

Die gezielte Backend-Abnahme mit `tests.test_zilch_seo` und
`tests.test_zilch_product_routes` ist erfolgreich: **21 Tests**. Gesamt-Lint
und Browserabnahme gehören zur gemeinsamen Release-Prüfung.

Die Prüfung belegt die Veröffentlichung und technische Freigabe. Sie enthält
keine Search-Console-Daten und bestätigt weder tatsächliche Aufnahme in den
Google-Index noch eine bestimmte Suchposition.
