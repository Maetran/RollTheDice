# Watten – vertiefter Regelabgleich und Modimatrix

**Stand:** 16.10.2026, Europe/Zurich.

**Status:** Recherche; noch keine lückenlose, freigegebene Spielregel.

**Ausführungsnachtrag 18.10.2026:** Der Owner hat inzwischen die Umsetzung
freigegeben und konkrete 2-/3-/4-Profile, Standardoptionen und Nebenaktionen
festgelegt. Aktuell verbindlich ist das [Entscheidungsprotokoll](WATTEN_OWNER_DECISIONS.md).
Die folgenden Quellenvergleiche bleiben historischer Regelabgleich und
entscheiden keine dort noch offenen Grenzfälle.

**Produktvorgaben und Assets:** [WATTEN_RESEARCH.md](WATTEN_RESEARCH.md).

**Arbeitszweig:** `codex/watten-recherche`; keine Entwicklung, kein Release.

## 1. Antwort auf die Vollständigkeitsfrage

**Nein, die Regeln sind noch nicht für alle gewünschten Modi lückenlos klar.**
Der vorige Recherchestand war eine Sammlung von Regelbefunden und offenen
Fragen. Er war keine vollständige Regelspezifikation. Dieser zweite Abgleich
trennt die Varianten und benennt die verbleibenden Fälle ausdrücklich.

Der Produktanspruch ist verbindlich: **Ein festgelegter Modus muss jeden
erreichbaren Regelfall eindeutig entscheiden.** Ein fehlender Fall darf später
nicht durch eine spontane Auslegung von Oberfläche, Server oder CPU gelöst
werden. Unterschiedliche regionale Regeln sind unterschiedliche Profile;
innerhalb eines Profils gibt es keinen Ermessensspielraum.

Recherchiert wurden Betreiberregeln, Vereins- und Turnierreglemente,
Autoren-/Verlagsquellen und eine unabhängige Fachsammlung. Die Quellen wurden
online gelesen; das Verzeichnis nennt die konkrete Herkunft. Nicht behauptet
wird, dass sämtliche weltweit existierenden Watten-Regeln erfasst wären.

Vier Kennzeichnungen gelten im ganzen Dokument:

- **Vorgabe:** ausdrücklich vom Owner gewünscht; ersetzt keine noch fehlenden Details.
- **Belegt:** eine Quelle beschreibt genau diesen Fall in ihrem Profil.
- **Konflikt:** Quellen definieren verschiedene Ergebnisse; nicht vermischen.
- **Lücke:** mit der gelesenen Dokumentation noch nicht eindeutig entscheidbar.

## 2. Gewünschte Modi und klare Begriffe

### Produktumfang aus dem Gespräch

| Modus / Kombination | Vorgabe | Wissenslage im beschriebenen Viererspiel |
| --- | --- | --- |
| Ladinisch, blind | Unterste Handkarten bestimmen Schlag/Trumpf; üblicher Grundmodus. | Die beiden Einschauer kennen die Kombination, die Partner erschliessen sie. |
| Ladinisch mit Kritischen | Als zusätzliche Kartenvariante berücksichtigen. | Verdeckte Ansage bleibt verdeckt; feste Kritische ändern Kartenstärken. |
| Nicht ladinisch, offen | Reguläre Ansage und reguläres Einsatzbieten berücksichtigen. | Schlag und Trumpf öffentlich bekannt. |
| Offen mit Kritischen | Die Kombination der gewünschten Varianten prüfen und vollständig beschreiben. | Öffentliche Ansage, zusätzliche feste hohe Karten; noch kein freigegebenes Vollprofil. |
| Zwei und drei Spieler | Echte eigene Varianten, jeweils mit Menschen und geplanten CPUs. | Keine automatische Übertragung der Viererrollen. |

Die letzte offene Viererkombination ist aus der gewünschten Kombinierbarkeit
abgeleiteter Prüfbedarf, keine zusätzliche behauptete Hausregel.

**Begriffe getrennt halten:**

1. **Schlag-/Trumpfansage:** bestimmt Kartenwert und Farbe.
2. **Ladinische Bestimmung:** diese Auswahl wird durch eine feste Handkarte ersetzt.
3. **Blind/offen:** wer die bestimmte Kombination kennt.
4. **Bieten:** erhöht den Einsatz einer Runde; Halten und Gehen beantworten das Gebot.
5. **Kritische/Guter:** verändern die Kartenhierarchie.

