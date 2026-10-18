# Hausdepp – Retrospektive für die Watten-Planung

**Stand:** 18.10.2026, Europe/Zurich. **Geprüfte Quellbasis:**
`origin/develop` = `80bc42df17eb5852a5153582b263f6d065138f35` (3.10.0), in den
Recherche-Worktree als `2c3a589` integriert. Keine Watten-Entwicklung.

## Ergebnis und Lesart

Die wichtigste übertragbare Erfahrung ist die vollständige Nutzerreise:
Regelengine, Tischdarstellung und Suite-Dienste müssen gemeinsam geplant werden.
Hausdepp erhielt nach dem ersten spielbaren Tisch unter anderem unmittelbare
Aktionen, sichtbare Transfers, native Kontoflows, freiwillige Folgetische,
flexible Warteräume und weitere CPU-Taktik. Ein Teil waren echte Fehler, ein
Teil neue Wünsche und ein Teil von Anfang an notwendige Schutzverträge.

**81 Befunde und Prüfverträge** sind unten mit Ursache/Einordnung, Quellen,
heutiger Sicherung und konkreter Watten-Abnahme dokumentiert. Es sind nicht
81 neue Bugs. Überschneidungen bleiben absichtlich aus verschiedenen
Verantwortungsperspektiven sichtbar. Jede ID ist vollständig in den
[Watten-Umsetzungsplan](WATTEN_IMPLEMENTATION_PLAN.md) übertragen.

Drei heutige Restpunkte sind gesondert eingegrenzt: **S27** Rezeptübernahme
neuer Warteraumoptionen (offene Vertragsfrage), **S28** fehlende Browserkombination
für Hausdepp-Freundestarts (Abdeckungslücke) und **S29** nachlaufender
Remindertext (Dokumentationslücke). Daraus wird kein unbelegter aktueller
Spiel-, Versand- oder Datenschutzfehler behauptet. **B06** ist ein noch
festzulegender Wiederholungs-/Quittungsvertrag; **O07** eine Geräte-Nachweisgrenze.

## Untersuchung und Aussagegrenzen

Untersucht wurden die integrierte Git-Historie ab dem ersten Hausdepp-Commit
`818f98d`, ausgewählte ältere gemeinsame Sessionfixes, sämtliche unten
aufgeführten PR-Beschreibungen, Commit- und Dateiinventare, kritische
Änderungsdiffs und heutige Quell-/Teststellen. Drei unabhängige Teilprüfungen
vertieften Spielerreise/Integration, Oberfläche und Engine/CPU/Persistenz.
Die PR-Dateilisten wurden vollständig paginiert; die Grenzen von `gh pr view`
(100 Dateien) wurden bei #28 und #41 nicht als vollständige Inventare behandelt.

Die 20 untersuchten PRs enthalten laut abgerufenen GitHub-Daten keine
Conversation-Kommentare oder formalen Reviews. Das sagt nichts über
Quellreviews, UI-Abnahmen oder Gespräche ausserhalb dieser GitHub-Felder aus.
Historische Testzahlen und Produktionsaussagen aus PR-Beschreibungen sind
jeweils damalige Berichte, keine erneute Liveverifikation. Die Quellprüfung
hat keine physischen Geräte, echten persönlichen Partien oder tatsächliche
Pushzustellung benutzt. Diese Dokumentation ändert keine Hausdepp-Funktion.

Die heutigen Codeverweise sind an den oben genannten Basiscommit gebunden;
Testnamen benennen vorhandene Absicherungen. Neue Watten-Prüfaufträge sind
Anforderungen für später und heute nicht implementiert. Ein aktueller
vollständiger Prüfbericht für diese Dokumentationsänderung wird beim Push
separat über den verbindlichen lokalen Ablauf geführt.

## Historie und PR-Abdeckung

Die erste Hausdepp-Implementierung entstand vor den PRs #28 ff. Sie auszulassen
würde gerade die frühen Integrationsnachträge verdecken:

