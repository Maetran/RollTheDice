# Watten – Übergabe von Planung zu Umsetzung

**Freigabe:** Der Owner hat am 18.10.2026 die Umsetzung gemäss Integrationsplan
ausdrücklich gestartet und einen eigenen Ausführungs-Chat gewünscht. Ältere
Angaben «keine Entwicklung/keine Entwicklungsfreigabe» dokumentieren den
früheren Recherchestand und sind dadurch überholt. Ungeklärte Hausregeln
werden dadurch nicht entschieden. Master-/Produktionsfreigabe bleibt separat.

## Einstieg und Quellen

Planungs-Worktree: `/Users/manuel/.codex/worktrees/watten-recherche/RollTheDice`.
Branch: `codex/watten-design-references`. Ausgang vor dieser Übergabe:
`66595432cd17ad5aa1c157f98e027eecc6afcf00`, sauber, zwei Commits gegenüber
dem Remote ungepusht. Die zusätzliche Übergabe ist ebenfalls lokal committet.
Den aktuellen lokalen Branch lesen, nicht nur den älteren GitHub-Stand.
Planungs-PR: <https://github.com/Maetran/RollTheDice/pull/37> gegen `develop`.

Verbindliche Dokumente:

- [Umsetzungsplan mit allen 81 Findings](WATTEN_IMPLEMENTATION_PLAN.md)
- [Regelabgleich und verbleibende P0-Fragen](WATTEN_RULES_AUDIT.md)
- [Produktanforderungen und Karten](WATTEN_RESEARCH.md)
- [Design und beide Ausrichtungen](WATTEN_DESIGN_REFERENCES.md)
- [Achievements, Ranglisten und Titelkurve](WATTEN_PROGRESSION_PLAN.md)
- [Hausdepp-Retrospektive mit aktuellen Nachträgen](HAUSDEPP_RETROSPECTIVE_2026-10-18.md)
- [Repository-Regeln](../AGENTS.md), [Produktlieferung](PRODUCT_DELIVERY.md),
  [lokale Prüfungen](LOCAL_CHECKS.md) und [Releaseweg](DEPLOYMENT.md)

## Sofort beginnen, ohne Fachregeln zu erfinden

1. Frisch `origin/develop` abrufen, in einem **neuen eigenen Worktree** auf
   einem `codex/*`-Branch von diesem Stand beginnen. Hauptcheckout und
   Planungs-Worktree erhalten. Den lokalen Planungsbranch einschliesslich der
   ungepushten Commits bewusst in den neuen Branch übernehmen; dort etwaige
   Konflikte lösen und Assets aus den Quellen bauen.
2. Den dokumentierten bestehenden Spielwechsler-/Auth-Race als begrenzte
   Voraussetzung für verlässliche lokale Prüfungen bearbeiten. Den roten
   Nachweis nicht übernehmen und Fehler nicht durch Retries verstecken.
3. P0-Regelfragen aus dem Audit früh gebündelt klären. Gesicherte Vorgaben
   nicht erneut zur Disposition stellen. Unabhängig davon mit Suite-, Konto-,
   Routen-, Infrastruktur- und Testgrundlagen aus P1 beginnen. Keine
   unbestätigten Zweier-/Dreier- oder Bietregeln als Implementierungsdefault.
4. Fachlich abgeschlossene Arbeitspakete, jeweils mit Zuständigkeit, Dateien,
   Abnahme und Prüfnachweis führen. PRs gegen `develop`, Integrationen
   nacheinander. Kein Node.js-Rewrite ist beauftragt.

## Bereits feststehende Produktvorgaben

- Zwei, drei und vier Personen; meist bis 11 («8+3 isch zmittag»).
- Vierer ladinisch/blind: Geber und Uhrzeigernachfolger schauen ein;
  andere Sitze erschliessen Schlag/Trumpf aus dem Spiel. Kritische und
  offene Modi sowie deren Zugabe-/Bietregeln gemäss geschlossenem Profil.
- **Teamwahl vor Spielbeginn durch den Nutzer, niemals zufällige Zuordnung.**
  Rejoin/Gerätewechsel behalten Sitz/Team und erlaubten Wissensstand.
