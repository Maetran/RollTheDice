# Achievement-Erreichbarkeit / Achievement reachability

Prüfung vom 12. September 2026: 156 ZDWA- und 110 Zilch-Definitionen, einschließlich
aller 15 gemeinsamen Interaktionsziele. Die Prüfung verbindet Katalog,
Auswertung, gespeicherte Belege und sichtbare Bedienwege. Seltene Spielziele
wurden anhand ihrer Regeln und gezielter Testdaten geprüft, nicht mit echten
Konten auf Produktion erspielt.

## Befunde und Korrekturen

| Bereich | Befund | Verhalten nach dem Fix |
| --- | --- | --- |
| Zilch: Rückblick | Die Historienseite existierte, war aber nicht mehr verlinkt. | Konto → Statistiken → Deine Historie öffnet sie und löst den vorhandenen Erfolg aus. |
| ZDWA: Rückblick | Der sichtbare Kontoverlauf wurde ohne Interaktionsereignis geladen. | Erst eine erfolgreich geladene, tatsächlich sichtbare eigene Historie zählt. |
| ZDWA: Statistik | Versteckte Statistik wurde auch beim Einstieg in Einstellungen geladen. | Statistikaufrufe und Verlauf laden erst beim Öffnen des Bereichs. |
| Beide: Sammlung | Nach neuen Aktionen blieb der beim Seitenstart geladene Erfolgsstand sichtbar. | Erfolge lädt beim Öffnen und nach erfolgreichen Interaktionen aktuelle Daten. |
| Beide: GitHub | HTTP-Weiterleitungen und öffentliche Ziele funktionieren; ein externer Browser kann aber eine andere Anmeldung haben. | Der Klick wird zusätzlich mit CSRF-Schutz im angemeldeten App-Kontext erfasst. Der normale Link bleibt erhalten. |
| ZDWA innerhalb der Zilch-PWA | Die eingebetteten Regeln und Ranglisten übersprangen die normalen Ereignisse. | Beide Seiten verwenden dieselben Auslöser wie die normale ZDWA-Seite. |
| Beide: Feinjustiert | Der separate Sprachwechsel speicherte ohne settings_saved. | Eine gespeicherte Sprachänderung zählt auch als persönliche Einstellung. |
| ZDWA: Styler Full / Styler-Show | Normales 3+2-Full und fünf gleiche Würfel können dieselben Punkte haben. | Nur neue, serverseitig belegte Fünflings-Fulls zählen; Korrekturen, Streichen und Admin-Änderungen behandeln die Belege mit. |

Alle anderen geprüften Kriterien haben erreichbare Auslöser und passende
Auswertungszweige. Die ZDWA-Ziele für exakte Endergebnisse wurden gegen gültige
Wertkombinationen geprüft; Zilchs persönlichen Kriterien gegen messbare,
erfüllende Spielbelege. Bedingte Funktionen wie Push erfordern weiterhin ein
unterstütztes Gerät und die entsprechende Benutzereinstellung.

## Keine nachträgliche Vergabe

- Kein historischer Ergebnisscan und kein Erzeugen fehlender Auszeichnungen.
- Migration `20260912_0040` markiert ausschließlich bereits vorhandene
  Styler-Auszeichnungen als Bestand. IDs, Vergabezeitpunkte und Quellen bleiben
  erhalten. Sie fügt keine Achievement-Zeile hinzu.
- Neue Styler-Auszeichnungen erfordern eindeutige Würfelbelege und unterliegen
  weiterhin der normalen Neuberechnung, etwa nach einer Ergebnislöschung.
- Mehrdeutige ältere Full-Punktstände zählen auch bei späteren Profilaufrufen
  nicht als neue Styler-Leistung oder Fortschritt zur nächsten Stufe.
- Stiller Deploy: kein Versions-Push und kein neuer Eintrag der In-App-Versionen.

## Validierung

Neue Browserprüfungen verwenden isolierte Testkonten und echte Oberflächenwege:
Zilch DE/EN und Classic/LCARS, ZDWA mit versteckter/fehlgeschlagener/später
geladener Historie, GitHub-Klick mit simulierter separater Browsersitzung,
Sammlungsaktualisierung ohne Neuladen. Bestehende Konto-, Release- und
Zilch-Oberflächentests ergänzen diese Fälle.

Backendtests prüfen Authentifizierung/CSRF, Ereignisse in beiden Sammlungen,
fehlende Vergabe vor der Aktion, Migration ohne neue Auszeichnungen sowie
Full-Würfelbelege, Korrekturen, Teamboards und Neustarts. Produkt-, Sprach-,
SEO- und Asset-Prüfungen gehören zum abschließenden Lint.

## English

The audit covered 156 ZDWA and 110 Zilch definitions, including all 15 shared
interaction goals. Repairs restore discoverable personal history, count only
visible successful history visits, refresh achievement collections, retain
GitHub account attribution across external-browser handoffs, and fix embedded
ZDWA navigation and language-save triggers. Styler awards now require actual
five-of-a-kind Full evidence instead of ambiguous score values.

No missing award is granted retroactively. The migration only preserves
existing Styler rows; new awards still require evidence and retain normal
invalidation behavior. All other reviewed criteria have reachable triggers.
The rollout is silent.
