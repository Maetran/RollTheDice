# Hausdepp: Tischdekoration / table props

## Deutsch

Der Owner wünscht für Tablet und Desktop eine üppigere Kartenrunde mit wechselndem
Bier, Nüssen und Marend. Holz, echte Tellkarten und bedienbare Spielbereiche
bleiben erhalten. Zwölf Requisiten liegen in drei transparenten 2×2-Atlanten:
`app/static/hausdepp-table-props-v1.png`, `hausdepp-table-props-snacks-v1.png`
und `hausdepp-table-props-evening-v1.png` (je 1’254×1’254, RGBA).
Es sind eigene, mit dem integrierten Imagegen-Werkzeug am 16.10.2026 generierte
Grafiken; es wurde kein fremdes Foto, Markenlogo oder Referenzmaterial verwendet.
Die ausgewählte PNG-Datei wurde unverändert in das Projekt kopiert.

`frontend/hausdepp/decor.js` wählt aus Bierglas, Dose, Nussschale, Jausenbrett,
Würfeln, Tee, Chips, Flips, Brezel, Süssigkeiten, Windlicht und Limonade
eine durch Tisch und Runde bestimmte Mischung. Derselbe Tisch und dieselbe
Runde behalten auch nach einem Reload dieselbe Auswahl. Tablet zeigt bis zu
zwei Gegenstände, Desktop bis zu vier. Handy-Hochformat zeigt höchstens einen
kleinen Gegenstand, Handy-Querformat bis zu zwei, jeweils nur bei freiem Platz.
Es gibt weder einen zusätzlichen Serverzustand noch eine Regelwirkung.

Vor jeder Platzierung werden die sichtbaren Gegner, Karten, Stapel, Texte und
Aktionen gemessen. Requisiten erscheinen ausschliesslich in freien Bereichen,
bieten optionales Antippen und Tastaturbedienung über beschriftete Flächen
von mindestens 44 Pixeln. Bei Platzmangel werden sie verkleinert oder weggelassen.
Innerhalb einer Runde bleiben Auswahl und Position fest. Nur ein geändertes
Fensterformat berechnet die Platzierung neu. Eine wachsende Hand darf über
Gegenständen liegen; die Karten liegen darüber und erhalten den Tipp. Teedampf, Bierschaum und Kerzenlicht bewegen sich nur sehr gering.
Ein Anstupsen kippt die Dose bei ausreichend freiem Platz um ihren Fuss; sie
bleibt liegen, bis sie erneut angeklickt wird. Würfel rollen in eine neue
Ruhelage, schwere Bretter rutschen nur kurz, Tassen federn am Standfuss zurück.
Gelegentlich erfolgt ein einzelner Anstoss in Abständen von 30–65 Sekunden während des Spiels;
in Hintergrundtabs und offenen Dialogen bleibt er aus. Diese Gesten verschieben
keine Platzierungskoordinaten, senden keine Spielbefehle und vermeiden belegte
Spielbereiche. Bei reduzierter Bewegung bleiben alle Requisiten unbewegt und
ihre optionalen Knöpfe deaktiviert.

Die gezielten Tests stehen in `tests/browser/hausdepp-table-decor.spec.js`.
Die eigentliche Karten- und Transferprovenienz bleibt separat in
`docs/HAUSDEPP_ASSETS.md` dokumentiert. Die gestalterische Abnahme bleibt offen.

### Streuteile, Bewegung und Schieben (3.4.1)

Zu den zwölf grossen Gegenständen kommen zehn kleine Streuteile im Atlas
`app/static/hausdepp-table-props-scatter-v1.webp` (4×3 Zellen, 1’024×768):
Kronkorken, Flaschenöffner, goldene und rote Praline, einzelner Würfel,
lose Nüsse, Chips, Flips, Bierdeckel mit Strichliste und Bleistift. Die ersten
acht sind freigestellte Ausschnitte aus den drei generierten Atlanten
(Alphamaske je Objekt, ohne neue Bildquelle). Bierdeckel und Bleistift sind
eigene Vektorgrafiken (`docs/hausdepp-decor/coaster.svg`, `pencil.svg`).
Für die Auslieferung gibt es von den drei grossen Atlanten verkleinerte
WebP-Fassungen (768×768, zusammen rund 0,4 statt 5,5 MB); die PNG-Originale
bleiben als Quelle im Projekt.

