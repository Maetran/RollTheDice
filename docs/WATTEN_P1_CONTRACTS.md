# Watten – P1-Verträge und Routeninventar

**Stand:** 18.10.2026. Basis `origin/develop=80bc42d` plus lokaler Übergabe.
Dieses Inventar beschreibt Implementierungsgrenzen, keine fertige Partie.

## Erste geschlossene Hostgrenze

Der feste Host ist `watten.zockdiewandan.online`. Ein blosser neuer Proxy-Vhost
würde heute ZDWA mit dessen Manifest/Worker ausliefern. Vor einer öffentlichen
Spielfreigabe muss Watten daher einen eigenen geschlossenen HTTP- **und**
WebSocket-Einstieg haben. `503`, `no-store` und `noindex` kennzeichnen die
Vorbereitung; es gibt noch keine veröffentlichte Sitemap oder Installation.
Ein minimaler Healthcheck beweist nur die Infrastruktur, keine Spielbereitschaft.

Watten wird erst mit eigenem Adapter und vollständiger Zugangspolitik in
`GAME_TYPES` aufgenommen. `adapter_for_game_type` fällt heute auf ZDWA zurück;
ein neuer Typname allein wäre keine sichere Integration.

## Geplante Routen und Zuordnung

Die folgende Form nutzt wie Hausdepp einen eigenen `/watten`-Namensraum,
damit installierte Suite-Apps den Ursprung beim Spielwechsel behalten können.
Das ist ein technischer Routenvorschlag; noch keine angebotenen Ziele.
Jede tatsächlich eingeführte Dokumentroute kommt gleichzeitig in
`tests/test_navigation_contract.py` und erhält reale Backend-/Browserprüfungen.

| Route/Familie | Ziel und Zugriff bei vollständiger P1-Lieferung | Erforderlicher Prüfvertrag |
| --- | --- | --- |
| `/` auf Wattenhost → `/watten` | Kanonischer Produkteinstieg, ohne persönliche Daten | Kein ZDWA-Fallback, bewusste öffentliche Freigabe, HTTPS/Canonical |
| `/watten` und `/watten/regeln` | Dauerhafte öffentliche Erklärung und bestätigte Regeln | Anonym/ohne JS/Auth-503 nutzbar; erst bei tatsächlicher Bereitstellung in SEO/Sitemap |
| `/watten/anmelden` | Native gemeinsame Anmeldung mit Wattenidentität | Passwort/echte virtuelle Passkeysignatur, sichere endliche Rückziele |
| `/watten/konto`, `/watten/konto/einstellungen` | Gemeinsames Suite-Konto, Watten-Kontext | Anmeldung, Änderungen, Logout-401-Race, Kontowechsel, no-store/noindex |
| `/watten/spiel/{id}` und `/zuschauen` | Eigener typisierter Tisch / Zuschauerprojektion | Fremde/alte ID, Anmeldung/Rückweg, stabile Sitze und erlaubte Sicht; P2/P3-abhängig |
| `/watten/rangliste`, eigene Historie/Erfolge | Vollständiges Watten-Fortschrittsumfeld | P6-Ergebnisbelege, Mitgliedschaft, Pagination, DE/EN, noindex gemäss Datenklasse |
| Wattenmanifest DE/EN, Icon-Aliasse und Worker | Eigene installierte Identität, gleiche Suite-Navigation | Produktionsimage, MIME/Scope, Browser-/PWA-Matrix; kein Cache privater Zustände |
| `/robots.txt`, `/sitemap.xml` | Tatsächlich bereitgestellte öffentliche Ziele | Vor Release geschlossen; nach Release exakt öffentliche Seiten und einheitlicher Host |
| `/api/health` | Technische Bereitschaft des bestehenden Dienstes | Gibt keine Konto-/Tischdaten; ausdrücklich kein Nachweis fertiger Wattenfunktion |

## Quelleninventar der Integration

