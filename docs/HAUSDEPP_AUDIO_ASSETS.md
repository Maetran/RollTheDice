# Hausdepp: Wirtshauskulisse

> Historische Dokumentation der Cambridge-Familie und ihrer drei Details.
> Seit 4.2.0 teilen Hausdepp und Watten einen erweiterten Katalog mit zusätzlichen
> Originalaufnahmen und sanfter Rotation. Der aktuelle Stand steht in
> [TAVERN_AUDIO_ASSETS.md](TAVERN_AUDIO_ASSETS.md).
> Historical documentation of the Cambridge family and its three detail clips.
> The linked shared catalogue documents the additional recordings and rotation
> introduced in 4.2.0 for Hausdepp and Watten.

Die Kulisse besteht aus echten Raum- und Objektaufnahmen. Die bisherige
Raumkulisse bleibt unverändert; neun neue Mischungen ergänzen sie auf zehn.
Zusammen mit drei gemeinsamen Geräuschdetails werden 13 Dateien lokal mit der
Anwendung ausgeliefert; zur Wiedergabe ist kein Aufruf
von Freesound oder eines anderen Audiodienstes nötig. Es wurde keine Musik,
synthetische Stimme oder erkennbare Prominentenstimme hinzugefügt.

## Quellen und Lizenz

Alle vier Originalseiten weisen am 20. Oktober 2026 ausdrücklich
**Creative Commons 0** aus. Die verlinkte Lizenz ist jeweils
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
Sie erlaubt Bearbeitung und kommerzielle Weiterverbreitung ohne
Namensnennungspflicht. Die Urheber sind hier dennoch dokumentiert.
Die Ausgangsdateien sind die öffentlichen HQ-MP3-Vorschauen derselben Werke.