Desktop zeigt pro Runde vier bis sechs grosse Gegenstände und vier bis sechs
Streuteile, Tablet bis zu drei grosse und drei bis fünf kleine, Handy-Hochformat
einen grossen und bis zu drei kleine, Handy-Querformat je zwei. Die Positionen
liegen meist am Tischrand und werden weiterhin gegen alle gemessenen
Spielbereiche und Bedienelemente geprüft. Zusätzlich bleibt das Band frei,
das eine Hand mit fünf bis sieben Karten braucht, damit später aufgenommene
Karten nichts verdecken.

Jeder Gegenstand reagiert beim Antippen eigen: Kronkorken drehen sich wie eine
Münze, Öffner und Bleistift kreiseln, Pralinen und Würfel rollen, lose Snacks
hüpfen und verlieren Krümel, Getränke kräuseln ihre Oberfläche, das Windlicht
flackert auf. Ist zu wenig Platz, gibt der Gegenstand nur kurz nach.
Mit Maus oder Finger lassen sich Gegenstände ein Stück über den Tisch schieben;
auf Karten, Stapeln, Namen oder Knöpfen bleiben sie nie liegen, sondern gleiten
zurück. Im Ruhezustand steigen Bläschen im Bier, das Windlicht schimmert und
Folie und Dose glänzen gelegentlich. Reduzierte Bewegung schaltet all das ab.

### Mitspielen mit dem Tisch (3.8.0)

- **Münze** (gezeichnet, ohne Bilddatei): Antippen wirft sie; sie dreht sich in der
  Luft und landet zufällig auf Kopf (Krone) oder Zahl (1), mit kurzer Beschriftung.
- **Würfel** (gross und klein): rollen und zeigen ein Zufallsergebnis 1–6.
- **Bier, Tee, Limonade**: Antippen ist ein Schluck; nach vier Schlucken ist das
  Glas leer (blasser), ein weiterer Tipp schenkt nach. Drei schnelle Tipps
  verschütten etwas (Spritzer und Pfütze), sechs werfen das Glas um; nach kurzer
  Pause stellt ein bewusster Tipp es leer wieder auf. Unberührtes Bier verliert
  nach etwa zweieinhalb Minuten seine Schaumkrone.
- **Nüsse, Chips, Flips, Süsses, Brezel, Pralinen, Jause**: werden Biss für Biss
  verputzt (lose Stücke mit einem Biss); danach bleiben bis zur nächsten Runde nur
  Krümel liegen.
- Alles bleibt Dekoration: kein Spielbefehl, keine Netzwerkanfrage, kein Speichern.
  Bei reduzierter Bewegung bleiben die Gegenstände still und deaktiviert.

## English

The owner requested richer tablet/desktop table space with varying drinks,
nuts and a Tyrolean snack board. The original walnut, Tell cards and playable
areas remain. The twelve props form three transparent 2×2 RGBA sprite atlases,
generated with the built-in Imagegen tool on 2026-10-16 without external images,
logos or references. The selected PNG is copied unchanged into the project.

Table and round determine a stable mix across reloads. Tablets show up to two
props; desktops up to four; portrait phones at most one small prop, landscape
phones up to two when space permits. Visible players,
cards, piles, copy and actions are measured before placing anything. Props offer optional taps and labelled keyboard controls with at least 44-pixel
targets, and are resized or omitted when space is insufficient. Positions stay
fixed for the round unless the viewport format changes. Growing hands can cover
objects; cards remain above them and receive the tap. They affect no rules or
server state. A can tips around its foot when space allows and stays down until
clicked again; dice roll to a new resting angle, heavy boards slide briefly,
and cups settle around their base. A rare automatic nudge occurs at 30–65-second
intervals during play, skipping hidden tabs and open dialogs. Gestures keep
placement coordinates fixed and leave occupied controls clear. Initial fading
and subtle steam, foam and candle flicker respect reduced motion. Ordinary
acknowledgements do not restart effects; reduced motion also disables optional
prop buttons.
Visual owner acceptance remains pending.

