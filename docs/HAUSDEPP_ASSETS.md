# Hausdepp-Kartenassets / Hausdepp card assets

## Vorderseiten: Quelle und Lizenz / Faces: source and licence

- Datei / File: `app/static/hausdepp/cards-source.jpg`
- Werk / Work: **Doppeldeutsche Preference.JPG**
- Fotograf / Photographer: **FUZxxl**, 10.06.2011
- Kontrastbearbeitung / Contrast adjustment: **Karl432**, 19.02.2024
- [Dateiseite / File page](https://commons.wikimedia.org/wiki/File:Doppeldeutsche_Preference.JPG)
- [Geprüfte Seitenrevision / Inspected page revision](https://commons.wikimedia.org/w/index.php?title=File:Doppeldeutsche_Preference.JPG&oldid=1211225922)
- [Original-JPEG / Original JPEG](https://upload.wikimedia.org/wikipedia/commons/6/64/Doppeldeutsche_Preference.JPG)
- Gewählte Lizenz / Selected licence: **[Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/)** (CC BY 3.0).
- Abmessungen / Dimensions: **3996 × 2526 Pixel**.
- Download geprüft am / Download checked on: **16.10.2026**.
- SHA-1 des heruntergeladenen Originals vor Provenienzmetadaten / SHA-1 of the downloaded original before provenance metadata: `30fee6c7b30211d73dfe7c6c7391befa0b3a1b8a`.

Das JPEG wurde ohne Bildbearbeitung übernommen. Nur die Quellenangabe wurde
anschliessend mit Impeccable als JPEG-Kommentar eingebettet. Die Bildpixel
bleiben unverändert; der Datei-Hash ändert sich durch diesen Kommentar.
Es handelt sich um ein Foto eines vollständigen Piatnik-Kartensatzes mit
36 Karten, nicht um einen Flachbettscan. Alle Karten wurden visuell geprüft,
einschliesslich aller vier Sechser.

The JPEG was imported without image editing. Only a provenance comment was
subsequently embedded through Impeccable. Its image pixels remain unchanged;
the file hash changes because of that comment. This is a photograph of a
complete 36-card Piatnik deck, rather than a flatbed scan. Every card was
visually inspected, including all four sixes.

Empfohlene sichtbare Quellenangabe / Suggested visible credit:

> Kartenfoto / Card photograph: FUZxxl; Kontrast / contrast: Karl432.
> „Doppeldeutsche Preference“, Wikimedia Commons, CC BY 3.0.
> Ausschnitte durch Darstellung / Cropped in presentation.

Bei Anzeige die Dateiseite und die Lizenz verlinken. / Link the file page and
licence where this credit is displayed.

## Bildvergleich / Visual comparison

**DE:** Die Figuren, Jahreszeiten-Asse, Farbzeichen und Landschaftsmotive gehören
zur gewünschten doppeldeutschen Tell-/Jahreszeiten-Bildsprache; die gezeigten
Herzkarten entsprechen visuell den Motiven der Referenz. Das fotografierte
Produkt heisst „Doppeldeutsche Preference“, während das Owner-Foto die Packung
„Doppeldeutsche Blitz“, Nr. 1885, zeigt. Damit wird keine Identität der
Produktnummer behauptet. Das Foto hat leichte Perspektive, kleine Unterschiede
zwischen den Kartenpositionen und eine Glanzstelle bei Laub 10. Die Schellen 6
trägt „WELI“ und zusätzliche Farbzeichen. Sie bleibt hier regeltechnisch eine
gewöhnliche Schellen 6, ohne übernommene Weli-Sonderregeln. Die gesuchte
Blitz-Rückseite ist im Vorderseitenfoto nicht enthalten.

**EN:** The figures, seasonal aces, suit symbols and landscape motifs match the
requested double-headed German Tell/seasons visual language; the pictured heart
cards visually match the motifs in the reference. The photographed product is
called “Doppeldeutsche Preference”, whereas the owner's packaging reference
shows “Doppeldeutsche Blitz”, no. 1885. This does not claim identical product
numbers. The photograph has mild perspective, slightly varying card positions
and glare on the 10 of leaves. The 6 of bells is marked “WELI” and carries
additional suit symbols. In this game it remains an ordinary 6 of bells,
without imported Weli rules. The desired Blitz back is not part of this
face-card photograph.

## Aktuelle Darstellung / Current rendering

**DE:** `frontend/hausdepp/cards.js` verwendet einzeln vermessene Papierkanten
(`CARD_CORNERS`) und eine affine SVG-Abbildung. Dadurch werden leichte Drehung
und Scherung jeder fotografierten Karte begradigt. Ein Sicherheitsbeschnitt
bleibt innerhalb des echten Papiers; ein gemeinsamer abgerundeter Papierumriss
ersetzt die fotografierten Schnittkanten. Keine Kartensymbole, Figuren oder
Rangbeschriftungen werden neu gezeichnet. Ein gemessener Weissabgleich pro Karte
vereinheitlicht beim Rendern die Papierfarbe auf Elfenbein. Die SVG-Farbkorrektur
verändert ausschliesslich die Darstellung; die JPEG-Pixel bleiben unverändert.

**EN:** `frontend/hausdepp/cards.js` uses individually measured paper corners
(`CARD_CORNERS`) and an affine SVG mapping to straighten photographed tilt and
shear. A safe inset stays inside the real paper; a common rounded paper outline
replaces the photographed cut edge. Symbols, figures and rank labels are not
redrawn. Measured per-card white balance makes paper consistently ivory during
rendering. SVG colour grading affects presentation only; JPEG pixels remain
unchanged.

### Blendfreie Laub-Zehn / Glare-free ten of leaves

- Datei / File: `app/static/hausdepp/tell-leaves-reference-v1.jpg`.
- Quelle / Source: [Original-Hungarian-Tell-set.jpg](https://commons.wikimedia.org/wiki/File:Original-Hungarian-Tell-set.jpg).
- Fotograf / Photographer: **SZERVÁC Attila**, 07.04.2024.
- Lizenz / Licence: **[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**.
- Verwendete Vorschau / Imported thumbnail: **3840 × 2887 Pixel**.
- [Offizielle Vorschaudatei / Official thumbnail](https://thumb.wikimedia.org/wikipedia/commons/thumb/0/03/Original-Hungarian-Tell-set.jpg/3840px-Original-Hungarian-Tell-set.jpg).
- SHA-256 vor Provenienzkommentar / before provenance comment: `d5f8b7cfb8c7504be5b8abde2d73db7c16e7cd2699644ae7b806baddbf5ba633`.

**DE:** Nur die Laub-Zehn wird aus diesem Foto gewählt. Sie zeigt denselben
schlichten Baum mit zehn Laubzeichen und beseitigt den Lichtreflex der bisherigen
Vorlage. Der übrige, teilweise anders gestaltete 32er-Satz ersetzt unsere
anderen Karten nicht. Die Anpassung der Laub-Zehn durch Ausschnitt, Ausrichtung
und Weissabgleich wird ebenfalls unter **CC BY-SA 4.0** bereitgestellt. Die
Quellen- und Lizenzangaben sind im Spiel verlinkt und im JPEG eingebettet.

**EN:** Only the ten of leaves is selected from this photograph. Its matching
plain tree and ten leaf symbols replace the glare in the earlier source. The
remaining 32-card deck has some different artwork and does not replace our other
cards. The ten-of-leaves adaptation, including cropping, alignment and white
balance, is also provided under **CC BY-SA 4.0**. Source and licence links appear
in the game and are embedded in the JPEG.

### Online geprüfte Qualitätsreferenzen / Online quality references

- [Piatnik: Doppeldeutsche Blitz, 36 Blatt](https://www.piatnik.com/spiele/spielkarten/regionale-karten/doppeldeutsche-blitz-36-blatt).
- [Piatnik-Werbedruckpartner: Doppeldeutsche Nr. 1885](https://promo-spielkarten.at/p/doppeldeutsche/) und [vollständige 36er-Übersicht](https://promo-spielkarten.at/wp-content/uploads/2020/11/1885-spielkarten-ueberblick.jpg).
- [Atlas of Playing Cards: Tell](https://atlasofplayingcards.org/pattern/tell.html).

Diese Seiten dienen dem Motiv- und Qualitätsvergleich. Ihre Produktbilder
wurden nicht in die App übernommen. Unvollständige 32er-Sätze und nicht
freigegebene PNG-Sammlungen wurden nicht als vollständiger Ersatz eingesetzt.

These pages guide motif and quality comparison. Their product images were not
imported into the app. Incomplete 32-card decks and PNG collections without a
reuse licence were not used as full-deck replacements.

## Frühere Viewports als Referenz / Earlier viewports for reference

**DE:** Vier Zeilen mit neun Karten. Von oben nach unten: **Eichel, Laub, Herz,
Schellen**. Von links nach rechts: **Ass, König, Ober, Unter, 10, 9, 8, 7, 6**.
Ein allgemeines gleichmässiges CSS-Raster trifft die leicht versetzten Karten
nicht genau. Die folgenden einzeln zentrierten Viewports sind ein visuell
ermittelter Ausgangspunkt in **Originalpixeln**, jeweils `x y Breite Höhe`.
Sie schneiden bewusst einen kleinen Teil des äusseren Papierrands ab, damit
möglichst kein fotografierter Tisch in die Karte gerät. Die aktive Darstellung verwendet inzwischen die oben beschriebene
Papierkantengeometrie; die Tabelle bleibt zur Nachvollziehbarkeit erhalten.

**EN:** Four rows of nine cards. Top to bottom: **acorns, leaves, hearts,
bells**. Left to right: **ace, king, ober, unter, 10, 9, 8, 7, 6**.
An evenly spaced CSS grid does not precisely follow the slightly displaced
cards. The individually centred viewports below are a visually derived
starting point in **original pixels**, written as `x y width height`.
They deliberately trim a little of the outer paper margin to keep the
photographed table out of the card. The active rendering now uses the paper-corner geometry above; this table
remains for traceability.

| Suit / Farbe | Rank / Rang | x | y | Width / Breite | Height / Höhe |
| --- | --- | ---: | ---: | ---: | ---: |
| acorns | ace | 458 | 53 | 360 | 570 |
| acorns | king | 854 | 49 | 360 | 570 |
| acorns | ober | 1244 | 56 | 360 | 570 |
| acorns | unter | 1634 | 52 | 360 | 570 |
| acorns | 10 | 2025 | 55 | 360 | 570 |
| acorns | 9 | 2416 | 68 | 360 | 570 |
| acorns | 8 | 2810 | 69 | 360 | 570 |
| acorns | 7 | 3201 | 64 | 360 | 570 |
| acorns | 6 | 3601 | 69 | 360 | 570 |
| leaves | ace | 475 | 665 | 360 | 570 |
| leaves | king | 866 | 671 | 360 | 570 |
| leaves | ober | 1250 | 674 | 360 | 570 |
| leaves | unter | 1639 | 668 | 360 | 570 |
| leaves | 10 | 2032 | 671 | 360 | 570 |
| leaves | 9 | 2421 | 674 | 360 | 570 |
| leaves | 8 | 2813 | 676 | 360 | 570 |
| leaves | 7 | 3205 | 682 | 360 | 570 |
| leaves | 6 | 3605 | 686 | 360 | 570 |
| hearts | ace | 475 | 1272 | 360 | 570 |
| hearts | king | 864 | 1278 | 360 | 570 |
| hearts | ober | 1247 | 1284 | 360 | 570 |
| hearts | unter | 1634 | 1283 | 360 | 570 |
| hearts | 10 | 2026 | 1281 | 360 | 570 |
| hearts | 9 | 2418 | 1290 | 360 | 570 |
| hearts | 8 | 2810 | 1296 | 360 | 570 |
| hearts | 7 | 3201 | 1294 | 360 | 570 |
| hearts | 6 | 3599 | 1303 | 360 | 570 |
| bells | ace | 460 | 1876 | 360 | 570 |
| bells | king | 841 | 1892 | 360 | 570 |
| bells | ober | 1230 | 1899 | 360 | 570 |
| bells | unter | 1629 | 1901 | 360 | 570 |
| bells | 10 | 2014 | 1899 | 360 | 570 |
| bells | 9 | 2401 | 1904 | 360 | 570 |
| bells | 8 | 2795 | 1902 | 360 | 570 |
| bells | 7 | 3194 | 1907 | 360 | 570 |
| bells | 6 | 3595 | 1921 | 360 | 570 |

Beispiel / Example:

```html
<svg viewBox="458 53 360 570" role="img" aria-label="Eichel Ass">
  <image href="/static/hausdepp/cards-source.jpg" width="3996" height="2526" />
</svg>
```

Der Ausschnitt geschieht ausschliesslich beim Rendern. Es wurden keine
Einzelkarten aus dem JPEG neu erzeugt oder bearbeitet. / Cropping occurs only
during rendering. No individual-card image files were generated or edited
from the JPEG.

## Rückseite: generiertes Asset / Back: generated asset

- Datei / File: `app/static/hausdepp/card-back.png`
- Abmessungen / Dimensions: **1254 × 1254 Pixel**, deckende Textur / opaque texture.
- Werkzeug / Tool: natives `image_gen.imagegen`, eingebauter Modus / native built-in mode.
- Referenz / Reference: zweites vom Owner angehängtes Foto / the owner's second attached photograph.
- Exakter Generierungsprompt / Exact generation prompt: [card-back.prompt.txt](../app/static/hausdepp/card-back.prompt.txt).
- Der identische Prompt ist mit `impeccable embed-prompt` im PNG gespeichert.
  / The identical prompt is embedded in the PNG through `impeccable embed-prompt`.

**DE:** Die Rückseite ist eine neu generierte, flache rot-schwarz-elfenbeinfarbene
Blitzmuster-Textur nach der Bildreferenz. Sie enthält weder Logos noch Packung,
Kartenumriss oder Perspektive. Sie wurde nach der Generierung unverändert
übernommen und nur um Promptmetadaten ergänzt. Das Muster kann im Frontend
klein skaliert werden. Die Generierung wurde auf nahtloses Wiederholen
ausgerichtet; die tatsächliche Nahtwirkung ist bei der Einbindung zu prüfen.
Es handelt sich nicht um einen Scan der originalen Piatnik-Rückseite.

**EN:** The back is a newly generated, flat red, black and ivory lightning-pattern
texture based on the reference. It contains no logos, packaging, card outline
or perspective. It was copied unchanged after generation, with only prompt
metadata added. The frontend can display the pattern at a small scale.
Generation requested seamless tiling; the actual seam appearance must be
checked during integration. This is not a scan of the original Piatnik back.

## Provenienzprüfung / Provenance check

`impeccable embed-prompt --scan app/static/hausdepp` meldete nach der Ablage
**3 Rasterdateien, 0 ohne Provenienz**. / After saving the assets,
`impeccable embed-prompt --scan app/static/hausdepp` reported
**3 raster files, 0 missing provenance**.


## Hausdepp PWA: stilisierter Herz-Zehner / stylised heart ten

**DE:** Der Owner hat den ursprünglichen geometrischen X-Entwurf verworfen und
eine stilisierte tatsächliche Spielkarte gewünscht. Das integrierte Imagegen
erzeugte am 16.10.2026 einen eigenen, aufrecht zentrierten Herz-Zehner vor
Tannengrün. Als Motivreferenz diente das oben dokumentierte Commons-Foto
`cards-source.jpg`, insbesondere Herz 10 mit gespiegeltem Schloss; dessen
Herkunfts-/Lizenzhinweise bleiben ausdrücklich Bestandteil dieser Referenz.
Die Illustration ist keine hochauflösende Originalkarte für das Spieldeck.

**EN:** The owner rejected the original geometric X mark and requested a
stylised real playing-card motif. Built-in Imagegen generated an upright,
centred heart ten on forest green on 2026-10-16, using the documented Commons
photograph `cards-source.jpg` as a motif reference. Its source and attribution
remain part of this reference. This illustration does not replace original
playing-card artwork in the game.

- Original output: `/Users/manuel/.codex/generated_images/01a1448c-ee65-7321-bd98-9501a7566c50/exec-b800f117-da2f-4c2b-ad7c-0b375eff7511.png`.
- Unmodified project source: `app/static/icons/hausdepp-heart-ten-source-v1.png`
  (1’254×1’254, opaque PNG).
- Exact prompt: [hausdepp-heart-ten-v1.prompt.txt](../app/static/icons/hausdepp-heart-ten-v1.prompt.txt).
- Proportional size exports only, with bundled Sharp: `hausdepp-icon-32.png`,
  `hausdepp-icon-192.png`, `hausdepp-icon-512.png`,
  `hausdepp-apple-touch-icon-180.png`, all in `app/static/icons/`.
- Consumed by all five Hausdepp document heads, both private installation
  manifests, the table header and the push-notification icon.
- The rejected SVG is removed. UI/UX and final icon acceptance remain with the
  owner; generated artwork is not represented as original Piatnik print art.
