# Zilch-Regelvertrag (intern)

Stand: `zilch-house-v1`. Dieses Dokument ist der verbindliche Regelvertrag für
die serverseitige Engine. Zilch ist öffentlich: Gäste und aktive Konten können
spielen. Gäste erhalten bewusst keine kontogebundene Historie, Statistik,
Ranglistenposition oder Erfolge. Persönliche Routen bleiben `noindex`; die
Zilch-Lobby und die Regelseite auf der Zilch-Subdomain sind canonical und
indexierbar.

## Begriffe

| Deutsch | English | Bedeutung |
| --- | --- | --- |
| Wurf | roll | Ein serverseitig erzeugtes Ergebnis für alle freien Würfel. |
| Halten | hold | Verbindlich ausgewählte Wertungswürfel; Halten kann nicht zurückgenommen werden. |
| Rundenpunkte | unbanked round points | Punkte eines noch nicht angeschriebenen Zuges. |
| Anschreiben / Sichern | bank | Rundenpunkte dauerhaft zum Gesamtstand hinzufügen. |
| Zilch | Zilch / no-score turn | Zugverlust; ungesicherte Punkte verfallen. |
| Bestätigungswurf | confirmation roll | Nach einer bestimmten starken Wertung erforderlicher weiterer Punktewurf. |
| Hot Dice | Hot Dice / free roll | Alle sechs physischen Würfel wurden gehalten; sie werden wieder frei, die Rundenpunkte bleiben bestehen. |
| Straße | straight | Einmal 1–6. |
| Drilling | three of a kind / triple | Drei gleiche Würfel als Wertungsgruppe. |
| Drei Paare | three pairs | Drei verschiedene Paare in einem Sechs-Würfel-Wurf. |

## Verbindliche Wertung

Es werden immer sechs Würfel verwendet; das Ziel beträgt mindestens 10.000
Punkte.

| Wertung | Punkte | Regel |
| --- | ---: | --- |
| Einzelne 1 | 100 | Jede einzeln gehaltene 1. |
| Einzelne 5 | 50 | Jede einzeln gehaltene 5. |
| Drei 1en | 1.000 | Ein Drilling; löst einen Bestätigungswurf aus. |
| Drei gleiche 2–6 | Augenzahl × 100 | Beispielsweise drei 4en = 400. |
| Vier gleiche 2–6 | doppelter Drillingwert | Beispielsweise vier 4en = 800. |
| Fünf gleiche 2–6 | vierfacher Drillingwert | Beispielsweise fünf 4en = 1.600. |
| Sechs gleiche 2–6 | achtfacher Drillingwert | Beispielsweise sechs 4en = 3.200; alle sechs lösen Hot Dice aus. |
| Vier oder mehr 1en | keine eigene Gruppe | Bei Einsen bleibt der 1.000-Punkte-Drilling; zusätzliche 1en zählen einzeln mit 100, aber Vierlinge oder mehr entstehen nicht als Wertungsgruppe. |
| Straße 1–6 | 2.000 | Alle sechs Würfel. |
| Drei Paare | 1.500 | Alle sechs Würfel, drei Paare. |
| Zwei Drillinge | Summe beider Drillinge | Beispielsweise 3×2 und 3×4 = 600. |
| „500 für nichts“ | 500 | Nur bei sechs freien Würfeln ohne sonstige wertbare Kombination, etwa 2-2-3-4-6-6. Dies ist **kein** Zilch. |

Es gibt in dieser Regelversion keine weiteren Sonderkombinationen.

### Auswahl und Kombination

- Der Spieler darf jeden gültigen, punktenden Teil eines Wurfs halten. Er darf
  etwa bei 3×5 nur eine 5 für 50 halten oder den Drilling für 500.
- Werden drei bis sechs gleiche 2–6 gemeinsam gehalten, zählen sie zwingend
  als eine passende Wertungsgruppe und nicht als einzelne Würfel oder mehrere
  Drillinge. Ab dem vierten Würfel verdoppelt sich der jeweilige Drillingwert
  pro zusätzlichem Würfel.
- Drei 1en zählen zwingend als 1.000-Punkte-Drilling. Weitere gleichzeitig
  gehaltene 1en zählen weiterhin einzeln mit 100; Vierlinge oder mehr haben
  keine eigene Mehrlingswertung.
