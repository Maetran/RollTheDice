# Hausdepp: lokale Prüfung vom 16.10.2026 / local verification

## Umfang / scope

Die private Entwicklungsfassung 2.59.0 umfasst Lobby, Tisch, Regeln, Konto,
100 Erfolge, 24 Ränge, Rundensiege, HAUSDEPP-Turniere, Suite-Spielauswahl,
Profilbilder/Reaktionen, CPU-Namen, Dekoration, PWA und Owner-Monitoring.
UI/UX und Icon bleiben zur gestalterischen Abnahme beim Owner.

The private 2.59.0 development increment covers the lobby, table, rules, account,
100 achievements, 24 ranks, round wins, labelled tournaments, suite picker,
avatars/reactions, computer names, decoration, PWA and owner monitoring.
Technical checks do not constitute owner visual acceptance.

## Spielregeln / rules

Die vorhandenen und erweiterten Tests prüfen aktives, privates Abheben mit
Ass-Ketten; verpflichtende Entnahme bei10; Startkarte ohne10; Mindesthand und
vollständiges Auffüllen mit einem Tipp; gleich/hoch legen; mehrfach denselben
Rang; zeitlich begrenztes Nachwerfen; erfolgreiche/gescheiterte Zockzüge und
Zocken auf leerem Tisch;10 und vier Gleiche; erneutes Ausspielen; FIFO-Schulden
am verdeckten Stapel ohne Sperre für erlaubtes Legen/Aufnehmen; Endspiel,
Kartenerhaltung, private Sicht und Wiederaufnahme.

Interleaved seeded rounds exercise 2–6 seats and conserve all 36 cards. Full
labelled tournaments cover each table size, persistence between rounds, one
letter per lost round, all other players receiving wins, and termination at
HAUSDEPP. Host-only continuation, cancellation and abandonment are covered.

## Punkte und Erfolge / points and achievements

- Menschenrunden:10 EP. Sobald mindestens ein Computer teilnimmt:75% Abzug und
  anschliessend Abrunden **je Runde**, also2 EP. Drei CPU-Runden geben6 EP.
- Achievement rewards remain complete and one-time. Round counts, wins and
  achievement conditions are unaffected by the CPU weighting.
- Ränge, Fortschritt und Benachrichtigungen rechnen mit gewichteten ganzen EP;
  Bestätigungsrevisionen bleiben davon getrennte monotone Ganzzahlen.
- Migration 0058 preserves existing credits/unlocks. Legacy partial receipts do
  not invent a point delta or promotion; stale tabs and concurrent reads/ACKs
  are covered by bounded, exact presentation snapshots.
- Erreichte Erfolge stehen in derselben thematischen Gruppe vor offenen.
  Häufige Ziele brauchen mehrere qualifizierende Runden; seltene Kunststücke
  bleiben direkt möglich. Es gibt kein künstliches Auszeichnungs-Limit.

## Oberfläche und Integration / interface and integration

Browserfälle decken Deutsch/Englisch und schmale Handys, Handy-Querformat,
Tablet-Hoch-/Querformat und Desktop ab. Tatsächlich ausgeteilte3-,5- und
6-Spieler-Tische ergänzen die gezielten Zustands-/Sichtbarkeitstests. Geprüft
werden unter anderem grosse Hände, exakte verdeckte Gegnerkartenzahlen,
Halbkreis mit langen Turniernamen, Avatare, eigene/fremde Reaktionen,
Kartenflüge, eine einmalige 850-ms-Mischanimation mit ausschliesslich
verdeckten Karten, Fokus/Bedienbarkeit und reduzierte Bewegung. Das Mischen
sperrt keine Aktion, wiederholt sich nicht bei Neuladen/Wiederverbinden und
wird beim Handeln oder Phasenwechsel unmittelbar entfernt.

The compact lobby uses 50 personalised bilingual name templates instead of a
name field. Its calm local demonstration conserves a 36-card ledger, plays
matching cards together and refills only below three. Twelve decorative props
occupy measured free space, never take input, retain their nodes on routine
updates, and respect reduced motion. Phone decoration is more restrained.

Die Spielauswahl zählt verbundene Menschen an laufenden Tischen, ohne CPUs oder
Zuschauer, mit Konten-Deduplizierung und frischer Berechtigungsprüfung. Fehlende
oder fehlgeschlagene Werte werden nicht als null Spieler ausgegeben.
Owner-exklusive Hausdepp-Messwerte bleiben auch aus den Dashboard-Gesamtsummen
anderer Berechtigter ausgeschlossen. Alle drei Dashboard-Designs sind geprüft.

## Push und PWA / push and PWA

Hausdepp benutzt die vorhandenen Suite-Einwilligungen: Gerätefreigabe und
separates Konto-Opt-in für Mitspieler-Rufe sowie die Absenderauswahl. Signierte
API-Aufrufe, freie menschliche Plätze, Zugriff, Konto-/Raum-Sperrfristen und
Widerruf werden geprüft. Empfänger müssen Hausdepp bereits öffnen dürfen.
Einladungslinks selbst erteilen keine Freigabe. Aktuell ist nur das Founder-
Konto zugelassen; ohne Selbst-Push gibt es deshalb keine weiteren echten
Empfänger. Ein positiver Zustellpfad wird mit isolierter Testfreigabe und
Mock-Dispatcher geprüft, ohne echte Push-Nachricht.

Fresh Hausdepp installations can enable their existing worker's push endpoint
from either shared account screen, even where the current page has no worker
controller. The real installed Hausdepp worker is tested through a synthetic
PushEvent to its showNotification boundary, with the correct title, body, icon
and table link. Headless Chromium denies OS notification permission; actual
phone/desktop OS display and native installation UI are **not** claimed as
verified. No VAPID call or real recipient was used for these browser checks.

