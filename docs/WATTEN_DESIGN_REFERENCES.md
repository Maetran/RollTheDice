# Watten – Gestaltungs- und Bedienungsreferenzen

**Stand:** 17.10.2026, Europe/Zurich.

**Status:** Referenzaufnahme, keine Entwicklung und noch keine gewählte
Oberflächenkomposition. Die bestehenden [Produktgedanken](WATTEN_RESEARCH.md)
und der [Regelabgleich](WATTEN_RULES_AUDIT.md) bleiben die Grundlage.

**Arbeitszweig:** `codex/watten-design-references`, auf dem am 17.10.2026
abgerufenen `origin/develop` (`9597bcd`) begonnen. Die früheren lokalen
Recherchetexte wurden vom erhaltenen Branch `codex/watten-recherche`
übernommen; dessen drei ursprüngliche Commits bleiben dort unverändert.

## Auftrag und Grenzen

Der Owner hat drei UltraWatten-Screenshots und den Link
[UltraWatten online spielen](https://www.ultra-watten.com/online-spielen)
als **Ideen und Referenz, ausdrücklich ohne 1:1-Kopie**, geliefert.

- Die **identischen Hausdepp-Kartendesigns** bleiben gesetzt.
- Die externe Oberfläche ist Anschauungsmaterial für Ablauf, Anordnung und
  Verständlichkeit. Ihre Farben, Texturen, Karten, Logos, Texte und exakten
  Abmessungen sind kein Auftrag zur Übernahme.
- Sichtbare Schalter der Fremd-App sind keine automatische Freigabe neuer
  Spielregeln oder Optionen für RollTheDice.
- Es entstehen hier weder Spielcode noch ein Mockup, eine neue Route oder
  eine fertige Designentscheidung.

## Gesicherte Bildreferenzen

Die drei vom Owner gelieferten PNGs wurden unverändert aus den temporären
Anhängen gesichert. Ein zusätzlicher Screenshot dokumentiert die eigene
Browserbeobachtung. Herkunft, Originaldateiname, Grösse und SHA-256 stehen in
[provenance.json](references/watten/provenance.json); die Kopien wurden
bytegleich mit den Quellen geprüft. Die Dateien liegen nur unter `docs/`,
nicht bei den auszuliefernden Produktassets.

| Referenz | Inhalt / Aussagegrenze |
| --- | --- |
| [Bild 1: Varianten](references/watten/ultrawatten-varianten-owner-2026-10-17.png) | Vom Owner gezeigte Konfiguration. Die Auswahl belegt keine Regelentscheidung für unser Spiel. |
| [Bild 2: Neues Spiel](references/watten/ultrawatten-neues-spiel-owner-2026-10-17.png) | Einstieg, aktuelle Variante, Name, Tischname, Zugangscode und Spielerzahl. |
| [Bild 3: Spieltisch](references/watten/ultrawatten-spieltisch-owner-2026-10-17.png) | Vier Sitzpositionen, Handfächer, verdeckte Gegenhände und Zählung. Ein Standbild erklärt nicht jeden Kartenbereich oder Ablauf. |
| [Live: Varianten](references/watten/ultrawatten-varianten-live-2026-10-17.png) | Browseraufnahme vom 17.10.2026 mit weiteren sichtbaren Optionen; keine vollständige Mobil- oder Regelprüfung. |

Die Screenshots dienen der Dokumentation einer fremden Oberfläche. Sie sind
keine frei lizenzierten Karten-, Textur- oder Interfaceassets für unser Produkt.

## Hilfreiche Muster und mögliche eigene Umsetzung

Die rechte Spalte enthält eigene Folgerungen, keine bereits freigegebene
Gestaltung.

| Beobachtung an der Referenz | Für Watten berücksichtigen |
| --- | --- |
| Vor dem Start steht eine kurze Zusammenfassung des Modus. | Vor dem Start eindeutig zeigen, welches vollständige Regelprofil gilt. Entscheidende Abweichungen müssen auffindbar bleiben. |
| Spiel erstellen und Varianten einstellen sind getrennt. | Einen kurzen Einstieg ermöglichen; vertiefte Regeln verständlich gruppieren. Die Teamwahl und CPU-Besetzung müssen trotzdem vor dem Start klar sein. |
| Punkte, Varianten, Weli und Zugeben haben eigene Gruppen und Infohilfen. | Fachbegriffe am betreffenden Ort erklären, mit eindeutigen Folgen für das gewählte Profil. Keine unzulässigen Kombinationen als scheinbar spielbar anbieten. |
| Vier Plätze liegen am Tisch; Teamnummern verbinden gegenüberliegende Partner. | Partner, Gegner, aktueller Spieler, Geber und Einschauer unterscheidbar machen. Die manuelle Teamwahl aus dem Produktauftrag bleibt erforderlich. |
| Eigene Karten bilden unten einen Fächer; fremde Hände zeigen Rückseiten. | Die eigenen Hausdepp-Karten lesbar und gut bedienbar nutzen; verdecktes Wissen auch bei Animationen und Hinweisen schützen. |
| Zählung und aktueller Einsatz sind am Tisch sichtbar. | Gesamtpunkte, Stiche dieser Runde, aktueller Einsatz und offene Antwort auf ein Gebot klar auseinanderhalten. |
| Chat und weitere Aktionen liegen ausserhalb der Hand. | Ansagen, Bieten, Halten und Gehen müssen als Spielhandlungen erkennbar sein. Ein Chatknopf allein bildet die Regeln nicht ab. |

## Live beobachtet am 17.10.2026

Ohne Registrierung liessen sich auf der genannten Seite die Lobby,
«Neues Spiel», die Variantenübersicht und die Infohilfe zum Zugeben öffnen.
Es wurde **keine Partie erstellt und kein fremder Tisch betreten**.
Das Tischbild stammt daher aus dem Nutzeranhang, nicht aus einem eigenen
abgeschlossenen Spieltest.

Im Dialog waren unter anderem Punkteziele, getrennte Modusschalter,
Weli-Auslegungen, Bot-Bieten sowie eigene Schalter zur Zugabe von Rechtem und
Gutem sichtbar. Auch «ohne Welli» und «Welli für Guten berücksichtigen» wurden
angezeigt. Die Infohilfe erklärt Zugabe durch Wissende und verweist auf die
einstellbare Behandlung hoher eigener Karten.
Quelle: [live aufgerufene Oberfläche](https://www.ultra-watten.com/online-spielen).

Diese Beobachtung ergänzt den Regelabgleich um konkrete Bedienelemente.
Sie entscheidet weiterhin nicht die dort dokumentierten Grenzfälle, etwa
Kritischen-Kollisionen oder die zulässige Reaktion nach einem Überstich.
Aus der Anzeige folgt auch nicht, dass sämtliche denkbaren
Schalterkombinationen gültig sind.

## Was unsere spätere Gestaltung genauer lösen soll

- **Freie Teamwahl:** Vor Beginn bewusst wählen, mit wem man spielt. Die
  Bilder zeigen Teamzugehörigkeit, aber keinen nachgewiesenen Auswahlablauf.
- **Zwei, drei und vier Spieler:** Die Referenz bietet sichtbar zwei oder vier.
  Unsere zusätzliche Dreieranforderung bleibt bestehen und benötigt ihre
  eigene Regel- und Sitzanordnung.
- **CPU-Besetzung:** Tiroler Namen wie bei Hausdepp beibehalten; Platz und
  Team eines Computers vor Beginn verständlich machen. Das Aussehen eines
  Bots ist kein Nachweis seiner taktischen Qualität.
- **Blindes Wissen:** Einschauen privat halten. Erklärtexte, Kartensortierung,
  Hervorhebungen und Ansagen dürfen unberechtigten Sitzen nichts verraten.
  Eine fremde Option zum Anzeigen der Partnerkarten nicht ungeprüft übernehmen.
- **Ansagen und gestrichen:** Zustände und tatsächlich erlaubte Handlungen
  müssen sichtbar sein. Die Owner-Regel bleibt fachliche Vorgabe; eine
  Chatansicht allein löst sie nicht.
- **Lesbarkeit:** Winzige Namensschilder, abgeschnittene Optionsnamen und ein
  sehr kleiner Punktestand sind keine Vorbilder. Auf dem Handy müssen Karten,
  Punkte und Spielhandlungen lesbar und erreichbar bleiben.
- **Anordnung:** Die Bedeutung offener Kartenbereiche muss verständlich sein.
  Aus dem Standbild allein lässt sich nicht sicher bestimmen, was Ausspiel,
  Stichhistorie oder andere Ablage ist.
- **Bedienbarkeit:** Hoch-/Querformat, Tastatur, sichtbarer Fokus, ausreichend
  grosse Ziele, Deutsch/Englisch und reduzierte Bewegung gehören in eine
  spätere Ausarbeitung. Die Referenz wurde dafür nicht vollständig geprüft.

## Responsive-Ausrichtung: beide Formate, Querformat empfehlen

**Owner-Vorgabe vom 18.10.2026:** Hoch- und Querformat vollständig umsetzen;
den Nutzern Querformat als angenehmere Spielansicht nahelegen. Für den
Vierertisch ist die zusätzliche Breite eine plausible Gestaltungsannahme:
gegenüberliegende Partner, seitliche Gegner, Hand und Stich lassen sich eher
als Tisch anordnen. Das ist unsere Entwurfsentscheidung, kein durch die
Referenzbilder oder Nutzertests bewiesener Usability-Vorteil.

- **Querformat:** Als bevorzugte Tischkomposition ausarbeiten. Zusätzliche Breite für erkennbare Sitz-/Teambeziehungen und gut unterscheidbare Stichkarten nutzen; kurze Bildschirmhöhe und Safe Areas trotzdem ernst nehmen.
- **Hochformat:** Eigenständig verdichten und vollständig spielbar halten. Dieselben Karten, Ansagen, Antworten, Team-/Punktanzeigen und privaten Informationen bleiben erreichbar. Keine Funktion setzt eine Drehung voraus.
- **Empfehlung:** Auf schmalen Geräten im Hochformat ein kleiner, schliessbarer Inlinehinweis mit Drehsymbol, vorzugsweise im Warteraum vor dem Spiel. Keine Vollbildschranke, Zwangsrotation oder wiederholte Aufforderung bei jedem Snapshot/Reload. Geschlossene Empfehlung auf dem Gerät merken; später in Hilfe auffindbar lassen.
- **Zeitpunkt:** Laufendes Einschauen, ein offenes Gebot, ausstehende Kommandos und Stichabschlüsse nicht mit einer neu eingeblendeten Empfehlung unterbrechen. Auch ein direkter Einstieg in eine laufende Partie bleibt sofort bedienbar.
- **Passender Kontext:** Desktop-/Splitview-/Tastaturfenster nach verfügbarem Platz gestalten; keinen pauschalen Handy-Drehhinweis wegen eines schmalen Fensters anzeigen. Zwei-/Dreiertische erhalten ihre eigene Sitzanordnung.

Textvorschlag DE: **«Im Querformat hast du Tisch und Karten besser im Blick.»**
EN: **“Landscape gives you a clearer view of the table and your cards.”**
Die Empfehlung beschreibt den erwarteten Vorteil; die genaue Platzierung
und Formulierung werden am eigenen Tisch geprüft.

Die Empfehlung beschränkt keine Nutzungsausrichtung. Das entspricht dem
[W3C-Hinweis zu WCAG 1.3.4 Orientation](https://www.w3.org/WAI/WCAG22/Understanding/orientation.html),
der die Bedienbarkeit unabhängig von der gewählten Ausrichtung beschreibt.
Die Quelle empfiehlt nicht speziell für Watten das Querformat.

**Abnahme für P4:** Alle freigegebenen 2-/3-/4-Spielermodi in beiden Formaten,
DE/EN, mindestens 320×568, 568×320, 667×375 und Tablet-Splitview prüfen.
Steuerungen mindestens 44×44 px, sichtbare Karten-Trefferflächen, Fokus,
Screenreader, reduzierte Bewegung, Chat-Tastatur und interne Dialog-Scrolls
bleiben bedienbar. Kein horizontal aufgeweiteter Seitentisch. Querformat
mit wenig Höhe muss ebenso bestehen wie schmales Hochformat.

Rotation beim Einschauen, Gebot/Antwort, ausstehendem ACK und Stichende
ändert weder Sitz/Team/Wissensrolle, Hand, Punkte/Einsatz noch Antwortrecht
oder fachliche Frist. Keine neue Ansage, kein Doppelkommando, kein erneutes
Abspielen alter Karten. Veraltete Fluggeometrie wird beendet; danach gilt
der aktuelle erlaubte Stand. Hinweis schliessen und im Hochformat
weiterspielen ist ein eigener positiver Abnahmefall. Prüfungen zuerst lokal
auf dem Mac; tatsächliche Gerätebedienung bleibt eine separate Abnahme.

## Weiterer Gebrauch

Die Bilder dürfen später neben dem eigenen Entwurf als Referenz dienen:
Welches Problem löst das Muster, und wie lösen wir es eigenständig mit unseren
Karten und Produktregeln? Eine visuelle Richtung, Bildschirmaufteilung oder
Regelauswahl ist damit noch nicht beschlossen.

Die Impeccable-Kontextaufnahme wurde für diese Recherche ausgeführt. Sie
meldete veraltete abgeleitete Design-Metadaten im bisherigen Projektstand;
eine Aktualisierung gehört nicht zu dieser Referenzaufnahme. Es wurden weder
`PRODUCT.md`, `DESIGN.md` noch Oberflächen-Briefs geändert.

**Prüfung:** `npm run check:quality` einschliesslich Lint und Sicherheitschecks
bestanden. Bestehende Backend-Vertragstests für Navigation und Produktversion:
16 Tests, 120 Subtests bestanden. Lokale Dokumentlinks und alle vier
Referenz-Hashes geprüft. Keine sichtbare Produktänderung, daher keine lokalen
Browser-Regressionstests; der beschriebene externe Browserblick ist eine
Referenzbeobachtung und keine Abnahme unseres Spiels.

**English brief:** The owner's three screenshots and UltraWatten's live
interface are references for interaction and information hierarchy, not a
design to copy. Preserve the existing Hausdepp card artwork. This note records
observations, limitations and ideas for a later independent design; no game
implementation or mockup has been started. The owner requires full portrait
and landscape support, with a discreet, dismissible landscape recommendation.
Neither rotation nor the hint may block play or alter private knowledge, bid
rights or pending commands.