- Ein bereits bestätigter Hold ist endgültig; es gibt keine Unhold-Aktion.
- Mehrere wertende Gruppen dürfen gemeinsam gehalten werden, zum Beispiel
  3×1 (=1.000) plus zwei weitere einzelne 1en (=200). Die Engine liefert auch
  kombinierte Auswahloptionen.

Beispiele:

- `5-5-5-5-2-3`: ein Drilling 5 = 500; alle vier 5en zusammen = 1.000; nur
  eine 5 = 50.
- `1-1-1-5-5-2`: drei 1en und zwei einzelne 5en = 1.100. Wegen der drei 1en
  folgt ein Bestätigungswurf.
- `1-2-3-4-5-6`: Straße = 2.000. Alle Würfel sind gehalten, daher Hot Dice
  und ein Bestätigungswurf.
- `2-2-3-4-6-6`: „500 für nichts“ = 500. Alle Würfel werden danach für
  denselben Spieler wieder frei; auch hier ist ein Bestätigungswurf nötig.

## Zugablauf, Risiko und Sichern

1. In `multiplayer` und `cpu` würfeln die Teilnehmer vor Spielbeginn jeweils
   einmal. Der höhere Wert beginnt; bei Gleichstand wird erneut gewürfelt.
   Jeder Startwurf wird ausschließlich serverseitig erzeugt. In einer
   CPU-Partie würfelt zuerst der Mensch; der serverseitige CPU-Runner erzeugt
   danach den gleichwertigen CPU-Wurf. Im Solo-Sprint gibt es bewusst keinen
   bedeutungslosen Startwurf: der einzige Mensch beginnt direkt mit seinem
   ersten normalen Zug.
2. Der aktive Teilnehmer würfelt ausschließlich auf dem Server alle noch
   freien Würfel und hält anschließend mindestens eine gültige Wertung.
3. Nach dem dritten Wurf müssen insgesamt mindestens 300 Rundenpunkte
   verbindlich gehalten sein. Ist das mathematisch nicht mehr möglich, tritt
   sofort Zilch ein. Gibt es eine erreichbare 300er-Auswahl, liefert der Server
   ausschließlich diese gültigen Fortsetzungs-Holds statt einer kleineren,
   unzulässigen Auswahl.
4. Anschreiben ist ab 400 Rundenpunkten möglich, solange kein
   Bestätigungswurf offen ist. Ein erfolgreiches Anschreiben überträgt die
   Punkte dauerhaft und setzt die eigene Zilch-Serie zurück.
5. Es gibt kein gewöhnliches Wurflimit: Nach erfüllter 300er-Regel darf der
   Spieler weiterwürfeln, bis er anschreibt oder Zilch erleidet.

## Bestätigungswurf und Hot Dice

Ein weiterer Punktewurf mit mindestens 50 Punkten muss gehalten werden, wenn

- ein Drilling aus 1en gehalten wurde; oder
- durch die Holds alle sechs physischen Würfel gehalten wurden.

Der zweite Fall umfasst insbesondere Straße, drei Paare, zwei Drillinge,
sechs gleiche 2–6 und „500 für nichts“. Hot Dice setzt die sechs Würfel wieder
auf frei; die Rundenpunkte und die Hold-Historie bleiben erhalten. Während ein
Bestätigungswurf offen ist, darf nicht angeschrieben werden. Erzeugt der
Bestätigungswurf erneut drei 1en oder Hot Dice, beginnt die Bestätigung erneut.

## Zilch, Serien und Spielende

Ein Zilch tritt ein, wenn

- ein Wurf keine gültige Wertung liefert (ausgenommen das bestätigte „500 für
  nichts“ bei sechs freien Würfeln); oder
- die 300er-Schwelle am dritten Wurf nicht verbindlich erreicht werden kann.

Ungesicherte Rundenpunkte verfallen; das eigene Board protokolliert den Zug
als `zilch`. Der letzte Zilch-Wurf bleibt sichtbar, bis der nächste Spieler
tatsächlich würfelt. Beim **dritten und jedem weiteren dritten aufeinanderfolgenden**
Zilch werden 500 Punkte abgezogen, also bei den Übergängen `2 → 3`, `5 → 6`,
`8 → 9` und so weiter – niemals unter 0. Ein erfolgreiches Anschreiben setzt
die Serie zurück.