### Scatter pieces, motion and pushing (3.4.1)

Ten small scatter pieces join the twelve large props in
`app/static/hausdepp-table-props-scatter-v1.webp` (4×3 cells): bottle cap,
opener, gold and red chocolates, a single die, loose nuts, crisps, peanut
puffs, a beer mat with tally marks and a pencil. Eight are alpha-masked cut-outs
of the three generated atlases; the beer mat and pencil are vector drawings in
`docs/hausdepp-decor/`. The large atlases ship as downscaled WebP files
(about 0.4 MB instead of 5.5 MB); the PNG originals stay as sources.

Desktop shows four to six large props and four to six scatter pieces per round,
tablets up to three large and three to five small, portrait phones one large and
up to three small, landscape phones two of each. Placement keeps the band a
five- to seven-card hand needs. Every object has its own tap reaction (coin
spin, spin, roll, hop with crumbs, liquid ripple, candle flare) or a short
squish when space is tight, and can be pushed with mouse or finger; it glides
back instead of resting on cards, piles, names or controls. Idle bubbles,
candle halo and foil glints stay subtle. Reduced motion turns all of it off.

### Playing with the table (3.8.0)

A drawn coin lands on heads or tails, dice show a random 1–6, drinks are sipped,
emptied and topped up, spilled after three quick taps and knocked over after six
(stand them up again after a short pause), an untouched beer goes flat, and snacks
are eaten bite by bite until only crumbs remain for the round. Everything stays
presentation only: no game command, request or storage; reduced motion keeps the
objects still and disabled.

## Original generation prompt

> Create ONE production-ready transparent PNG sprite sheet for an online Alpine
> card game, four precisely separated photorealistic tabletop props arranged in
> an exact 2 by 2 grid of equal square cells on a square canvas. No grid lines,
> no background or tabletop, no text, lettering, branding or watermarks. Camera:
> nearly straight overhead with just a little natural depth, consistent soft
> warm light from upper left, realistic small contact shadows kept inside each
> cell. All objects fully visible with at least 12 percent transparent padding
> around each cell; nothing touches cell boundaries or other cells. TOP LEFT:
> a short clear handled beer mug with golden amber lager and a modest creamy
> foam head, circle coaster beneath, realistic glass reflections. TOP RIGHT:
> one handsome unbranded forest-green aluminum beer can with simple cream and
> dark-red geometric bands, no text, viewed from overhead showing silver pull
> tab, a subtle condensation sheen. BOTTOM LEFT: one small rustic ceramic bowl
> filled with mixed peanuts and a few walnuts, a few scattered nuts beside it
> but contained in the cell. BOTTOM RIGHT: a small oval wooden Tyrolean snack
> board / Marend with a modest arrangement of sliced cured ham, cheese, rustic
> bread and two small pickles, no knife. Quality: rich photographic detail,
> convincing appetizing food, valuable real objects suitable to composite over
> dark walnut wood. Keep individual silhouettes visually distinct, do not add
> playing cards, people, hands, table, logos or extra elements.

## Supplemental generated sets / weitere generierte Sets

The same transparent 2×2 atlas specification, overhead camera, warm light,
separation and no-branding constraints apply to the two additional sets.
Their subject briefs were:

- Snacks: two loose ivory dice; a ceramic tea cup and saucer; a small bowl of
  potato crisps; a small bowl of peanut puffs. The tea receives a separate,
  restrained CSS steam effect rather than a permanently painted smoke cloud.
- Evening: a rustic pretzel; a little bowl of colourful sweets; a small glass
  candle lantern; a glass of lemonade with lemon. Candle flicker is a separate
  CSS effect. The generated pixels remain unmodified.

Selected original Imagegen output files, all from this task's
`/Users/manuel/.codex/generated_images/01a1448c-ee65-7321-bd98-9501a7566c50/`:

