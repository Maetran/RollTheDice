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


## Nachtrag 3.2.0 / integration addendum

Dieser Nachtrag betrifft die Integration nach dem öffentlichen V3-Start. Die
oben protokollierte ursprüngliche Testphase und deren damalige Deploymentgrenzen
bleiben als historische Angaben erhalten. Der neue Zielzweig ist `develop`;
diese Integration ist kein Produktionsdeploy.

This addendum covers integration after the public V3 launch. The earlier test
phase and its deployment limitations above remain historical records. This
batch targets `develop` and does not deploy production.

- Ausgangspunkt / base: `1218657476632bcacb4e3306db0dde877ae6746a`, einschliesslich
  der Einsteigertouren / including beginner tours. Migration `0060` bleibt
  unverändert, Hausdepps Chat-Erweiterung folgt als `0061` / migration `0060` is
  retained, with the chat extension following as `0061`.
- Gesamte Backend-Suite / complete backend suite: 1’199 Tests bestanden / passed,
  Coverage 84,56 %. Der begrenzte Legacy-Rückweg und bösartige Ziele sind
  eingeschlossen / the narrow legacy return path and malicious targets are included.
- `npm run check:quality` bestanden / passed: Lint, generierte Assets,
  Übersetzung, SEO, Versionsvertrag, Bandit und Abhängigkeitsprüfung / lint,
  generated assets, localization, SEO, version contract, Bandit and dependency audit.
- Fester Spieltisch / fixed game window: **53 Chromium +15 WebKit** bestanden /
  passed. Zehn Fenstergrössen mit sechs Sitzen, grosse Hand, DE/EN-Texte,
  Chat/Hilfe, Tastatur, Drehung, Animationen und Wartetisch-Austritt / ten window
  sizes with six seats, large hands, DE/EN copy, chat/help, keyboard, rotation,
  animations and waiting-table departure.
- Community, Rangliste, öffentlicher Zugang und alle Touren / community,
  standings, public discovery and all tours: **49** bestanden / passed. Ein
  optionaler Bildaufnahmefall wurde nicht ausgeführt / one optional screenshot
  capture was not executed. Der englische Chatwechsel wurde nach Korrektur
  seines bei jedem Reload Deutsch erzwingenden Testsetups erneut bestanden /
  the English chat switch passed after correcting a test setup that forcibly
  restored German on every reload.
- **10** native WebAuthn-, Konto- und Recovery-Flows sowie **8** echte
  PWA-/Kartenbildtests bestanden / passed. Sie prüfen eigene Hausdepp-Seiten, gemeinsame Konten, Token-Fragmente, sichere
  Rückwege, genau eine Logout-Navigation, Manifest und dekodierte PNGs. Die
  Kartenprüfung drosselt die Verbindung auf zwei Sekunden Latenz und bestätigt,
  dass neue Gesichter keine weiteren Bildanfragen benötigen. / Native WebAuthn,
  account and recovery flows plus real PWA/card-image tests cover dedicated
  Hausdepp pages, shared accounts, fragment tokens, safe returns, one logout
  navigation, manifest and decoded PNGs. The card test adds two seconds of
  network latency and verifies that new faces make no additional artwork requests.
- Der CPU-Vergleich ist reproduzierbar dokumentiert unter
  [HAUSDEPP_CPUS.md](HAUSDEPP_CPUS.md), einschliesslich einer getrennten
  Holdout-Stichprobe / the reproducible CPU benchmark includes a separate holdout.
- Bilder und Logs sind ausserhalb des Worktrees gesichert. Die lokale Vorschau
  unter Port 8001 verwendet eine getrennte SQLite-Sicherung; Port 8000 und das
  dortige Testkonto wurden durch diese Prüfungen nicht bespielt. / Screenshots
  and logs are retained outside the worktree. Preview port 8001 uses a separate
  SQLite backup; tests did not play on port 8000 or its account.