In `multiplayer` und `cpu` wird ab mindestens 10.000 angeschriebenen Punkten
die mögliche Schlussrunde begonnen. Der andere Teilnehmer erhält einen
vollständigen normalen Zug mit beliebig vielen Würfen nach diesen Regeln.
Danach gewinnt der höchste Gesamtstand; bei Gleichstand gibt es keinen Sieger
und keinen Stechwurf. Der Solo-Sprint hat keinen Gegner, keine Schlussrunde
und keinen Gegenzug: ein legaler Bank-Vorgang mit mindestens 10.000 Punkten
schließt sein Objective unmittelbar ab.

Manuelle Punkteingabe ist nicht vorgesehen. Die Oberfläche erlaubt die direkte
Auswahl noch freier, wertender Würfel oder einer kompakten Empfehlung. Diese
Auswahl bleibt ein änderbarer Entwurf, bis `Weiterwürfeln` oder `Sichern` sie
zusammen mit der Folgeaktion atomar übernimmt. Nur eine vollständig wertende
Auswahl ist dafür gültig; beim Abwählen werden Würfel, die dadurch nicht mehr
werten, ebenfalls aus dem Entwurf entfernt. Bereits in einem früheren Wurf
bestätigte Holds lassen sich nicht zurücknehmen.

Die Daumenleiste zeigt höchstens acht schlanke Empfehlungen. Sie zeigt eine
einzelne Wertungsgruppe pro Karte – etwa `1 Einser`, `2 Fünfer`, einen
Drilling oder einen Vierling – samt Punkten. Zusammengerechnete Mischungen
werden dort nicht als eigene Karte erklärt. Eine bewusst direkt über Würfel
zusammengestellte, gültige Auswahl bleibt weiterhin serverseitig prüfbar.

**„Aktueller Wurf“** zeigt transparent nur den Wert, der gerade angeschrieben
werden könnte: **„Bisher gehalten“** sind die verbindlichen Rundenpunkte,
**„Aktuell gehalten“** ist ausschließlich die momentan ausgewählte gültige
Wertung. Ihre Summe ersetzt keine noch nicht gewählte kombinierte Auswahl.
In einer laufenden Zwei-Personen-Partie sehen beide Seiten dieselben
serverbestätigten Empfehlungen, den aktuellen Wurf, die bereits verbindlich
gehaltenen Rundenpunkte und die gerade gewählte gültige Wertung. Dieser
gemeinsame Entwurf ist weiterhin keine gehaltene Wertung: Nur die Person am Zug
kann ihn ändern, und erst `Weiterwürfeln` oder `Sichern` übernimmt ihn atomar.

Die Schaltfläche **„Kombinierte Wertung“** direkt unter dem Spielblatt wählt
alle aktuell punktenden Würfel als eine servergeprüfte Auswahl. Führt genau
diese Auswahl als benannter Spezialwurf zu Hot Dice – etwa drei Paare oder eine
Straße –, nennt die Schaltfläche den Wurf statt „Kombinierte Wertung“ und zeigt
den Stempel **„Freier Wurf!“**. Auch diese Auswahl bleibt ein Entwurf, bis
`Weiterwürfeln` oder `Sichern` sie atomar übernimmt.

## Einladen und Zuschauen

In einer Zwei-Personen-Partie erzeugt **„Spiel teilen“** einen sauberen
Einladungslink für den freien menschlichen Platz. Der Link enthält weder
Raumcode noch Konto- oder Wiederaufnahme-Zugangsdaten; geschützte Räume fragen
den Raumcode weiterhin ab.

Die Lobby zeigt laufende Zwei-Personen-Partien mit beiden Spielern. Über
**„Zuschauen“** öffnet sich eine schreibgeschützte Live-Ansicht. Zuschauer können
dem Spielstand und dem sozialen Raum folgen, aber weder würfeln noch Würfel
halten oder Punkte sichern. Solo-, CPU-, wartende und beendete Partien erlauben
keinen Zuschauerzugang.