| Shipped atlas | Original generated PNG |
| --- | --- |
| `hausdepp-table-props-v1.png` | `exec-869fecb2-8279-43c9-a188-96c7e5504d45.png` |
| `hausdepp-table-props-snacks-v1.png` | `exec-7392d913-f628-497e-9c54-80c3ffe18b3b.png` |
| `hausdepp-table-props-evening-v1.png` | `exec-e2fd5377-347b-47d2-a641-0aac75a563c4.png` |

These filenames record provenance, not a runtime dependency on a developer's
home directory. The shipped atlases are local static assets. No image API,
tracking request or third-party image host is needed at play time.


### Sichtbare Portionen und kleine Überraschungen (3.11.0)

Die ursprünglichen Atlanten bleiben unverändert. `decor-consumables.js` trennt
Gefäss/Brett, Flüssigkeit und einzelne fotobasierte Essensportionen mit SVG-/CSS-
Masken. Jeder Schluck senkt den Meniskus, bei null verschwinden Flüssigkeit und
Schaum. Aufgegessene Schalen/Bretter bleiben bis zum Rundenwechsel leer.
`decor-play.js` ergänzt einen karierten SVG-Putzlumpen: Schnelles Tippen leert die
Restfüllung in eine begrenzte Pfütze. Der Lumpen ist eine erreichbare
44-Pixel-Bedienfläche: Ziehen mit Maus oder Touch wischt schrittweise auf;
Antippen, Enter oder Leertaste erledigt jeweils einen Teil. Er bleibt bis zum
Aufwischen oder dem gemeinsamen Lifecycle-Cleanup liegen. Ein leeres Glas erzeugt keine neue Flüssigkeit. Höchstens eine Pfütze
je Gefäss und drei insgesamt, auf freiem Holz kollisionsgeprüft. Nur der
Lumpen nimmt Eingaben an; die übrige Pfütze bleibt pointer-inert.
Rundenwechsel, Rundenende, Hintergrundtab und reduzierte Bewegung räumen Effekte
auf. Neben Spielbereichen kippen Gläser innerhalb ihrer eigenen Grundfläche.

Ein eigener SVG-Bierdeckel bekommt bis zwanzig Graphitstriche in Fünfergruppen;
der nächste Tipp dreht ihn auf die leere Rückseite. Ein vorhandener Bleistift
schreibt auf einen sichtbaren Deckel mit. Verschobene Gläser hinterlassen maximal
drei rasch verblassende Kondensringe. Das Windlicht lässt sich aus- und wieder
anschalten. Kräftige Richtungswechsel beim Verschieben löschen es kurz und
starten eine erneute Zündung. Die Bierdose öffnet sich nach mehreren Tipps mit
Schaum und platzt bei kräftigen Schüttelgesten; die kleine Stelle ist aufwischbar.
Die SVGs sind im Projekt gezeichnet; neue Bildquellen kamen nicht dazu.
Claude steuerte eine begrenzte Ideen-/Reviewrunde und die animierten
Bierdeckelstriche bei. Codex prüfte den Beitrag und verantwortet Auswahl,
Integration und Verifikation.

### Visible portions and small surprises (3.11.0)

The original atlases remain unchanged. `decor-consumables.js` separates the
vessel/board, liquid and individual photographic servings using SVG/CSS masks.
Each sip lowers the meniscus; zero hides liquid and foam. Empty bowls and boards
stay empty until the next round. `decor-play.js` adds a drawn checked cloth:
rapid taps spill the remaining fill. A reachable 44-pixel cloth lets mouse
and touch users wipe incrementally; a click, Enter or Space clears one part.
The spill stays until cleaned or until lifecycle cleanup. Empty glasses produce no liquid. At most one puddle per glass and
three overall occupy collision-checked free wood. Only the cloth accepts input;
the puddle itself remains pointer-inert.
Round changes, finished rounds, hidden tabs and reduced motion clear effects.
Glasses next to playable areas tip inside their own footprint.

A drawn SVG beer mat takes twenty graphite tally marks in groups of five and
then flips to its clean reverse. A visible pencil adds marks to a visible mat.
Moved glasses leave up to three fading condensation rings. The lantern can be
blown out and relit. Vigorous direction changes during a drag briefly put it
out before automatic relighting. Repeated taps open the can with foam; vigorous
shaking bursts it and leaves a small cleanable patch. SVGs are project-authored, with no new image sources.
Claude contributed a bounded idea/review pass and the animated beer-mat strokes.
Codex reviewed the contribution and owns selection, integration and verification.


