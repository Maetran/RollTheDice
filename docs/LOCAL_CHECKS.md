# Lokale Prüfungen / Local checks

Vor jedem Push den fertigen Stand committen und vollständig lokal prüfen.
Der gemeinsame Lieferweg bleibt `develop → master → prod`; ein lokaler Nachweis
ersetzt weder die Prüfung des integrierten GitHub-Stands noch die Releasefreigabe.

```bash
npm run hooks:install
npm run push:checked -- -u origin codex/my-feature
```

Die Hook-Installation gilt für dieses Repository samt Worktrees, ohne globale
Git-Einstellungen zu verändern. Vorhandene fremde Hooks werden erhalten;
gegebenenfalls muss deren `pre-push` den Aufruf
`node scripts/verify-local.mjs --pre-push` mit unveränderter Standardeingabe
einbinden. Der Hook startet keine langen Tests in einer offenen Push-Verbindung,
sondern verweigert einen ungeprüften Push sofort. `push:checked` führt die
fehlenden Vollprüfungen vor dem eigentlichen `git push` aus. Force-Pushes und
das Umgehen des Hooks sind nicht vorgesehen.

Voraussetzungen: Node wie in `.github/workflows/quality.yml`, Python aus `.venv`
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
4. Produktionsimage bauen und `tests/container_smoke.py` ohne Netzwerk,
   Zugangsdaten oder persistente Daten im Container ausführen.
5. Vier Haupt-Browser-Shards gleichzeitig, danach Benutzername, Passkeys und
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
lokale Arbeitshilfe, kein kryptografischer Nachweis und kein GitHub-CI-Ersatz.

Für die Entwicklung bleiben gezielte Prüfungen verfügbar:

```bash
npm run check:quality
npm run test:tools
npm run test:backend -- -n 0 tests/test_ci_workflow.py
npm run test:browser -- --suite main -- hausdepp-flex-lobby.spec.js
npm run test:browser -- --suite passkeys
npx playwright test tests/browser/hausdepp-flex-lobby.spec.js
```

Gefilterte Läufe erhalten `fullRun=false` und geben keinen vollständigen
Push-Nachweis. `--port-base 8100` reserviert bei Bedarf sieben aufeinanderfolgende
Ports; ohne Angabe werden freie Ports vergeben. `--output-dir` verlangt ein
neues oder leeres Verzeichnis. `PLAYWRIGHT_BASE_URL` ist im isolierten Runner
unzulässig, damit kein fremder Server benutzt wird.

GitHub prüft Feature-PRs einmal und jeden neu integrierten `develop`-Commit.
Beim unveränderten Fast-forward nach `master` darf ausschliesslich ein
vollständig grüner GitHub-Lauf desselben Commits wiederverwendet werden.
Die Details und der aussagekräftige Check **Quality result** stehen in
[Deployment](DEPLOYMENT.md#entwicklung-und-releasebranches).

## English

Commit the finished changes, install the repository-local hook once with
`npm run hooks:install`, then use `npm run push:checked -- <git push arguments>`.
Alternatively run `npm run verify:local` followed by a normal push. Existing
hooks are preserved. The hook refuses an unverified push immediately; the wrapper
runs the full check before opening the push connection.

The full check covers quality/security checks, Node tooling tests, backend
coverage, a production Docker build with its offline smoke test, every browser
suite and a final source/base/environment comparison. Use the Node version from
the workflow, the development Python environment, Chromium, WebKit and a local
Docker socket. Coordinate with any agent already running a full test pool.

Four main browser shards run simultaneously on separate servers with independent
ports, SQLite databases, legacy JSON data and reports. Username and both passkey
suites follow serially even when an earlier suite failed. Cancellation stops only
owned processes and removes disposable data. Logs remain in
`test-results/local-checks/<run>/`, including browser summaries and HTML reports.

A receipt in shared Git metadata authorizes only the exact clean commit, current
`origin/develop` base and installed environment for at most 24 hours. A source,
base or dependency change invalidates it. Focused commands remain available but
never authorize a push. Local receipts are not trusted as GitHub evidence.
GitHub checks feature PRs once and new integrated develop commits in full;
unchanged master fast-forwards reuse only verified successful GitHub evidence.
