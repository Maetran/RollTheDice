# Watten Tirol: Zirbenstube

Der gewählte Tisch ist Entwurf A „Zirbenstube“ vom 02.11.2026: eine helle
Holzfläche mit geschnitzten Edelweiß- und Enzianecken. Das eigene, mit
Bildgenerierung erstellte Material wurde im Figcraft-Tischvergleich ausgewählt
und anschließend unverändert in „Stubendruck × Bergluft“ übernommen. Das Bild
enthält keine Karten, Texte, Avatare oder Bedienelemente.

The selected table is concept A, “Zirbenstube”, from 2 November 2026: light wood
with carved edelweiss and gentian corners. This original generated material was
selected in the Figcraft table comparison and retained in “Stubendruck ×
Bergluft”. It contains no cards, text, avatars or controls.

## Quelle und Auslieferung / Source and delivery

- Freigegebene Quelle / Approved source: `material-A.png`, 1584 × 993 px,
  RGB, 2,501,317 bytes. Preserved in the design artifact
  `watten-tischentwuerfe/assets/`; the same image is embedded in the editable
  Figcraft proposals.
- SHA-256 der Quelle / Source SHA-256:
  `ac3cb681dcf73b40ac7fcc21ac0ef69e6463189a66e9d77b95ed1cfae7fb388b`.
- Produktdatei / Production asset:
  `app/static/images/watten-tirol/zirbenstube.webp`, 1584 × 993 px,
  RGB, WebP quality 92, encoder method 6, 325,236 bytes.
- SHA-256 der Produktdatei / Production SHA-256:
  `5d3f892b33ad9e651ad66dc1658827d1b898e3a3388224481febae8547b7f669`.

Es wurde ausschließlich neu kodiert: keine Skalierung, Ausschnitte, Retuschen
oder zusätzlichen Ornamente. Alle vier Schnitzecken bleiben vollständig
erhalten. / Re-encoding only: no resizing, cropping, retouching or added
ornament. All four carved corners remain complete.

## Darstellung / Rendering

Der bestehende neunteilige Tischrahmen erhält nur die neue Bildquelle.
Die im freigegebenen Figcraft-Entwurf verwendete Teilung beträgt
`30.241935% 22.082019% fill`: etwa 300.30 px oben/unten und 349.78 px
links/rechts. Die vorhandenen responsiven Rahmenbreiten bleiben erhalten;
`border-image-repeat: stretch` und `border-image-width: 1` verbinden die ruhige
Mitte mit den vier vollständigen Ecken. Ein normales `background-size: cover`
würde die Ecken im Hochformat abschneiden.

Only the image source changes in the existing nine-slice table frame. The
approved Figcraft material uses `30.241935% 22.082019% fill`: approximately
300.30 px at the top/bottom and 349.78 px at the left/right. Keep the existing
responsive border widths, `border-image-repeat: stretch` and
`border-image-width: 1`. A regular `background-size: cover` would crop the
corners in portrait.

## Erneute Kodierung / Re-encoding

Mit der unveränderten freigegebenen PNG-Quelle und Pillow mit WebP-Unterstützung:
/ With the unchanged approved PNG source and Pillow with WebP support:

```python
from PIL import Image

with Image.open("material-A.png") as source:
    source.save(
        "app/static/images/watten-tirol/zirbenstube.webp",
        "WEBP", quality=92, method=6,
    )
```

Die Produktdatei wurde vollständig dekodiert und auf Format, Farbmodus und
Abmessungen geprüft. Die tatsächliche Tischdarstellung und Bedienbarkeit
benötigen zusätzlich den Browsernachweis des Releases. / The product file was
fully decoded and checked for format, color mode and dimensions. Rendering and
interaction still require the release's browser verification.