**Gerätegrenze / device limit:** Das iPhone-Foto zeigt den generischen H-Platzhalter
bereits im Hinzufügen-Dialog. Explizite Apple-Icons, PNG-Dekodierung und beide
GET/HEAD-Discoverypfade sind automatisiert geprüft. Eine tatsächliche Abnahme
dieses iOS-Systemdialogs benötigt nach einem Rollout das physische iPhone.
Der finale Assetstand ist `8520b6b69416`. Chrome-Manifest- und WebKit-Tests
belegen keine erfolgte iOS-Installation. /
The iPhone photo shows the generic H placeholder in the Add to Home Screen
sheet. Explicit Apple icons, PNG decoding and both GET/HEAD discovery paths are
automatically tested. Acceptance of that iOS system sheet still requires the
physical iPhone after rollout; Chrome manifest and WebKit tests do not prove
an iOS installation.

## Abschliessender 3.2.0-Releasecheck / final release checks

Nach der Integration wurden weitere ausdrücklich gewünschte Verbesserungen
aufgenommen. Der Nutzer hat den gemeinsamen Rollout nach Abschluss der Touren
und dieser Verbesserungen freigegeben. Die frühere Integrationsphase oben ist
kein Nachweis eines bereits erfolgten Deployments. /
Additional requested improvements were added after integration. The owner has
authorized the combined rollout once tours and these improvements are ready.
The earlier integration phase above is not a record of a completed deployment.

- Gesamte Backend-Suite / complete backend suite: **1’208 bestanden / passed**,
  Coverage **84,59 %**. Neue Notice-Quittungen sind reine Präsentationsdaten;
  sie ändern keine verdienten EP. Migrationen `0060 → 0061 → 0062` haben genau
  einen Kopf / notice receipts are presentation data, not XP grants; migrations
  have a single head.
- **111** betroffene Browser-Regressionen bestanden / affected browser
  regressions passed. Alte Spiel-Fixtures unterdrücken nur das neue freiwillige
  Tourangebot; die positiven Tourtests bleiben unverändert und bestehen. /
  Existing game fixtures suppress only the new optional tour offer; positive
  tour tests remain unchanged and pass.
- **9** Dekorationsfälle bestanden / prop cases passed: echte Tische mit sechs
  Sitzen, objektabhängige Bewegungen, reduzierte Bewegung und feste Koordinaten
  bei wachsender Hand. Überdeckende Karten erhalten weiterhin den Tipp. /
  Real six-seat tables, object-specific motion, reduced motion and stable
  coordinates while hands grow; covering cards still receive taps.
- **8 Chromium +21 WebKit** bestanden / passed: Paketansicht, echter langer
  Maus-/Touchdruck ohne versehentliche Aufnahme, Tastatur, Live-Karten,
  Ablagestapel und sechs Sitze in beiden Ausrichtungen. Zusätzlich präzisierte
  Inspector-Spec **6/6 je Browser** / inspection, long press without accidental
  pickup, keyboard, live public cards, cleared stack and six seats in both
  orientations; refined inspector checks also passed in both browsers.
- Erfolgsmeldungen erklären Bedingung, eigene belegte Ursache und EP, einschliesslich
  früherer Erfolge und Rangaufstiege. Abbruch bestätigt nichts. Auch der
  Abschluss einer einzelnen Turnierrunde zeigt Meldungen; die nächste Runde
  gibt den Tisch sofort frei. / Progress notices explain the condition, recorded
  reason and XP, including older awards and rank-ups. Dismissal acknowledges
  nothing. Each finished tournament round can show notices; the next round
  immediately releases the table.
- Öffentliche Spielregeln erklären Paketinspektion und den ausgeschiedenen
  Kartenstapel vollständig DE/EN. Keine neue öffentliche Route, keine Änderung
  der eigentlichen Spielregeln / public rules explain pile inspection and
  cleared cards in both languages, without new public routes or rule changes.

Logs und Bilder dieser Phase werden im bestehenden externen Evidenzordner
`outputs/hausdepp-next` gesichert. Keine Prüfung versendet echte Pushmeldungen
oder spielt mit Produktionskonten. Der reale iPhone-Systemdialog bleibt als
Geräteabnahme offen. / Logs and screenshots are retained in the existing external
evidence folder. Tests neither send real push alerts nor play on production
accounts. The physical iPhone installation sheet still needs device acceptance.

