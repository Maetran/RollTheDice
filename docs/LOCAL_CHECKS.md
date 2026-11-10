# Lokale Prüfungen / Local checks

Vor jedem Push den fertigen Stand committen und vollständig lokal prüfen.
Der gemeinsame Lieferweg bleibt `develop → master → prod`; ein lokaler Nachweis
ersetzt weder die Kontrolle des integrierten GitHub-Stands noch die Releasefreigabe.

```bash
npm run hooks:install
npm run push:checked -- -u origin codex/my-feature
```

Der stabile Launcher liegt unter `<git-common-dir>/local-checks/hooks`; ein
älterer Worktree ohne Prüfer kann die Kontrolle nicht still umgehen. Die
Hook-Installation gilt für dieses Repository samt Worktrees, ohne globale
Git-Einstellungen zu verändern. Vorhandene fremde Hooks werden erhalten;
gegebenenfalls muss deren `pre-push` den Aufruf
`node scripts/verify-local.mjs --pre-push` mit unveränderter Standardeingabe
einbinden. Der Hook startet keine langen Tests in einer offenen Push-Verbindung,
sondern verweigert einen ungeprüften Push sofort. `push:checked` führt die
fehlenden Vollprüfungen vor dem eigentlichen `git push` aus. Force-Pushes und
das Umgehen des Hooks sind nicht vorgesehen.

Voraussetzungen: Node 22, Python aus `.venv`
mit `requirements-dev.txt`, `npm ci`, installierte Playwright-Browser
(`npx playwright install chromium webkit`) und ein lokaler Docker-Daemon.
`PLAYWRIGHT_PYTHON` kann den Pythonpfad vorgeben. Netzwerk-/SSH-Docker-Endpunkte
werden abgewiesen. Vor einem vollen Lauf fremde Testpools prüfen und abstimmen;
der lokale Prüfer sperrt zusätzliche eigene Vollprüfungen in anderen Worktrees.
Der Vollprüfer verlangt ausdrücklich Node 22. Ist der System-Node älter, kann
ein vorhandener Versionsmanager oder beispielsweise
`npm exec --yes --package=node@22 -- npm run push:checked -- <Argumente>`
die passende Version bereitstellen, ohne den System-Node zu ersetzen.

Direkte Playwright-Aufrufe ohne eigenen Ausgabepfad legen ihre Artefakte unter
`test-results/direct/<Poolname>` ab; ausdrücklich konfigurierte Pfade bleiben
erhalten. Playwright bereinigt nur den jeweiligen Ausgabeordner. Derselbe
direkte Pool darf deshalb nicht gleichzeitig mehrfach laufen. Relative Pfade
gelten ab dem Ordner der jeweiligen Konfigurationsdatei; der Vollprüfer verwendet
weiterhin getrennte, ausdrücklich gesetzte Pfade für jeden Lauf und Pool.

Direct Playwright calls without a configured output path keep artifacts in
`test-results/direct/<pool-name>`; explicit paths remain unchanged. Playwright
cleans that pool's output directory, so do not run the same direct pool twice
concurrently. Relative paths resolve from the configuration file's directory.
The full verifier continues to set separate output paths for each run and pool.

`npm run verify:local` prüft zuerst Commit und Basis. Danach laufen die
Schritte 2 bis 4 gleichzeitig und anschliessend Schritt 5 mit dem Browser-Pool
allein, weil Backend-Worker und emuliertes Image neben acht Browsern die
zeitkritischen Browserprüfungen überlasteten. Jeder Schritt läuft auch dann,
wenn ein anderer fehlschlägt; am Schluss stehen alle Fehler gesammelt da.

1. Frisches `origin/develop` abrufen, sauberen Commit und integrierte Basis prüfen.
2. `npm run check:quality`: Lint, Produkt-/Versions-/Assetprüfungen, Pip-Konsistenz,
   Bandit und Abhängigkeits-Audit.
3. Node-Tooltests und die vollständige Backend-Suite mit Coverage.
4. Produktionsimage für `linux/amd64` bauen (wie der Produktionsserver, auch auf
   einem ARM-Mac) und `tests/container_smoke.py` ohne Netzwerk,
   Zugangsdaten oder persistente Daten im Container ausführen.