| Commit | Aussage der integrierten Änderung |
| --- | --- |
| [`818f98d`](https://github.com/Maetran/RollTheDice/commit/818f98d) | Owner-only Lobby, erster spielbarer Tisch, Engine/Adapter/Projektion. |
| [`6e1f619`](https://github.com/Maetran/RollTheDice/commit/6e1f619) | Aktives privates Abheben, sofortige Aktionen und geordnete Auffüllpflichten. |
| [`6402ec2`](https://github.com/Maetran/RollTheDice/commit/6402ec2) | Gegnerhände und erkennbare Kartentransfers. |
| [`d5a90ab`](https://github.com/Maetran/RollTheDice/commit/d5a90ab) | Lobby-, Konto- und Regelbuchabläufe vervollständigt. |
| [`cfba2ac`](https://github.com/Maetran/RollTheDice/commit/cfba2ac) | Spielauswahl und Navigation in installierten Apps. |
| [`6a7e35e`](https://github.com/Maetran/RollTheDice/commit/6a7e35e), [`92e25e1`](https://github.com/Maetran/RollTheDice/commit/92e25e1) | Erfolge/Ränge/Turniere sowie XP-Gewichtung, Tisch- und Suite-Integration. |
| [`21cc14d`](https://github.com/Maetran/RollTheDice/commit/21cc14d) | Öffentliche V3-Freigabe; frühere Owner-only-Berichte sind historisch. |
| [`ca30739`](https://github.com/Maetran/RollTheDice/commit/ca30739), [`4b59e31`](https://github.com/Maetran/RollTheDice/commit/4b59e31), [`c597abd`](https://github.com/Maetran/RollTheDice/commit/c597abd) | TLS-/ACME-Bereitschaft und fehlende Container-Manifeste nachgearbeitet. |
| [`62856e1`](https://github.com/Maetran/RollTheDice/commit/62856e1) | Grössere mobile Kartenstapel. |

Die folgenden Zahlen zählen geänderte Dateien laut GitHub, einschliesslich
geballter generierter Assets. Sie sind keine Zahl eigenständig neuer Features.
#30 betraf ZDWA und wurde als Kontext eingeordnet; #37 ist der noch offene
Watten-Dokumentations-PR selbst und kein abgeschlossener Hausdepp-Fix.

| PR | Geänderte Dateien | Schwerpunkt / Bezug |
| --- | ---: | --- |
| [#28](https://github.com/Maetran/RollTheDice/pull/28) | 170 | Native Konten, CPU, Tisch, Erfolge und Assets (S02–S06, B08/B09, U03/U15). |
| [#29](https://github.com/Maetran/RollTheDice/pull/29) | 91 | Folgetische, Mehrfachauswahl, Lade-/PWA-/Tourfixes (S14/S17–S20/S25, U20). |
| [#31](https://github.com/Maetran/RollTheDice/pull/31) | 83 | Zufallsgeber, Peekwissen, Präferenz und Touchfehler (B04, U14). |
| [#32](https://github.com/Maetran/RollTheDice/pull/32) | 76 | Tischaktionen, Deko und isolierte Testkonten (U15/U17/U18, O04). |
| [#33](https://github.com/Maetran/RollTheDice/pull/33) | 65 | Lesbare öffentliche Abläufe und responsive Hände (U07/U09). |
| [#34](https://github.com/Maetran/RollTheDice/pull/34) | 60 | Tatsächliche Kartenmasse während Animation (U05). |
| [#35](https://github.com/Maetran/RollTheDice/pull/35) | 67 | Neueste Erfolge im Konto-/Ranglistenkontext; Datenschutz und Filter (B16/B19). |
| [#36](https://github.com/Maetran/RollTheDice/pull/36) | 84 | Sofortige Würfe, Queue/Timing und vorgerenderte Karten (B09, U01/U06/U08). |
| [#38](https://github.com/Maetran/RollTheDice/pull/38) | 72 | Kaufentscheidungen, sanfte Stärke und Tipps (B08/B10/B11). |
| [#39](https://github.com/Maetran/RollTheDice/pull/39) | 3 | Versionshistorie mit ausgelieferter Revision korrigiert (O03). |
| [#40](https://github.com/Maetran/RollTheDice/pull/40) | 61 | Öffentliches Abheben verständlich zeigen, reale CPU-Tests (U09/U13/U21). |
| [#41](https://github.com/Maetran/RollTheDice/pull/41) | 108 | Rundenabschluss, Tischdetails, Payload, Suite-Dienste und Langzeitziele (S23/S29, B18/B20, U03). |
| [#42](https://github.com/Maetran/RollTheDice/pull/42) | 1 | Browser-Races zu Draw, Geber und DOM/Snapshot (O05/U21). |
| [#43](https://github.com/Maetran/RollTheDice/pull/43) | 75 | Spielneutrale DE/EN-Kontotexte, fehlende Übersetzung (S23/O11). |
| [#44](https://github.com/Maetran/RollTheDice/pull/44) | 64 | Lesbarer Tisch, Deckkraft und aktive Markierungen (U16). |
| [#45](https://github.com/Maetran/RollTheDice/pull/45) | 7 | Duell-CPU bewertet Ass-Pakete differenzierter (B10/B12). |
| [#46](https://github.com/Maetran/RollTheDice/pull/46) | 100 | Flexlobby, Favoriten, CPU-Ersatz und sofortiger Stapelstand (S08–S12/S27, U07). |
| [#47](https://github.com/Maetran/RollTheDice/pull/47) | 59 | Logout-401-Race und isolierte Gerätewechseltests (S05/O04). |
| [#48](https://github.com/Maetran/RollTheDice/pull/48) | 29 | Vollständige lokale Prüfungen und exakter Integrationsnachweis (O05/O06). |
| [#49](https://github.com/Maetran/RollTheDice/pull/49) | 57 | Hohe Karten zurückhalten, sichere Abschlüsse und echter Referenzbenchmark (B11/B12). |

## Befunde: Kennzeichnung

Beispiele mit zwei Wissenden/zwei Blinden und festen Partnerteams betreffen
das Vierer-Blindprofil. Zweier-, Dreier- und offene Profile benötigen ihre
eigene freizugebende Wissenstabelle. Vergleiche blinder CPU-Entscheidungen
halten eigene Hand, öffentlichen Verlauf und Zufallszustand gleich.

- **Historischer Fehler:** konkretes falsches Verhalten und Korrektur belegt.
- **Spätere Anforderung/Qualitätsverbesserung:** gewachsener Produktwunsch; kein rückwirkender Bugvorwurf.
- **Bestehende Absicherung:** heutiger Quell-/Testvertrag, der bei Watten bewusst wieder gebraucht wird.
- **Offene Entscheidung/Deckungslücke:** eng benannter Nachweis oder Vertrag fehlt; noch kein bestätigter Produktfehler.
- **Watten-Ableitung:** neues Risiko wegen Bieten, Partnerschaft oder Geheimwissen; Hausdepp beweist diesen Regelfall nicht.

## Spielerreise und Suite-Integration

### S01 — Öffentlicher Einstieg ohne Konto und bei gestörter Identitätsabfrage

- **Typ/Historie:** Spätere Freigabestufe, kein nachgewiesener Fehler. [21cc14d – öffentlicher Hausdepp-Start](https://github.com/Maetran/RollTheDice/commit/21cc14daebf250737faa7633df10e353f00a4036) erweiterte den Owner-Preview.
- **Aktueller Beleg:** [app/main.py:1139–1148](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/main.py#L1139-L1148) trennt öffentliche Dokumente und geschützte Ziele. [frontend/hausdepp/index.js:1208–1216](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/index.js#L1208-L1216) fängt Auth-Ausfall auf Lobby/Regeln ab.
- **Tests:** `tests/test_hausdepp_public_release.py::test_public_lobby_and_rules_are_indexable_on_each_suite_host_with_one_canonical`; [tests/browser/hausdepp-public.spec.js:49](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/browser/hausdepp-public.spec.js#L49) anonymous lobby/rules without private requests, `:153` unavailable identity service, `:206` No-JavaScript.
- **Watten-Aktion:** Öffentlichkeits-/Anmeldematrix vor Routen festlegen. Regeln, Spielbeschreibung und Anmeldung ohne persönliche Requests ausliefern.
- **Abnahme:** Anonym, JavaScript deaktiviert sowie `/api/auth/me=503`: Watten erklären, Regeln und Anmeldung erreichbar; weder eigene Tische noch Chat/Verlauf anfragen.

### S02 — Native Anmeldung und Kontoeinstellungen trotz gemeinsamem Konto

- **Typ/Historie:** Spätere Anforderung. [PR #28](https://github.com/Maetran/RollTheDice/pull/28), `72eeda9`, ergänzte ausdrücklich native Hausdepp-Anmeldung und Kontoeinstellungen.
- **Aktueller Beleg:** [app/main.py:1333–1349](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/main.py#L1333-L1349) stellt Produkt-Anmeldung/Settings bereit; [frontend/hausdepp/settings.js:58–90](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/settings.js#L58-L90) verwendet gemeinsame Kontoaktionen und produktinterne Rücksprünge.
- **Tests:** `tests/test_hausdepp_auth_flow.py::test_house_auth_pages_keep_product_identity_and_protected_settings`; [tests/browser-hausdepp-passkeys/account-flow.spec.js:47](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/browser-hausdepp-passkeys/account-flow.spec.js#L47) prüft Passkeys, Umbenennen, Backup-Passwort und dasselbe Konto.
- **Watten-Aktion:** Registrierung, Passwort/Passkey, Name, Profilbild, Sprache, E-Mail, Recovery und Logout als vollständige erste Kontoreise planen.
- **Abnahme:** Bestehendes Suite-Konto in Watten anmelden; Name/Avatar/Sprache ändern; danach dieselbe Benutzer-ID und Änderungen in anderen Spielen sehen. Nach sensibler Änderung bei Watten weiterführen.

### S03 — Passkey-Ursprünge ausdrücklich erlauben

- **Typ/Historie:** Spätere Anforderung aus [PR #28](https://github.com/Maetran/RollTheDice/pull/28), `72eeda9`: echte Passkey-Anmeldung auf dem Hausdepp-Ursprung.
- **Aktueller Beleg:** [app/passkeys.py:147–164](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/passkeys.py#L147-L164) erlaubt Hausdepp nur als feste bekannte Subdomain des konfigurierten RP; keine Erweiterung durch beliebige Hosts oder lokale/staging RPs.
- **Tests:** `tests/test_hausdepp_passkeys.py::test_fixed_house_origin_is_added_only_to_its_parent_rp_and_aliases_are_not_advertised`; `::test_house_passwordless_signup_authentication_and_sensitive_registration_use_real_signatures`; `::test_house_ceremonies_still_reject_another_trusted_product_origin_and_missing_csrf`; Browser [tests/browser-hausdepp-passkeys/in-origin.spec.js:34](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/browser-hausdepp-passkeys/in-origin.spec.js#L34).
- **Watten-Aktion:** Produktursprung, RP-Zuordnung, Session-Cookie und Origin-Prüfung vor Entwicklung abstimmen; keine Request-Host-basierte Freigabe.
- **Abnahme:** Registrierung/Anmeldung mit echten virtuellen Signaturen im Browser/installierten Kontext; manipulierte Origin-/Hostfälle ablehnen, lokale Tokens niemals nach Produktion schicken.

### S04 — Produktkontext in Recovery- und E-Mail-Links

- **Typ/Historie:** Spätere Anforderung aus [PR #28](https://github.com/Maetran/RollTheDice/pull/28), `72eeda9`, für Registrierung, Bestätigung, Reset und E-Mail-Änderung.
- **Aktueller Beleg:** [app/account_context.py:8–11](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/account_context.py#L8-L11) priorisiert feste Hostidentität; `:14–42` entpackt höchstens einen erlaubten relativen Handoff; `:45–55` hält lokale/staging Tokens in ihrer Umgebung und benutzt Tokenfragmente. Frontend: [frontend/multigame/routes.js:215–238](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/multigame/routes.js#L215-L238).
- **Tests:** `tests/test_hausdepp_auth_flow.py::test_registration_email_completion_and_reset_retain_shared_identity_and_house_context`; `::test_mail_context_unwraps_only_a_single_relative_valid_house_continuation`; `::test_mail_tokens_never_cross_from_a_local_or_staging_environment_into_production`; Browser `account-flow.spec.js:178`, `:228`.
- **Watten-Aktion:** Rücksprungziel nur aus bekannter Routenmenge; E-Mail-Kontext zentral erweitern.
- **Abnahme:** Gültiger Reset führt zurück zu Watten; fremde URL, doppelte Parameter, verschachtelter Handoff und ungültiges Token enden sicher innerhalb der erwarteten Umgebung.

### S05 — Logout gegen parallele 401-Antwort absichern

- **Typ/Historie:** Behobener Fehler. [PR #47](https://github.com/Maetran/RollTheDice/pull/47), [2a5e7ec](https://github.com/Maetran/RollTheDice/commit/2a5e7ec53aac5c4134c47f06cc05071be681df09): parallele 401 leerte den Auth-Cache vor dem Lesen öffentlicher Spielfreigabe; konkurrierende Navigation schickte teilweise zu ZDWA.
- **Aktueller Beleg:** [frontend/shared/auth.js:499–516](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/shared/auth.js#L499-L516) liest Freigabe vor dem Request; [frontend/hausdepp/settings.js:126–129](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/settings.js#L126-L129) überlässt dem Auth-State-Listener die einzige Navigation.
- **Tests:** [tests/browser-hausdepp-passkeys/account-flow.spec.js:149–169](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/browser-hausdepp-passkeys/account-flow.spec.js#L149-L169) erzwingt die Reihenfolge und genau einen richtigen Rücksprung.
- **Watten-Aktion:** Gemeinsames Logout verwenden, eine Navigationsverantwortung; öffentlichen Zugang nicht aus bereits invalidiertem Cache rekonstruieren.
- **Abnahme:** Settingsrequest wird während Logout 401, Logoutantwort verzögert: genau eine Navigation zur Watten-Lobby.

### S06 — Konto-Wechsel entfernt montierte private Inhalte

- **Typ/Historie:** Schutzanforderung aus [21cc14d](https://github.com/Maetran/RollTheDice/commit/21cc14daebf250737faa7633df10e353f00a4036), kein hier neu nachgewiesener Fehler.
- **Aktueller Beleg:** [frontend/hausdepp/index.js:1246–1264](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/index.js#L1246-L1264) leert Root, zerstört Controller, bricht Requests ab, schliesst Socket, lädt neu; BFCache-Rückkehr lädt frisch.
- **Tests:** [tests/browser/hausdepp-public.spec.js:164](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/browser/hausdepp-public.spec.js#L164), signing out in another tab removes preceding account data.
- **Watten-Aktion:** Identitätswechsel invalidiert Hand, Wissen, Teamwahl, Einladungen, Dialoge und offene Requests.
- **Abnahme:** A spielt, anderer Tab meldet ab/zu B um: A-Hand/private Ansagen verschwinden sofort; späte A-Antworten dürfen nichts neu montieren.

### S07 — Spielwechsel im Browser und in installierten Apps

- **Typ/Historie:** Spätere Suite-Integration. [cfba2ac](https://github.com/Maetran/RollTheDice/commit/cfba2ac10b835b5d805a7f0931a7ad2085287abe) ergänzte Spielauswahl/PWA-Navigation.
- **Aktueller Beleg:** [frontend/multigame/routes.js:184–211](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/multigame/routes.js#L184-L211) verwendet Browser-Subdomains oder gleiche PWA-Origin mit Produktpfaden/Bridge. Backend [app/main.py:918–973](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/main.py#L918-L973).
- **Tests:** [tests/browser/pwa-product-isolation.spec.js:145](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/browser/pwa-product-isolation.spec.js#L145), `:196`, `:213`, `:240`; [tests/browser/game-picker.spec.js:141](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/browser/game-picker.spec.js#L141), `:209`, `:230`.
- **Watten-Aktion:** Watten in dieselbe Routen-/App-Identitätsmatrix eintragen, einzelne Links nicht hart codieren.
- **Abnahme:** Von jedem Spiel zu jedem anderen und zurück, Browser/PWA: Session und PWA-Identität/Worker erhalten, keine ungewollte externe Browseransicht.

### S08 — Sitzanzahl, CPUs und Start als getrennte Konzepte

- **Typ/Historie:** Spätere Anforderung. [PR #46](https://github.com/Maetran/RollTheDice/pull/46), `eed5443`: offen/fix, CPUs im Warteraum und ausdrücklicher Hoststart lösten die zwingende endgültige Besetzung beim Erstellen ab.
- **Aktueller Beleg:** [app/hausdepp_state.py:51–115](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_state.py#L51-L115), `:193–208`; [app/hausdepp_waiting.py:41–80](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_waiting.py#L41-L80); [frontend/hausdepp/game-creator.js:9–30](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/game-creator.js#L9-L30).
- **Tests:** `tests/test_hausdepp_flexible_waiting.py::test_open_room_never_autostarts_and_start_freezes_actual_tournament_roster`; `::test_open_requires_two_and_connected_humans_while_fixed_manual_requires_capacity`; `::test_host_guards_reject_other_account_stale_socket_forged_actor_and_spectator`.
- **Watten-Aktion:** 2-/3-/4-Personenvarianten und Teams direkt im Warteraummodell; Startbesetzung explizit prüfen.
- **Abnahme:** 4er startet erst mit vier gültig belegten Sitzen und vollständiger gewählter Teamzuordnung. Verbindung/CPU-Änderung startet nicht heimlich.

### S09 — Hausdepp-Sitzreihenfolge nicht als Watten-Teammodell übernehmen

- **Typ/Historie:** Bestandsanforderung seit `818f98d`, CPU-Ersatz später [PR #46](https://github.com/Maetran/RollTheDice/pull/46). Kein Hausdepp-Fehler: dort keine Nutzer-Teamwahl.
- **Aktueller Beleg:** [app/hausdepp_state.py:181–185](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_state.py#L181-L185) fügt Menschen im Uhrzeigersinn vor CPU-Sitzen ein.
- **Tests:** `tests/test_hausdepp_flexible_waiting.py::test_free_seats_precede_cpu_replacement_and_removed_cpu_ids_are_not_reused`; `::test_persistence_lobby_metadata_and_start_permissions_agree_after_cpu_replacement`.
- **Watten-Aktion:** Sitz-ID, Teilnehmer-ID, Konto-ID, Team-ID und Verbindungs-ID unterscheiden; Team/Sitz ausdrücklich wählen statt Joinreihenfolge oder Mensch/CPU abzuleiten.
- **Abnahme:** Beliebige Beitrittsreihenfolge, Teamwahl, CPU-Ersatz, Hostdeparture, Reload: gewählte Teams/Sitze konsistent.

### S10 — CPU-Sitzersatz mit Reservationsvorrang

- **Typ/Historie:** Spätere Anforderung aus [PR #46](https://github.com/Maetran/RollTheDice/pull/46), `eed5443`.
- **Aktueller Beleg:** [app/hausdepp_state.py:155–173](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_state.py#L155-L173) prüft Zulassung vor Mutation, nutzt freie Sitze zuerst und ersetzt CPU erst bei vollem Warteraum. [app/hausdepp_rematch.py:133–144](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_rematch.py#L133-L144) schützt eingeladene Menschen.
- **Tests:** `tests/test_hausdepp_flexible_waiting.py::test_fixed_full_room_accepts_human_in_cpu_seat_without_changing_capacity`; `::test_rematch_full_waiting_cpu_table_accepts_a_human_after_invitee_declines`; `::test_rematch_invitee_can_accept_again_and_replace_cpu_without_losing_reservation`.
- **Watten-Aktion:** Definieren, ob Teamwahl konkreten CPU-Sitz ersetzt und wer CPUs ändern darf; atomare Admission vor Mutation.
- **Abnahme:** Zwei Menschen wollen denselben CPU-/Teamplatz: genau einer erhält ihn, Zahlen und Teams gültig. Nach Start keine spontane Ersetzung.

### S11 — Kontofavoriten ohne Raumgeheimnisse

- **Typ/Historie:** Spätere Anforderung aus [PR #46](https://github.com/Maetran/RollTheDice/pull/46), `eed5443`.
- **Aktueller Beleg:** [app/api_hausdepp_favourite.py:21–36](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/api_hausdepp_favourite.py#L21-L36) striktes Schema; `:46–84` kontogebunden, CSRF/no-store. [frontend/hausdepp/game-creator.js:33–37](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/game-creator.js#L33-L37) verlangt frisches Passwort bei geschütztem Favorit.
- **Tests:** `tests/test_hausdepp_favourite.py::test_save_replace_and_delete_are_durable_and_account_scoped`; `::test_authentication_csrf_and_secret_or_account_fields_are_rejected`; Browser `hausdepp-flex-lobby.spec.js:80`, `:112`, `:126`.
- **Watten-Aktion:** Falls Favoriten gewünscht: Variante/Ziel/CPU-Wunsch als Rezept; keine Karten, persönlichen Fremdteamzuweisungen oder Passwörter.
- **Abnahme:** Zweites Gerät desselben Kontos erhält Konfiguration, anderes Konto nicht. Favoritenlesefehler blockiert individuelle Erstellung nicht.

### S12 — Geschützte Tischlinks enthalten kein Passwort

- **Typ/Historie:** Erweiterung des geschützten Joinablaufs mit [PR #46](https://github.com/Maetran/RollTheDice/pull/46).
- **Aktueller Beleg:** [frontend/hausdepp/table-access.js:3–16](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/table-access.js#L3-L16) sitzungs-/kontogebundene Speicherung; `:17–42` ausdrückliche Abfrage. Passwort nur im authentifizierten WebSocket-Join, nie URL.
- **Tests:** [tests/browser/hausdepp-flex-lobby.spec.js:139](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/browser/hausdepp-flex-lobby.spec.js#L139); `tests/test_hausdepp_flexible_waiting.py::test_real_http_and_socket_password_open_room_add_remove_and_manual_start`.
- **Watten-Aktion:** Teilen/Kopieren nur kanonische Tisch-URL; Login erhält Tisch, umgeht Schutz nicht.
- **Abnahme:** Frischer Browser: Link, Login, falsch/richtiges Passwort, Abbrechen/Neuversuch. URL/History/Referrer ohne Passwort.

### S13 — Warteraum verlassen, Verbindung verlieren und abbrechen unterscheiden

- **Typ/Historie:** Spätere Anforderung aus [PR #28](https://github.com/Maetran/RollTheDice/pull/28), `72eeda9`: wartende Sitze ausdrücklich verlassen.
- **Aktueller Beleg:** [app/hausdepp_waiting.py:83–122](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_waiting.py#L83-L122) nur eigene aktive Verbindung, Hostübergabe, letzter Wartender schliesst ohne Punkte; Mutationen vor erstem await.
- **Tests:** `tests/test_hausdepp_waiting.py::test_real_sockets_release_own_seat_transfer_host_and_retire_last_waiter_without_points`; `::test_started_tables_stale_sockets_spectators_and_forged_identity_cannot_leave`; Browser `hausdepp-waiting.spec.js:91` Start-/Leave-Race ohne Ersatz-Endaktion.
- **Watten-Aktion:** Explizite Lifecycle-Zustände und Aktionen; Team/Sitz nur beim echten Leave freigeben, Disconnect als Rejoin behandeln.
- **Abnahme:** Host geht, Nachfolger erhält Rechte; letzter geht ohne Ergebnis. Start gewinnt Race: Spieler bleibt, kein versehentlicher Abbruch.

### S14 — Eigene dauerhafte Ablaufuhr für Warteräume

- **Typ/Historie:** Spätere Anforderung aus [PR #29](https://github.com/Maetran/RollTheDice/pull/29), `d4ced75`: eine Stunde seit letztem neuen menschlichen Sitz.
- **Aktueller Beleg:** [app/game_state.py:68–103](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/game_state.py#L68-L103), `:124` nutzt `_hausdepp_waiting_last_join_at`; [app/hausdepp_state.py:190](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_state.py#L190) erneuert nur bei neuem Menschen.
- **Tests:** `tests/test_hausdepp_waiting_timeout.py::test_only_a_successful_new_human_seat_renews_the_waiting_deadline`; `::test_stored_waiting_deadline_survives_a_restart_with_newer_general_activity`; `::test_real_reconnect_viewer_chat_and_pings_do_not_prevent_periodic_retirement`.
- **Watten-Aktion:** Warten, laufende Partie, Bietantwort und Pause mit bewusst verschiedenen Fristen; Reload/Chat hält verwaiste Tische nicht ewig offen.
- **Abnahme:** Pings, Zuschauer, Rejoin, Neustart ändern Warteraum-Ende nicht; neuer gültiger Mensch erneuert genau nach Regel.

### S15 — Kontogebundener Rejoin vor Kapazitätsprüfung

- **Typ/Historie:** Behobener Suitefehler. [4e47264](https://github.com/Maetran/RollTheDice/commit/4e47264db772515c071c1f56cf8bc2c7b4d66ada), Gerätesitze wiederherstellen; Hausdepp verwendet gemeinsame Sessionlogik.
- **Aktueller Beleg:** [app/game_ws_session.py:116–129](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/game_ws_session.py#L116-L129) wandelt Linkjoin in eigenen Kontorejoin vor voll/gestartet um; `:291–330` prüft Eigentum und beendet alten Socket fatal als `session_replaced` gegen Rückeroberungsloop.
- **Tests:** `tests/test_hausdepp_integration.py::test_reconnect_restores_only_account_owned_hand_and_durable_private_state`; `tests/test_hausdepp_local_multiplayer.py::test_two_account_join_private_play_manual_refill_disconnect_and_account_rejoin`.
- **Watten-Aktion:** Sitz/Team/Wissen an Teilnehmer/Konto binden, nicht Socket; alten Socket entmachten.
- **Abnahme:** Voller laufender Tisch, frisches Gerät öffnet Tischlink: gleicher Sitz/Team/Hand/Wissensstand; Altgerät kann nicht mehr handeln/ansagen.

### S16 — Eigene informationsarme Zuschauerprojektion

- **Typ/Historie:** Grundanforderung seit `818f98d`; keine aktuelle Lücke nachgewiesen. [PR #28](https://github.com/Maetran/RollTheDice/pull/28) erhielt die Privatsphäre beim Produktstart.
- **Aktueller Beleg:** [app/hausdepp_snapshot.py:20–39](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_snapshot.py#L20-L39): Zuschauer-ID nie Handbesitzer, auch Founder nicht; Default Zuschauerprojektion. Session [app/game_ws_session.py:201–259](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/game_ws_session.py#L201-L259).
- **Tests:** `tests/test_hausdepp_integration.py::test_projection_and_fanout_never_share_hands_stock_or_failed_peek`; `::test_guest_is_limited_to_public_documents_and_signed_in_spectators_keep_cards_private`.
- **Watten-Aktion:** Projektionen für Wissenden, Blinden, CPU, Zuschauer; Freundestart darf eigenen Sitz nicht zum Zuschauer machen.
- **Abnahme:** Zwei Wissende, zwei Blinde, Zuschauer, Founder: jeweils nur erlaubte Daten, auch kein indirekter Schlag/Trumpf über Aktionen, Sortierung oder Diagnose.

### S17 — Gemeinsamer Folgetisch nur mit ausdrücklicher Annahme

- **Typ/Historie:** Spätere Anforderung. [PR #29](https://github.com/Maetran/RollTheDice/pull/29), `d4ced75`.
- **Aktueller Beleg:** [frontend/hausdepp/rematch.js:31–42](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/rematch.js#L31-L42) eigener Create-Klick als eigene Zustimmung; `:83–104` nur explizite Accept/Decline; Backend [app/hausdepp_rematch.py:211–287](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_rematch.py#L211-L287).
- **Tests:** `tests/test_hausdepp_rematch.py::test_same_settings_private_password_and_cpu_count_without_implicit_human_seats_or_rewards`; Browser `hausdepp-rematch-real.spec.js:33` echter Zwei-Konten/CPU/Retirement-Fall; `hausdepp-rematch.spec.js:50`, `:86`, `:203`.
- **Watten-Aktion:** Folgetisch/Einwilligung früh planen; Schliessen ist nicht Ablehnen; Teamwiederwahl ausdrücklich definieren.
- **Abnahme:** Einer erstellt, ein Tisch; andere bleiben bis Annahme. Prompt schliessen oder andere aktive Partie bewirkt keinen Beitritt.

### S18 — Dauerhafte Folgetisch-Rezepte ohne erneute Wertung

- **Typ/Historie:** Spätere Anforderung aus [PR #29](https://github.com/Maetran/RollTheDice/pull/29).
- **Aktueller Beleg:** [app/hausdepp_rematch.py:40–69](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_rematch.py#L40-L69) speichert Mitglieder/Konfiguration, gesalzene Raumprüfwerte; `:211–252` erholt Recipe/Terminalzustand, Erstellung unter Lock/einmaligem Insert.
- **Tests:** `tests/test_hausdepp_rematch.py::test_duplicate_and_concurrent_creation_is_one_durable_target_and_retry_recovers_it`; `::test_actual_timeout_retirement_and_restart_can_recreate_original_parameters`; `::test_capture_database_failure_keeps_terminal_recovery_without_interrupting_broadcast_or_retirement`; `::test_completed_outcome_stays_successful_when_capture_fails_and_startup_retries_recipe_only`.
- **Watten-Aktion:** Recipe schemafest definieren: Variante, Ziel, Ansagen-/Gestrichenregel, Schutz, CPUs, Team/Sitzübernahmeentscheidung. Keine Hände/Klartextgeheimnisse.
- **Abnahme:** Nach Ende/Abbruch, Retirement, Neustart gleicher Folgetisch; Doppelrequest, Antwortverlust, DB-Fehler weder mehrere Tische noch doppelte Punkte.

### S19 — Reservation, Ablehnung und späteren Join unterscheiden

- **Typ/Historie:** Behobener Fehler. [8ce1b5b](https://github.com/Maetran/RollTheDice/commit/8ce1b5b27fbb307bb5b0485afabad4a831235e06), [PR #29](https://github.com/Maetran/RollTheDice/pull/29): bereits belegten Sitz nach früherem Decline anerkennen. PR #46 ergänzt CPU-/Startinteraktion.
- **Aktueller Beleg:** [app/hausdepp_rematch.py:108–144](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_rematch.py#L108-L144) trennt pending, accepted, joined, aktive Konten und Reservationen; [app/hausdepp_waiting.py:61–69](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_waiting.py#L61-L69) nutzt Guard.
- **Tests:** `tests/test_hausdepp_rematch.py::test_declined_invitation_then_deliberate_normal_join_does_not_require_acceptance_again`; `::test_committed_accept_with_lost_response_remains_resumable_until_actual_join`; `::test_accept_and_seat_mutation_cannot_race_into_an_overbooked_table`; `::test_real_waiting_leave_releases_reservation_and_transfers_host_for_remaining_player`.
- **Watten-Aktion:** Kontoreservation und Team-/Platzbindung ausdrücklich definieren; Accept ist noch keine bestätigte Socketbelegung.
- **Abnahme:** Acceptantwort verloren, Retry, CPU-Join, Decline/später bewusster Join, Hostwechsel: keine Doppelbelegung, Platzverluste oder ungewollten Teamwechsel.

### S20 — Optionale Einladungen unterbrechen keine aktive Interaktion

- **Typ/Historie:** Teil der neuen Rematchfunktion [PR #29](https://github.com/Maetran/RollTheDice/pull/29).
- **Aktueller Beleg:** [frontend/hausdepp/rematch.js:43–51](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/rematch.js#L43-L51), `:108–150` berücksichtigt hidden tabs, Dialoge, Web Locks, Abort/Polls; [frontend/hausdepp/index.js:1238–1240](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/index.js#L1238-L1240) sperrt Angebote während eigener aktiver Partie.
- **Tests:** [tests/browser/hausdepp-rematch.spec.js:118](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/browser/hausdepp-rematch.spec.js#L118) hidden tab/native dialog, `:216` späte Createantwort nach Navigation, `:310` Warten bis Spielende.
- **Watten-Aktion:** Modalpriorität auf Einschauen, Bieten, Teamwahl, Rundenende anwenden; Antworten an Seiten-/Identitätslebensdauer binden.
- **Abnahme:** Einladung bei Einschauen/Bietantwort: keine Unterbrechung/Leak, erst sicher präsentieren; nach Seitenwechsel keine späte Fremdnavigation.

### S21 — Teilen, persönliche Einladung und allgemeiner Spielerruf trennen

- **Typ/Historie:** Spielerruf in `21cc14d`, persönliche Folgetische [PR #29](https://github.com/Maetran/RollTheDice/pull/29), CPU-Kompatibilität [PR #46](https://github.com/Maetran/RollTheDice/pull/46).
- **Aktueller Beleg:** [frontend/hausdepp/invitations.js:46–82](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/invitations.js#L46-L82) pusht nur Call-Klick; [app/web_push.py:441–461](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/web_push.py#L441-L461) verlangt öffentlichen wartenden Tisch und eigenen Sitz; `:547–603` prüft Opt-in, echten Absender, aktive Konten/Selbst-Ausschluss.
- **Tests:** `tests/test_hausdepp_invitations.py::test_sender_allowlist_and_terminal_state_are_rechecked`; `::test_cpu_seats_remain_invitable_until_replaced_by_humans`; `::test_empty_attempt_consumes_account_barrier_and_exposes_no_recipient_data`; Browser `hausdepp-invitations.spec.js:38`, `:83`.
- **Watten-Aktion:** Kanäle getrennt planen; nur gültige verfügbare Team-/CPU-Ersatzplätze bewerben, keine Geheimnisse im Link.
- **Abnahme:** Share/Copy pusht nicht; unberechtigter Sender, privater/gestarteter/voller Tisch oder widerrufenes Opt-in senden nichts; serverseitige spielübergreifende Cooldowns.

### S22 — Geräteberechtigung ist kein Kategorieopt-in

- **Typ/Historie:** Hausdepp-Kontext seit öffentlichem Start `21cc14d`; bestehende Suitegrenzen, später vollständigere Integration [a18c056](https://github.com/Maetran/RollTheDice/commit/a18c0566bbf067eec1def52187788b62b7dd6821).
- **Aktueller Beleg:** [app/web_push.py:240–284](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/web_push.py#L240-L284) übernimmt Endpunkt auf aktuellen Nutzer/Produkt; `:277–283` hält Kategorien getrennt; Schema `:97`, Kontext `:249`.
- **Tests:** `tests/test_hausdepp_push_context.py::test_device_context_uses_installed_identity_without_enabling_message_categories`; `::test_endpoint_reassignment_moves_context_and_owner_without_a_duplicate`; Browser `hausdepp-push-settings.spec.js:108`, `:135`.
- **Watten-Aktion:** `watten` kontrolliert in Schema/Migration/Workerwahl/Settings/Versand ergänzen, kein stiller ZDWA-Fallback.
- **Abnahme:** Frische PWA registriert Watten ohne Kategorieaktivierung; Wechsel A→B übernimmt Endpunkt ohne Push für A; andere Suite-Settings benutzen tatsächlichen installierten Worker.

### S23 — Reminder, Freundestarts und Settingssprache vollständig integrieren

- **Typ/Historie:** Klar belegter später Nachtrag. [a18c056](https://github.com/Maetran/RollTheDice/commit/a18c0566bbf067eec1def52187788b62b7dd6821) vom 17.10. ergänzt 32 bilinguale Reminder, Freundestarts mit Zuschauerlink und Texte, die zuvor nur ZDWA/Zilch nannten.
- **Aktueller Beleg:** [app/push_reminders.py:79–118](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/push_reminders.py#L79-L118), `:123–134`; [app/friend_activity.py:35–38](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/friend_activity.py#L35-L38), `:53–91`; [frontend/shared/friend-activity.js:18–38](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/shared/friend-activity.js#L18-L38); Settings [frontend/hausdepp/settings.js:32–43](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/settings.js#L32-L43).
- **Tests:** `tests/test_push_reminders.py::test_a_hausdepp_device_gets_its_own_reminder`; `::test_both_apps_alternate_without_two_reminders_and_all_copy_is_bilingual`; `tests/test_avatars_friend_activity.py::test_live_notice_requires_current_selection_and_never_includes_the_player`.
- **Watten-Aktion:** Integrationsliste: Spieleauswahl/Aktivitätszahlen, Auswahl, Startmeldungen, Pushkategorien, Reminderrotation, Releasehinweise, Touren, Konto-/Regeltexte. Jeden Dienst integrieren oder begründet ausschliessen.
- **Abnahme:** Start nur für berechtigte ausgewählte Freunde, keine privaten Tische/Selbstlinks; bei aktivem Reminder und mehreren PWAs höchstens ein Tageshinweis, korrekte Wattenidentität/DE/EN, kein Versand nach bereits gespieltem Tag.

### S24 — PWA-Identität über Manifest hinaus abnehmen

- **Typ/Historie:** Behobene fehlende Icon-Erkennung in [PR #28](https://github.com/Maetran/RollTheDice/pull/28); echte Workerreloads/Kaltladen/Bildretry in [PR #29](https://github.com/Maetran/RollTheDice/pull/29). Beide ersetzen ausdrücklich keine physische iPhoneinstallation.
- **Aktueller Beleg:** [hausdepp-manifest.webmanifest:5–8](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/hausdepp-manifest.webmanifest#L5-L8) eigene ID/Startadresse mit Suite-Scope; [app/static/hausdepp-sw.js:30–48](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/static/hausdepp-sw.js#L30-L48) enger Netzwerkworker, HTTP-Cache für öffentliche Karten, kein privates Cache Storage; Offline `:13–27`, Pushklick `:51–79`.
- **Tests:** `tests/test_hausdepp_pwa.py::test_manifest_identity_preserves_suite_navigation_without_a_root_worker`; `::test_apple_discovery_aliases_are_public_host_specific_png_for_get_and_head`; Browser `hausdepp-pwa.spec.js:32`, `:61`, `:94`, `:129`; `pwa-product-isolation.spec.js:252`.
- **Watten-Aktion:** Manifest/Worker/Installed-Entry/Pushidentität gemeinsam; öffentliche Motive cachbar, Hände/Schlag/Trumpf nie offline speichern.
- **Abnahme:** Kaltstart/Workerupdate Browser und iPhone-WebKit; physische Installation/Homescreen/Pushklick separat abnehmen. Offline verständlich, Reconnect richtiger Sitz.

### S25 — Sichtbare Hilfe vor langsamen Einstellungen binden

- **Typ/Historie:** Behobener Fehler. [764dfd4](https://github.com/Maetran/RollTheDice/commit/764dfd4af1624a9a8740677852437af37986debe), [PR #29](https://github.com/Maetran/RollTheDice/pull/29): sichtbare Touraktionen waren erst nach initialem Einstellungsabruf bedienbar.
- **Aktueller Beleg:** [frontend/shared/game-tours.js:391–417](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/shared/game-tours.js#L391-L417) bindet Start/Vorschau vorher, nur datenabhängiger Toggle wartet.
- **Tests:** [tests/browser/game-tours.spec.js:442](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/browser/game-tours.spec.js#L442) sichtbare Aktionen vor Präferenzantwort, `:469` Toggle, `:763` Hausdepp wartet auf echte Aktion nach Einschauen.
- **Watten-Aktion:** Teamwahl/Regeln/Hilfe/Abbrechen sofort binden oder erkennbar deaktivieren; Tour löst keine echten Ansagen/Einschauaktionen aus.
- **Abnahme:** Konto-/Favoriten-/Tourrequest blockiert, unmittelbar sichtbare Aktion klicken: funktioniert ohne späteren Geisterklick.

### S26 — SEO- und Navigationsregister als Lieferbestandteil

- **Typ/Historie:** Öffentlicher Start `21cc14d`; neue Login-/Settings-/Rematch-/Flexfälle in [PR #28](https://github.com/Maetran/RollTheDice/pull/28), [#29](https://github.com/Maetran/RollTheDice/pull/29), [#46](https://github.com/Maetran/RollTheDice/pull/46) nachgeführt.
- **Aktueller Beleg:** [app/site_seo.py:13–24](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/site_seo.py#L13-L24) öffentlich/privat, `:75–76` nur Lobby/Regeln dauerhaft; [tests/test_navigation_contract.py:121–149](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/test_navigation_contract.py#L121-L149) Routen-/Prüfzuordnung, `:195–227` Vollständigkeitsguard.
- **Tests:** `tests/test_hausdepp_public_release.py::test_public_lobby_and_rules_are_indexable_on_each_suite_host_with_one_canonical`; `tests/test_navigation_contract.py::test_every_document_route_has_explicit_navigation_coverage`; `::test_inventory_references_existing_regression_tests`.
- **Watten-Aktion:** Routeninventar mit Ziel, Anmeldung, Canonical, noindex, Spieltyp und Prüfung vor Implementierung.
- **Abnahme:** Lobby/Regeln kanonisch; Konto/Spiel/Zuschauen/Login noindex; fremde/alte Spiel-IDs keine falsche Hülle, private Static-Aliasse gesperrt.

### S27 — Offene Rematch-Rezeptfrage bei neuer flexibler Lobby

- **Typ:** Aktuelle Vertrags-/Abdeckungsfrage, **kein bewiesener Bug**.
- **Historie:** [PR #46](https://github.com/Maetran/RollTheDice/pull/46) ergänzt `waiting_mode` und `manual_start` nach dem Rematch aus [PR #29](https://github.com/Maetran/RollTheDice/pull/29).
- **Aktueller Beleg:** [app/hausdepp_rematch.py:59–62](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_rematch.py#L59-L62) speichert beide nicht; `:267–268` übergibt sie nicht an `configure_hausdepp_game`; Defaults in [app/hausdepp_state.py:51–52](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_state.py#L51-L52) sind fixed/false.
- **Tests/Lücke:** [tests/test_hausdepp_flexible_waiting.py:224–277](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/test_hausdepp_flexible_waiting.py#L224-L277) testet Rematch nur fixed/manual=False. Quellseitig sicher: Folgetisch übernimmt nicht alle neuen Wartemodusoptionen. Unerwünschtheit ist nicht bewiesen; Anleitung spezifiziert vor allem Spielerzahl/CPU/Turnier/Schutz.
- **Watten-Aktion:** Verbindlich entscheiden, was übernommen oder neu gewählt wird: Teams, Sitze, Variante, Zielpunkte, Ansagen, Wartemodus. Vollständiger versionierter Recipevertrag.
- **Abnahme:** Vergleich Ursprung/Folgetisch für jede konfigurierte Option im lebenden, retireten und neugestarteten Zustand; nur ausdrücklich gewollte Unterschiede.

### S28 — Hausdepp-Freundestarts fehlen in Browser-Zielmatrix

- **Typ:** Aktuelle Browserabdeckungslücke, **kein nachgewiesenes Fehlverhalten**.
- **Historie:** [a18c056](https://github.com/Maetran/RollTheDice/commit/a18c0566bbf067eec1def52187788b62b7dd6821) aktiviert Hausdepp-Freundestarts in Backend/Frontend.
- **Aktueller Beleg:** [frontend/shared/friend-activity.js:18–38](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/shared/friend-activity.js#L18-L38) und [app/friend_activity.py:81–91](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/friend_activity.py#L81-L91) behandeln Hausdepp; [tests/browser/navigation-destinations.spec.js:83–90](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/browser/navigation-destinations.spec.js#L83-L90) listet nur ZDWA-/Zilch-Fälle.
- **Tests:** Backend `tests/test_avatars_friend_activity.py::test_live_notice_requires_current_selection_and_never_includes_the_player` prüft Hausdepp; Browsermatrix bleibt unvollständig. Quellpfad wirkt schlüssig.
- **Watten-Aktion:** Von Anfang an Watten-Browser-/PWA-Ziele in vollständige Spiel-/Hostmatrix aufnehmen.
- **Abnahme:** Freundestart öffnet richtigen Watten-Zuschauertisch auf Browser-Canonical oder aktuellem PWA-Ursprung; eigenen Sitz nicht überschreiben.

### S29 — Dokumentationsnachlauf zu Hausdepp-Remindern

- **Typ:** Aktueller Dokumentationsnachlauf, **kein Versandfehler**.
- **Historie:** [a18c056](https://github.com/Maetran/RollTheDice/commit/a18c0566bbf067eec1def52187788b62b7dd6821) liefert Hausdepp-Erinnerungen.
- **Aktueller Beleg:** [docs/HAUSDEPP.md:414–418](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/docs/HAUSDEPP.md#L414-L418) sagt noch: „Eine tägliche Hausdepp-Erinnerung ist damit nicht zugesagt.“ Code [app/push_reminders.py:123–134](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/push_reminders.py#L123-L134) liefert sie.
- **Tests:** `tests/test_push_reminders.py::test_a_hausdepp_device_gets_its_own_reminder`.
- **Watten-Aktion:** Dienstaktivierung, Settingscopy, README und Anleitung gemeinsam liefern und aktivierte Suite-Dienste gemeinsam abhaken.
- **Abnahme:** Alle DE/EN-Produkttexte beschreiben dieselbe aktuell aktivierte Reminder-/Opt-in-Funktion; kein widersprüchliches altes Versprechen oder veralteter Ausschluss.

## Regelengine, CPU und dauerhafte Ergebnisse

### B01 — Hausregeln als ausführbare, versionierte Domäne

- **Typ:** Bereits initial vorhandene Architekturentscheidung, kein historisch belegter Bug.
- **Historie:** [Initialcommit `818f98d`](https://github.com/Maetran/RollTheDice/commit/818f98d) führte eine reine Engine mit neu zurückgegebenem Zustand und ausdrücklicher Projektionsgrenze ein.
- **Aktueller Pfad und Zeile:** [app/hausdepp_engine.py:17](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_engine.py#L17) enthält Rangfolge und Ruleset; [app/hausdepp_engine.py:275](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_engine.py#L275) Eingabevalidierung und neue Zustandskopie.
- **Tests:** `test_invalid_or_duplicate_deck_is_rejected`, `test_mixed_missing_and_duplicate_cards_are_rejected`; `test_seeded_interleaved_human_actions_preserve_cards_fifo_finishes_and_privacy` prüft zusätzlich unveränderten alten Zustand bei Ablehnung.
- **Watten-Aktion:** Eigene versionierte Ruleset-Daten, keine Rangordnung aus Hausdepp übernehmen. Rein prüfbare Funktionen für Stichbewertung und Zustandsübergänge vorsehen.
- **Abnahme:** Gleiche vier ausgespielte Karten bei unterschiedlichen bestätigten Schlag-/Trumpfkombinationen ergeben jeweils den erwarteten Gewinner. Ein regelwidriger Zug verändert weder Hand, Stich, Gebot noch Zugrecht.

### B02 — Regelumsetzung und aktive Spielerhandlung getrennt prüfen

- **Typ:** Nachträgliche Regel-/Interaktionspräzisierung.
- **Historie:** [`6e1f619`](https://github.com/Maetran/RollTheDice/commit/6e1f619) ersetzte das vorher beim Erzeugen der Runde vollständig automatisch erledigte Abheben durch eine aktive `peeking`-Phase.
- **Aktueller Pfad und Zeile:** [app/hausdepp_engine.py:305](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_engine.py#L305) und [app/hausdepp_engine.py:359](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_engine.py#L359) enthalten die ausdrückliche Schrittfolge.
- **Tests:** `test_mandatory_peek_is_private_one_active_tap_per_card_before_dealing`, `test_active_human_peek_acknowledges_each_tap_and_rejection_restores_private_projection`.
- **Watten-Aktion:** Austeilen, unterste unveränderte Handkarte bestimmen, privates Zusammenzeigen, Kenntnisnahme und erstes Ausspiel als getrennte Phasen festlegen. Sortieren darf nicht die Ansagekarte wechseln.
- **Abnahme:** Einer der beiden Wissenden lädt während des Zusammenzeigens neu. Er erhält denselben bestimmten Kartenwert; Blinde erhalten ihn weder vor noch nach dem Wiederverbinden.

### B03 — Gleichzeitige Handlungen brauchen fachliche Konfliktklassen

- **Typ:** Nachträgliche Flowpräzisierung und Absicherung.
- **Historie:** [`6e1f619`](https://github.com/Maetran/RollTheDice/commit/6e1f619) führte unmittelbare Handzüge bei weiterhin offener FIFO-Auffüllpflicht ein. Nicht jede fremde Änderung macht deshalb den eigenen Zug ungültig.
- **Aktueller Pfad und Zeile:** [app/hausdepp_engine.py:290](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_engine.py#L290) unterscheidet Tisch- und Spielerversionen; [app/hausdepp_engine.py:315](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_engine.py#L315) schützt die gemeinsame Ressource.
- **Tests:** `test_other_players_refill_does_not_make_a_valid_table_command_stale`, `test_stock_follows_refill_queue_and_last_card_settles_all_empty_hands`, `test_invalid_or_stale_next_action_does_not_close_afterthrow`.
- **Watten-Aktion:** Festlegen, welche Ereignisse ein offenes Gebot, eine Gebotsantwort oder eine bereits gewählte Karte schliessen. Abgelehnte und veraltete Befehle dürfen keine Gelegenheit verbrauchen.
- **Abnahme:** Gebot und vierte Stichkarte treffen nahezu gleichzeitig ein. Genau eine festgelegte Reihenfolge gilt; Einsatz, Stichgewinner und Rundenschluss sind für alle vier Ansichten identisch.

### B04 — Sitzreihenfolge kann Zufallsrollen unbeabsichtigt verzerren

- **Typ:** Ausdrücklich belegter historischer Fairnessfehler.
- **Historie:** [PR #31](https://github.com/Maetran/RollTheDice/pull/31), Commit [`52825b4`](https://github.com/Maetran/RollTheDice/commit/52825b4), dokumentiert: Anfangs gab immer der letzte Sitz; weil CPUs hinter Menschen sassen, durfte bei mindestens drei Spielern kein Mensch abheben.
- **Aktueller Pfad und Zeile:** [app/hausdepp_state.py:209](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_state.py#L209) wählt den ersten Geber zufällig; [app/hausdepp_tournament.py:156](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_tournament.py#L156) rotiert ihn.
- **Tests:** `test_first_dealer_is_random_and_the_deal_then_passes_clockwise`, `test_dealer_position_determines_peeker_and_clockwise_starter`.
- **Watten-Aktion:** Partner, Geber, im Uhrzeigersinn folgender Schlagansager und Blinde anhand der tatsächlichen Sitzordnung modellieren.
- **Abnahme:** Über vier Folgerunden waren alle vier Sitze genau einmal Geber und Schlagansager; gegenüber sitzende Partner bleiben unverändert.

### B05 — Autorität nach dem Warten auf die Spielsperre erneut prüfen

- **Typ:** Vorhandene Absicherung, kein belegter neuer Fehler.
- **Historie:** Initialer Adapter, mit Turnier- und Mehrgeräteflüssen weiter abgesichert.
- **Aktueller Pfad und Zeile:** [app/hausdepp_gameplay.py:107](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_gameplay.py#L107) prüft nach Erwerb der Sperre, ob der Socket noch der aktuelle Sitzsocket ist. Zuschauer und gefälschte CPU-Akteure werden zusätzlich abgewiesen.
- **Tests:** `test_next_round_socket_ack_and_replaced_socket_protection`, `test_cpu_actor_cannot_be_forged_or_joined`; `test_two_account_join_private_play_manual_refill_disconnect_and_account_rejoin` umfasst fremde Spieler-ID und gefälschtes Wiederaufnahmetoken.
- **Watten-Aktion:** Weder `player_id` noch Teamsitz aus dem Browser als Autorität übernehmen. Alte Geräte dürfen nach Sitzübernahme auch wartende Befehle nicht mehr ausführen.
- **Abnahme:** Gerät A sendet „Vier halten“ und wartet auf die Sperre; Gerät B übernimmt inzwischen den Sitz. A wird ohne Änderung von Gebot oder Punkten abgewiesen.

### B06 — Wiederholungsschutz und wiederholbare Bestätigung sind verschiedene Verträge

- **Typ:** Künftige Spezifikationsentscheidung; kein nachgewiesener Hausdepp-Bug.
- **Historie:** Befehls-ACKs im bestehenden Gameplay-Adapter und dessen Integrationsprüfungen.
- **Aktueller Pfad und Zeile:** [app/hausdepp_gameplay.py:100](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_gameplay.py#L100) verwendet `command_id` zur ACK-Korrelation. Die Mutation wird durch Versionen geschützt; dort existiert keine dauerhafte, anhand derselben ID erneut auslieferbare Befehlsquittung.
- **Tests / Grenze der Abdeckung:** `test_manual_refill_is_one_private_socket_command_without_blocking_cpu_turn` wehrt doppelte Auffülltipps ab; Peeking und nächste Turnierrunde besitzen ACK-Prüfungen. Ein verlorenes erfolgreiches ACK mit später identischer Befehls-ID als wiederholter Erfolg ist dort kein zugesicherter Vertrag.
- **Watten-Aktion:** Ausdrücklich entscheiden, ob Wiederholungen nur wirkungslos abgewiesen werden oder dieselbe sichere Quittung zurückgeben sollen.
- **Abnahme:** „Gehen“ wird angenommen, ACK geht verloren, Browser verbindet neu und wiederholt denselben Befehl: kein zweites Anschreiben, keine zweite Runde und eindeutige sichtbare Auflösung.

### B07 — Datenschutz durch Projektionen und echten Fanout beweisen

- **Typ:** Seit initialer Implementierung bestehende Architekturanforderung.
- **Historie:** Initialcommit [`818f98d`](https://github.com/Maetran/RollTheDice/commit/818f98d) und anschliessende Integrationsprüfungen.
- **Aktueller Pfad und Zeile:** [app/hausdepp_engine.py:428](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_engine.py#L428) baut eine ausdrückliche Allowlist. Gegnerhände und Nachziehreihenfolge fehlen; unbekannte Betrachter erhalten keine Aktionen. [app/hausdepp_snapshot.py:27](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_snapshot.py#L27) verhindert, dass eine Zuschaueridentität als Handbesitzer verwendet wird.
- **Tests:** `test_projection_and_fanout_never_share_hands_stock_or_failed_peek` prüft tatsächlich an alle Empfänger gesendete Nachrichten, Metadaten und Lobbylisten; `test_reconnect_restores_only_account_owned_hand_and_durable_private_state`.
- **Watten-Aktion:** Vier Sitzansichten plus Zuschaueransicht. Partner eines Wissenden ist weiterhin blind. Ereignisse, Tipps, Fehlerantworten, Kontohistorie und Erfolge dürfen Schlag/Trumpf nicht vorzeitig offenlegen.
- **Abnahme:** Nur verborgenes Schlag-/Trumpfwissen ändern und öffentliche Situation gleich lassen: Die beiden blinden Ansichten bleiben identisch, einschliesslich erlaubter Karten und Fehlermeldungen.

### B08 — CPU und Tipps erhalten nur das Wissen ihres Sitzes

- **Typ:** Bestehende Fairnessgarantie.
- **Historie:** CPU-Projektion bereits initial; sichere Schlussketten und eigene Erinnerung in [#28](https://github.com/Maetran/RollTheDice/pull/28), Tipps in [#38](https://github.com/Maetran/RollTheDice/pull/38).
- **Aktueller Pfad und Zeile:** [app/hausdepp_cpu_runner.py:70](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_cpu_runner.py#L70) ruft CPU mit persönlicher Projektion auf. [app/hausdepp_cpu_strategy.py:51](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_cpu_strategy.py#L51) simuliert ausdrücklich keine unbekannten Gegnerhände. [app/hausdepp_snapshot.py:35](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_snapshot.py#L35) erzeugt Tipps ebenfalls aus der persönlichen Ansicht.
- **Tests:** `test_choices_ignore_hidden_hands_stock_order_and_private_achievement_metadata` vertauscht echte Gegnerhände und Stapelreihenfolge und prüft identische Entscheidung; absichtlich eingeschleuste Geheimfelder ändern sie ebenfalls nicht.
- **Watten-Aktion:** Wissende und blinde CPUs erhalten unterschiedliche erlaubte Informationsstände. Hinweise für Blinde dürfen keine Kenntnis durch eine serverseitig berechnete „richtige“ Karte verraten.
- **Abnahme:** Identischer öffentlicher Verlauf bei unterschiedlicher verborgener Ansage: blinde CPU entscheidet identisch; wissende CPU darf passend anders entscheiden.

### B09 — CPU-Timing braucht unabhängige Fristen und Neuberechnung

- **Typ:** Neue Qualitätsfunktion in #28; später belegte Ablaufkorrektur.
- **Historie:** [#28](https://github.com/Maetran/RollTheDice/pull/28); [`11387a3`](https://github.com/Maetran/RollTheDice/commit/11387a3) korrigierte einen bereits wartenden Runner: Er musste die Ankunft menschlicher Karten beachten; sonst konnte der nächste CPU-Zug das Nachwurffenster schliessen, bevor der Mensch die Karte lesen konnte.
- **Aktueller Pfad und Zeile:** [app/hausdepp_cpu_runner.py:180](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_cpu_runner.py#L180) verwendet unabhängige Sitzfristen und berechnet die Entscheidung unter Sperre neu.
- **Tests:** `test_two_cpu_seats_race_by_their_deadline_instead_of_participant_order`, `test_human_additional_card_is_accepted_during_wait_and_cpu_recomputes`, `test_waiting_runner_lets_a_human_card_land_before_the_next_cpu_turn`.
- **Watten-Aktion:** Animation darf keine Regelautorität schaffen. Gebote und menschliche Antworten müssen während CPU-Denkzeit korrekt verarbeitet werden.
- **Abnahme:** CPU plant Ausspiel; während ihrer Pause wird Drei geboten. Sie reagiert auf die aktuelle Gebotssituation und setzt keinen vorher berechneten Kartenzug durch.

### B10 — Legalität allein reicht für die CPU-Abnahme nicht

- **Typ:** Produktverbesserung in #38; enger belegter taktischer Fehlentscheid in #45.
- **Historie:** [#38](https://github.com/Maetran/RollTheDice/pull/38) ergänzte Kaufen statt unnötigem Verbrennen hoher Karten. [#45](https://github.com/Maetran/RollTheDice/pull/45) zeigte danach eine verbleibende Duellausnahme: Im in PR #45 berichteten Audit von 1’500 Vollstärkepartien wurden die übrigen untersuchten Duellsituationen mit Assspitze und eigener Zehn stets mit der Zehn abgeräumt; das ist keine universelle Aussage für alle Stärken und Hände. [`3acbf23`](https://github.com/Maetran/RollTheDice/commit/3acbf23) änderte die Bewertung.
- **Aktueller Pfad und Zeile:** [app/hausdepp_cpu_strategy.py:159](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_cpu_strategy.py#L159).
- **Tests:** `test_buys_a_lone_ace_instead_of_burning_a_ten_while_stock_remains`, `test_heads_up_weighs_an_ace_topped_packet_instead_of_always_clearing_it`.
- **Watten-Aktion:** Zusätzlich zu legalen Zügen taktische Beispielhände für Partnerspiel, Sticheinsparung und Informationsgewinn definieren. Keine Hausdepp-Taktik direkt übertragen.
- **Abnahme:** Partner hält den Stich sicher; CPU verbraucht ihre höchste bekannte Karte nicht grundlos. Bei Unsicherheit eines blinden Sitzes muss dieselbe Hand anders bewertet werden dürfen.

### B11 — Sanftere Stärke darf sichere Abschlüsse nicht zerstören

- **Typ:** Neue Zurückhaltetaktik plus ausdrücklich belegter historischer Bugfix.
- **Historie:** [#49](https://github.com/Maetran/RollTheDice/pull/49); Der integrierte Commit [`6e6d3a5`](https://github.com/Maetran/RollTheDice/commit/6e6d3a5) übernimmt die Korrektur: Zufälliges Übersehen wurde vor der Prüfung eines garantiert abschliessenden Nachwurfs ausgeführt. Dadurch konnte selbst der sichere Schlusszug ausfallen.
- **Aktueller Pfad und Zeile:** [app/hausdepp_cpu_strategy.py:282](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_cpu_strategy.py#L282) prüft den sicheren Abschluss zuerst.
- **Tests:** `test_keeps_its_high_reserve_through_its_own_afterthrow_but_finishes_with_it` prüft volle und sanfte Stärke mit kontrolliertem RNG; `test_an_ordinary_afterthrow_can_still_be_missed` schützt die weiterhin gewünschte Variation.
- **Watten-Aktion:** Pflichtregeln und sichere, aus erlaubtem Wissen bewiesene Abschlüsse vor Schwierigkeitsfehlern auswerten.
- **Abnahme:** Selbst niedrigste Stärke verletzt niemals die Trumpfpflicht und verweigert keinen bereits bewiesenen dritten Teamstich aufgrund eines Zufallsaussetzers.

### B12 — Benchmarks müssen echte Produktionsparameter und Referenzen verwenden

- **Typ:** Nachträgliche Verbesserung der Belegqualität in #49, kein Spielregelbug.
- **Historie:** [`6e6d3a5`](https://github.com/Maetran/RollTheDice/commit/6e6d3a5) übernimmt eine eingefrorene echte 3.8.2-Policy und den reproduzierbaren Vergleich in den integrierten Stand.
- **Aktueller Pfad und Zeile:** [tests/test_hausdepp_cpu_strategy.py:214](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/test_hausdepp_cpu_strategy.py#L214) lässt jeden Kandidatensitz auf denselben Austeilungen gegen diese Referenz antreten, einschliesslich produktiver Stärke und Zufallsaussetzer; `tests/hausdepp_cpu_policy_382.py` hält die Referenz fest.
- **Tests:** `test_holding_back_beats_the_frozen_3_8_2_policy_at_production_settings`; Referenzvergleich und Timing-Rennen sind getrennte Tests.
- **Watten-Aktion:** CPU-Abnahme über gepaarte Austeilungen und alle Sitz-/Wissensrollen. Teamgewinn, Gebotsentscheidungen und Stagnation getrennt messen; eine Einzelserie beweist keine allgemeine Verbesserung.
- **Abnahme:** Gleiche vier Hände, jede Policy auf jeder Sitzposition und in beiden Teams; alle Partien enden, keine CPU nutzt fremdes Wissen. Taktikbenchmark ersetzt keine Echtzeitprüfung.

### B13 — Invarianten und serialisierte Wiederaufnahme über ganze Partien

- **Typ:** Vorhandene umfangreiche Absicherung, kein Nachweis eines heutigen Fehlers.
- **Historie:** Reine Engine seit [`818f98d`](https://github.com/Maetran/RollTheDice/commit/818f98d), Queue-/Legacy-Verhalten seit [`6e1f619`](https://github.com/Maetran/RollTheDice/commit/6e1f619).
- **Aktueller Pfad und Zeile:** [tests/test_hausdepp_engine_adversarial.py:16](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/test_hausdepp_engine_adversarial.py#L16) prüft Erhaltung aller 36 Karten, eindeutige Fertigreihenfolge, zulässige Zugrechte, FIFO und Zuschauerrechte. Derselbe Test serialisiert Zustände während zufällig verschachtelter Handlungen wiederholt nach JSON zurück.
- **Tests:** `test_seeded_interleaved_human_actions_preserve_cards_fifo_finishes_and_privacy`, `test_persisted_old_single_debt_releases_next_turn_without_dealing_or_wiping`.
- **Watten-Aktion:** Entsprechende komplette Partien für das bestätigte Deck, alle Geberpositionen, Gebote, Gehen und frühzeitigen Rundenschluss prüfen.
- **Abnahme:** Nach jedem Ereignis existiert jede Karte genau einmal; maximal vier Karten pro Stich; kein weiterer Stich nach drei Teamstichen; Neustart zwischen Gebot und Antwort verändert weder Einsatz noch Wissensrollen.

### B14 — Finalisierung vor Abschluss-Broadcast; Terminalzustand bis dauerhafter Buchung behalten

- **Typ:** Vorhandene Wiederherstellungsarchitektur.
- **Historie:** Ergebnisablage initial; XP-/Turnierintegration mit [`6a7e35e`](https://github.com/Maetran/RollTheDice/commit/6a7e35e) und Folgearbeiten.
- **Aktueller Pfad und Zeile:** [app/hausdepp_gameplay.py:75](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_gameplay.py#L75) versucht die Finalisierung vor dem Finished-Broadcast. Bei zurückgemeldetem Persistenzfehler wird der fachlich beendete Zustand trotzdem gesendet; der Rückgabewert ist kein Broadcast-Gate. [app/hausdepp_results.py:217](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_results.py#L217) synchronisiert aus dauerhaften Ergebnissen; Fehlschläge behalten den aktiven Zustand. [app/active_games.py:57](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/active_games.py#L57) dokumentiert Terminaldaten ausdrücklich als Recoveryquelle.
- **Tests:** `test_finished_broadcast_waits_for_round_persistence`, `test_failed_result_write_retains_round_and_prevents_starting_next`, `test_finalization_failure_is_recovered_by_account_read_and_retry_keeps_original`. Der Broadcasttest prüft die Reihenfolge im Erfolgsfall, kein Broadcastverbot bei Datenbankfehler.
- **Watten-Aktion:** Fachliches Ende, dauerhafte Buchung und Wiederherstellung getrennt modellieren. Gewinnerteam, gebotene Punkte und Ergebnis-ID einmal dauerhaft festhalten, danach Fortschritt ableiten; ausstehende Buchung verständlich kennzeichnen.
- **Abnahme:** Datenbankfehler beim entscheidenden 8+3; Neustart und erneute Finalisierung erzeugen genau ein 11-Punkte-Endergebnis und einmalige XP.

### B15 — Runde, Partie, Turnier und Tisch sind verschiedene Identitäten

- **Typ:** Nachträglich hinzugefügte Produktfunktion, keine übertragbare Wattenregel.
- **Historie:** Hausdepp-Turniere kamen mit [`6a7e35e`](https://github.com/Maetran/RollTheDice/commit/6a7e35e).
- **Aktueller Pfad und Zeile:** [app/hausdepp_tournament.py:20](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_tournament.py#L20) erzeugt eigene begrenzte Runden-IDs; [app/hausdepp_tournament.py:73](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_tournament.py#L73) verhindert doppelte Verlustbuchstaben; die nächste Runde verlangt dauerhaften Abschluss und Hostautorität ([app/hausdepp_tournament.py:137](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_tournament.py#L137)).
- **Tests:** `test_unique_round_ids_remain_bounded_for_long_room_ids`, `test_next_round_requires_host_finished_persisted_round_and_fresh_version`, `test_interround_state_survives_database_reload_and_preserves_results`, `test_contradictory_restored_scores_fail_closed`.
- **Watten-Aktion:** Stich → Runde/Gabe → Partie bis 11 → weitere Partie/Turnier ausdrücklich unterscheiden. Nicht pro Stich dieselben Belohnungen vergeben wie pro Partie.
- **Abnahme:** Reload nach der letzten Gabe, zweimaliger „Nächste Partie“-Befehl und langer Tischbezeichner ergeben genau eine neue Partie; Partner- und Punktestand gehören zur richtigen Ebene.

### B16 — Erfolge aus bewiesenen Ereignissen; fehlende Historie ist kein Beweis

- **Typ:** Vorhandene Anforderung seit XP-/Erfolgsfunktion.
- **Historie:** [`6a7e35e`](https://github.com/Maetran/RollTheDice/commit/6a7e35e) ergänzte private Erfolgsbelege; Folgepräzisierungen bewahren Unsicherheit alter Zustände.
- **Aktueller Pfad und Zeile:** [app/hausdepp_achievement_evidence.py:101](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_achievement_evidence.py#L101) hängt Evidenz nur an akzeptierte Übergänge. Alte Zustände werden als unvollständig markiert. Insbesondere beweisen unbekannte frühere Aufnahmen keinen „ohne Aufnahme“-Erfolg. [app/hausdepp_results.py:41](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_results.py#L41) entfernt private Trackingdaten aus dem Ergebnis.
- **Tests:** `test_unknown_legacy_past_does_not_prove_no_ten_or_fabricate_previous_peek`, `test_new_no_pickup_achievement_requires_complete_pickup_tracking`, `test_schema_two_evidence_is_strict_bounded_and_strips_all_tracking`.
- **Watten-Aktion:** Von Beginn an Erfolgsbelege für echte spätere Definitionen planen; keine konkrete Erfolgszahl oder Schwelle aus Hausdepp übernehmen.
- **Abnahme:** Eine alte Partie ohne vollständiges Gebotsprotokoll beweist weder „nie geboten“ noch „alle Gebote gehalten“. Ein Achievement darf Blinden während der laufenden Gabe keinen verborgenen Schlag verraten.

### B17 — XP, Grantgeneration und Anzeigequittung getrennt modellieren

- **Typ:** Nachträgliche Produktpräzisierung für CPU-Gewichtung; Schutz gegen doppelte/verschluckte Anzeigen.
- **Historie:** [`92e25e1`](https://github.com/Maetran/RollTheDice/commit/92e25e1) führte gewichtete Hausdepp-XP ein.
- **Aktueller Pfad und Zeile:** [app/hausdepp_achievements.py:504](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_achievements.py#L504) unterscheidet gewichteten Score und stabile Grantgeneration. Der pro Konto gesperrte Abgleich steht in [app/hausdepp_achievements.py:420](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_achievements.py#L420); Unique-Schlüssel in [app/models.py:639](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/models.py#L639).
- **Tests:** `test_concurrent_recovery_creates_one_credit_and_one_unlock_per_definition`, `test_concurrent_stale_receipts_use_exact_weighted_score_and_rank`, `test_late_older_completion_does_not_reannounce_seen_badges_or_hide_new_ones`, `test_real_legacy_migration_reweights_credits_and_recovers_seen_score_before_new_round`.
- **Watten-Aktion:** Belohnungspolitik für CPU-/Menschentische zuerst entscheiden; Score und Anzeigeversion nicht gleichsetzen.
- **Abnahme:** Zwei Kontotabs gleichen dieselbe Partie ab, danach kommt eine ältere Partie verspätet hinzu. Keine Doppel-XP; eine alte Quittung kann neue Erfolge nicht verbergen.

### B18 — Rundenwert ist nicht der kumulierte Kontowert

- **Typ:** Konkreter historischer Berechnungsbug in #41.
- **Historie:** [#41](https://github.com/Maetran/RollTheDice/pull/41), [`21017d9`](https://github.com/Maetran/RollTheDice/commit/21017d9), korrigierte die Ergebnisanzeige: `awarded_points` war der laufende Grantstand und wurde fälschlich als Wert eines einzelnen Erfolgs summiert.
- **Aktueller Pfad und Zeile:** [app/hausdepp_round_summary.py:39](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_round_summary.py#L39) verwendet die Punkte aus dem Erfolgskatalog.
- **Tests:** `test_round_xp_and_only_this_rounds_achievements_per_seat`, `test_a_seat_without_a_credit_shows_no_invented_xp`.
- **Watten-Aktion:** Abschlusskarte strikt auf diese Partie begrenzen. Persönliche Gesamt-XP, öffentlicher Rang und Teamspielpunkte sind unterschiedliche Werte.
- **Abnahme:** Konto mit 4’000 bestehenden XP erhält einen 20-XP-Erfolg: Abschluss zeigt exakt die neue Belohnung, nicht 4’020. Fehlender Credit wird als unbekannt dargestellt, nicht durch einen erfundenen Standard ersetzt.

### B19 — Private Historie braucht echte Mitgliedschaft und stabile Pagination

- **Typ:** Weiter ausgebaute Produktfunktion, kein bewiesener heutiger Datenverlust.
- **Historie:** Kontofluss mit [`d5a90ab`](https://github.com/Maetran/RollTheDice/commit/d5a90ab), weitere Absicherung durch `6a7e35e`, `92e25e1` und [#28](https://github.com/Maetran/RollTheDice/pull/28).
- **Aktueller Pfad und Zeile:** [app/hausdepp_account.py:62](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_account.py#L62) scannt alle eigenen Ergebnisse in begrenzten Quellenpaketen; Anzeigelimit kürzt nicht die Gesamtsumme. Cursor trägt keine Autorität. [app/hausdepp_results.py:124](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_results.py#L124) validiert zusätzlich relationale Sitzdaten gegen den Ergebnisinhalt.
- **Tests:** `test_all_time_totals_exceed_both_history_and_source_page_limits`, `test_cursor_pages_are_stable_for_identical_timestamps_and_remain_private`, `test_relational_seats_are_authoritative_and_cannot_assign_cpu_to_an_account`, `test_damaged_unknown_and_mismatched_rows_are_skipped_without_leaking_live_fields`.
- **Watten-Aktion:** Zugehörigkeit zum damaligen Team und zur damaligen Partie dauerhaft ablegen; kein Zugriff über erratene Partie-ID oder fremden Cursor.
- **Abnahme:** Mehr als 250 Partien und mehrere gleiche Endzeitpunkte: korrekte Gesamtsumme, keine fehlenden/duplizierten Seiten, kein fremder Ergebniseintrag.

### B20 — Langzeitprogression und lokale Zeit explizit testen

- **Typ:** Neue Produktwünsche in #41; keine frühere Regelverletzung.
- **Historie:** [`cb15869`](https://github.com/Maetran/RollTheDice/commit/cb15869) ergänzte Zeit-/Häufigkeitserfolge und streckte die höheren Ränge.
- **Aktueller Pfad und Zeile:** Schweizer lokale Zeit wird in [app/hausdepp_achievements.py:322](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_achievements.py#L322) ausgewertet; die Rangdaten stehen in [app/hausdepp_achievements.py:70](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_achievements.py#L70). Partiedauer basiert auf dem jeweiligen Rundenstart ([app/hausdepp_results.py:204](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/hausdepp_results.py#L204)), nicht auf dem Alter des Tisches.
- **Tests:** `test_all_aggregate_milestones_and_final_rank_remain_reachable_without_rare_events`, `test_previously_earned_awards_are_not_revoked_by_higher_future_goals`, `test_play_time_and_streak_achievements_follow_swiss_local_time`, `test_round_duration_uses_each_round_start_instead_of_whole_tournament_age`.
- **Watten-Aktion:** Ränge, Erfolge und Werte bleiben Produktentscheidungen. Von Anfang an Erreichbarkeit, Zeitzone und spätere Katalogänderungen berücksichtigen.
- **Abnahme:** Partie über Schweizer Mitternacht beziehungsweise Zeitumstellung korrekt zählen; reguläres Spielen kann den höchsten gewünschten Rang erreichen; spätere neue Ziele entziehen bereits verdiente Erfolge nicht.

## Kartentisch, Bilder und Bedienung

### U01 — Identische Kartendesigns wiederverwenden, fertige Asset-Pipeline übernehmen

**Historie/Typ:** Die Erstfassung `818f98d` schnitt unmittelbar aus dem fotografierten JPEG aus. Später kamen gemessene Perspektive und Weissabgleich hinzu; `11387a3` / [PR #36](https://github.com/Maetran/RollTheDice/pull/36) verlegte diese Arbeit in ein vorgerendertes Atlas. Das ist eine Qualitäts-/Performanceverbesserung, kein Wechsel des gewünschten Kartensatzes.

**Ursache:** Das Foto hat ungleichmässige Randunschärfe und eine Glanzstelle; Laufzeitfilter kosteten pro bewegter Karte Rechenarbeit.

**Heutige Sicherung/Pfad:** [cards.js:265](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/cards.js#L265), insbesondere `CARD_ASSET_URLS`, `prepareCardAssets`, `cardArt`; [build_hausdepp_cards.py:88](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/scripts/build_hausdepp_cards.py#L88) erzeugt perspektivisch entzerrte, abgeglichene und geschärfte WebP-Zellen. `--check` prüft die Übereinstimmung mit dem eingecheckten Atlas.

**Tests:** `tests/test_hausdepp_assets.py`; optionaler Kontaktbogen aller 36 Karten in `tests/browser/hausdepp.spec.js`.

**Watten-Aktion:** Gemeinsames Bildmodul/Atlas verwenden, Spielrangfolge und Weli-Regel davon trennen. Nicht nochmals Fotografien beschneiden oder fremde Karten importieren.

**Abnahme:** Jede vom Watten-Profil benötigte Karte, einschliesslich Weli und kritischer Karten, ist korrekt zugeordnet und in Hand, Stich und Flug gleich erkennbar; Asset-Prüfung grün.

### U02 — Lizenz und sichtbare Kartennamen gehören zur Wiederverwendung

**Historie/Typ:** Bestehende Asset-Entscheidung; keine neu entdeckte Fehlfunktion. Atlasänderung `11387a3` / [PR #36](https://github.com/Maetran/RollTheDice/pull/36).

**Beleg/Pfad:** [HAUSDEPP_ASSETS.md:63](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/docs/HAUSDEPP_ASSETS.md#L63) dokumentiert die Atlasbearbeitung; Laub 10 stammt aus einer zweiten Vorlage und behält CC BY-SA 4.0, der übrige Vorderseitenursprung CC BY 3.0. Die Quelle erklärt ausdrücklich, dass die Weli-Abbildung bei Hausdepp regeltechnisch lediglich Schellen 6 ist.

**Ursache/Risiko:** Gleiches Artwork bedeutet weder gleiche Rangfolge noch dieselben Sonderregeln.

**Tests:** Assettests und sichtbare Credits auf der Regelseite sind vorhanden; einen Watten-spezifischen Kartennamen-/Profilvertrag gibt es noch nicht.

**Watten-Aktion:** Credits samt beiden Quellen erhalten; Rang-/Farbbezeichnungen DE/EN getrennt vom Bildschlüssel pflegen.

**Abnahme:** Profilwechsel verändert Regeln und erlaubte Kartenmenge, nicht versehentlich das Artwork; sichtbare und vorgelesene Kartenbezeichnungen entsprechen dem Watten-Profil.

### U03 — Bilder müssen dekodiert sein, bevor ein privater Tisch spielbereit wird

**Historie/Typ:** Ladefehler und langsamer Kaltstart; `ecaa240` / [PR #41](https://github.com/Maetran/RollTheDice/pull/41) nennt fehlende Rückseiten/blanke Vorderseiten nach Neustart und senkt die Bildlast von etwa 5,6 auf 2,4 MB.

**Heutige Sicherung/Pfad:** [index.js:1219](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/index.js#L1219) wartet am Tisch auf `prepareCardAssets()`, bevor die Tisch-Shell die Verbindung aufbaut. `cards.js:273–287` hält dekodierte `Image`-Objekte und verwirft bei Fehlern die fehlgeschlagene Vorbereitung.

**Tests:** `hausdepp-assets.spec.js`: **“all card artwork is decoded before the first private table connects”**, **“newly drawn card faces reuse warm images without requests or a loading wait”**. `hausdepp-card-reload.spec.js`: kalte Ladebarriere und transienter 503 mit Wiederholung.

**Watten-Aktion:** Den Ladevertrag übernehmen; verständliche Lade-/Fehlermeldung anbieten.

**Abnahme:** Bei künstlich blockiertem Atlas kein leeres Kartenpapier und kein voreilig spielbereiter Tisch; nach Freigabe vollständige Motive; einmaliger Bildfehler bleibt wiederherstellbar.

### U04 — Öffentliche Bildbytes und private Spielzustände brauchen unterschiedliche Cachewege

**Historie/Typ:** Warm-Reload-/Safari-SVG-Problem; `ecaa240` / [PR #41](https://github.com/Maetran/RollTheDice/pull/41).

**Heutige Sicherung/Pfad:** [hausdepp-sw.js:30](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/app/static/hausdepp-sw.js#L30) lässt Atlas und Rückseite durch den nativen HTTP-Bildcache laden. Der Worker legt keine Daten in Cache Storage; private Inhalte bleiben online.

**Tests:** `hausdepp-card-reload.spec.js`: **“real worker-controlled warm reloads keep lobby card motives painted”** prüft über drei Reloads echte Motivpixel, Worker-Kontrolle, zwei Bildquellen, native Warmwiederverwendung und leeres Cache Storage.

**Watten-Aktion:** Gemeinsame versionierte öffentliche Bilder nutzen; keine Hände, private Einschaukarten, Antworten oder Kontodaten im Offlinecache.

**Abnahme:** Echter Worker plus Warm-Reload zeigt bemalte Karten in Chromium/WebKit; nach Abmelden bleiben keine privaten Tischansichten aus Cache Storage abrufbar.

**Prüfgrenze:** Der vorhandene warme Pixeltest betrifft die Lobby; er ist kein vollständiger iPhone-Home-Screen-Neustartnachweis.

### U05 — Fliegende Karten müssen die tatsächliche Papiergrösse und Drehung behalten

**Historie/Typ:** Eindeutiger Darstellungsbug: [PR #34](https://github.com/Maetran/RollTheDice/pull/34), Commit `2c52ad1`, beschreibt auf Tablets **176 → 112 → 176 px** während eines Wurfs. Ältere Flugkopien waren auf 74–80/112 px begrenzt.

**Ursache:** Responsive Kartengrösse und generische Animationsgrösse waren auseinandergefallen; ein gedrehter Bounding-Box-Rahmen ist zudem nicht die Papierbreite.

**Heutige Sicherung/Pfad:** [motion.js:104](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/motion.js#L104) misst CSS-Papiergrösse, Mittelpunkt und aufsummierte Drehung; [motion.js:440](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/motion.js#L440) baut den Flug am grösseren Ende und skaliert ohne willkürliche Endbegrenzung.

**Tests:** `hausdepp-shuffle.spec.js`: **“previous packet faces and incoming cards retain their real dimensions and positions”**, **“stable pile geometry: resizing cancels the old pictures…”**; PR #34 dokumentiert den Gegenlauf gegen das alte Bundle.

**Watten-Aktion:** Geometrievertrag für Hand → Tischplatz → Stichstapel übernehmen.

**Abnahme:** Smartphone, grosses Tablet und Desktop: kein Grössensprung, kein aufgeblasener Radius, keine Verschiebung alter Karten; Rotation während des Flugs beendet veraltete Geometrie sauber.

### U06 — Ein Tap darf genau eine visuelle Karte erzeugen, deren Serverbestätigung dieselbe Bewegung fortsetzt

**Historie/Typ:** `11387a3` / [PR #36](https://github.com/Maetran/RollTheDice/pull/36) behebt eine halbtransparente Handkarte plus zweite Flugkopie und verzögerten Flugstart.

**Heutige Sicherung/Pfad:** [index.js:754](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/index.js#L754) sendet versioniertes Kommando mit ID und startet den eigenen Flug; `motion.js:182–262` verwaltet `launches`, Übernahme und Rückflug; `renderState` markiert bereits gestartete Handkarten unsichtbar.

**Tests:** `hausdepp-hand-selection.spec.js`: **“a tap launches exactly one card at once and the accepted state continues that same card”**, **“a follow-up beaten by the next player's card flies back…”**.

**Watten-Aktion:** Optimistische Optik nur für bereits gewählte eigene Karte; endgültige Regelentscheidung bleibt beim Server.

**Abnahme:** Mit 250–500 ms Latenz sofortiges Feedback, keine Doppelkarte; abgelehnter oder veralteter Zug kehrt verständlich zurück, Punktestand und Stich bleiben serverbestimmt.

### U07 — Akzeptierter Spielstand muss sofort sichtbar werden; Lesbarkeitsanimation darf ihn nicht verdecken

**Historie/Typ:** [PR #33](https://github.com/Maetran/RollTheDice/pull/33) (`e0a0a1e`) führte gut gemeinte serielle öffentliche Präsentation ein; spätere Korrektur `681270f` in [PR #46](https://github.com/Maetran/RollTheDice/pull/46) macht ein angenommenes wachsendes Paket im ersten Frame sichtbar. Das ist eine spätere Korrektur einer zuvor eingeführten Darstellungslogik.

**Ursache:** Alte Paketbilder und eine Opazitätsmaske konnten den neu angenommenen Inhalt trotz aktueller Schaltflächen überdecken.

**Heutige Sicherung/Pfad:** [motion.js:322](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/motion.js#L322) entfernt alte Pile-Flüge bei `instantPile`; `636–639` erkennt angenommene Erweiterung.

**Tests:** `hausdepp.spec.js`: **“…accepted pile growth is visible in the first frame, including rapid afterthrows”**; `hausdepp-shuffle.spec.js`: **“rapid accepted public plays expose the current packet immediately…”**.

**Watten-Aktion:** Angenommene Stichkarten, Stichzähler und Einsatz sofort aktualisieren. Animation erklärt den Übergang, ohne alte Entscheidungslage vorzutäuschen.

**Abnahme:** Zwei schnell angenommene Ausspiele/Bietantworten zeigen sofort den neuesten erlaubten Stand; keine alte Maske verdeckt aktuelle Karte oder Einsatz.

### U08 — Schnelle Folgetaps niemals als Handlung in einer neuen Gelegenheit wiederverwenden

**Historie/Typ:** Echter Aktionsfehler in [PR #36](https://github.com/Maetran/RollTheDice/pull/36), `11387a3`: vorgemerkte Taps konnten nach einem fremden Zug als neue Aktion ausgeführt werden.

**Heutige Sicherung/Pfad:** [index.js:780](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/index.js#L780) verbindet die Queue mit akzeptierter Version und ununterbrochenem Wurf; [hand-selection.js:15](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/hand-selection.js#L15) bindet Auswahl an Runde, Version und sichtbare Gelegenheit. Nur ein nachweislich harmloses fremdes Auffüllen darf Auswahl erhalten.

**Tests:** **“a same-rank tap queued behind an own card is dropped when another player acted in between”**; **“expired follow-up, lost cards, changed legality and a later regained turn never restore a selection”**.

**Watten-Aktion:** Kartentap und Gebot/Antwort an explizite Gelegenheits-ID binden. Keine Hausdepp-Mehrfachwurfqueue in Watten übernehmen.

**Abnahme:** Doppeltap während eines Serverroundtrips erzeugt keinen zweiten Stichzug; eine verspätete Bietantwort wird nicht zur Antwort auf ein neueres Gebot.

### U09 — Lesbarkeit des Stichabschlusses ist eine Präsentationsaufgabe, kein Eingabe-Lock

**Historie/Typ:** [PR #33](https://github.com/Maetran/RollTheDice/pull/33), Commit `e0a0a1e`: gespielte Karten sollen ankommen, lesbar liegen und erst dann nach Zehn/Vierling abräumen. [PR #36](https://github.com/Maetran/RollTheDice/pull/36) beseitigt zusätzlich eine 80-ms-Lücke beim Abräumen.

**Heutige Sicherung/Pfad:** [motion.js:667](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/motion.js#L667) bis Zeile 700 trennt Auffüllen, Aufnehmen, Wurf und Abräumen; `313–377` begrenzt wartende Bildhistorie auf 2200 ms.

**Tests:** `hausdepp-shuffle.spec.js`: **“a … burn leaves the public cause readable before the packet moves, while stock input stays live”**, **“four cards played together all remain face up…”**; `hausdepp.spec.js`: fehlgeschlagenes Zocken erst Stock → Tisch, danach Aufnehmen.

**Watten-Aktion:** Alle Stichkarten und Gewinner/Eigentümer vor dem Einsammeln verständlich zeigen, ohne regelwidrige zeitliche Freiheiten zu erfinden. Einsatz und zulässige Ansagen bleiben serverbestimmt.

**Abnahme:** Dritter Stich/letzte Karte → Gewinner und Wert klar nachvollziehbar → Einsammeln → nächste erlaubte Aktion; bei schnellem Ereignisstrom keine mehrere Sekunden alte Tischhistorie.

### U10 — Reload, Reconnect und neue Runde sind verschiedene Animationsfälle

**Historie/Typ:** Bereits `6402ec2` trennte Baseline und Transfer; [PR #33](https://github.com/Maetran/RollTheDice/pull/33)/[PR #36](https://github.com/Maetran/RollTheDice/pull/36) erweiterten Bereinigung. [`92e25e1`](https://github.com/Maetran/RollTheDice/commit/92e25e1) brachte die einmalige Mischpräsentation bereits vor dem öffentlichen Start.

**Heutige Sicherung/Pfad:** [motion.js:43](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/motion.js#L43) merkt `gameId:roundNumber` im Sessionstorage; `622–630` hält Erstladung, verpasste Versionen und reine UI-Render still; `index.js:879–889` beendet Bewegungen beim Disconnect.

**Tests:** `hausdepp-shuffle.spec.js`: einmal je Runde, Reload/Reconnect, neue Turnierrunde, Stocktap bricht Mischen ohne Lock ab; `hausdepp.spec.js`: **“close-render-reconnect treats exactly one missed version as a quiet baseline”**.

**Watten-Aktion:** Runde/Stich/Partie getrennt identifizieren. Reconnect rekonstruiert den Tisch, ohne Einschauen, Gebot oder Kartenausspiel erneut zu „spielen“.

**Abnahme:** Reload während Einschauen, laufendem Stich und Ergebnis zeigt korrekten Stand ohne doppelte Karten/Ansagen; echte nächste Runde erhält neue Präsentation.

### U11 — DOM-Identität ist Spielstabilität: ACK und Chat dürfen keine ankommenden Karten neu montieren

**Historie/Typ:** Wiederholte Verfeinerungen, besonders `11387a3` / [PR #36](https://github.com/Maetran/RollTheDice/pull/36); kein fachlicher Regelwechsel.

**Heutige Sicherung/Pfad:** [index.js:140](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/index.js#L140) erhält Kartenknoten anhand Karten-ID; `172–201` erhält gegnerische Fächer und Avatare.

**Ursache:** Ganzes `innerHTML` pro Snapshot kann laufende Opazitätsanimationen, Fokus und dekodierte Bilder verlieren.

**Tests:** `hausdepp.spec.js`: **“ACK and same-version renders preserve the receiving card and its active opacity animation”**; `hausdepp-table-presence.spec.js`: **“own and remote account avatars retain decoded nodes across accepted actions”**, Reaktionen bleiben drei Sekunden sichtbar.

**Watten-Aktion:** Identitäten für Sitz, eigene Karte, einzelne Stichposition und Ansage erhalten.

**Abnahme:** Chat/ACK während eines Kartenflugs ändert weder Bildknoten noch Fokus; keine kurz leere Hand, kein Avatarflackern, keine neu gestartete Stichanimation.

### U12 — Gegnerhände brauchen öffentliche Mengen und anonyme Rückseiten, keine erfundenen Identitäten

**Historie/Typ:** Frühere Ergänzung `6402ec2` **“Show Hausdepp opponent hands and clear card transfers”** gegenüber `818f98d`. Das ist eine nachgelieferte Tischdarstellung, kein nachgewiesenes Datenleck.

**Heutige Sicherung/Pfad:** [index.js:121](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/index.js#L121) erstellt allein aus `hand_count` anonyme Rückseiten; `motion.js:426–429` nimmt sichtbare Rückseitenpositionen ohne unbekannte Farbe/Rang zuzuweisen.

**Tests:** **“shows all 35 opponent cards as compact private backs”**; `hausdepp-product.spec.js`: **“explicit spectator route sends a read-only action and receives no private hand”**.

**Watten-Aktion:** Eindeutige Sitze/Teams, Kartenanzahl und Kartenrückseiten; beim Ausspiel nur die tatsächlich öffentliche Karte offen zeigen.

**Abnahme:** Aus jeder Sitz-/Zuschaueransicht enthalten DOM, ARIA, Flüge und Ereignisdetail keine fremden Handidentitäten; wechselnde eigene Sitzposition verändert nicht die tatsächliche Spielrichtung.

### U13 — Für blindes Watten dürfen Komfortsignale das Geheimnis nicht verraten

**Historie/Typ:** **Watten-spezifische Ableitung**, kein behaupteter Hausdepp-Bug. Hausdepp zeigt erlaubte Karten, Tipps und privat bekannte unterste Karten bewusst an.

**Beleg/Pfad:** [index.js:921](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/index.js#L921) verarbeitet `available_actions`/`playable_cards`; `937` rendert deren Hervorhebung; `973–975` Tischtipps; `988–997` private unterste Karten inklusive ARIA-Benennung. [PR #40](https://github.com/Maetran/RollTheDice/pull/40), `4f48a2d`, macht einen **bei Hausdepp öffentlichen** erfolgreichen Cut für alle sichtbar.

**Risiko/Ursache:** Ungeprüfte Wiederverwendung könnte Schlag/Trumpf durch Sortierung, Goldring, Legalitätsfilter, Tipp, ARIA oder öffentliche Cut-Animation offenbaren.

**Tests:** Hausdepp hat **“active bottom peek stays private…”** und **“everyone sees who receives the cut cards…”**; diese konträren Hausdepp-Verträge sind kein Watten-Nachweis.

**Watten-Aktion:** Wissen je Sitz explizit definieren; erlaubte optische Hinweise aus dieser Projektion ableiten, keinesfalls aus vollständigem Serverwissen.

**Abnahme:** Identische eigene Hand und vollständiger öffentlicher Verlauf, unterschiedliche verborgene Ansage im Vierer-Blindprofil → für Nichtwissende identische erlaubte Darstellung/Sortierung/ARIA; nur Geber und definierter Nachfolger können einschauen. Kritische Varianten separat prüfen.

### U14 — Überlappende Karten dürfen keine Taps an die darunterliegende Nachbarkarte durchreichen

**Historie/Typ:** Eindeutiger Bug aus [PR #31](https://github.com/Maetran/RollTheDice/pull/31), Fix `9791f05`: `pointer-events:none` an deaktivierten Handkarten liess Taps auf sichtbaren Kartenstreifen zur verdeckten Nachbarkarte fallen. Zusätzlich blieb Touch-Hover nach Auswahl angehoben.

**Heutige Sicherung/Pfad:** `.hd-hand-fan .hausdepp-card:disabled` in [hausdepp.css:347](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/styles/hausdepp.css#L347) lässt Pointer-Hitfläche bestehen; Hover-Anheben ist an `@media (hover:hover)` gebunden.

**Tests:** `hausdepp.spec.js` prüft Fächer/Tapbreiten; Auswahltests prüfen 44-px-Steuerungen, sichtbare Kartenziele und horizontales Scrollen.

**Watten-Aktion:** Fünf Karten bedeuten nicht automatisch problemloses Fächern. Eigene eingeschränkte Karten bleiben echte Trefferflächen und erklären nötigenfalls ihre Nichtspielbarkeit.

**Abnahme:** Tap auf eine sichtbare, derzeit unzulässige Karte spielt niemals die benachbarte zulässige Karte; Touch-Hover verdeckt keine Karte; Tastatur erreicht alle fünf Karten.

### U15 — Mobile Geometrie muss Tisch, Tastatur und sekundäre Sheets gemeinsam abdecken

**Historie/Typ:** `72eeda9` führte den festen mobilen Tisch ein; die gemeinsame Viewport-Korrektur stammt aus `1503d10`. Danach wiederholte Verfeinerungen in [PR #32](https://github.com/Maetran/RollTheDice/pull/32)/[PR #33](https://github.com/Maetran/RollTheDice/pull/33)/[PR #44](https://github.com/Maetran/RollTheDice/pull/44).

**Heutige Sicherung/Pfad:** [game-viewport.js:23](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/shared/game-viewport.js#L23) nutzt `visualViewport` nur bei belegter Tastatur und verwirft alte Rotationsmasse; [hausdepp-viewport.css:12](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/styles/hausdepp-viewport.css#L12) hält den Tisch fest, Fächer/Sheets intern scrollbar, Safe Areas berücksichtigt.

**Tests:** `hausdepp-table-presence.spec.js`: fester Tisch/grosse Hand/erreichbare Hilfe und Chat; Tastatur über simulierte `visualViewport`-Masse plus Rotation. `hausdepp.spec.js`: Portrait/Landscape auf Handy/Tablet/Desktop.

**Watten-Aktion:** Vor Layoutfreigabe Platz für Stich, Teamstand, Einsatz, Ansagen, Hand und Einschauen reservieren.

**Abnahme:** 320×568 und 568×320, Tablet-Splitview, Chat-Tastatur und anschliessende Rotation: alle zwingenden Aktionen erreichbar, kein Seitenscrollen, keine abgeschnittene Kartenkante.

**Prüfgrenze:** Emulation ersetzt keinen Nachweis auf physischem iPhone/iPad.

### U16 — Deaktivierte Aktion darf öffentlich sichtbare Karten und Informationen nicht ausbleichen

**Historie/Typ:** [PR #44](https://github.com/Maetran/RollTheDice/pull/44), `0a97b1a`: allgemeines `button:disabled {opacity:.45}` traf Vorrat und Paket; Namen/Zähler verschwanden im Holz, aktive Sitzplatten und Mindestschriftgrössen wurden nachgeliefert.

**Heutige Sicherung/Pfad:** [hausdepp-contrast.css:24](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/styles/hausdepp-contrast.css#L24) hält Karten voll sichtbar; Ringe markieren nur aktuell relevante Taps, dunkle Namensplatten und goldene aktive Platte; Statuspill ohne Scrollbalken.

**Tests:** `hausdepp.spec.js:859`: **“the table never fades its stacks, lights up only what may be tapped and keeps every caption readable”** prüft sieben Viewports, Opazität, Ringbedingungen, Beschriftungen ≥11 px und volle Tischbelegung ohne Plattenüberlappungen.

**Watten-Aktion:** Sichtbarkeit von Stich und Teamstand von Eingabeberechtigung trennen; „gestrichen“ braucht lesbaren Status statt bloss deaktivierter grauer Knöpfe.

**Abnahme:** Auch zwischen eigenen Zügen sind alle öffentlichen Karten, Stichzahl, Einsatz und Punkte lesbar; nur tatsächlich erlaubte Handlungen wirken aktiv.

**Prüfgrenze:** Dieser Test prüft CSS/Geometrie, nicht sämtliche realen Kontrastverhältnisse oder Sehbeeinträchtigungen.

### U17 — Langes Halten, Kontextmenü und Dialogschliessen dürfen keinen versteckten Spielzug auslösen

**Historie/Typ:** Inspektion wurde in `1aa086a` nachgeliefert; [PR #32](https://github.com/Maetran/RollTheDice/pull/32) erklärte Tap/Halten deutlicher. [PR #36](https://github.com/Maetran/RollTheDice/pull/36) ergänzte Rangauswahl per Halten.

**Heutige Sicherung/Pfad:** [pile-inspector.js:36](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/pile-inspector.js#L36) unterdrückt den nachlaufenden Pickup-Klick; expliziter Inspektionsknopf, Shift+Enter/ContextMenu, nativer Dialog und Fokus-Rückgabe; Handauswahl unterstützt Shift+Enter und Escape.

**Tests:** `hausdepp-pile-inspector.spec.js`: **“public packet inspection has an explicit and keyboard action…”**, **“long hold suppresses the trailing pickup…”**; Reaktionspicker: erster Handtap schliesst nur, erst der nächste darf spielen.

**Watten-Aktion:** Einblendungen für erlaubte Stichhistorie/Regelhilfe/Einschauen ausdrücklich bedienen; keine implizite Aktion beim Schliessen oder Loslassen. Umfang erlaubter Historie vor Implementierung verbindlich festlegen.

**Abnahme:** Halten → ansehen → Escape/Schliessen sendet **null** Spielkommandos; Fokus kommt an einen sinnvollen erreichbaren Auslöser zurück; nächster bewusster Tap funktioniert.

### U18 — Tischdeko und Reaktionen sind spätere Produktwünsche mit eigenen Spielschutzverträgen

**Historie/Typ:** `1aa086a` stabile Props, `383b1d3`/[PR #32](https://github.com/Maetran/RollTheDice/pull/32) Scatter/Schieben, `a93daf4`/[PR #41](https://github.com/Maetran/RollTheDice/pull/41) ess-/trinkbare Extras. Das sind Erweiterungen, keine Fehler der ursprünglichen Watten-/Hausdepp-Regeln.

**Heutige Sicherung/Pfad:** [decor.js:39](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/decor.js#L39) schützt gemessene Spiel-/Kontrollbereiche; `517–570` behält Positionen bei gewöhnlichem Handwachstum; `592` bindet Zustand an Partie/Runde. Drag unterdrückt den anschliessenden Click. Reduzierte Bewegung deaktiviert interaktive Props.

**Tests:** `hausdepp-table-decor.spec.js`: Schutz bei sechs Sitzen, stabile Knoten, reduzierte Bewegung, wachsende Hand ohne Tap-Durchfall, Schieben gegen Kontrollbereich kehrt zurück.

**Watten-Aktion:** Falls gewünscht erst auf stabilen Tisch aufsetzen; Stich-/Biet-/Team-/Einschauflächen als Schutzbereiche ergänzen. Keine automatische Freigabe aller Hausdepp-Gimmicks.

**Abnahme:** Kein Prop oder Effekt kann Karte/Ansage verdecken oder deren Trefferfläche übernehmen; reduzierte Bewegung und kleine Formate bleiben voll spielbar.

### U19 — Kommunikationsfunktionen müssen zum Watten-Ansagezustand passen

**Historie/Typ:** Hausdepps Reaktionen wurden in `d4ced75` ausgebaut. **Watten-spezifische Ableitung:** Der Nutzer hat „gestrichen darf man nichts mehr sagen“ festgelegt; frei übernommener Chat/Reaktionscode kann diese Vorgabe umgehen. Noch kein heutiger Hausdepp-Fehler.

**Heutige Sicherung/Pfad als technische Basis:** [reactions.js:14](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/reactions.js#L14) zählt nur bestätigte eigene Reaktionen; Schnellreihenfolge bleibt im Raum stabil. `193–197` schliesst/deaktiviert Picker beim Disconnect. [index.js:728](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/index.js#L728) dedupliziert und erhält sichtbare Reaktion drei Sekunden.

**Tests:** `hausdepp-reactions.spec.js`: bestätigtes eigenes Echo, kaputter Storage, anderer Account, Verbindungsausfall, Click-through; `hausdepp-table-presence.spec.js`: Reaktionen überleben Snapshots.

**Watten-Aktion:** Vor Implementierung klären und verbindlich abbilden, welche Kommunikationswege bei „gestrichen“ gesperrt sind, einschliesslich normaler Ansagen, Geboten, freien Nachrichten, Emojis und CPU-Ausgaben.

**Abnahme:** Gesperrte Kommunikation verschwindet/deaktiviert verständlich **und** wird serverseitig abgelehnt; ein vor Zustandswechsel geöffneter Picker kann danach nichts mehr senden. DE/EN nennt denselben Grund.

### U20 — Rematch muss bewusst sein und darf Teamwahl nicht stillschweigend ersetzen

**Historie/Typ:** `d4ced75` / [PR #29](https://github.com/Maetran/RollTheDice/pull/29): opt-in Rematch; `8ce1b5b` korrigierte bestehende Rematchplätze nach abgelehnten Einladungen.

**Heutige Sicherung/Pfad:** [index.js:1114](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/hausdepp/index.js#L1114) expliziter Neuerstellen-Button; `rematch.js` trennt Annahme/Ablehnung/Schliessen, pausiert während aktiver Partie, cancelt nach Seitenwechsel.

**Tests:** `hausdepp-rematch.spec.js`: Schliessen lehnt nicht ab, Fehler bleibt wiederholbar, Seite verlassen verhindert späte Navigation; `hausdepp-rematch-real.spec.js:33` prüft echten beendeten Ursprung, neuen Warteraum und zweite Person erst nach ausdrücklicher Annahme.

**Watten-Aktion:** Gewähltes Regelprofil/CPU-Besetzung sichtbar übernehmen, gewünschtes Team bestätigen oder erneut wählen lassen. Niemals alle Menschen automatisch umsetzen oder zufällige Teamzuweisung als Komfort erfinden.

**Abnahme:** Neue Partie zeigt Profil und Teamplätze vor Beginn; Nichtannahme bleibt ohne Sitzwechsel; historische Punkte bleiben unverändert.

### U21 — Zufallsänderungen und bessere CPUs entwerten alte Testannahmen, nicht automatisch das Produkt

**Historie/Typ:** [PR #31](https://github.com/Maetran/RollTheDice/pull/31) machte den ersten Geber zufällig; [PR #36](https://github.com/Maetran/RollTheDice/pull/36) machte Refills für alle automatisch; [PR #40](https://github.com/Maetran/RollTheDice/pull/40) traf auf CPUs, die legitimerweise Pakete kauften. Nachfolgefixes `864009b`, `61cbb39`, `6eb3a95`, `4f44b12`, `f9e54bb`, `8952d80` passen Tests an tatsächliche Projektion und sichtbare Kartenziele an.

**Beleg/Pfad:** PR #31/#33/#34 nennen falsche Geber-/Aktionsannahmen und gemeinsame Rate-Limits; aktuelle Testnamen und Fixtures in [hausdepp.spec.js:489](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/browser/hausdepp.spec.js#L489), insbesondere echte Tische, `labelledUiFixture` und die mit „labelled UI fixture“ benannten Fälle, kennzeichnen Darstellungsfixtures gegenüber echten Tischen. [hausdepp-rematch-real.spec.js:26](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/browser/hausdepp-rematch-real.spec.js#L26) grenzt explizit nur unterdrückte Nebennotices von echten Raum-, Einladungs-, Authentifizierungs- und WebSocket-Übergängen ab.

**Ursache:** Test wartete auf feste Person/Aktion oder las Socket und DOM in unterschiedlichen angenommenen Zuständen.

**Tests:** Die historischen Anpassungscommits oben betreffen `hausdepp.spec.js`, `hausdepp-table-decor.spec.js`, `hausdepp-public.spec.js`, reale Rematch- und Motion-Flows. Vorhandene Tests sind keine Watten-Abdeckung.

**Watten-Aktion:** Reproduzierbare Regelfixtures für alle Grenzfälle **plus** echte 2-/3-/4-Personen-/CPU-Flows. Zufällige Karten/Geber dürfen Tests nicht zum stillen Raten zwingen. Test-Isolation erhalten, Produktlimits nicht erhöhen, um Testfehler zu verdecken.

**Abnahme:** Zufälliger Geber, CPU reagiert vor dem Menschen, schnell aufeinanderfolgende Ansagen, Reload und gemischtes DE/EN laufen anhand aktueller autoritativer Lage; Gegenlauf eines Regressionstests gegen den alten Fehler schlägt erwartungsgemäss fehl.

## Lieferung und Prüfverfahren

### O01 — Produktionsimage muss sämtliche ausgelieferten Dateien enthalten

**Typ:** behobene Auslieferungslücke. Commit [`c597abd`](https://github.com/Maetran/RollTheDice/commit/c597abd) ergänzte erst nach dem öffentlichen Start die beiden Hausdepp-Manifeste im Dockerfile. Ein erfolgreicher Source-/Browserlauf war damit kein Nachweis für vollständige Containerdateien.

**Heute / Belege:** `Dockerfile:13–18`, [tests/container_smoke.py:23–76](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/container_smoke.py#L23-L76); `tests/test_deployment_scripts.py::test_all_root_file_response_assets_and_manifest_routes_are_copied_into_image` leitet die erwarteten Root-Dateien aus den tatsächlichen Routen ab.

**Watten-Aktion:** Manifest DE/EN, Icons, Worker, HTML und Karten im ersten Produktionsimage über echte HTTP-Antworten prüfen. Suite-Smoke um Watten erweitern; kein blosses Copy-Statement als Abnahme.

**Abnahme:** Netzwerkisoliertes gebautes Linux/amd64-Image liefert beide Manifeste, jedes referenzierte Icon, Lobby/Regeln und den eng begrenzten Worker mit richtiger MIME-Type/Scope; fehlende Datei lässt den Lauf fehlschlagen.

### O02 — Host-Aktivierung braucht überprüfte Bereitschaft nach Reload

**Typ:** behobene Infrastruktur-Race. [`ca30739`](https://github.com/Maetran/RollTheDice/commit/ca30739) korrigierte die sofortige TLS-Prüfung nach Nginx-HUP; [`4b59e31`](https://github.com/Maetran/RollTheDice/commit/4b59e31) erweiterte dieselbe Lehre auf öffentliche HTTP-01- und permanente Renewal-Routen. Ein quittierter Reload bedeutet nicht, dass alle neuen Worker antworten.

**Heute / Belege:** `scripts/activate_hausdepp.sh:23–78,150–182`; `tests/test_hausdepp_deployment.py` mit `test_transient_old_worker_sni_rejection_waits_then_accepts_verified_https`, `test_persistent_tls_or_certificate_failure_remains_bounded_and_rolls_back`, `test_permanent_http_proof_is_required_after_final_reload_before_renewal` und Tests für frische exakte Tokens.

**Watten-Aktion:** Erst den gewünschten Host beschliessen; bei eigener Domain bestehendes Aktivierungsverfahren mit zeitlich begrenzten, echten DNS-/Proxy-/TLS-Prüfungen und Rückweg nutzen.

**Abnahme:** Temporäre alte Worker werden toleriert; falscher Token, Zertifikatsfehler, Redirect oder dauerhafte Fehlantwort blockieren und stellen die Konfiguration wieder her. Renewal wird erst nach Prüfung der permanenten Route ausgeführt.

### O03 — Versionen auf tatsächlich ausgelieferte Revisionen beziehen

**Typ:** nachgewiesener Releaseblocker. [PR #39](https://github.com/Maetran/RollTheDice/pull/39) dokumentiert den abgebrochenen 3.7.0-Deploy: 3.6.0 war dem Feature-Merge statt dem ausgelieferten Master-Commit `4d1fe4c` zugeordnet. Der Guard verhinderte den fehlerhaften Release; laut PR lief 3.6.0 weiter.

**Heute / Belege:** `app/version.json`, `app/version-history.json`, `scripts/product_versions.py`, `tests/test_product_versions.py`; die nächste Korrektur [PR #40](https://github.com/Maetran/RollTheDice/pull/40) startete ausdrücklich vom ausgelieferten Stand.

**Watten-Aktion:** Vor jedem Versionsbump ausgelieferte Master-Revision feststellen, bestehende Zuordnungen erhalten, parallele Migrationen/Releaseeinträge beim Integrationsmerge abstimmen.

**Abnahme:** `product_versions.py check --previous <ausgelieferter Commit>` besteht; falscher Vorläufer wird abgewiesen. Watten wird nur via develop → master → prod veröffentlicht, mit gesonderter Releasefreigabe.

### O04 — Testserver, Konten und Ratenlimits müssen isoliert sein

**Typ:** historische Prüfprobleme, kein Beleg für fehlerhafte Spielregeln. PRs [#31](https://github.com/Maetran/RollTheDice/pull/31), [#32](https://github.com/Maetran/RollTheDice/pull/32) und [#34](https://github.com/Maetran/RollTheDice/pull/34) nennen SQLite-/Registrierungs-/Erstellungsquoten unter gemeinsamem Testbetrieb. [`fc6c30a`](https://github.com/Maetran/RollTheDice/commit/fc6c30a) belegt konkret einen Shard nahe 200 realen Tischen/Stunde; nur Testlimits wurden erhöht. [PR #47](https://github.com/Maetran/RollTheDice/pull/47) isolierte Gerätewechsel-Konten.

**Heute / Belege:** `scripts/test-browser-local.mjs:64–91,176–272`, `playwright.config.js`, `docs/LOCAL_CHECKS.md`. Vier getrennte Hauptserver mit je einem Worker, danach getrennte Kontosuiten.

**Watten-Aktion:** Reale Mehrkontenfälle auf eigenen Datenbanken/Ports/Konten ausführen; Quoten ausdrücklich testen und Testlast separat budgetieren. Keine fremden Vorschau-/Testprozesse verändern.

**Abnahme:** Vollsuite läuft ohne gemeinsam genutzte Kontosprache, Raumlisten oder SQLite-Dateien; beabsichtigte 429-Prüfungen bleiben streng. Ein fehlgeschlagener Assertion-Fall wird nicht durch pauschale Retries oder Produktionslimitänderungen verdeckt.

### O05 — Beobachteten Browserzustand mit derselben Darstellung vergleichen

**Typ:** korrigierte Test-Races. [PR #42](https://github.com/Maetran/RollTheDice/pull/42) sichert drei konkrete Ursachen: automatisches Nachziehen war vor dem Messstart erfolgt; zufälliger Geber machte die angenommene Rolle falsch; Node-seitiger WS-Zustand war der gezeichneten Kartenbeschreibung bereits voraus.

**Heute / Belege:** [tests/browser/hausdepp.spec.js:312–390](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/browser/hausdepp.spec.js#L312-L390) (`expectDescribedPile`, `completeRequiredDraw`), `window.hausdeppObservedState`. `8952d80` innerhalb [PR #48](https://github.com/Maetran/RollTheDice/pull/48) benutzt tatsächlich sichtbare Kartenflächen beim Klicken.

**Watten-Aktion:** Testrollen gezielt aufbauen, öffentliche/privat erlaubte Sicht atomar mit DOM-Geometrie lesen; Kommandos anhand Tisch, Versionsintervall und Receipt korrelieren. Renderer-Fixtures ersetzen keinen echten Spielablauf.

**Abnahme:** Echtpartie mit zufälligem Geber, CPU und Netzverzögerung wiederholt stabil; kein Vergleich des DOM mit einem noch nicht gezeichneten zukünftigen Snapshot. Klicks treffen sichtbare Kartenflächen und behalten echte Legalitäts-/Privacy-Assertions.

### O06 — Ein exakter vollständiger Nachweis statt verstreuter Teilprüfungen

**Typ:** nachträglich eingeführte Prozessverbesserung; keine rückwirkende Behauptung, jede damalige Änderung sei ungeprüft gewesen. PRs #32–34 dokumentieren verschiedene Teilmatrizen und CI-Skips; [PR #48](https://github.com/Maetran/RollTheDice/pull/48) vereinheitlicht Vollprüfung und Remote-Nachweis.

**Heute / Belege:** `docs/LOCAL_CHECKS.md`, [scripts/verify-local.mjs:14–75](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/scripts/verify-local.mjs#L14-L75), `scripts/local-checks.mjs`, `.github/workflows/quality.yml`; verpflichtende Gruppen quality/tools/backend/image-build/production-image/browser/diff.

**Watten-Aktion:** Vor jedem Push fertigen sauberen Commit gegen frisch integriertes origin/develop vollständig mit `push:checked` prüfen; keine doppelte fremde Vollsuite. CI prüft den veröffentlichten Owner-Nachweis für genau diesen Tree/Basisstand.

**Abnahme:** Neuer Commit, andere Quellen/Umgebung oder neue Develop-Basis machen den alten Nachweis ungültig; alle sieben Browserteile werden erfasst. Release erst nach bestandenem Integrationsnachweis, nicht nach Teilgrün.

### O07 — Technische Emulation und echte Geräteabnahme auseinanderhalten

**Typ:** verbleibende Nachweisgrenze, kein neu bestätigter Gerätefehler. `docs/HAUSDEPP_LOCALHOST_TEST_2026-10-16.md` und PRs #28/#29/#33/#34 unterscheiden Browser-/iPhone-WebKit-Emulation von physischer Home-Screen-Installation, Betriebssystem-Push und tatsächlicher Bedienung.

**Heute / Belege:** `docs/HAUSDEPP_FLEX_LOBBY_QA_2026-10-18.md` prüft native Sharing-/Push-Grenzen ohne Sendung an echte Konten. Keine aktuelle Produktions-/Geräteprüfung wurde in dieser Retrospektive durchgeführt.

**Watten-Aktion:** Gerätematrix vorab mit Zuständigkeit einplanen: schmales Handy, kurzer Landscape, Tablet, Desktop; tatsächliche Installation/App-Wechsel/Touch/Netzausfall und opt-in Testpush separat abnehmen.

**Abnahme:** Browsermatrix und manuelle Gerätechecks erhalten eigene Belege. Ohne physisches Gerät bleibt genau diese Prüfung offen; echte Konten/Benachrichtigungen werden nicht ungefragt benutzt.

### O08 — Früh einen vollständigen Produktablauf abnehmen

**Typ:** Schlussfolgerung aus belegter Folge von Ergänzungen, keine pauschale Schuldzuweisung. Zwischen Erstimplementierung [`818f98d`](https://github.com/Maetran/RollTheDice/commit/818f98d), [`d5a90ab`](https://github.com/Maetran/RollTheDice/commit/d5a90ab), [`cfba2ac`](https://github.com/Maetran/RollTheDice/commit/cfba2ac), PRs #28/#29 und #46 entstanden Konto, Suite-Navigation, Folgetische und flexible Lobby in getrennten Schritten. Einige waren neue Wünsche; andere schlossen Integrationslücken.

**Heute / Belege:** `docs/PRODUCT_DELIVERY.md`, `tests/test_navigation_contract.py`, `app/game_registry.py:28–41,162–182`. Die untersuchten 20 PRs haben laut abgerufenen GitHub-Daten keine eingetragenen formalen Reviews oder Conversation-Kommentare; dies belegt nicht das Fehlen anderweitiger Reviews.

**Watten-Aktion:** Vor Regelengine-Arbeit die kleinste komplette Nutzerreise und die explizit zurückgestellten Features festlegen; kleine fachlich abgeschlossene PRs mit unabhängiger Quell-/UI-Prüfung vorbereiten. Spätere Wünsche als Scopeänderung dokumentieren.

**Abnahme:** Ein menschlicher Gast öffnet einen Link, meldet sich an, wählt bewusst Team/Sitz, spielt mit erlaubten Informationen, verbindet sich neu, sieht ein dauerhaftes Ergebnis und kann eine Folgepartie freiwillig betreten. Jeder Schritt besitzt Fehlerszenario und zuständigen Prüffall.

### O09 — Prüfpartien dürfen persönliche Ergebnisse nicht verunreinigen

**Typ:** historisch dokumentierte Aufräumarbeit. `docs/HAUSDEPP_LOCALHOST_TEST_2026-10-16.md`, Abschnitt Lokale Daten, berichtet von nachträglich archivierten Assistenten-QA-Runden mit Owner-Zustimmung, während Owner-Runden erhalten blieben. Das ist keine Erlaubnis für künftige Kontobereinigung.

**Heute / Belege:** derselbe Bericht verlangt weitere QA ausschliesslich auf isolierten Testservern; [tests/container_smoke.py:81–100](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/tests/container_smoke.py#L81-L100) verwendet temporäre Daten ohne persistente Mounts.

**Watten-Aktion:** Wegwerfkonten und temporäre SQLite-/JSON-Daten schon für exploratives Spielen verwenden. Ergebnisse, Ranglisten, Achievements und Push-Outbox echter Konten nicht als QA-Umgebung benutzen.

**Abnahme:** Nach Tests bleiben echte Konten, Ergebnisse und Abonnements unverändert; Testprozess besitzt ausschliesslich seine Daten/Ports. Keine nachträgliche Reparatur persönlicher Statistiken nötig.

### O10 — Dokumentation und Nachweise müssen denselben Produktstand beschreiben

**Typ:** historische Nachtragsdokumentation und heutiger dokumentarischer Nachlauf. Frühere Owner-only-Regeln wurden beim öffentlichen V3-Start ausdrücklich ersetzt (`docs/HAUSDEPP_V3_RELEASE.md`); pauschales Lesen alter Berichte als aktuelle Zugangspolitik wäre falsch. Der heutige Reminder-Widerspruch wird gesondert unter S29 erfasst.

**Heute / Belege:** `docs/HAUSDEPP_V3_RELEASE.md`, `docs/HAUSDEPP_LOCALHOST_TEST_2026-10-16.md` mit datierten Nachträgen; `docs/PRODUCT_DELIVERY.md`, DE/EN-Kataloge, README, Spielregeln, Changelog und Releasehinweise.

**Watten-Aktion:** Quellen und Prüfnachweise mit Basis/Datum/Umfang versehen; aktuelle Handbücher bei Funktionsänderungen gemeinsam ändern, historische Berichte erkennbar historisch lassen. Kein veralteter Testlauf wird als Nachweis des neuen Stands dargestellt.

**Abnahme:** UI/Regeltext DE/EN stimmen mit realen Einstellungen überein; Doku nennt keine abgeschaffte Präferenz und keine unzutreffende Freigabe. Alle Erkenntnis-IDs dieser Retrospektive sind im Umsetzungsplan einem Arbeitspaket und einer Abnahme zugeordnet.

### O11 — Ein neuer Spieladapter erweitert nicht automatisch alle Suite-Register

**Typ:** bestehende Integrations- und Datenschutzanforderung, kein hier neu nachgewiesener Fehler. `92e25e1` ergänzte unter anderem Hausdepp-Monitoring und echte Aktivitätszahlen; die spätere Neutralisierung der Kontotexte in [PR #43](https://github.com/Maetran/RollTheDice/pull/43) zeigt den Pflegebedarf fester Spiellisten.

**Heute / Belege:** `app/game_registry.py:28–41,162–182` ist nur eine Grenze. `app/analytics.py:388–397,1059–1063`, `app/cross_game_activity.py`, [frontend/multigame/game-picker.js:49–57](https://github.com/Maetran/RollTheDice/blob/80bc42df17eb5852a5153582b263f6d065138f35/frontend/multigame/game-picker.js#L49-L57) und eigene Push-/Freunde-/SEO-Register benötigen ebenfalls eine ausdrückliche Spielzuordnung. `tests/test_game_activity.py::test_connected_humans_are_deduplicated_per_product_without_identity_fields` und `tests/test_hausdepp_monitoring.py::test_all_and_previous_totals_live_counts_and_options_exclude_private_game_for_delegate` sichern unterschiedliche Zähl-/Berechtigungsgrenzen.

**Watten-Aktion:** Integrationsinventar aller Produktregister und Filter führen, inklusive Analytics, Administration, Community und Aktivitätsanzeigen. Verbindungsstatus, menschliche Konten, CPUs und Zuschauer nicht vermischen; Datenbank-/Netzfehler nicht als null Spieler darstellen.

**Abnahme:** Zwei Geräte desselben aktiven Menschen zählen einmal; CPU und Zuschauer nicht. Fehlende Aktivitätsantwort erscheint als unbekannt. Nicht berechtigter Dashboardnutzer erhält weder direkte private Spielmetriken noch deren Anteil über Gesamtsummen; Karten/Ansagen und Tischgeheimnisse erscheinen in keinen Analyticsdaten.

## Nächster Schritt

Die Erkenntnisse sind vollständig im [Umsetzungsplan](WATTEN_IMPLEMENTATION_PLAN.md)
als Arbeit mit Abnahme verankert. Zuerst werden dort die fachlichen P0-Entscheidungen
geschlossen. Diese Retrospektive beauftragt weder Hausdepp-Bugfixes noch einen
Watten-Prototyp, ein neues Backend, Merge oder Deployment.

**English brief:** This audit covers the original Hausdepp implementation and
20 later PRs through develop revision 80bc42d. It records 81 findings and
contracts across accounts/invitations, lifecycle, rules/privacy, CPUs,
persistence, presentation and delivery. Historical defects are distinguished
from later requests and present evidence gaps. Every finding has an explicit
Watten action and acceptance scenario in the linked implementation plan.