Die Verlagsquelle unterscheidet Blind, Offen und zufälliges Ladinisch und
bestätigt auch kleinere Spielerzahlen, liefert dafür aber keine Vollregeln.
[W15] (gedruckte S. 15–16)

UltraWatten dokumentiert kombinierbare Einstellungen für Ladinisch, Blind,
Kritisch und Guten. Damit sind es dort getrennte Achsen. Seine App nennt für
Ladinisch allerdings die **oberste** Karte. Das ist kein Grund, unsere
ausdrücklich vorgegebene unterste Handkarte zu ändern. [W05] (Varianten)

**Zusätzlicher Vergleich, kein still gewählter Produktmodus:** Die frei gewählte,
geheim gezeigte Ansage von watten.org unterscheidet sich von der ladinischen
Zufallsbestimmung. Ähnliche Variantenbezeichnungen machen die Verfahren nicht
identisch. [W01] (Spielregeln), [W19]

## 3. Trumpfzwang: Auslöser, verpflichtete Spieler, geschützte Karten

**Owner-Vorgabe:** Beim Blindwatten besteht für die beiden Einschauer
Trumpfzwang, mit Ausnahme des Rechten und allenfalls Kritischer. Die Pflicht
darf in einer späteren Umsetzung nicht als freiwillige Empfehlung behandelt
werden. Eine genauere Definition der Ausnahmen muss diese Vorgabe erhalten.

Zwei verschiedene Fragen müssen getrennt beantwortet werden:

- **Auslöser:** Welche zuerst ausgespielte Karte verpflichtet nachfolgende Spieler?
- **Zugabemenge:** Welche eigenen Karten müssen oder dürfen darauf gespielt werden?

«Den Rechten muss ich nicht hergeben» bedeutet deshalb nicht automatisch
«Wenn der Gegner den Rechten ausspielt, muss ich keinen Trumpf zugeben».

| Belegtes Profil | Auslöser | Wer muss bedienen? | Eigene Ausnahmen / Alternative |
| --- | --- | --- | --- |
| Tiroler Wattergemeinschaft, ladinisch [W02] (Trumpfzugabe) | Trumpf als erste Karte eines Stiches, unabhängig vom Ausspieler. | Nur beide Wissenden, sofern Trumpf vorhanden. | Gute/Rechte müssen nicht zugegeben werden; alternativ mit Schlag etc. stechen. |
| Café Weli / FC Wacker [W04] | Trumpf, Rechter oder Guter wird ausgespielt. | Beide Ansager. | Gute/Rechte müssen selbst nicht zugegeben werden; höherer Trumpf kann stechen. |
| Club Tirol [W03] (Nr. 14) | Trumpfausspiel. | Beide Ansager. | Gute/Rechte müssen selbst nicht zugegeben werden. |
| watten.org [W01] (Trumpf zugeben) | Trumpf eröffnet einen Stich; beim Guten ausdrücklich variabel. | Schlag- und Trumpfansager. | Trumpf bedienen oder mit Schlag stechen; bei fehlender Möglichkeit frei. |
| NewTec-Hausversion [W18] (Spielen/Spielvarianten) | Trumpfausspiel; Guter als Auslöser gesondert einstellbar. | Beide Nichtblinden. | Rechter/Guter müssen nicht geopfert werden. |
| Offenes Wattkönig-Turnier [W11] (Nr. 16) | Rechter oder Trumpf wird ausgespielt. | Die Spieler des offenen Profils. | Regel nennt Pflicht; daraus keine zusätzlichen Schutzkarten erfinden. |
| Tiroler Kritisch-Profil bei Pagat [W17] (Watten mit Kritischen) | Ausgespielter Kritischer löst dort keine Trumpfbedienung aus. | Nachfolgende Spieler dürfen dann frei spielen. | Das ist eine Aussage über den Auslöser, kein vollständiger Beleg für jede Antwort auf gewöhnlichen Trumpf. |

**Bereits belastbar im gewünschten Blindprofil:** Trumpfzwang ist an
Stichanfang und Rolle gebunden.
Er bedeutet nicht allgemein Farbzwang in jeder Farbe oder Pflicht, jeden
möglichen Stich zu übernehmen. Pagats Tiroler Abschnitt beschreibt ausdrücklich
Zugeben ohne allgemeine Übernahmepflicht. [W17] (Das Spiel)