5. 24 kleine Haupt-Browser-Shards sowie öffentliches Watten, Benutzername,
   Passkeys und Hausdepp-Passkeys in einem gemeinsamen Pool: Standardmässig
   laufen halb so viele Teile wie Kerne (höchstens 8) gleichzeitig, ein frei
   werdender Platz übernimmt den nächsten Teil (`PLAYWRIGHT_LOCAL_JOBS` setzt die
   Zahl). Die Dauer jedes Teils wird unter
   `<git-common-dir>/local-checks/browser-durations.json` gemerkt; die längsten
   Teile starten beim nächsten Lauf zuerst. Jeder Teil erhält seinen eigenen Server, freien Port, SQLite-Datei,
   Legacy-JSON-Daten und Artefakt-/HTML-Verzeichnisse.
6. Diff, Commit, Basis und Umgebung erneut prüfen und einen Nachweis speichern.

Bestandene Prüfgruppen und Browserteile werden pro Git-Tree unter
`<git-common-dir>/local-checks/stages/<Tree>.json` gemerkt. Ein erneuter Lauf auf
exakt demselben Tree mit unveränderter Umgebung wiederholt nur, was fehlgeschlagen
ist oder noch nie lief; jede geänderte Datei ergibt einen neuen Tree und damit
einen vollständigen Lauf. Wiederverwendete Ergebnisse gelten höchstens 24 Stunden,
und der Nachweis ist nie jünger als das älteste wiederverwendete Ergebnis.
`npm run verify:local -- --fresh` wiederholt alles.

Die Ergebnisse liegen unter `test-results/local-checks/<Lauf>/`; Browserberichte
und deren `summary.json` unter `browser/`. Die Datenbanken liegen vorübergehend
in eigenen System-Tempverzeichnissen und werden beim Abschluss entfernt.
Fehler oder Abbruch erzeugen keinen gültigen Nachweis. Alle Browserteile laufen
auch nach einem Fehler weiter, damit ein Lauf die übrigen Fehler sichtbar macht.
Bei Abbruch werden nur die eigenen Testprozesse beendet.

Der Browsernachweis verlangt 28 Teilgruppen: `main-1` bis `main-24`,
`watten-public`, `username`, `passkeys` und `hausdepp-passkeys`. Der öffentliche
Watten-Pool prüft die echte DE/EN-Navigation bei eingeschalteter öffentlicher Beta
und ausgeschalteten Preview-Freigaben. Die beiden Sprachfälle sind aus den
Preview-Konfigurationen ausgeschlossen; ein fehlender öffentlicher SSR-Marker
ist im öffentlichen Pool ein Fehler. Ein früherer Nachweis ohne diesen Pool
reicht weder zum Push noch zur Übernahme durch einen unveränderten Merge.
Die sieben vollständigen Prüfgruppen bleiben unverändert.

Der Nachweis liegt unter dem gemeinsamen Git-Verzeichnis in
`local-checks/receipts/<Commit>.json`. Er gilt 24 Stunden für exakt denselben
Commit und Tree, dieselbe frisch abgerufene Basis sowie dieselben installierten
Node-/Python-Abhängigkeiten. Ein Commit, eine lokale Änderung, eine neue Basis
oder eine andere Umgebung erzwingen eine neue Prüfung. Der Nachweis ist eine
lokale Arbeitshilfe und kein kryptografischer Nachweis. GitHub vertraut keiner
solchen Datei aus einem PR. Nach dem Push veröffentlicht `push:checked` mit dem
authentifizierten Repository-Eigentümer einen echten Commitstatus
**Local verification**. Dazu prüft es den vollständigen Nachweis erneut, die
tatsächliche Identität und den bereits vorhandenen Remote-Commit/Tree. Ein
normaler Push benötigt anschliessend `npm run checks:publish`. `gh` muss als
Repository-Eigentümer angemeldet sein; der Publisher erweitert keine Rechte
und gibt keine Zugangsdaten aus.