Auf der aktiven Spielseite schalten die Tasten `1` bis `6` den entsprechenden
noch nicht bestätigten Würfel um. `Q`, `W`, `E`, `R`, `T`, `Z`, `U` und `I`
wählen die sichtbaren Empfehlungen in ihrer Reihenfolge. Die Leertaste löst
zuerst einen zulässigen Startwurf und danach die aktuell zulässige
Weiterwürfeln-Aktion aus; `B` sichert nur, wenn Sichern möglich ist. In
Eingabefeldern, bei einem offenen Dialog oder zusammen mit einer
Steuerungstaste greifen diese Kürzel nicht ein.

## Serververtrag für spätere Bedienung

Nach jedem Wurf liefert der Snapshot strukturierte Quick-Hold-Optionen unter
`_zilch_quick_holds`. Jede enthält mindestens eine stabile, rollgebundene ID,
Kombinationstyp, Würfelindizes/-werte, Punkte, Übersetzungs-Key samt Parametern,
Komponenten, Hot-Dice-/Free-Roll-Information und Folgeaktionen. Der Server
formatiert daraus keine deutschen Texte.

Die aktuell verfügbaren WebSocket-Aktionen sind:

- `zilch_start_roll` mit `start_roll_version`; jeder menschliche Teilnehmer
  löst genau seinen eigenen serverseitigen Startwurf aus. Der CPU-Startwurf
  wird ausschließlich über den vertrauenswürdigen Server-Runner ausgelöst;
- `zilch_roll_dice` mit `turn_id` und `version`; in der Phase `awaiting_hold`
  zusätzlich mit `roll_id`, `option_id` sowie optional gegengeprüften
  Würfelindizes, Punkten und Kombinationstyp für Hold und Wurf in einer Action;
- `zilch_select_hold` mit `turn_id`, `version`, `roll_id`, `option_id` sowie
  optional gegengeprüften Würfelindizes, Punkten und Kombinationstyp;
- `zilch_bank_points` mit `turn_id` und `version`; dieselbe optionale
  Hold-Referenz übernimmt eine gültige Auswahl und sichert sie atomar. Eine
  Bestätigungspflicht oder weniger als 400 Rundenpunkte blockieren weiterhin
  den gesamten Vorgang ohne Zustandsänderung.
- `zilch_abandon_solo` mit aktuellem `turn_id`, `version` und dem exakten
  Server-Flag `confirmed: true`; die Oberfläche zeigt davor einen
  Bestätigungsdialog. Die Action ist ausschließlich für den menschlichen
  Teilnehmer eines aktiven Solo-Sprints gültig.

Eine Quick-Hold-Auswahl wird für den aktuellen Turn und Roll erneut
berechnet. Alte IDs, falsche Indizes/Punkte, ein falscher Spieler, falscher
Spieltyp sowie doppelte oder veraltete Versionsstände werden ohne
Zustandsänderung abgewiesen. Auswahl plus Folgeaktion erzeugt genau einen
abschließenden Snapshot; ein Zwischenzustand wird nicht veröffentlicht. Der
ältere Platzhalter `zilch_submit_score` wird explizit als nicht unterstützte
manuelle Punkteingabe abgelehnt.

## Modi, CPU-Gegner und Ergebnisgrenze

Der aktuelle Spielmodus unterstützt drei Varianten:

- `multiplayer`: genau zwei angemeldete menschliche Teilnehmer. Beide führen
  ihren Startwurf selbst aus.
- `cpu`: ein angemeldeter menschlicher Host gegen einen echten CPU-Teilnehmer.
  Die CPU hat keinen Account, keine Session, keinen Resume-Token und keinen
  WebSocket. Sie ist daher nie „offline“ und ein zweiter Mensch kann ihre
  Stelle nicht einnehmen.
- `solo`: genau ein angemeldeter menschlicher Host mit dem versionierten
  Objective `reach_10000_fewest_turns` v1. Es gibt keinen Gegner, keinen CPU-
  Teilnehmer, keinen Raumcode und keinen Startwurf.

### Solo-Sprint: `reach_10000_fewest_turns` v1