**Noch nicht vollständig belegt für unsere Kritisch-Kombination:**

- Darf ein Kritischer beim gewöhnlichen Trumpfausspiel freiwillig stechen,
  obwohl ein gewöhnlicher Trumpf vorhanden ist?
- Bleibt nach einem kritischen Überstich die zuvor ausgelöste Pflicht für
  die weiteren Spieler bestehen?
- Was gilt, wenn nur geschützte hohe Karten, aber kein gewöhnlicher Trumpf
  und kein sonst erlaubter Stecher vorhanden sind?
- Welche nichttrumpfigen Schläge dürfen statt Trumpf gespielt werden, wenn
  damit der bereits führende Stich nicht mehr übernommen werden kann?

Diese Fälle sind nicht durch die Formulierung «Trumpfzwang ausser Rechter»
allein entschieden. Eine Quellenlücke ist hier keine freie Wahl für die CPU.

### Die bayerische Erststich-Regel gesondert halten

Eine bayerische Turnieranleitung verlangt bei Rechtem als erster Karte des
ersten Stiches «Trumpf oder Kritisch»; nach kritischem Überstich entfällt die
Pflicht für die weiteren Spieler. Das ist ein anderes Regelpaket als die
Zugabe bei jedem Trumpfstich im Tiroler Blindprofil. [W23] (Spielablauf)

Trumpfstich beschreibt zusätzliche Sonderfälle für Partner und eine Haube,
die zugleich kritisch wäre. Diese digitale bayerische Auslegung nicht als
fehlendes Teilstück unserer Tiroler Regel einsetzen. [W24] (trumpf oder kritisch)

## 4. Kartenstärken und Kritische

| Quellenprofil | Hierarchie / wesentliche Grenze |
| --- | --- |
| Tiroler Wattergemeinschaft mit Gutem [W02] (Kartenwertigkeit) | Guter > Rechter > übrige Schläge > übrige Trümpfe > Weli als kleinster Trumpf > angespielte Farbe. Gleich hohe Linke: zuerst gelegte gewinnt. Nach Ass ist die Trumpf-7 gut; bei Weli-Schlag kein Guter. |
| UltraWatten, kritisch [W05] (Kritisch/mit Gutem) | Herz-König > Schellen-6/Weli > Eichel-7; alle drei stehen auch über einem aktivierten Guten. Guter und Kritische sind dort kombinierbar. |
| Bayerische Verlagsregel [W16] (gedruckte S. 15) | Die drei Kritischen sind Herz-König, Schellen-7 und Eichel-7. Das zweite Blatt ist somit ein anderes als beim genannten Tiroler Profil. |
| Offenes Wattkönig-Profil [W11] (Nr. 2, 17) | Ohne Guten; Weli nur in Schellen Trumpf, bei Weli-Schlag Rechter. |

**Korrektur einer möglichen Fehlannahme:** «Kritisch» ist weder eine
überall gleiche Kartenliste noch automatisch «ohne Guten». Die App von
UltraWatten unterstützt die Kombination ausdrücklich. [W05]

Hubert Auer beschreibt ladinisches Watten einschliesslich lokaler Varianten
mit Gutem, Obergutem, Schlechtem und Kritischen; als Kritische nennt er
Herz-König, Weli und Eichel-7. Er bezeichnet den Hausbrauch als massgeblich.
Das belegt die Existenz der Kombination, aber nicht sämtliche Kollisionsfälle.
[W14] (PDF-Seite 3)

### Kollisionen, die ein endgültiges Profil entscheiden muss

| Beispiel / Fall | Verbindlich zu bestimmendes Ergebnis |
| --- | --- |
| Herz ist Trumpf, Könige sind Schlag, Herz-König ist kritisch. | Behält er vollständig seine kritische Rolle? Existiert daneben ein gewöhnlicher Rechter? |
| Der rechnerische Gute wäre Eichel-7 oder Herz-König und damit kritisch. | Kein zusätzlicher Guter, nächste nichtkritische Karte oder andere belegte Regel? |
| Die feste unterste Schlagkarte ist Weli und Weli ist kritisch. | Wie bestimmt dieses konkrete Ladinisch-Kritisch-Profil den Schlag? |
| Ein kritisches Blatt hat zugleich den Schlagrang. | Zählt es nur als Kritischer oder zusätzlich für andere Regelprüfungen? |

