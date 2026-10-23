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

`npm run verify:local` führt nacheinander aus:

1. Frisches `origin/develop` abrufen, sauberen Commit und integrierte Basis prüfen.
2. `npm run check:quality`: Lint, Produkt-/Versions-/Assetprüfungen, Pip-Konsistenz,
   Bandit und Abhängigkeits-Audit.
3. Node-Tooltests und die vollständige Backend-Suite mit Coverage.
4. Produktionsimage für `linux/amd64` bauen (wie der Produktionsserver, auch auf
   einem ARM-Mac) und `tests/container_smoke.py` ohne Netzwerk,
   Zugangsdaten oder persistente Daten im Container ausführen.
5. 4, 6 oder 8 Haupt-Browser-Shards gleichzeitig, danach Benutzername, Passkeys und
   Hausdepp-Passkeys einzeln. Jeder Teil erhält seinen eigenen Server, freien
   Port, SQLite-Datei, Legacy-JSON-Daten und Artefakt-/HTML-Verzeichnisse.
6. Diff, Commit, Basis und Umgebung erneut prüfen und einen Nachweis speichern.

Die Ergebnisse liegen unter `test-results/local-checks/<Lauf>/`; Browserberichte
und deren `summary.json` unter `browser/`. Die Datenbanken liegen vorübergehend
in eigenen System-Tempverzeichnissen und werden beim Abschluss entfernt.
Fehler oder Abbruch erzeugen keinen gültigen Nachweis. Alle Browserteile laufen
auch nach einem Fehler weiter, damit ein Lauf die übrigen Fehler sichtbar macht.
Bei Abbruch werden nur die eigenen Testprozesse beendet.

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
npm run test:browser -- --suite passkeys
npx playwright test tests/browser/hausdepp-flex-lobby.spec.js
```

Gefilterte Läufe erhalten `fullRun=false` und geben keinen vollständigen
Push-Nachweis. `--port-base 8100` reserviert bei Bedarf einen Port je ausgewähltem
Shard und Konto-Suite (standardmässig sieben); ohne Angabe werden freie Ports
vergeben. `--output-dir` verlangt ein
neues oder leeres Verzeichnis. `PLAYWRIGHT_BASE_URL` ist im isolierten Runner
unzulässig, damit kein fremder Server benutzt wird.

## Lokale Browser-Parallelisierung / Local browser parallelism

Ohne Kalibrierung bleiben es vier Haupt-Shards. Für einen Vergleich auf derselben
Maschine bei freiem Testpool jeden Lauf separat mit identischen Quellen und
vollständiger Hauptsuite ausführen:

```bash
npm run test:browser -- --shards 4 --suite main
npm run test:browser -- --shards 6 --suite main
npm run test:browser -- --shards 8 --suite main
```

Laufzeit, Fehler und Speicherdruck vergleichen und den Gewinner erneut prüfen.
Jeder Shard behält einen Worker und seine eigene Datenbank. Die Konto-Suiten
bleiben seriell. Eine höhere Anzahl nie allein anhand der CPU-Kernzahl wählen.
Eine bestandene Hauptsuite ist weiterhin kein vollständiger Push-Nachweis.
Die gemessene Anzahl lokal setzen, etwa:

```bash
git config --local rollthedice.browserShards 6
# Zurück zum Standard / restore the default:
git config --local --unset rollthedice.browserShards
```

Die Auswahl gilt für Worktrees dieses Repositories mit dem aktualisierten Runner.
Reihenfolge: `--shards`, `ROLLTHEDICE_BROWSER_SHARDS`, lokale Git-Einstellung,
Standard 4. Erlaubt sind 4, 6 und 8; ungültige Werte brechen sichtbar ab.
Die effektive Anzahl und die vollständige Gruppe aller Haupt-Shards sowie aller
drei Konto-Suiten werden im Vollnachweis geprüft. Eine Änderung der lokalen
Anzahl macht vorhandene Nachweise wegen der geänderten Umgebung ungültig.

The uncalibrated default stays four. Compare complete main-suite runs with
`--shards 4`, `--shards 6` and `--shards 8` separately on the same idle machine
and source tree, measuring elapsed time, failures and memory pressure; confirm
the winner. Keep one worker and an independent server/database per shard, with
account suites serial. Save the measured count using repository-local Git
configuration as shown above; this affects updated worktrees on this machine.
CLI takes precedence over the environment, local Git configuration and default.
Every selected shard and all three account suites remain mandatory for a full
receipt. Changing the effective count invalidates prior environment evidence.

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

4, 6 or 8 main browser shards run simultaneously on separate servers with independent
ports, SQLite databases, legacy JSON data and reports. Username and both passkey
suites follow serially even when an earlier suite failed. Cancellation stops only
owned processes and removes disposable data. Logs remain in
`test-results/local-checks/<run>/`, including browser summaries and HTML reports.

A receipt in shared Git metadata authorizes only the exact clean commit, current
`origin/develop` base and installed environment for at most 24 hours. A source,
base or dependency change invalidates it. Focused commands remain available but
never authorize a push. Raw receipt files are not trusted by GitHub. The owner-issued commit status
binds the verified tree, base and completion time. GitHub runs only a lightweight
remote integration/evidence check, rejecting stale, untrusted or changed sources.
It does not repeat the full local backend, browser, Docker, lint or tooling suites.

An unchanged two-parent PR merge at the current `origin/develop` tip may inherit
its feature parent's complete receipt only when the merge tree exactly matches
the tested source tree and its first parent is the tested base. Freshness,
environment and all groups are checked again; original reports and timestamps
remain unchanged and `inheritedFrom` records the source. New sources require a
new full run. This lets the master fast-forward and release tag reuse the same
local source verification.
The publisher retains the PR's original source status for an inherited receipt;
it does not publish a second merge status with a different base.