Eigene DE/EN-Manifeste, Herz-Zehner-Icons und die App-Identität werden geprüft.
Der eng begrenzte Hausdepp-Worker speichert weder private Seiten noch APIs oder
Karten offline. Ohne Verbindung erscheint eine ehrliche Verbindungsmeldung.
Spielwechsel behalten die installierte App-Identität. Private Routen,
Manifeste und Worker bleiben zugriffsgeschützt und noindex/no-store.

## Lokale Daten / local data

Eine frühere parallele QA-Runde des Assistenten wurde mit Zustimmung des Owners
archiviert und aus der lokalen Wertung genommen. Die eigenen Runden des Owners
blieben erhalten. Der lokale Testfortschritt wurde nach den neuen Zielen neu
berechnet. Die CPU-EP-Gewichtung berechnet bestehende Belege neu, ohne Runden,
Siege oder freigeschaltete Erfolge zu löschen. Vor Neustarts liegt eine lokale
SQLite-Sicherung im ignorierten Vorschauordner. Weitere QA-Partien entstehen
nur auf isolierten Testservern, niemals im aktiven Port8000-Testkonto.

## Grenzen / limitations

Die eigentlichen Tell-Karten stammen weiterhin aus den dokumentierten Fotos.
Besonders das Eichel-Ass bleibt weicher als eine saubere Druckvorlage; kein
CSS-Filter stellt fehlende Bilddetails wieder her. Das stilisierte App-Icon
ersetzt diese Spielkarten nicht. Herkunft und Generierung stehen in
[HAUSDEPP_ASSETS.md](HAUSDEPP_ASSETS.md) und
[HAUSDEPP_TABLE_DECOR.md](HAUSDEPP_TABLE_DECOR.md).

No production deployment, version tag or release notification was performed.
The Cloudflare hostname reservation does not imply a deployed Hausdepp release.

## Prüfprotokoll / verification record

- Vollständige Backend-Suite: **1088 Tests +1168 Unterprüfungen bestanden**,
  `/tmp/hausdepp-qa-backend-v259-final.log`.
- Push-Einstellungen: **20 Browsertests bestanden**,
  `/tmp/hausdepp-push-settings-browser-final.log`.
- Live-Spielzahlen, echter PWA-Worker und Tischdekoration: **19 Browsertests
  bestanden**, `/tmp/hausdepp-qa-root-browser-final.log`.
- Tischnamen-Pool: **4 Fälle bestanden**, alle 50 Vorlagen in beiden Sprachen,
  Namensformen, Unicode/Längenlimit und eingeschränkte Zufallsquelle.
- Finale Bundle-Kennung: **`0f737870befb`**. Quellen und generierte Assets sind synchron.
- **`npm run check:quality` bestanden**, einschliesslich Lint, Produkt-/Sprach-/
  SEO-/Versionsvertrag, Bandit, Paketkonsistenz und Abhängigkeitsprüfung:
  `/tmp/hausdepp-qa-quality-shuffle-final.log`.
- Hauptoberfläche: 85 bestandene Browserfälle; die korrigierte Demo und ihre
  unveränderten Nachbarfälle wurden mit **7 bestandenen Fällen** nachgeprüft,
  `/tmp/hausdepp-qa-final-demo-browser.log`. Die 6 optionalen älteren
  Aufnahmefälle sind keine übersprungenen Funktionsprüfungen.
- Finale Misch-/Beschriftungsfälle: **8 bestanden**,
  `/tmp/hausdepp-shuffle-tests.log`, darunter normale und dringende
  Nachziehtexte bei 320/390/844/1024/1440 Pixeln.
- Bestehende echte Karten-/Gebe-/FIFO-/Reconnect-Abläufe: **8 bestanden** auf
  dem finalen Bundle, `/tmp/hausdepp-qa-final-shuffle-motion.log`.
- PWA und Dekoration auf dem finalen Bundle: **10 bestanden**,
  `/tmp/hausdepp-qa-last-pwa-decor.log`.
- Gemeinsame Konsole, Navigation und PWA: **34 bestanden**,
  `/tmp/hausdepp-qa-shared-final-browser.log`.
- Mission Control: **40 Browserfälle bestanden**, alle drei Designs,
  `/tmp/hausdepp-monitoring-browser.log`; Dashboard-Quellen blieben danach
  unverändert. Privatsphäre zusätzlich in Backendfällen geprüft.
- Abschliessende statische Backendverträge: **25 Tests +123 Unterprüfungen**,
  `/tmp/hausdepp-qa-static-contract-final.log`.
- **22 finale Bilder**, alle mit `0f737870befb`: 13 tatsächlich spielende
  Tischansichten und 9 Lobby-/Konto-/Regelansichten. Die unabhängige Sichtprüfung
  bestätigt die behobene Überlagerung; kein weiterer sichtbarer Blocker.
  Manifest und Review: `.impeccable/review/hausdepp-roundtable-evidence.json`
  und `hausdepp-roundtable-visual-review.md`. Ältere Crop-Derivate gehören
  ausdrücklich nicht zu diesem finalen Bildsatz.
- Localhost nach kontrolliertem Neustart geprüft: private HTML-/Manifest-/
  Worker-/Kontoantworten 200 mit passendem Cache-/Indexschutz; das finale
  versionierte JS wird korrekt unveränderlich ausgeliefert. Spielstände und
  gespeicherte Runden blieben erhalten.