Pagats Grunddarstellung nimmt kritische Karten aus gewöhnlichem Schlag/Trumpf
heraus und dokumentiert Beispiele ohne gewöhnlichen Hauptschlag. Sein
Tiroler Kritisch-Abschnitt verbietet Sechs als frei gewählten Schlag.
Damit ist die automatische unterste-Weli-Ansage beim Ladinisch-Kritisch noch
nicht geregelt. [W17] (Spieler und Karten; Watten mit Kritischen)

Die Modi werden deshalb nicht schon durch vier Optionsnamen vollständig.
Die Kreuzung der Regeln muss ebenso eindeutig sein wie jede einzelne Option.

## 5. Bieten, Halten, Gehen und gestrichen

### Reguläres Einsatzbieten

watten.org beschreibt zwei Punkte als Ausgangswert und abwechselnde Erhöhungen auf
drei, vier, fünf usw. Bei Halten gilt der neue Wert; bei Gehen gewinnt der
Bieter den bisherigen. Die Runde pausiert für die Antwort. [W01] (Bieten)

Das offene Spiel bedeutet nicht automatisch einen anderen Bietmechanismus.
Es ändert zunächst die Schlag-/Trumpfansage und die Information der Spieler.
NewTec beschreibt offen zuerst Schlag, dann Farbe, blind dagegen gleichzeitig.
[W18] (Offen/Blind)

**Owner-Vorgabe bleibt:** «Gestrichen darf man nichts mehr sagen.» Für dieses
Projekt darf ein Quellenprofil nicht ungefragt wieder ein eigenes Erhöhen
erlauben. Bietverbot, notwendige Antwort auf ein gegnerisches Gebot und normale
Chatnachricht sind trotzdem getrennte Aktionen. Die Quellen belegen kein
einheitliches vollständiges Sprachverbot.

### Unterschiedliche feste Gestrichen-Regeln

| Quelle | Regel im jeweiligen Profil | Verhältnis zur Produktvorgabe |
| --- | --- | --- |
| TWG [W02] (Wattrunden/Bieten) | Ziel minus zwei oder eins; bei elf also neun/zehn; kein eigenes Ansagen/Bieten. | Passender Beleg für ein striktes Bietverbot. |
| Club Tirol [W03] (Nr. 17–18) | Neun/zehn; kein Bieten; kein automatisches Drei für Gegner. | Strikt, keine automatische Drei ableiten. |
| watten.org [W01] (Gestrichen) | Automatische Vier bei gestrichen und mindestens vier Punkten Abstand; bei Ablehnung zwei, regional drei Punkte. | Eigenes Regionalprofil, nicht still unser Standard. |
| Wattkönig [W11] (Nr. 13–15) | Bis fünfzehn, Bietverbot ab dreizehn; automatische Vier bei gestrichenem Gegner und mindestens vier Punkten Rückstand; Ablehnung zwei. Zusätzlich freiwillige Vor-Vier. | Ziel und Zusatzregeln unterscheiden sich. |
| Telfs [W12] (Nr. 14–17) | Bis elf, neun/zehn gestrichen; nur Drei verboten, höhere Gebote erlaubt. | Widerspricht unserer strengeren Vorgabe; nicht übernehmen. |
| Josefi/Anras [W13] (Nr. 17–19) | Ebenfalls elf und neun/zehn; nur Drei verboten, höhere Gebote erlaubt. | Derselbe relevante Widerspruch, trotz Tiroler Veranstalterquelle. |

Die Zielverschiebung beim Wattkönig ist kein fertiger Beweis, dass sein
gesamtes Fünfzehner-Reglement unverändert in unsere Elferpartie gehört.

### Zeitpunkte und letzte Karte

- TWG lässt im ersten Stich eine Antwort bis zu dessen Ende warten; sonst
  ist Bieten während der Runde möglich. [W02] (Bieten)
- Club Tirol erlaubt das erste Gebot erst nach dem ersten Stich. [W03] (Nr. 15)
- Wattkönig verlangt beim Bieten nach der letzten Ausspielkarte passende
  Farbe, Trumpf oder Schlag; bei Trumpf/Schlag als Ausspiel ist Trumpf/Schlag
  nötig. [W11] (Nr. 18)