Finaler Assetstand / final asset fingerprint: **`4e0800075052`**. Gegenüber
`4c2c64a9d39a` sind nur die DE/EN-Bedienhinweise sowie der eng begrenzte Schutz
gegen einen nachträglich geöffneten nativen Dialog hinzugekommen. Der neue
umgekehrte Dialog-Fokusfall und alle acht bisherigen Notice-Fälle bestehen:
**9/9**. Die beiden Regeln-/Navigationsflows bestehen ebenfalls erneut.
`npm run check:quality` ist auf dem finalen Stand vollständig grün. /
The final bundle adds only bilingual instructions and the narrow safeguard for
a native dialog opening after a progress popup. All nine notice checks and
both rules/navigation checks pass; full quality/security checks are green.

## 17.10.2026: Folgetisch, Mehrfachauswahl und PWA-Reload / follow-up table, multiple selection and PWA reload

Vorbereiteter Stand **3.3.0**, Asset **`7d79fb567fac`**, nur für `develop`;
kein Deployment und kein Versand an echte Konten. / Prepared 3.3.0 increment
for `develop` only, without deployment or notifications to real accounts.

- Vollständiger Backendlauf: **1’250 bestanden**, Coverage **84,80 %**.
  `npm run check:quality` inklusive Abhängigkeitsprüfung vollständig grün. /
  Full backend suite: 1,250 passed, 84.80% coverage; quality/security checks pass.
- Neu-erstellen-Oberfläche: **14 Chromium + 14 WebKit**. Deutsch/Englisch,
  ausdrückliche Annahme, sichere lokale Ziele, Wiederholung nach Fehlern,
  Dialoggrenzen, versteckte Tabs und Freigabe ihrer Sperren, Abbruchzustände,
  Turnierpausen und Beenden ausstehender Requests beim Seitenwechsel. /
  Invitation and recreation UI covers consent, safe local navigation, retries,
  modal bounds, hidden tabs/locks, terminal states and page-lifetime cancellation.
- Ein zusätzlicher echter Zwei-Konten-Browserflow prüft Registry-Retirement
  nach Abbruch, Neu-erstellen-POST, wartenden Folgetisch mit CPU, persönlichen
  Prompt ohne Sitznahme und anschliessenden normalen WS-Join nach Annehmen.
  Die EP bleiben unverändert. **114 fokussierte Backendtests + 75 Untertests**
  und ein unabhängiger 25er-Lauf sichern Reservierung, private Codes,
  Doppelklickschutz, Neustart und Datenbankfehler-Wiederherstellung ab. /
  A real two-account flow verifies retirement through explicit acceptance and
  normal WebSocket admission; focused backend tests cover storage and recovery.
- Mehrfachauswahl: **55 bestandene Ausführungen** in Chromium und WebKit,
  einschliesslich bestehender Hand-/Animations-/Sechser-Tischregressionen.
  Atomare 2er-/4er-Züge und Nachwürfe, verfallene Auswahl, neun Geräteformate,
  35 Karten und mindestens 44-Pixel-Steuerungen. /
  Multiple selection retains immediate single taps and submits matching cards
  atomically, with stale-selection and fixed-window regressions checked.
- Karten/PWA: Motivpixel statt bloss vorhandener SVG-Rahmen geprüft. Echte
  Worker kontrollieren drei warme Reloads; kaltes Laden und einmaliger 503-Fehler
  sind abgedeckt. Die drei Fälle bestehen auch im finalen Bundle jeweils in
  Chromium, WebKit und iPhone-13-WebKit-Emulation. Kein Cache Storage für Hände
  oder Kontodaten. **Eine echte installierte iPhone-PWA wurde nicht geprüft.** /
  Actual motif pixels, worker-controlled reloads, cold loading and transient
  image failure pass in all three browser configurations; physical iPhone PWA
  acceptance remains distinct from emulation.

Die lokale Vorschau auf Port 8001 verwendet eine separat gesicherte Testdatenbank
mit Migration 0063. Browserfälle laufen ausschliesslich auf wegwerfbaren Servern;
sie verändern den Vorschau-Fortschritt nicht. / The preview uses a separately
backed-up local test database; disposable browser servers never alter its progress.
