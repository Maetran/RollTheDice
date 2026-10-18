# Zusammenarbeit und Branches

- Verbindlicher Lieferweg: `develop → master → prod`.
- `develop` ist der gemeinsame Integrationszweig. Neue Arbeit in einem eigenen
  Worktree auf einem `codex/*`-Branch vom aktuellen `origin/develop` beginnen;
  Feature-PRs richten sich gegen `develop`.
- `master` enthält geprüfte Release-Stände. Änderungen von `develop` erst nach
  bestandener CI und bewusster Releasefreigabe nach `master` übernehmen;
  Produktionsdeploys erfolgen weiterhin explizit von `master`.
- Bei paralleler Arbeit nur im eigenen Worktree schreiben. Vor der Integration
  `git fetch origin` ausführen und `origin/develop` in den eigenen Featurebranch
  integrieren, Konflikte in den Quellen lösen, generierte Assets neu bauen und
  passende Tests ausführen. Änderungen committen und per PR gegen `develop`
  übergeben; Integrationen nach `develop` nacheinander durchführen. Hat sich der
  Zielstand inzwischen geändert, erneut abgleichen und prüfen. Gemeinsame
  Branches nicht mit Force-Push überschreiben. Versionsnummern, Migrationen und
  Releasehinweise beim Integrieren abstimmen; bestehende Zuordnungen erhalten.
- Unmittelbar vor **jedem Push** erneut `git fetch origin` ausführen und den
  aktuellen `origin/develop`-Stand mit dem zuletzt integrierten und geprüften
  Stand vergleichen. Hat er sich geändert, zuerst integrieren, Konflikte lösen,
  nötigenfalls Assets neu bauen und relevante Prüfungen wiederholen. Danach vor
  dem nächsten Push erneut abrufen und vergleichen. Einen wegen neuer Remote-
  Commits abgelehnten Push durch erneuten Abgleich lösen, niemals per Force-Push.
- Vor jedem Push den vollständigen lokalen Prüfablauf auf dem fertig
  committeten, sauberen Stand bestehen lassen: einmal `npm run hooks:install`
  pro Repository, danach `npm run push:checked -- <git-push-Argumente>`.
  Alternativ `npm run verify:local`, normal pushen und danach
  `npm run checks:publish` ausführen. Der Wrapper veröffentlicht den lokalen
  Vollnachweis nach erfolgreichem Push automatisch als Owner-Commitstatus. Der Hook
  verlangt einen gültigen Nachweis für exakt diesen Commit, die aktuelle
  `origin/develop`-Basis und die unveränderte lokale Umgebung. Ein unveränderter
  normaler Develop-PR-Merge darf den vollständigen Source-Nachweis nach strikter
  Tree-/Basis-/Abstammungsprüfung übernehmen; neue Quellen brauchen einen neuen
  Volltest. Keine Hooks
  umgehen und keine Teilprüfung als Vollprüfung ausgeben. Alle Qualitäts-,
  Sicherheits-, Tool-, Backend-, Container- und Browserprüfungen sind enthalten.
  Die Haupt-Browser-Suite läuft auf vier eigenen Servern mit getrennten
  Datenverzeichnissen und je einem Worker; die drei Konto-Suiten folgen separat.
  Vor einem vollen Lauf laufende fremde Testpools prüfen und abstimmen; keine
  zweite volle Testsuite parallel zu einem fremden Vollpool starten. Einzelheiten
  und Voraussetzungen stehen in [docs/LOCAL_CHECKS.md](docs/LOCAL_CHECKS.md).
- `develop` nach `master` per Fast-forward oder normalem Merge übernehmen,
  ohne Squash/Rebase der referenzierten Historie. Einen Release-Merge oder
  Hotfix auf `master` vor der nächsten Versionserhöhung nach `develop`
  zurückführen. Details stehen in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#entwicklung-und-releasebranches).
- Nach abgeschlossener Arbeit alte, nicht mehr benötigte eigene Worktrees
  aufräumen, wenn sinnvoll. Vorher frisch abrufen und nachweisen, dass die Arbeit
  vollständig committet und in `origin/develop` enthalten ist. Uncommittete,
  unversionierte oder nur in einem detached HEAD/Stash vorhandene Arbeit sowie
  wichtige ignorierte Dateien zuerst ausserhalb des Worktrees sichern.
  Unmittelbar vor dem Aufräumen Eigentümer und aktive Nutzung nochmals prüfen;
  Hauptcheckout, fremde, aktive, gepinnte oder geteilte Worktrees erhalten.
  Eigene verwaltete Codex-Worktrees wiederherstellbar archivieren; wichtige
  ignorierte Dateien sind nicht im Archiv enthalten. Nicht mit Gewalt entfernen
  und Branches nicht pauschal löschen.

# Produkt-Lieferpflicht

Bei jeder sichtbaren Seite oder Funktion gilt zusätzlich zur technischen
Implementierung der Standard in [docs/PRODUCT_DELIVERY.md](docs/PRODUCT_DELIVERY.md).

- Neue sichtbare Texte vollständig Deutsch/Englisch ausliefern.
- README und bei spielrelevanten Änderungen die Spielanleitung aktualisieren.
- Öffentliche, dauerhafte Seiten in `app/site_seo.py` registrieren; persönliche
  oder kurzlebige Seiten mit `noindex` halten.
- Vor dem Abschluss `npm run lint`, relevante Backend-Tests und bei sichtbaren
  Änderungen Browser-Tests ausführen.
- Bei sichtbaren Releases `app/release-notice.json` mit einem neuen, kurzen
  DE/EN-Usability-Hinweis, spielerfreundlichen `player_notes` und den betroffenen
  Spielen aktualisieren; die ausführlichere Historie steht in `CHANGELOG.md`.
  Der Deploy prüft diese Inhalte; reine Backend-Releases erhalten automatisch den
  Stabilitätstext. Versions-Push niemals manuell gegen echte Konten testen.
- Neue oder geänderte Seitenpfade in `tests/test_navigation_contract.py` mit
  passender Ziel-, Anmeldungs- und gegebenenfalls Browserprüfung erfassen.
  Bereits vorhandene Flowtests weiterverwenden; neue Routen dürfen den Guard
  nicht ohne begründete Prüfzuordnung passieren.
- Beide Spiele teilen eine Produktversion aus `app/version.json`:
  Major für große Produktmeilensteine, Minor für neue Funktionen, Patch für
  Korrekturen/Wartung. Vor einem neuen Release mit
  `scripts/product_versions.py bump major|minor|patch` erhöhen und den
  bilingualen Changelog ergänzen; auch stille Releases benötigen eine Version.
  Bestehende Zuordnungen in `app/version-history.json` niemals umnummerieren.