Der erste echte Solo-Modus ist ein 10.000-Punkte-Sprint: Ziel ist, mindestens
10.000 gesicherte Punkte in möglichst wenigen **eigenen Zügen** zu erreichen.
Es gibt kein Rundenlimit. Der Server beobachtet die unveränderten Engine-
Ereignisse und behält Anzahl Züge, Anzahl Würfe, Zilchs, Hot-Dice-Ereignisse,
höchste gesicherte Runde und aktive Dauer ausschließlich als private
Ergebnismetriken für den passenden Bestenlistenvergleich. Sie sind keine
laufenden Kennzahlen der Spielansicht. Die spätere, noch nicht implementierte
Vergleichsreihenfolge lautet: weniger Züge, dann weniger Würfe, weniger
Zilchs und kürzere aktive Dauer.

Pausen und Neustart-/Offline-Zeit zählen nicht zur aktiven Dauer. Der Spieler
kann einen laufenden Sprint nach einer sichtbaren Bestätigung aufgeben. Das
ergibt das private Outcome `abandoned`; der bis dahin autoritative Verlauf und
alle Metriken bleiben erhalten. Ein erfolgreicher Zielabschluss heißt
`completed`. Keines der beiden Outcomes erzeugt künstlich einen Gewinner,
Gleichstand oder Gegner.

Die beiden Startwerte und ein möglicher Gleichstand bleiben im Snapshot
sichtbar. Die aktive Spielansicht beschränkt ihre Spielstandsdarstellung
anschließend auf den Punktezettel und, im Solo-Sprint, auf das aktuelle Ziel.
Sie zeigt keine gesonderten Laufkennzahlen für Züge, Würfe, Zilchs, Hot Dice,
beste Runde oder aktive Dauer. Die Würfel, gültigen Wertungen und
Spielaktionen bleiben selbstverständlich steuerbar; sie sind keine zweite
Statistikansicht.

Die CPU verwendet genau dieselben gültigen serverseitigen Quick Holds,
Würfelaktionen, Versionen, Scoring-Regeln und die gleiche faire RNG-Funktion
wie ein Mensch. Sie besitzt keine eigene Zufallsquelle, kann keine künftigen
Würfe sehen, keine Kombination erfinden und keine Punktzahl bestimmen. Ihre
einzige Auswahl beim Erstellen ist eine fest validierte Strategie:

| Strategie | Basis zum Sichern | Verhalten |
| --- | ---: | --- |
| Konservativ | 500 | sichert eher früh und vermeidet unnötige Risiken |
| Normal | 650 | sichert solide Runden etwas früher |
| Aggressiv | 850 | jagt größere Runden, lässt gute Punkte aber seltener liegen |

Diese Werte sind transparente Produktparameter, keine abweichenden
Spielregeln. Die Strategie berücksichtigt zusätzlich Punkteabstand,
verbleibende Würfel, Hot Dice, Bestätigungswurf und Schlussrunde. Ein
Bestätigungswurf bleibt immer zwingend; ein erreichbarer Sieg wird gesichert,
und eine CPU würfelt in einem noch legalen Gegenzug weiter, wenn ein sonstiges
Sichern sicher verlieren würde. Die genaue technische Heuristik steht in
[MULTIGAME_FOUNDATION.md](MULTIGAME_FOUNDATION.md).

Die Bedienung verbindet direkte Würfelauswahl mit serverseitig berechneten
Wertungsoptionen. Ein Tipp auf einen wertenden, noch freien Würfel markiert ihn
zunächst; nur dazu passende Wertungsoptionen bleiben wählbar. Ein Tipp auf die
passende Option übernimmt alle zugehörigen Würfel in diesen weiterhin
änderbaren Entwurf. Ein Hot-Dice-Vorschlag wählt mit einem einzigen Tipp alle
zugehörigen Würfel, bleibt aber ebenfalls optional. Erst `Weiterwürfeln` oder
`Sichern` bestätigt den vollständigen Entwurf zusammen mit der Folgeaktion.
Die Karten, Würfel und Sichern sind Tastatur- und Touch-Buttons; der Browser
sendet nur die referenzierte Option und übernimmt nie einen lokalen Punktewert.

Der Punktezettel zeigt ausschließlich den serverseitigen Rundenverlauf.
Chatnachrichten und Schnellreaktionen sind davon getrennte Kommunikation:
Schnellreaktionen erscheinen kurz bei allen verbundenen Teilnehmern,
einschließlich des Absenders, und ändern weder Wertung noch Punktezettel.