- Hausdepp-Karten wiederverwenden, keine fremden Watten-Karten kopieren.
- Beide Ausrichtungen vollständig spielbar; Querformat mit dezentem,
  schliessbarem Hinweis empfehlen. Rotation verändert keine Spielhandlung.
- Taktische CPUs mit Tiroler Namen; nur Wissen des eigenen Sitzes verwenden.
- Achievements, dauerhafte Wirtshaustitel, Ranglisten und das vollständige
  Konto-/Verlaufs-/Fortschrittsumfeld gehören verbindlich dazu. Frühe Titel
  schneller, spätere zunehmend langsamer; langfristig erreichbar, kein
  Komplettabschluss in einer intensiven Woche. Konkrete Namen/XP im Entwurf
  sind noch keine endgültig freigegebenen Werte.
- Bieten/Ansagen sind Spielhandlungen. «Gestrichen darf man nichts mehr sagen»
  bleibt verbindlich; notwendige Antworten und Kommunikationsumfang vor
  Implementierung präzise schliessen.

## Domain, Auffindbarkeit und Betrieb

**Feste Zieladresse: `watten.zockdiewandan.online`.** Der Owner hat die
Einrichtung ausdrücklich in den Umsetzungsumfang aufgenommen. Aktuellen
DNS-/Cloudflare-/Originstand zuerst prüfen; weder vorhandene Reservierung
noch funktionierenden Host aus dieser Notiz ableiten.

- DNS, Nginx/Originroute, verifiziertes TLS und Erneuerung, rollbackfähige
  Aktivierung und Readiness gemeinsam vorbereiten. Bestehende Suitehosts
  erhalten; Cloudflare-Arbeiten nach dem entsprechenden Skill ausführen.
- Hostkontext für Konto/Passkeys, Cookies/Origin, Recoverylinks, Spielwechsel,
  PWA-Manifest/Worker/Icons und Pushkontext ausdrücklich aufnehmen.
- Öffentliche dauerhafte Wattenseiten in `app/site_seo.py` registrieren;
  einheitliche Canonicals, strukturierte Daten, `robots.txt` und Sitemap
  gemäss tatsächlichen Routen/Hostregeln prüfen. Private Konto-, Tisch-,
  Zuschauer- und API-Inhalte nicht in die Sitemap aufnehmen; noindex und
  Datenzugriffsschutz getrennt korrekt setzen.
- Das gebaute Produktionsimage muss Manifeste, Icons und tatsächliche
  HTTP-Routen enthalten. Vor öffentlicher Bereitstellung keine erfolgreiche
  Veröffentlichung oder Suchmaschinenaufnahme behaupten.
- **Search Console gehört zur Lieferung.** Bestehende Property und
  Zugriffsrechte prüfen; die passende Sitemap nach ausdrücklich freigegebener
  öffentlicher Bereitstellung und erfolgreichem HTTPS-/Canonical-/Sitemap-
  Smoke einreichen. Rückmeldung prüfen und Einreichung getrennt von späterer
  Indexierung dokumentieren. Nicht vorab eine unerreichbare Sitemap melden.

## Codex führt, Claude bleibt austauschbarer Mitarbeiter

Der Owner hat die Nutzung von **Claude Desktop** ausdrücklich erlaubt:
`plugin://computer-use@openai-bundled?app=com.anthropic.claudefordesktop`.
Die mitgelieferte Momentaufnahme zeigt **95 % Sitzungsverbrauch** und
**82 % Wochenverbrauch**. Angezeigter Sitzungsreset: **17:20 Europe/Zurich**;
Wochenreset laut Bild Freitag 20:00. Das sind keine live geprüften Restwerte.

- Codex ist der primäre Verantwortliche. Claude nur begrenzte, überprüfbare
  Pakete geben; vor neuen Paketen aktuellen Sitzungs-/Wochenstatus prüfen.
- Aktuellen Aufgaben-, Entscheidungs-, Datei-, Git- und Prüfstand laufend in
  einem kurzen Ausführungslog halten. Kein entscheidender Stand darf nur im
  Claude-Chat, in dessen Erinnerung oder in unzugeordneten Änderungen liegen.
