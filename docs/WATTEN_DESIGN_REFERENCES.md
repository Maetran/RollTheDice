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
implementation or mockup has been started.