Nach dem vollen kompetitiven Gegenzug markiert der aktive Zilch-State Gewinner
oder Gleichstand. Ein Solo-Sprint markiert stattdessen `completed` oder
`abandoned`. Beide Terminalarten werden zuerst als `active_games`-Snapshot
gespeichert, damit ein Datenbankfehler oder Neustart keinen Endstand verliert.
Anschließend erzeugt der Zilch-Finalizer idempotent entweder den unveränderten
kompetitiven `zilch_result`-Payload (Schema 1) oder den getrennten
`zilch_solo_result`-Payload (Schema 2). Solo enthält Objective-ID/-Version,
Parameter, Fortschritt, aktive Dauer, eine Board-Historie und keine
Startwurf-/Schlussrunden-/Winner-/Tie-Felder. Erst nach bestätigter Speicherung
wird der aktive Terminal-State entfernt.

Der Report ist ausschließlich über die geschützte, `noindex`
Zilch-Ergebnisroute und die persönliche eigene Historie erreichbar. Die beiden
verknüpften Konto-Teilnehmer dürfen ein kompetitives Ergebnis lesen; ein
anderes Konto erhält ein nicht unterscheidbares 404. Solo-Ergebnisse bleiben auf
ihren verknüpften Konto-Teilnehmer beschränkt, und die HTTP-Projektion enthält
keine internen `user_id`-Werte. Gast-Endstände bleiben im aktuellen Spielzustand,
erzeugen aber weder Report-URL noch persönliche Historie. Der Report wird
weiterhin **nicht** in ZDWA-Historie, Scorecards, Replay, Statistik,
Leaderboard, Achievement- oder Profilaggregate geschrieben. Die getrennten
persönlichen Zilch-Statistiken und öffentlichen Bestenlisten lesen ausschließlich validierte
abgeschlossene Zilch-Payloads; sie verändern weder Ergebnisse noch Regeln.
Ihre Darstellung ist bewusst kuratiert: Sie zeigt nur für Spielvergleich und
persönlichen Rückblick nützliche Zusammenfassungen und Bestenlisten, nicht
jede intern gespeicherte Solo-Metrik. Ein alter Terminal-State, dem eine
autoritative Pflichtangabe wie der Endzeitpunkt fehlt, bleibt aktiv und wird
protokolliert; die Anwendung erfindet keine Werte.

### Geschützte Zilch-Erfolge sind keine Spielregel

Zilch-Erfolge bilden einen eigenen, geschützten Zilch-Namensraum. Sie
sind weder ZDWA-Erfolge noch **Ehrenberg-Marken**: persönliche Ziele bringen
1–10 Zilch-Punkte und ergeben ausschließlich einen Zilch-Rang. Sie ändern
keine ZDWA-Titel, Sterne, öffentlichen Profile, Ranglisten, Statistiken oder
Spielregeln. Das gilt ausdrücklich auch dann, wenn derselbe Account ZDWA und
Zilch verwendet.

Als fachliche Quelle zählt ausschließlich ein erfolgreich gespeichertes,
validiertes Zilch-Ergebnis, das der Finalizer als neues post-Rollout-Workitem
registriert. Live-Snapshots, Browseranzeigen und lokale Zählwerte können
keinen Erfolg auslösen. Die Recovery verarbeitet nur solche ausstehenden
Workitems; frühere, nie registrierte Preview-Partien werden nicht rückwirkend
gescannt oder nachgetragen. Bei einer versionierten Katalogerweiterung darf
ausschliesslich die bereits nach dem ursprünglichen Rollout akzeptierte Evidenz
einmalig neu ausgewertet werden. Für jede abgeschlossene, nicht gelöschte
Registrierung wird dabei nur ihr exakt per Spiel-ID geladenes, weiterhin
vorhandenes und typisiertes Quellergebnis verwendet. Vor einer Anreicherung
werden Quelle, Sitz, Account-Zuordnung, Metadaten und alle bestehenden Fakten
geprüft; bei einer Abweichung wird der gesamte Kataloglauf inklusive
Versionsmarker zurückgerollt. Die allgemeine `CompletedGame`-Historie wird nie
aufgezählt oder gescannt. Eine Auslieferung ist pro Freischaltung idempotent.
Die Bestätigung in der Oberfläche setzt nur den Anzeigezeitpunkt und nicht die
fachliche Vergabe.