| Vertrag | Zuständige Quellen / Folgearbeit |
| --- | --- |
| Fester Ursprung und sichere Pfade | `app/product_hosts.py`: expliziter Host, endliche tatsächlich eingeführte Ziele; keine aus Request-Host abgeleitete Vertrauensliste |
| Konto und Recovery | `app/account_context.py`, `api_auth.py`, `email_accounts.py`; `frontend/shared/auth.js`, `email-action.js`: Kontext/Weiterführung, lokale Tokens bleiben lokal, verschachtelte/duplizierte Handoffs ablehnen |
| Passkeys | `app/passkeys.py`: nur festen Wattenursprung unter passender konfigurierter RP-ID erlauben; fremde/lokale Origins unverändert streng prüfen |
| Dokumente und Static-Aliasse | `app/main.py`: Middleware, Login, Account-Aktionen, `/auth/continue`, Rootrouting; private HTML-Artefakte direkt sperren |
| Spielwechsel und installierter Einstieg | `frontend/multigame/routes.js`, `app-mode.js`, `frontend/shell/pwa.js`: Browser-Canonical und gleicher PWA-Ursprung, Bridge, Controller/Manifest/Launchmarker gemeinsam |
| Pushkontext | `frontend/shared/web-push.js`, `app/api_auth.py`, `web_push.py`, `models.py`: additive Migration für Kontextconstraints, Workerwahl, keine Kategorieeinwilligung durch Installation |
| Entdeckung und Auslieferung | `site_seo.py`, `check_product_delivery.py`, `verify_public_release.py`, Dockerfile, `tests/container_smoke.py`: tatsächliche HTTP-Routen/Dateien prüfen |
| Suite-Dienste | `api_game_activity.py`, `game_tours.py`, `friend_activity.py`, `release_manifest.py`, `release_push.py`, `push_reminders.py`, Analytics-/Dashboardfilter und zugehörige Frontends: ausdrücklich vollständig integrieren |
| Runtime und Speicherung | `game_types.py`, `game_registry.py`, `main.CreateReq`, Zugriff, Ergebnis-/Tombstonetypen, Lobbychat und Pushconstraints sind getrennte Grenzen |
| Infrastruktur | Eigenes Zertifikat/Vhost, enger ACME-Webroot, exakter öffentlicher Tokenbeweis, begrenzte Reloadbereitschaft, Erneuerung und Rückweg; bestehende Hosts erhalten |

## Reale Abnahme statt reiner Registrierung

Bestehende Vorlagen: `test_hausdepp_auth_flow.py`, `test_hausdepp_passkeys.py`,
`test_hausdepp_push_context.py`, `test_hausdepp_pwa.py`, Navigationstest und
`tests/browser-hausdepp-passkeys/`. Diese sind Muster, keine Wattennachweise.
Zusätzliche Browsermatrix: `suite-picker-routes.spec.js`,
`pwa-product-isolation.spec.js`, `email-navigation.spec.js`.

Vollständige Gast-/Kontoreise, privater Datenzugriff, Signaturen, echte
Worker-/Containerantworten und alle Übergänge werden für Watten selbst geprüft.
Regelengine, Team-/Wissensmodell und Fortschrittswerte bleiben ihren P0-
Entscheidungen zugeordnet. Keine abgeschlossene ID wird aus diesem Inventar
allein abgeleitet.

## Gegenprüfung privater Sicht

Claude hat S16/B07/B08/U13 lesend gegengeprüft. Codex übernimmt folgende
Prüfaufträge; sie entscheiden keine offenen Hausregeln:

- Bei gleicher eigener Hand, gleichem erlaubtem öffentlichen Verlauf und
  denselben ausdrücklich erlaubten privaten Partner-Rückmeldungen
  verborgene Ansage und fremde Hände variieren. Vor jeder regelgemässen
  öffentlichen Offenlegung müssen erlaubte Snapshots, Fehler, ARIA,
  Sortierung, Hinweise und CPU-Eingaben invariant bleiben. Ein später
  öffentlich geänderter Stichgewinner ist keine identische öffentliche Lage.
- CPU-Erinnerung sitzweise führen. Bei identischem erlaubtem Wissen und Seed
  dürfen fremde Geheimnisse weder Entscheidung noch Denkzeit verändern.
  Nach Prozessneustart nur eigenes erlaubtes Wissen rekonstruieren.
- Private Ereignisse dürfen über Versionszähler, Diagnose, Analytics,
  Erfolgsfeed, Abschlussanzeigen oder Worker-/Browsercache nichts verraten.
  Markerprüfungen untersuchen tatsächliche HTTP-/WebSocket-Ausgaben.
- Rejoin erhält die erlaubte Sicht desselben Sitzes. Geräteübernahme entmachtet
  den alten Socket vor weiterem privatem Fanout; Kontowechsel entfernt
  montierte Inhalte und verwirft späte Antworten.

Der Vierer-Blindmodus verpflichtet gemäss fester Vorgabe die **beiden
Einschauer**. Ein allgemeiner Trumpfzwang für Blinde wurde nicht beschlossen.
CPU-Ersatz in einem laufenden Spiel wird aus einem Warteraumvertrag ebenfalls
nicht abgeleitet. Diese Grenzen korrigieren mögliche zu weite Schlussfolgerungen
der Gegenprüfung.

Owner-Nachtrag: «gut / schlecht / keine Ahnung» ist ein ausdrücklich erlaubter
privater Kanal an den jeweiligen Mitspieler im Dreier/Vierer. Die konkrete
Karteninformation bleibt verboten. Der Invarianzvergleich hält diesen erlaubten
Informationsverlauf ebenfalls gleich; er darf erlaubte Kommunikation nicht
irrtümlich als Geheimnisleck behandeln.

**English:** P1 separates fixed host identity, actual routes, shared accounts,
passkeys, installed context, push consent, runtime adapters and public discovery.
The first host boundary stays closed and prevents accidental ZDWA delivery.
Every later route needs its real access, navigation and delivery checks.