- Telfs nennt eine eigene Liste erlaubter Kombinationen. Diese nicht aus
  ähnlichen Wörtern als identisch behandeln. [W12] (Nr. 17)

**Noch festzulegen:** zulässiger erster Zeitpunkt, Reihenfolge bei offener
Antwort, Gegengebot, Ende nach dem dritten Teamstich und erlaubte Handlungen
gestrichener Spieler. Gleichzeitige Onlineaktionen haben noch keinen
freigegebenen Ablauf. Das ist spätere Spezifikation, keine jetzt gestartete
Implementierung.

## 6. Zwei und drei Spieler

### Zweierwatten

Zwei Personen spielen gegeneinander; watten.org dokumentiert diesen Modus
ausdrücklich. Beide beteiligen sich an der Ansage. [W01] (Spielregeln)

Auer beschreibt fünf Handkarten, drei Stiche zum Rundensieg, zwei
Ausgangspunkte und Drei-Bieten; meist elf mit neun/zehn gestrichen.
[W14] (PDF-Seite 2)

**Eigene Schlussfolgerung:** Ohne zusätzliche Partner ist kein dritter oder
vierter Sitz blind. Ob Schlag und Farbe gleichzeitig geheim gewählt oder
nacheinander öffentlich angesagt werden, kann trotzdem einen taktischen
Unterschied machen; NewTec beschreibt diesen Unterschied ausdrücklich.
[W18] (Offen/Blind)

Das genaue Zweierprofil muss daher weiterhin Ansageverfahren, Reihenfolge
und die gewünschte Kritisch-Kombination benennen.

### Drei unvereinbare Dreiermodelle

| Profil | Belegt | Noch fehlende Details |
| --- | --- | --- |
| Rotierendes Solo | Bayerisches Fünfkarten-Profil: Rohrmayer nennt Vorhand allein gegen die beiden anderen. [W16] (S. 14) Pagat ergänzt: Vorhand bestimmt Schlag und Farbe, jeder Gegenpartner schreibt bei Sieg die Rundenpunkte aufs eigene Konto. [W17] (Zwei oder drei Spieler) | Vollständiger Tiroler Blind-/Ladinisch-Ablauf und Gestrichen bei wechselnden Parteien. |
| Fünf Karten, Team erst beim Gebot | UltraWatten: zunächst jeder für sich, Geberfarbe/Nachbarschlag; erster Bieter wird Solist, beide anderen antworten einzeln. Ohne Gebot drei Stiche zum Sieg; bei 2:2:1 je ein Punkt für beide Zweier. [W10] | Nur ein Gegner geht, Gegengebote, Wertung nach gehaltenem Gebot, Zurechnung früherer Stiche, drei getrennte Gestrichen-Zustände. |
| Sieben Karten, jeder gegen jeden | Watten Südtirol: sieben pro Person, getrennte Konten; ein haltender Gegner genügt zur Fortsetzung nach einem Gebot. [W20] (Variante 1) | Stichziel, Gleichstände und vollständige Wertung fehlen. |

Watten Südtirol beschreibt daneben Solo gegen zwei, enthält beim Übergang
zum nächsten Geber aber eine widersprüchliche Rollenbeschreibung. Nicht
stillschweigend eine Rotation daraus rekonstruieren. [W20] (Variante 2)

**Konsequenz:** Die drei Modelle sind keine austauschbaren Erläuterungen
derselben Regel. Für das Produkt ist zunächst eines als konkrete Dreierregel
zu bestimmen. Quellen zu Fünfkarten-Solo dürfen keine Lücken des
Siebenkarten-Einzelspiels füllen.

Die freie Bestimmung beider Ansagekomponenten durch einen Solisten ist auch
nicht bereits mit den zwei ladinischen Einschauerrollen vereinbar. Diese
Verknüpfung benötigt eine eigene belegte Regel oder ausdrückliche Hausvorgabe.

Freie Teamwahl vor Beginn ist für die feste Viererpartnerschaft vorgemerkt.
Bei rotierendem Dreiersolo entstehen Parteien regelbedingt neu; die
Teamwahl-Anforderung braucht dafür eine ausdrückliche fachliche Zuordnung.