Wird das Quellergebnis gelöscht, werden daraus abgeleitete persönliche Zilch-
Erfolge widerrufen; der separate Punktestand und Rang folgen automatisch.
Gemeinsame Meilensteine für 100, 500, 1’000, 5’000 und 10’000 qualifizierte
Partien frieren ihren damaligen Empfängerkreis ein und bleiben als historischer
Moment bestehen. Sie geben immer 0 Punkte. Das berührt weder ZDWA-Aggregate
noch Ehrenberg-Marken.
Unbekannte, unvollständige oder beschädigte Ergebnis-Payloads, CPU-Sitze und
alte Daten ohne die erforderliche Evidenz bleiben absichtlich ohne Erfolg. Die
Ansichten `/zilch/erfolge` und `/zilch/spieler/{username}` trennen Konto- und
Öffentlichkeitsgrenze: Die eigene Sammlung bleibt kontogebunden; die öffentliche
Spieleransicht zeigt nur Titel, Fortschritt und Award-Status, niemals Quellspiel,
Ergebnisroute oder Evidenz. Die öffentliche Spieleransicht bleibt `noindex`.
Der technische Auslieferungs-, Widerrufs- und
Katalogvertrag steht in [ACCOUNT_STATISTICS.md](ACCOUNT_STATISTICS.md); er ist
keine zusätzliche Zilch-Spielregel.

Die Zilch-Navigation führt nur zu funktionierenden Bereichen:
`/zilch` (Lobby), `/zilch/spiel/{id}` (Partie), `/zilch/historie` (eigene
abgeschlossene Partien), `/zilch/ergebnis/{id}` (read-only Ergebnis),
`/zilch/statistiken` (eigene Auswertung), `/zilch/bestenlisten` (öffentliche
Ranglisten), `/zilch/erfolge` (eigene Erfolge),
`/zilch/spieler/{username}` (öffentlicher, evidenzfreier Zilch-Spielerkontext) und `/zilch/regeln`
(diese Regeln als lokalisierte In-App-Hilfe).
Konto, Historie, Ergebnis, Statistiken und eigene Erfolge sind serverseitig
kontogebunden. Lobby, Regeln, Bestenlisten und die sichere Spieleransicht sind
öffentlich; nur Lobby und Regeln erscheinen im Zilch-Sitemap. Gemeinsame Konto-
und Spracheinstellungen bleiben Plattformfunktionen und führen bei gültiger
Berechtigung zurück zur Zilch-Lobby.

Produktion verwendet `ROLLTHEDICE_ZILCH_ACCESS_MODE=public`; damit können Gäste
und aktive Konten Solo, CPU oder eine Zwei-Menschen-Partie öffnen. Ein Gast-Host
für Solo/CPU erhält eine lokale Zufallsberechtigung; serverseitig wird nur deren
Hash gespeichert. Der ältere Modus `preview` samt
`ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES` bleibt ausschließlich als fail-closed
Betriebsrollback dokumentiert und ist nicht der Public-Beta-Standard.

## Technische und Produktgrenzen

- Die Engine verwendet für Menschen und CPU-Teilnehmer denselben injizierbaren,
  serverseitigen Zufallsweg. Clients liefern nie Würfelergebnisse. Die
  serverseitige Denkpause `ROLLTHEDICE_ZILCH_CPU_DELAY_SECONDS` (Standard 0,9
  Sekunden, begrenzt auf 0–5) beeinflusst nur die sichtbare Taktung, niemals
  Würfel oder Wertung. Nach einem Zilch bleibt der autoritative letzte
  Würfelsatz 0,5 Sekunden sichtbar; danach folgt das 1,35-sekündige
  Zilch-Signal. Eine anschließende CPU-Aktion beginnt frühestens nach 1,9
  Sekunden und verdeckt diesen Übergang dadurch nicht.
