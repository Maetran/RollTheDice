# Hintergrundgeräusche für Hausdepp und Watten / Tavern ambience

Hausdepp und Watten nutzen denselben lokalen Audioplayer und Katalog.
Die bisherigen zehn Mischungen bleiben bytegenau erhalten; sie gehören zu
**einer** Cambridge-Familie. Zusätzliche Familien verwenden jeweils eine
andere echte Raumaufnahme. Es werden keine Stimmen synthetisiert und keine
fremden Webdienste während des Spiels aufgerufen.

Hausdepp and Watten share a local audio player and catalogue. The ten existing
mixes remain byte-for-byte unchanged and form **one** Cambridge family.
Additional families each use a different real venue recording. No voices are
synthesised and gameplay makes no requests to third-party audio services.

## Neue Quellen / Additional sources

Die einzelnen Freesound-Werkseiten weisen am 24. Oktober 2026 CC0 aus.
Verwendet werden die öffentlichen HQ-MP3-Vorschauen dieser Werke; sie sind
von den teils loginpflichtigen Originalformaten zu unterscheiden.
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) erlaubt
Bearbeitung und kommerzielle Weiterverbreitung. Die Urheber werden hier zur
Nachvollziehbarkeit trotzdem genannt. Angaben zu Ort und Aufnahmesituation
stammen von den Urhebern.

Each individual Freesound page lists CC0 as checked on 24 October 2026.
The inputs are the public HQ MP3 previews, distinct from the original formats
that can require a Freesound account. Authors are documented for provenance.
Venue descriptions are the authors' descriptions of their recordings.