## 7. Weitere Fälle mit Auswirkungen auf Taktik und verborgenes Wissen

| Regelbereich | Dokumentierte Unterschiede und Quelle |
| --- | --- |
| Reststapel ansehen | watten.org gewährt dem Geber oberen/unteren Reststapelblick. [W01] Telfs verbietet diesen Blick [W12] (Nr. 9), Josefi erlaubt ihn einmal [W13] (Nr. 11). Nicht mit dem untersten Handkartenblick verwechseln. |
| Reihenfolge und erneutes Einschauen | Club Tirol fixiert unterste = erste Handkarte und verbietet erneutes Informieren nach dem ersten Ausspiel. [W03] (Nr. 8) |
| Erster Stich | Club Tirol lässt ihn die ganze Runde offen [W03] (Nr. 16); UltraWatten nur bis nach dem zweiten [W07]. |
| Partnerblatt | Wattkönig erlaubt einmaliges Ansehen nach der Ansage [W11] (Nr. 7); Telfs vereinbart Deuten oder einmaliges Anschauen [W12] (Nr. 24). Das gehört nicht automatisch zum Blindprofil. |
| Kommunikation | TWG erlaubt beim Bieten allgemeine Blattbewertung, nennt die Grenze selbst unscharf [W02] (Wichtig). Club Tirol verbietet konkrete Karteninformation/Handlungsbefehle [W03] (Nr. 21). Für unser Profil muss die Grenze genauer sein. |
| Schönere / Schlagtausch | watten.org kennt beides und auch Nullansagen [W01]; Wattkönig verlangt eine Ansage [W11] (Nr. 5). Eure ladinische Zwangsbestimmung darf dadurch nicht unbemerkt zur freien Auswahl werden. |
| Gestrichene Partei antwortet | Eure Vorgabe wird eingehalten; welche Halten-/Gehen-Antworten noch nötig und erlaubt sind, ist getrennt von einem eigenen Gebot festzulegen. |
| Abheben / Fehlgeben | Paketfolge, allfälliges Behalten Kritischer beim Abheben, falsche Handzahl und Neustart je Profil vollständig festlegen; keine bayerische Schleck-Regel allein wegen «kritisch» importieren. |
| Rundenschluss / Gesamtspiel | Einmalige Wertung, sofortiges Ende bei erreichtem Ziel, Gleichstände mehrerer Dreierkonten und Abbruch sind noch Bestandteil der Vollspezifikation. |

## 8. Was der vertiefte Abgleich geklärt hat

- Die verlangten Regelachsen sind real dokumentiert; ein pauschales
  «Ladinisch = blind = ohne Kritische» ist für den Produktumfang unbrauchbar.
- Die beiden Einschauer unterliegen einer echten Trumpfzugabepflicht.
  Schutz hoher eigener Karten und auslösendes Ausspiel sind verschiedene Fälle.
- Mit Kritischen ändern sich feste Kartenidentitäten und Kollisionsfälle;
  reine Bild- oder Namensvarianten sind das nicht.
- Reguläre Schlag-/Trumpfansage und Einsatzbieten sind unterschiedliche
  Vorgänge. Offenheit allein ersetzt die Bietregeln nicht.
- Mehrere offizielle Reglements widersprechen sich. Eine einzelne Quelle
  als «die Watten-Regel» zu bezeichnen würde falsche Sicherheit schaffen.
- Zweier ist gut belegt, Dreier hat mehrere echte konkurrierende Modelle.

Die Aussagen sind Schlussfolgerungen aus den oben einzeln verlinkten
Befunden, keine zusätzliche Regelauswahl durch den Recherchierenden.

## 9. Restentscheidungen vor einer lückenlosen Regelfassung

| Entscheidung / Abschluss | Was danach eindeutig feststehen muss |
| --- | --- |
| Profilumfang | Welche Ansage-/Sichtbarkeitskombinationen werden angeboten, für welche Spielerzahl sind sie vollständig definiert? Freies Blindansagen zusätzlich oder nur als Vergleich? |
| Hohe Karten | Guter je Modus an/aus; genaue Kritischenliste und Reihenfolge; Weli; alle Überschneidungen mit Rechtem/Gutem. |
| Vollständige Zugaberegel | Auslöser, betroffene Sitze, erlaubte Antwortkarten, geschützte Karten, kritischer Überstich. |
| Bieten und gestrichen | Feste Verbote, Antwortrechte, automatische Angebote oder deren Ausschluss, genaue Zeitpunkte und letzte Karte. |
| Dreierprofil | Eines der belegten Modelle vollständig wählen; dessen Rollen/Wertung/Wissen schliessen. |
| Sichtbarkeit und Nebenaktionen | Reststapel, Partnerkarten, Stichhistorie, erneutes Einschauen, Schönere, Schlagtausch, Nullansage und Kommunikation. |