| Lokale Datei | Urheber und Originalseite | Verwendete Originalaufnahme | Ausgangsdatei |
| --- | --- | --- | --- |
| `app/static/audio/hausdepp/tavern-room.mp3` | [domasmo: Pub in Cambridge](https://freesound.org/people/domasmo/sounds/376456/) | Raumaufnahme eines Pubs in Cambridge; Original 2:01.490 | [HQ-MP3](https://cdn.freesound.org/previews/376/376456_4339600-hq.mp3) |
| `app/static/audio/hausdepp/glasses.mp3` | [EpicWizard: Drinking Glasses contact (Clink)](https://freesound.org/people/EpicWizard/sounds/325195/) | Unterschiedliche Kontakte kurzer Trinkgläser; Original 0:36.033 | [HQ-MP3](https://cdn.freesound.org/previews/325/325195_2291325-hq.mp3) |
| `app/static/audio/hausdepp/dishwasher.mp3` | [Caitlin_100: Emptying a dishwasher.mp3](https://freesound.org/people/Caitlin_100/sounds/365551/) | Geschirrspüler ausräumen; Original 0:27.677 | [HQ-MP3](https://cdn.freesound.org/previews/365/365551_5407590-hq.mp3) |
| `app/static/audio/hausdepp/laughter.mp3` | [HowardV: live audience comedy show genuine laughter_moderate.wav](https://freesound.org/people/HowardV/sounds/581528/) | Echtes Lachen eines kleinen/mittleren Publikums, laut Urheber ohne Dialog; Original 0:16.359 | [HQ-MP3](https://cdn.freesound.org/previews/581/581528_1654262-hq.mp3) |

Ein gesonderter Fluchruf gehört nicht zu diesen Assets. Die Raumaufnahme
enthält das natürliche Stimmengewirr des Pubs.

## Zehn Kulissen beim Einschalten

Bei jedem tatsächlichen Ausschalten und erneuten Einschalten wählt der Browser
eine der zehn Raumkulissen zufällig. Wiederholtes Einschalten eines bereits
aktiven Sounds und die Fortsetzung auf derselben Seite behalten die Auswahl.
Geladen werden nur der ausgewählte Raum und die drei kleinen Detaildateien;
höchstens ein decodierter Raum bleibt im Arbeitsspeicher. Der HTTP-Cache kann
bereits geladene Varianten wiederverwenden.

`tavern-room-02.mp3` bis `tavern-room-10.mp3` sind neun eigenständige
Neumischungen der oben dokumentierten, bereits verwendeten vier Aufnahmen.
Unterschiedliche Ausschnitte und Abschnittsfolgen, sanfte Raumfilter und
Stereobreiten, leise versetzte Raumanteile und sparsame Gläser-, Geschirr- oder
Lachdetails geben ihnen unterschiedliche Verläufe. Sie sind keine neuen
Aufnahmen aus neun anderen Lokalen. Die bisherige Kulisse und die drei
Detaildateien bleiben bytegenau unverändert. Musik, künstliche Stimmen und
Tonhöhenänderungen werden nicht ergänzt.

Die vollständigen Mischrezepte und technischen Messwerte stehen in
[`references/hausdepp-ambience-variants.json`](references/hausdepp-ambience-variants.json).
[`scripts/build_tavern_ambience.py`](../scripts/build_tavern_ambience.py)
erstellt die neun Mischungen reproduzierbar aus den vorhandenen Dateien mit
FFmpeg, ohne Netzabruf oder zusätzliche Projektabhängigkeiten.

## Bearbeitung

Bearbeitet mit FFmpeg 7.1 (`libmp3lame`), 44.1 kHz. Ein Hochpass bei 100 Hz
entfernt tiefes Rumpeln, ein Tiefpass bei 6 kHz rückt die Aufnahme in den
Hintergrund. `loudnorm` mit Ziel −23 LUFS / −7 dBTP / LRA 7 und ein Limiter
mit linearer Grenze 0.45 begrenzen Pegelspitzen. Die Zielnormalisierung ist
kein Lautstärkeversprechen für die Wiedergabe: Der Browser spielt die
Kulisse zusätzlich mit kleinem Gain ab, die Gerätelautstärke bleibt beim
System. Kurze, einzelne Glaskontakte haben naturgemäss viel Stille zwischen
den Spitzen und entsprechend einen niedrigeren Durchschnittspegel.

| Datei | Schnitt aus der Quelle | Nutzdauer | Kanäle / MP3-Bitrate | Dateigrösse | Decodierter Spitzenpegel |
| --- | --- | ---: | --- | ---: | ---: |
| `tavern-room.mp3` | 0.750–120.750 s; 3 s lineare Überblendung zwischen Ende und Anfang | 117 s | Stereo / 96 kbit/s | 1’404’700 Bytes | −7.2 dBFS |
| `glasses.mp3` | 2–10 s; 0.08 s Ein- und 0.6 s Ausblendung | 8 s | Mono / 80 kbit/s | 80’762 Bytes | −7.4 dBFS |
| `dishwasher.mp3` | 3–16 s; 0.15 s Ein- und 0.8 s Ausblendung | 13 s | Mono / 80 kbit/s | 130’656 Bytes | −7.1 dBFS |
| `laughter.mp3` | 3–11 s; 0.3 s Ein- und 1.2 s Ausblendung | 8 s | Mono / 80 kbit/s | 80’762 Bytes | −7.2 dBFS |

Die vier bisherigen Basisdateien zusammen: **1’696’880 Bytes**, etwa **1.62 MiB**. Die Containerdauer kann wegen
des MP3-Encoder-Paddings um einige Hundertstelsekunden abweichen. Beim
gapless Decodieren beträgt die Raumaufnahme genau 5’159’700 Samples je Kanal.

Die Raumüberblendung wird aus dem 120-s-Ausschnitt aufgebaut: Samples von
3 bis 117 s, gefolgt von einer 3-s-Mischung aus den letzten und ersten
3 Sekunden. Das Ende läuft somit in denselben Originalzeitpunkt über,
mit dem die Datei beginnt. Es wird keine kurze, auffällige Sequenz im
Sekundentakt wiederholt. Gläser, Geschirr und Lachen sind separate Details
für seltene, zeitlich versetzte Einsätze.

## Technische Prüfung und Integrität

Alle vier fertigen Dateien wurden vollständig mit FFmpeg decodiert; keine
Decoderfehler. Kanalzahl, Abtastrate, Nutzdauer, Dateigrösse und Spitzenpegel
wurden an den ausgelieferten Dateien geprüft. Das ersetzt keine akustische
Abnahme der Lautstärke und Mischung auf echten Lautsprechern oder Kopfhörern.

```text
SHA-256
3aac8d98b7f37c00a08645d6193e01d3203c63791c982499d45176274b06383b  tavern-room.mp3
9733bd5aaf1cac3e29df531033cc1b67f93990e12cc71e4c69c1694677da4d7a  glasses.mp3
2bbe62e430ec011c016abec7b132a8ee13bf31196ea6c0bccb82bbe6b9e94f42  dishwasher.mp3
3e750f23bfb80978dcfa691fb85610aa3cb802a446372c7ad588e1c118e756a2  laughter.mp3
```

## Technische Werte der neun Neumischungen

Jede neue Kulisse dauert 108 s: 44.1 kHz, Stereo, MP3 mit 96 kbit/s,
1’296’866 Bytes. Eine Aktivierung mit den drei Detaildateien lädt damit
1’589’046 Bytes (rund 1.52 MiB). Alle 13 ausgelieferten Audiodateien zusammen
belegen 13’368’674 Bytes (rund 12.75 MiB), werden aber nicht gemeinsam geladen.

| Datei | Mischung | Lautheit | Decodierter Spitzenpegel |
| --- | --- | ---: | ---: |
| `tavern-room-02.mp3` | Nebenraum | -23.48 LUFS | -7.334 dBFS |
| `tavern-room-03.mp3` | Fenstertisch | -23.52 LUFS | -7.499 dBFS |
| `tavern-room-04.mp3` | Hintere Stube | -23.50 LUFS | -7.305 dBFS |
| `tavern-room-05.mp3` | Gemuetliche Runde | -23.50 LUFS | -7.291 dBFS |
| `tavern-room-06.mp3` | Tresenseite | -23.50 LUFS | -7.276 dBFS |
| `tavern-room-07.mp3` | Ruhige Ecke | -23.49 LUFS | -7.394 dBFS |
| `tavern-room-08.mp3` | Am Stammtisch | -23.55 LUFS | -7.449 dBFS |
| `tavern-room-09.mp3` | Abendstube | -23.45 LUFS | -7.294 dBFS |
| `tavern-room-10.mp3` | Tisch am Rand | -23.54 LUFS | -7.234 dBFS |

Alle neun Dateien wurden vollständig und ohne Fehler decodiert. Jede enthält
exakt 4’762’800 Samples je Kanal. Der gemessene Pegelsprung am decodierten
Loop-Übergang liegt bei jeder Variante unter ihrem grössten inneren
Sample-Sprung. Die vier Basisdateien wurden per SHA-256 unverändert bestätigt.
Dies ist eine technische Assetprüfung, keine subjektive Hörabnahme und keine
Ausführung der Anwendungs-Testsuite.