| Raum / Venue | Urheber und Quelle / Author and source | Lokale Länge / Local length | Bytes |
| --- | --- | ---: | ---: |
| Keller-Café / Basement café | [clivew: ambience Cafe basement.m4a](https://freesound.org/people/clivew/sounds/577104/) | 137 s | 1,644,817 |
| Restaurant / Restaurant | [The_Runner_01: Crowd in restaurant.wav](https://freesound.org/people/The_Runner_01/sounds/640740/) | 137 s | 1,644,817 |
| Kaffeehaus / Coffee shop | [waweee: coffee shop ambience](https://freesound.org/people/waweee/sounds/370973/) | 137 s | 1,644,817 |
| Belebte Bar / Crowded bar | [SoundsExciting: bar chatter](https://freesound.org/people/SoundsExciting/sounds/543913/) | 137 s | 1,644,817 |
| Weinbar / Wine bar | [rbn_yng: Wine Bar Ambience, Light Talking, Around 20 People](https://freesound.org/people/rbn_yng/sounds/275639/) | 137 s | 1,644,817 |
| Englischer Pub / English pub | [Talitha5: English pub ambiance.m4a](https://freesound.org/people/Talitha5/sounds/690597/) | 127 s | 1,524,759 |

Vollständige Quelle, Downloadhash, exakter Ausschnitt, Bearbeitung und Messwerte:
[`references/tavern-recordings.json`](references/tavern-recordings.json).
Die früheren Cambridge- und Detailaufnahmen stehen unverändert in
[HAUSDEPP_AUDIO_ASSETS.md](HAUSDEPP_AUDIO_ASSETS.md).

## Auswahl und Wiedergabe / Selection and playback

- Hintergrundgeräusche sind beim Laden der Seite aus und werden freiwillig
  eingeschaltet. Der Sprachchat hat eigene Schalter und eine eigene Verbindung.
- Ein Shuffle-Vorrat wählt zuerst eine Raumfamilie, danach eine Variante.
  Die zehn Cambridge-Mischungen verdrängen die neuen Räume dadurch nicht.
  Es gibt keine direkte Wiederholung, auch an der Grenze zum nächsten Vorrat.
- Auswahlhistorie wird je Browser-Origin gespeichert. Hausdepp und Watten
  laufen auf verschiedenen Origins; ein Spielwechsel teilt weder diesen
  Speicher noch den HTTP-Cache. Bei gesperrtem Speicher gilt der Schutz
  innerhalb der aktuellen Seite weiter.
- Nach drei bis fünf Minuten aktiver Audiozeit wird der nächste Raum geladen
  und über 20 Sekunden sanft eingeblendet. Bei einem Ladefehler spielt der
  bisherige Raum weiter. Es werden höchstens zwei Räume gleichzeitig
  decodiert gehalten; Dekodiervorgänge laufen seriell, auch nach Aus/Ein.
- Nur Cambridge bekommt die bisherigen Gläser-, Geschirr- und Lachdetails.
  Zusätzliche Räume enthalten ihre eigenen natürlichen Geräusche.
- Audio wird erst bei Bedarf geladen, nicht bei PWA-Installation vorab.
  Aus, Verlassen, Abmelden und `pagehide` beenden die Wiedergabe und räumen auf.

Sound starts off and is enabled voluntarily, independently of voice chat.
A shuffled bag chooses families before variants and prevents immediate repeats.
History is stored per origin, with an in-memory fallback. After three to five
minutes of active audio time, another room loads and fades in over 20 seconds;
a failed load leaves the old room playing. At most two room buffers are held,
with serial decoding. Only Cambridge uses the old object/laughter overlays.
Audio is loaded on demand, never precached at PWA installation. Turning sound
off or leaving the page stops playback and cleans up pending work.

## Reproduzierbare Bearbeitung / Reproducible processing

```sh
python3 scripts/build_tavern_recordings.py --ffmpeg /absolute/path/to/ffmpeg \
  --source-dir /absolute/path/to/downloaded-hq-previews
```

Das Skript führt keine Downloads aus und verlangt die dokumentierten
SHA-256-Hashes. Ein zusammenhängender Ausschnitt jeder neuen Aufnahme erhält
Hoch-/Tiefpass, zweistufige Lautheitsnormalisierung und eine drei Sekunden
lange Überblendung zwischen Ende und Anfang. Es gibt keine neue Schichtung
mit der alten Cambridge-Aufnahme. Ausgabe: MP3, 44.1 kHz, Stereo, 96 kbit/s,
Metadaten entfernt; Spitzen bleiben unter −7 dBFS. Die Weinbar wird wegen
der dokumentierten einseitigen Aufnahme aus ihrem nutzbaren Mikrofonkanal
auf beide Lautsprecher verteilt. Die Wiedergabe nutzt zusätzlich einen
kleinen Browsergain; die Systemlautstärke bestimmt die tatsächliche Lautstärke.

The offline script verifies source hashes and processes a continuous excerpt
from each independent recording, with filtering, two-pass loudness processing
and a three-second tail/head loop join. New rooms are not layered with the old
Cambridge source. Output is stereo MP3 at 44.1 kHz / 96 kbit/s, with metadata
removed and decoded peaks below −7 dBFS. The wine bar's usable microphone
channel is placed in both speakers. A small browser gain further lowers
playback; system volume still determines actual listening level.

## Prüfgrenzen / Validation limits

Lizenz- und Quellenprüfung, vollständiges Dekodieren, Dateigrösse, Dauer,
Lautheit, Spitzenpegel und Sampleübergang sind technische Nachweise. Sie
belegen keine subjektive Hörabnahme und keine Prüfung über echte
Handylautsprecher oder Kopfhörer. In dieser Arbeitsumgebung kann der Agent
Audiodateien nicht selbst hören. Die Raumaufnahmen enthalten natürliches
Stimmengewirr; verständliche Sprache oder eventuell mitaufgenommene Musik
kann aus Metadaten und Lautheitswerten allein nicht sicher ausgeschlossen werden.

Licence/source checks, complete decoding, byte size, duration, loudness, peaks
and boundary measurements are technical evidence. They do not constitute
subjective listening approval or real-device speaker/headphone testing. The
agent cannot hear audio in this environment. These field recordings contain
natural chatter; intelligible speech or incidental recorded music cannot be
ruled out from metadata and loudness measurements alone.