Für die spätere Abnahme sind Beispielhände zu jedem Grenzfall vorzusehen:
Trumpfausspiel bei nur geschütztem Rechten; kritischer Überstich; rechnerischer
Guter zugleich kritisch; Weli unterster Schlag im Kritisch-Ladinisch;
Gebot gestrichener Partei; beide gestrichen; letztes Ausspiel; sowie die
zugehörigen Fälle mit zwei oder drei Spielern. Dies sind dokumentierte
Prüffälle, keine jetzt entwickelten Tests.

## 10. Quellenverzeichnis und Aussagegrenzen

Die Kennungen verlinken direkt auf die gelesenen Quellen. Abschnitte bzw.
Nummern stehen bei den jeweiligen Befunden. Kopien und Wikipedia-Spiegel
wurden nicht als zusätzliche unabhängige Belege gezählt.

| Kennung | Quelle | Art / Grenze |
| --- | --- | --- |
| [W01] | watten.org, Hilfe | Betreiberregel; besonders wichtig; selbst mit regionalen Optionen, kein vollständiges Dreier-/Kritisch-Reglement. |
| [W02] | Tiroler Wattergemeinschaft, Ladinisch | Vereinsregel; Bietbeispiel schreibt widersprüchlich dem gehenden Team Punkte zu. |
| [W03] | Club Tirol, Turnierregeln 24.11.2023 | Präzises ladinisches Turnierprofil; kein universelles Reglement. |
| [W04] | FC Wacker / Café Weli, 09.07.2012 | Historisches Ladinisch-Profil mit Gutem. |
| [W05] | UltraWatten, App-Optionen | Betreiber erklärt konkrete Kombinierbarkeit; nicht sämtliche Randfälle. |
| [W07] | UltraWatten, Ladinisch | Eigenes Verfahren; unterscheidet sich auch beim Anschauzeitpunkt. |
| [W10] | UltraWatten, zwei/drei Spieler | Eigenes Dreiermodell; mehrere Fortsetzungsfälle nicht beschrieben. |
| [W11] | Wattkönig, Regeln | Verbindliches offenes Turnierprofil, bis fünfzehn. |
| [W12] | Preiswatten Telfs, Regeln | Tiroler Turnierprofil, bis elf; anderes Gestrichen-Verbot. |
| [W13] | Josefi/Anras, Regeln 2024 | Weiteres Tiroler Veranstalterprofil. |
| [W14] | Hubert Auer, «Das alte Tiroler Kartenspiel Watten, ein Kulturgut» | Autorenquelle beim Veranstalter, besonders PDF-Seiten 2–3. |
| [W15] | Eva Marini, «So spielen wir in Südtirol», Verlagsleseprobe | Unterscheidet Varianten; keine Detailregeln kleinerer Spielerzahlen. |
| [W16] | Erich Rohrmayer, «Lerne Watten», Verlagsleseprobe | Ausdrücklich bayerisch; Probe enthält nicht die späteren Zugabe-/Bietkapitel. |
| [W17] | Pagat, Watten | Unabhängige Fachsammlung, mit benannten regionalen Informanten; keine einheitliche Tiroler Norm. |
| [W18] | NewTec, eigene praktizierte Südtiroler Spielanleitung | Deklariertes Hausprofil; nennt Weli-Schlag sprachlich ohne Rechten, anders als watten.org. |
| [W19] | Watten Südtirol, Ladinisch | Beschreibt Zufallsansage aus Handkarten; einzelne FAQ-Formulierung unpräziser als Haupttext. |
| [W20] | Watten Südtirol, zwei/drei Spieler | Konkurrierende Dreiermodelle; widersprüchlicher Rollenwechsel im Soloabschnitt. |
| [W21] | Euregio, Watt-Karten | Öffentliche Regionalanleitung; erklärt regionale Varianten selbst ausdrücklich. |
| [W22] | Tirol Werbung, Tiroler Spiele | Nennt kritisch-ladinisch als Kombination; keine Vollregeln. |
| [W23] | KLJB Peising, Turnieranleitung März 2024 | Bayerischer Verein; Erststich-Zwang, kein Tiroler Blindprofil. |
| [W24] | Trumpfstich, Regeln | Digitale bayerische Eigenregel; besondere Hauben-Kollision nicht übertragen. |