- Bei parallelen Änderungen erhält Claude einen eigenen klar zugeordneten
  Worktree/Branch und abgegrenzte Dateien. Keine gleichzeitige Bearbeitung
  derselben Dateien, keine eigenen schweren Testpools neben einem fremden
  Vollpool. Commits/Diffs prüfen, bevor Ergebnisse übernommen werden.
- Bei einem Limit übernimmt Codex das Paket anhand der Dateien und des Logs
  und arbeitet weiter; kein Stillstand bis zum Reset, keine Doppelarbeit.
- **Owner-Nachtrag:** Falls Claude wegen Limit ausfällt, um **17:20 wieder
  aktivieren** und weiter beobachten. Dafür wird ein Heartbeat am neuen
  Ausführungs-Chat eingerichtet; keine zweite Automation dafür anlegen.
  Vor Wiederaufnahme live prüfen, ob die Sitzung wirklich zurückgesetzt ist
  und das Wochenkontingent noch Arbeit erlaubt. Keinen doppelten Auftrag
  starten, wenn Claude bereits arbeitet. Bei Wochenlimit bleibt Codex dran.
- Wiederkehrende Kontingentbeobachtung im selben Ausführungs-Chat wird
  ebenfalls eingerichtet. Unveränderten Zustand nicht fortlaufend melden;
  relevante Limitwechsel, gescheiterte Reaktivierung und nötige Eingriffe
  dokumentieren. Nach Ende der Claude-/Watten-Arbeit Überwachung beenden.
- Keine Zusatznutzung kaufen, kein Tarifupgrade und keine Kontoumstellung.

## Lokale Prüfungen und bekannter Startblocker

Tests soweit möglich **lokal auf dem Mac**. Schwere GitHub-Suiten vermeiden;
GitHub prüft nur den schlanken veröffentlichten Integrationsnachweis.
AGENTS und `LOCAL_CHECKS.md` bleiben verbindlich: sauberer fertiger Commit,
frischer Fetch unmittelbar vor jedem Push, aktuelle Develop-Basis integrieren,
`npm run push:checked -- …`, kein Force-Push und kein Hook-Bypass.

Letzter lokaler Lauf auf `76c3455`: Qualität/Sicherheit, 91 Werkzeugtests,
1’360 Backendtests, Produktionsimage und HTTP-Smoke bestanden. Browser:
**1’118 bestanden, ein Fehler, neun optionale Capture-Skips**; alle sieben
Browserteile liefen aus. **Kein gültiger Vollnachweis, kein Push.**

Fehler: `tests/browser/hausdepp-product.spec.js:117`, Spielwechsel Hausdepp →
ZDWA. Ein sichtbarer aktiver Button kann beim zweiten Auth-Refresh einen
frühen Klick verlieren. Trace und Quellreview: `frontend/multigame/app-mode.js`
startet `allowed=false`, der Guard ignoriert den Klick vor Auth-Abschluss;
der Button wirkt bereits bereit. Keine Watten-Laufzeitänderung war beteiligt.
Details im S25-Nachtrag der Retrospektive. Lokale Belege:
`test-results/local-checks/76c3455133ac-1792331247090-dcb957a4/` im
Planungs-Worktree; dessen wichtige ignorierte Belege vor einer eventuellen
späteren Archivierung separat sichern.

Bekannte lokale Laufzeitpfade (vor Nutzung neu prüfen): Node 22 unter
`/Users/manuel/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`,
Python unter `/Users/manuel/PycharmProjects/RollTheDice/.venv/bin/python`.
`PLAYWRIGHT_PYTHON` und PATH konsistent verwenden. Fremde Prozesse/Daten
nicht stoppen oder als Testumgebung benutzen.

**English brief:** Implementation is now authorized in a separate execution
chat, using a fresh develop-based worktree and the complete local planning
branch. Preserve all 81 findings and unresolved rule decisions. The fixed
host is watten.zockdiewandan.online, including SEO/robots/sitemap and verified
Search Console submission after public release. Codex leads and must take
over from Claude at any limit; reactivation at 17:20 and ongoing quota checks
are explicitly requested. Full testing stays local; the existing game-picker
race currently prevents a valid push receipt.