Eine enge Ausnahme vermeidet eine doppelte Vollprüfung beim Release: Ein
unveränderter normaler PR-Merge auf dem aktuellen `origin/develop` darf den
vollständigen lokalen Nachweis seines Feature-Elternteils übernehmen. Dazu müssen
der tatsächliche Merge-Tree exakt dem geprüften Source-Tree und der erste
Merge-Elternteil exakt der getesteten Basis entsprechen; der Feature-Stand muss
diese Basis enthalten. Frische, Umgebung und sämtliche Pflichtgruppen werden
erneut geprüft. Zeiten und Berichte bleiben unverändert, die Herkunft wird als
`inheritedFrom` aufgezeichnet. Andere Commits oder neue Quellen brauchen einen
neuen Volltest. So können `master` und der zugehörige Tag denselben geprüften
Stand übernehmen, ohne die lokalen Suiten nochmals zu wiederholen.
Der Publisher behält dabei den bestehenden Source-Status des PRs bei, statt
auf dem Merge einen zweiten Status mit einer anderen Basis zu erzeugen.

Für die Entwicklung bleiben gezielte Prüfungen verfügbar:

```bash
npm run check:quality
npm run test:tools
.venv/bin/python -m pytest -n 0 tests/test_ci_workflow.py
npm run test:browser -- --suite main -- hausdepp-flex-lobby.spec.js
npm run test:browser -- --suite watten-public
npm run test:browser -- --suite passkeys
npx playwright test tests/browser/hausdepp-flex-lobby.spec.js
```

Gefilterte Läufe erhalten `fullRun=false` und geben keinen vollständigen
Push-Nachweis. Vor ihrem Start prüft der Runner die Auswahl mit Playwrights
JSON-Testliste: Insgesamt null ausgewählte Tests oder ein ungültiger Bericht
lassen den Lauf fehlschlagen; einzelne leere Shards bleiben erlaubt.
Der Runner verbietet `test.only`/`describe.only` und erzwingt
`--retries=0`, auch bei gesetztem `CI`. Ein Fehler im ersten Versuch bleibt
damit ein Fehler; Filter dürfen diese Vorgaben nicht überschreiben.
`--port-base 8100` reserviert bei Bedarf 28 aufeinanderfolgende
Ports; zulässig sind Basiswerte von 1024 bis 65508. `--suite main-7` wählt einen
einzelnen Haupt-Shard, `--jobs N` die Zahl gleichzeitiger Teile. Ohne Angabe werden freie
Ports vergeben. `--output-dir` verlangt ein
neues oder leeres Verzeichnis. `PLAYWRIGHT_BASE_URL` ist im isolierten Runner
unzulässig, damit kein fremder Server benutzt wird.

GitHub führt ausschliesslich **Quality result** aus: ein schlanker Check der
Remote-Integration und des lokalen Owner-Nachweises. Der Status enthält
`[1, treeSHA, baseSHA, completedAtISO]`, wobei die Zeit ein UTC-String ohne
Millisekunden ist. GitHub kontrolliert den Aussteller, maximal 24 Stunden Alter,
den tatsächlichen Commit/Tree, die Basis und die Abstammung. Der synthetische
PR-Merge und normale Integrations-/Release-Merges müssen genau den lokal
geprüften Tree enthalten. Neue Quellen oder unklare Nachweise blockieren und
müssen lokal geprüft werden. Backend-, Browser-, Container-, Lint- und Tool-Suiten
laufen auf GitHub nicht erneut. Ein begrenztes Warten auf den unmittelbar nach
Push veröffentlichten Status verhindert ein Rennen; Ablehnungen werden nicht
ausgeblendet. Feature-Push und Release-Tag erzeugen keine doppelten Läufe.

## English

Commit the finished changes, install the repository-local hook once with
`npm run hooks:install`, then use `npm run push:checked -- <git push arguments>`.
Alternatively run `npm run verify:local`, push normally, then run
`npm run checks:publish`. The wrapper publishes automatically after a successful
push using the authenticated repository-owner account in `gh`. Existing
hooks are preserved. The hook refuses an unverified push immediately; the wrapper
runs the full check before opening the push connection.

The full check covers quality/security checks, Node tooling tests, backend
coverage, a production Linux/amd64 Docker build with its offline smoke test
(including emulation on ARM hosts), every browser
suite and a final source/base/environment comparison. Use Node 22,
the development Python environment, Chromium, WebKit and a local
Docker socket. Coordinate with any agent already running a full test pool.