Euregio bestätigt ebenfalls Blindrollen, Trumpfzugabe der Ansager und ein
Bietverbot gestrichen; die Anleitung weist selbst auf örtliche Unterschiede
hin. Sie ersetzt daher keine fehlende eindeutige Regelkreuzung. [W21]
Tirol Werbung nennt «kritisch ladinisch» ausdrücklich, liefert dazu jedoch
keine Detailmechanik. [W22]

Die bestehende Erstquelle Innsbruck Tourismus wurde bereits im ersten
Durchgang gelesen. Die konkrete Vertiefung stützt sich für die strittigen
Regelfälle auf die oben präziseren Reglements.

**Designentscheidung:** Alle externen Seiten dienen ausschliesslich als
Regel-/Vergleichsquellen. Die identischen Hausdepp-Kartendesigns bleiben
vorgegeben. Kartenbilder und Layout von watten.org werden nicht übernommen.

**Prüfung dieses Dokumentationsstands:** Drei unabhängige Gegenprüfungen
für Quellen/Modi, watten.org und Zweier-/Dreierregeln; Quellenreferenzen und
lokale Dokumentlinks geprüft. `npm run check:quality` einschliesslich Lint
und Sicherheitschecks bestanden. Die bestehenden Backend-Vertragstests für
Navigation und Produktversion bestehen mit 16 Tests und 115 Subtests.
Browser-Tests entfallen bei dieser reinen Dokumentationsänderung.

**English brief:** The rules are not yet complete for every requested mode.
This audit separates fixed rule profiles, dealing/announcement methods,
hidden information, trump obligations, critical cards, bidding and player
counts. Conflicting published variants are not combined into invented rules.
The existing Hausdepp card designs remain required. No development has begun.

[W01]: https://www.watten.org/hilfe
[W02]: https://www.tiroler-wattergemeinschaft.at/ladinisch-watten/
[W03]: https://clubtirol.net/rte/upload/news/einzelbilder_zu_veranstaltungen/watterregeln_fuer_unser_ladinisches_watterturnier.pdf
[W04]: https://fc-wacker-innsbruck.at/2012/07/09/wacker-watter-turnier/
[W05]: https://www.ultra-watten.com/app-fuer-ios-android
[W07]: https://www.ultra-watten.com/watten-regeln/ladinisch-watten
[W10]: https://www.ultra-watten.com/watten-regeln/watten-zu-zweit-oder-zu-dritt
[W11]: https://www.wattkoenig.it/de/spielregeln.html
[W12]: https://www.preiswatten-telfs.at/spielregeln.html
[W13]: https://www.josefi-preiswatten.at/files/Spielregeln.pdf
[W14]: https://www.josefi-preiswatten.at/files/Kulturgut.pdf
[W15]: https://www.athesia-tappeiner.com/sites/default/files/datenblatt/so_spielen_wir_in_suedtirol_9788868397913_leseprobe.pdf
[W16]: https://www.battenberg-bayerland.de/uploads/produkt/lerne-watten/lerne-watten-leseprobe-2022-04-20-104501.pdf
[W17]: https://www.pagat.com/de/trumps/watten.html
[W18]: https://www.newtec-audio.com/spielanleitung-watten/
[W19]: https://watten-suedtirol.com/varianten/ladinisch-watten/
[W20]: https://watten-suedtirol.com/2er-watten-oder-3er-watten/
[W21]: https://www.europaregion.info/euregio/aktuelles/gadgets/euregio-watt-karten/
[W22]: https://www.tirol.at/reiseservice/tiroler-spiele
[W23]: https://kljb-peising.de/clubdesk/fileservlet?id=1000186&s=djEtlpWNfTzjuYZP1MFGw1OT_fpGdVZjfWZBq-8jO-kO0ac%3D&type=file
[W24]: https://trumpfstich.de/rules.html
