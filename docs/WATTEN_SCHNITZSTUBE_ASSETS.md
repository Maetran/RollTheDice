# Watten: Schnitzstube

Der gewählte Entwurf ist die helle Tiroler Schnitzstube mit ruhiger Holzfläche,
geschnitzten Blumenecken und schmalem Flechtrand. Die Spielkarten kommen weiterhin
aus den vorhandenen Hausdepp-/Watten-Assets. Hintergrund und Schnitzwerk enthalten
keine Karten oder Bedienelemente und vermitteln keinen Spielzustand.

## Material / Material

`app/static/watten/table-schnitzstube.jpg` wurde am 20.10.2026 mit dem eingebauten
image_gen-Werkzeug aus unserem eigenen gewählten Entwurf erzeugt. JPEG-Kodierung:
86 Prozent; keine Fremdspiel-Assets. Das Bild wird als neunteiliger Rahmen mit
Mittelbereich verwendet, damit die Schnitzecken auch im Hochformat vollständig
erhalten bleiben. / Created with the built-in image_gen tool from our selected
original concept. Nine-slice rendering preserves carved corners in portrait.

## Vollständiger Erzeugungsprompt / Complete generation prompt

```text
Use case: precise-object-edit.
Asset type: production texture asset for a responsive digital Tyrolean tavern card game table. Reference image is our selected original UI mockup.
Primary request: remove ALL interface and game objects from the reference, leaving ONLY the beautiful empty light ash wooden tabletop with the same traditional relief-carved four corners and slim braided wooden perimeter frame. Remove every playing card, card pile, card back, avatar, circle, button, label, score, icon, heart, tiny inlay/butterfly-joint shape and every letter of text. Reconstruct uninterrupted natural warm wood in every removed area.
Preserve the pale warm wood colour, straight overhead view, believable fine grain, hand-carved alpine flowers and leaves in the four corners, and the rope-carved border. Do not draw any shadows from removed objects.
Composition adjustment for use as a nine-slice border: the rope border must run very close to all four outside image edges, at equal inset. No separate header strip at top: uninterrupted table inside the braided perimeter. Each corner ornament must be fully contained in the outermost square corner area, with the same size at all four corners (roughly the outermost 15% width and 24% height in each corner). Center and edge middles are calm plain pale wood and a single narrow braided border. Flat orthographic view with no perspective distortion or room behind it. Overall landscape aspect ratio 16:10.
Materials: real hand-cut light ash relief with fine believable soft shadows; sunny warm honey cream main wood; no dramatic shiny polish, no dark stains or green. Crisp texture asset, restrained contrast at center where readable cards will be placed.
Constraints: absolutely NO cards, no UI, no text, no avatars, no gaming elements, no pictures printed on the wood, no watermark, no embedded interface shadows. Output one complete empty table surface, no collage, no mockup/device frame.
```