- Aktive Zustände samt Turn-ID, Holds, Rundenpunkten, Boards und Quick-Hold-
  Grundlage bleiben über die bestehende aktive Persistenz
  restart-sicher. Ein Abschluss wird erst nach einer erfolgreichen,
  idempotenten privaten Ergebnis-Persistenz entfernt und bleibt vollständig
  von ZDWA-Ergebnissen, Statistiken, Achievements und Bestenlisten getrennt.
- Die private Auswertung verwendet nur abgeschlossene, validierte Zilch-
  Ergebnisse: Solo Sprint v1 nach weniger Zügen, Würfen, Zilchs und aktiver
  Dauer; Human-vs-Human nach Siegen, dann weniger Niederlagen, mehr
  Gleichständen, höherer Endpunktzahl und höchster Runde; CPU-Partien nach
  denselben Kriterien je Strategie. Aufgegebene Solo-Läufe und nicht aktive
  Konten sind nicht rankingfähig.
- Noch offen bleiben insbesondere eine präzise Strafkadenz nach mehr als drei
  aufeinanderfolgenden Zilchs, weitere Solo-Objectives/Challenges und finale
  Interaktions-/Markenpolitur.

## Designrichtung

Die Zilch-Oberfläche nutzt die vorhandene `data-game="zilch"`-Grenze mit
einer lokal ausgelieferten, gealterten Wirtshaus-Holztextur, physisch wirkenden
Würfeln und klar getrennten
ausgewählten sowie bereits gehaltenen Zuständen. Der aktive, intern scrollbare
Notizzettel liegt vorne; im Duell bleibt der Name samt Gesamtstand des anderen
Teilnehmers auf dem dahinterliegenden Blatt sichtbar. Kompakte, unterschiedliche
Wertungsvorschläge bleiben rechts mit dem Daumen erreichbar, während die sechs
Würfel große responsive Touch-Ziele bilden. Linienpapier, eine rein dekorative
CSS-Spiralbindung und versetzte Blattkanten geben dem Block Tiefe, ohne
Fokusreihenfolge oder Bedienfläche zu verändern. Der Notizzettel belegt vor und
nach dem ersten Wurf exakt dieselbe linke Hälfte, damit die Empfehlungen ohne
Layoutsprung rechts dazukommen. Lobby, Wartesaal, Startwurf (nur
kompetitiv), ein oder zwei Boards, Ergebnis, Historie und
die geschützte Hilfe bleiben dabei eine eigenständige Zilch-Oberfläche. Zilch, Hot
Dice, Bestätigungswurf und Spielende erhalten einen zusätzlichen Textstatus und
kurze reduzierte-Bewegung-freundliche Effekte. Ein neues Zilch erscheint einmalig
als großer Stempel über dem betroffenen Blatt; erst danach rückt das Blatt des
nächsten Teilnehmers nach vorne. Semantische Buttons,
sichtbarer Fokus, Live-Status und nicht allein farbbasierte Zustände gehören zur
Bedienung. Nach Spielende bleiben Notizzettel und Ergebnisfläche gleich hoch und
gleich breit; neue Runde, Ergebnisansicht und Lobby sind als eindeutige,
untereinander angeordnete Aktionen erreichbar. Finales Branding, eine lizenzierte
Akzentschrift und weitere
Produktpolitur sind nicht Teil dieser Regelversion.

Neue private Zilch-Awards werden am Spielende nur dann direkt im Ergebnisfeld
gezeigt, wenn ihr persistierter `source_game_id` exakt zur soeben beendeten
Partie passt. Ältere, noch nicht bestätigte Awards bleiben in der allgemeinen,
reload-sicheren Zustellwarteschlange und werden diesem Endstand nicht zugerechnet.
Folgt aus den Awards ein echter Zilch-Rangaufstieg, erscheint danach eine eigene,
pompös animierte Rang-Karte. Die Zustellung rekonstruiert für bestehende Konten
einmalig den letzten echten Aufstieg aus ihren langlebigen Award-Freischaltungen;
auch diese Karte wird erst nach ausdrücklicher Bestätigung als gesehen markiert.

Das ist ausschließlich eine eigene Designrichtung. Es werden keine Grafiken,
Sounds, Fonts, Logos, Award-Designs, Quellcodes oder pixelgenauen Vorlagen von
Bubblebox oder anderen Dritten übernommen.