### Seltene gemeinsame Funde / rare shared finds (3.11.0)

Ein erster serverseitiger SHA-256-Bucket aus Tisch und Runde entscheidet mit
ungefähr 1/50 über ein Angebot. Nur danach wählt eine unabhängige Hash-Domain
einen von acht Funden: Stern, Runenhammer, UFO, Portal, Drache, Kraken, Taschenuhr
oder schwarzes Loch (je ungefähr 1/400). Erst der Tipp eines berechtigten Menschen
auf den sichtbaren Gegenstand beansprucht ihn atomar für diese Runde. Das Angebot
allein startet keinen Effekt, auch nicht nach einer Wartezeit; Computer aktivieren
keine Funde. Ein gesondertes Live-Ereignis zeigt den Effekt allen
verbundenen Raumteilnehmern, ohne Karten, Zugrecht, Wertung, Spielversion oder
Computerplanung anzufassen. Alte Runden, fremde/ersetzte Sockets und erneute
Aktivierungen werden abgewiesen. Snapshots enthalten nur das unbenutzte Angebot,
keine nachträglich abgespielte Explosion. Ein kleiner Claim im bestehenden
Spielzustand erhält die Einmaligkeit bei Wiederaufnahme; es gibt keine neue Tabelle.

Die SVG-Grundmotive, der erste Effektplayer und die Zylindermaus stammen aus
Claudes begrenzten Beiträgen; Codex prüfte sie und überarbeitete die Inszenierung.
Die SVGs sind eigene Zeichnungen. Die überarbeitete Inszenierung animiert
pointer-inerte optische Doppelgänger von Karten und Gegenständen. Echte Knoten,
Spielwerte und Trefferflächen bleiben an Ort und Stelle. Der Tisch darf während
des schwarzen Lochs eine Sekunde schwarz werden; die Uhr zeigt zwei Sekunden
visuelle Zeitpause, ohne Serverzeit oder Computerzüge anzuhalten. Ein einziges
serverseitiges Bool-Flag projiziert nach dem Drachen die angesengten Ränder auch
für Wiederaufnahme und spätere Zuschauer; neue Tische starten mit sauberem Papier. Der Hammer kann ausschliesslich im auslösenden Tab und bei vorhandener
Browserunterstützung kurz vibrieren. Reduzierte Bewegung, Hintergrundtabs,
Rundenwechsel und Navigation verhindern oder beenden die Effekte. Nach 42 neuen
Graphitstrichen gibt es zudem einmal pro Runde eine kleine lokale Beschriftung.

A first server-side SHA-256 bucket of table and round decides eligibility
(about 1/50). Only then does an independent hash domain select one of eight
finds: star, rune hammer, UFO, portal, dragon, kraken, pocket watch or black hole
(about 1/400 each).
The offer alone never starts an effect, including after a delay; computer players
never activate finds. A human must tap the visible object to claim it atomically
for that round. A separate live
event shows the effect to everyone connected to the room without changing cards,
turns, scoring, game versions or CPU scheduling. Old rounds, foreign/replaced
sockets and repeated claims are rejected. Snapshots carry only an unused offer,
never an old explosion. A small claim in the existing game state preserves
once-per-round behaviour during recovery, with no new database table.

Claude authored the SVG motifs, first effect player and top-hat mouse; Codex
reviewed them and revised the scenes. The revised scenes animate pointer-inert visual doubles of cards
and objects while real nodes, game values and hit boxes remain in place. The
black hole can make the table black for one second; the watch shows a two-second
visual time stop without pausing server time or CPU turns. One server-projected
boolean preserves singed card edges after the dragon, including reconnects and
late spectators; new tables start with clean paper. Only the triggering tab's hammer can briefly vibrate, when supported.
Reduced motion, hidden tabs, round changes and navigation suppress or clear the
effects. Forty-two new graphite marks also reveal a small local caption once
per round.