After the commit/base check, quality, tooling, backend and the Docker image run
side by side; the browser pool then gets the machine to itself. Every group runs
even when another fails, and all failures are reported at the end. The pool
remembers each part's duration and starts the longest ones first. Twenty-four small main browser
shards plus public Watten, username and both passkey suites share one bounded
pool (half the cores, at most 8; `PLAYWRIGHT_LOCAL_JOBS` overrides it).
Each part has its own server, port, SQLite database, legacy JSON data and reports.
Groups and browser parts that passed are remembered per Git tree; rerunning on
exactly the same tree and environment within 24 hours repeats only the failed
ones, and `npm run verify:local -- --fresh` repeats everything.
Cancellation stops only owned processes and removes disposable data. Logs remain in
`test-results/local-checks/<run>/`, including browser summaries and HTML reports.

Browser evidence requires 28 pools: `main-1` through `main-24`, `watten-public`,
`username`, `passkeys` and `hausdepp-passkeys`. The public Watten pool checks real
DE/EN navigation with public beta enabled and preview access disabled. Preview
configs exclude those two cases; a missing public SSR marker fails the public
pool. Older evidence without this pool cannot authorize a push or be inherited
by an unchanged merge. The seven complete check groups remain unchanged.
Use `npm run test:browser -- --suite watten-public` for a focused run.
`--port-base` reserves 28 consecutive ports; its range is 1024 through 65508.

A receipt in shared Git metadata authorizes only the exact clean commit, current
`origin/develop` base and installed environment for at most 24 hours. A source,
base or dependency change invalidates it. Focused commands remain available but
never authorize a push. Raw receipt files are not trusted by GitHub. The owner-issued commit status
binds the verified tree, base and completion time. GitHub runs only a lightweight
remote integration/evidence check, rejecting stale, untrusted or changed sources.
It does not repeat the full local backend, browser, Docker, lint or tooling suites.
The runner rejects `test.only`/`describe.only` and enforces `--retries=0`, even
with `CI` set. A first-attempt failure remains a failure; filters cannot
override these requirements.
Filtered runs first collect Playwright JSON test lists. Zero tests across the
whole selection or an invalid report fails the run; individual empty shards
remain allowed.

An unchanged two-parent PR merge at the current `origin/develop` tip may inherit
its feature parent's complete receipt only when the merge tree exactly matches
the tested source tree and its first parent is the tested base. Freshness,
environment and all groups are checked again; original reports and timestamps
remain unchanged and `inheritedFrom` records the source. New sources require a
new full run. This lets the master fast-forward and release tag reuse the same
local source verification.
The publisher retains the PR's original source status for an inherited receipt;
it does not publish a second merge status with a different base.

### Optional PostgreSQL rare-surprise races

The opt-in `tests/test_rare_surprise_postgres.py` suite exercises the rare
surprise counters and real table starts against PostgreSQL. It creates a fresh,
random schema per test and drops only that schema. The test refuses network
hosts and databases other than the disposable `rare_concurrency_test` on a
private `rtd-rare-pg.*` Unix socket. Without its explicit URL the tests skip.
They are focused checks and do not replace the full local proof.

With local PostgreSQL tools, the project Python environment, and `psycopg2`
available, an isolated run can be prepared as follows:

```sh
RARE_POSTGRES_DIR=$(mktemp -d /tmp/rtd-rare-pg.XXXXXX)
initdb -D "$RARE_POSTGRES_DIR/data" -A trust --no-locale --encoding=UTF8
pg_ctl -D "$RARE_POSTGRES_DIR/data" -l "$RARE_POSTGRES_DIR/postgres.log" \
  -o "-k $RARE_POSTGRES_DIR -p 55439 -c listen_addresses=''" -w start
createdb -h "$RARE_POSTGRES_DIR" -p 55439 rare_concurrency_test
ROLLTHEDICE_RARE_TEST_POSTGRES_URL="postgresql+psycopg2:///rare_concurrency_test?host=$RARE_POSTGRES_DIR&port=55439" \
  python -m pytest -n 0 -q tests/test_rare_surprise_postgres.py
pg_ctl -D "$RARE_POSTGRES_DIR/data" -m fast -w stop
```

Remove the temporary directory only after confirming that the server stopped.
The test checks migration 0083 against a representative existing 0082 schema;
it does not claim that all historical migrations support PostgreSQL. In
particular, a fresh PostgreSQL migration currently fails in 20260907_0035.
