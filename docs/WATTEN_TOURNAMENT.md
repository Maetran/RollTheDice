# Watten: Nockerl-Serien und Turniere

Eine Revanche übernimmt die Nockerl bei gleicher Besetzung und gleichen
Viererteams. Menschen werden über ihr Konto erkannt, CPUs über ihren
logischen Sitz. Neue temporäre Spielernamen oder Teilnehmer-IDs ändern
diese Bindung nicht. Jede Revanche behält Regeln, Konten, genaue Sitze, Teams
und CPUs unverändert. Sie fragt kein Passwort ab; die ursprünglichen Konten
erhalten ihren eigenen Platz zurück. Fremde Konten sind ausgeschlossen, auch
wenn der Quelltisch ein Passwort hatte. Andere Menschen, Teams oder Einstellungen
beginnen über einen neuen Lobbytisch eine neue Serie bei null. Im Dreier wird jedes persönliche Nockerl-Konto
mitgeführt; ein Turnier mit festen Teams wird dort nicht angeboten.

Beim Erstellen kann für zwei oder vier Spieler ein Nockerl-Limit gewählt
werden: 3, 5, 8, 10, 15, 20 oder eine andere positive ganze Zahl. Sobald ein
Team das Limit erreicht oder überschreitet, verliert es das Turnier und die
Gegenseite gewinnt. Die normalen 1/2/4 Nockerl pro abgeschlossenem Spiel
gelten unverändert. Ein beendetes Turnier bietet keine weitere Revanche in
derselben Serie; ein neues Turnier beginnt mit einem neuen Tisch.

Ab dem ersten Start bleiben Konten, Teams und CPU-Sitze für alle
Turnierspiele fest; dieselbe feste Besetzung gilt für gewöhnliche Revanchen. Die reservierten Spieler müssen weiterhin bewusst
beitreten und ihren zugewiesenen Platz einnehmen. Eine abgelaufene
Einladung öffnet keinen Platz für Fremde oder eine CPU. Der Gastgeber darf
die Turnierbesetzung nicht durch andere Menschen oder CPUs ersetzen.

Die private Room-JSON speichert Serienidentität, Kontobindungen, Nockerl und
den zuletzt gewerteten Spielabschluss. Die Wertung gehört zur atomaren
Abschluss-/Checkpoint-Transaktion; deren Wiederholung vergibt keine
weiteren Nockerl. Ein Revanche-Ziel wird weiterhin mit der dauerhaften
Quellverknüpfung atomar erstellt. Alte Rezepte bleiben Einzelspiele und
alte Räume ohne Serienmetadaten bleiben lesbar. Es gibt keine neue
Datenbankmigration und keinen erfundenen Import älterer Serien.

Öffentliche Ansichten enthalten nur Sitzgruppen und deren Nockerl, keine
Kontobindungen. Die Revanche zeigt die mitgenommenen Nockerl bereits im
Warteraum. Eine abgelehnte oder abgelaufene Reservierung löst die feste
Kontobindung nicht auf. Ein geschlossener, nie gestarteter Warteraum hat
keinen Spielabschluss für eine Revanche; dafür wird ein neuer Tisch erstellt.

Der Bierblock zeigt jede bereits gewertete Runde mit Rundennummer,
Gewinnpartei, Punkten und laufender Anschrift. Eine angenommene
Retourschneider-Löschung ist ausdrücklich enthalten. Rundenzeitstempel
wurden bisher nicht gespeichert und werden nicht nachträglich erfunden.
Gestrichen beginnt immer zwei Punkte vor dem Spielziel, etwa bei 13 von 15.

## English

A rematch carries loss marks when the actual participants and four-player
teams remain the same. Human identities use accounts, CPUs use logical
seats. Every rematch retains the exact accounts, seats, teams, CPUs and rules.
It requires no password: only the original accounts may return to their own
seats, even if the source table was protected. Different people, teams or
settings require a new lobby table and start a fresh series at zero.
Three-player rematches retain individual loss marks; fixed-team tournaments
are offered only with two or four players.

Creation offers limits of 3, 5, 8, 10, 15, 20 or another positive integer.
Reaching or exceeding the limit loses the tournament for that team; the
other side wins. Existing match loss marks of one, two or four still apply.
A finished tournament cannot continue through another rematch in the same
series. A new table starts a new tournament.

After the first start, accounts, teams and CPU seats stay fixed throughout
the tournament. Ordinary rematches also retain the exact roster. Joining and
taking the assigned seat remain deliberate.
An expired invitation never releases a tournament seat to another account
or CPU. The host cannot replace the tournament participants.

Private room checkpoints retain series identity, actual identity bindings,
counts and the last completed game. Updating loss marks is part of the
atomic native completion transaction; retries do not score again. The
existing atomic source-to-rematch link preserves one linear successor.
Old recipes remain ordinary matches, and older room payloads remain valid
without a database migration or an invented historical series.

Public projections expose only seat groups and loss marks, never account
bindings. Inherited marks appear immediately in the rematch waiting room.
Declining or expiring a reservation does not release the account-bound seat.
A closed waiting room that never started has no completed game to rematch;
create a new table instead. The score notebook contains scored rounds, their winner, awarded
points, running totals and explicit Retourschneider resets. Round timestamps
were never retained, so the notebook uses round numbers. Gestrichen always
starts at the match target minus two, including thirteen when playing to fifteen.
