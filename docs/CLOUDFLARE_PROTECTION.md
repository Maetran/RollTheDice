# Cloudflare-Schutz / Cloudflare protection

Stand / Reviewed: 2026-10-11. Die Dashboard-Erweiterung und Cloudflare-Regeln
sind getrennte Änderungen. **RollTheDice: Auth API Burstschutz** wurde in der
Zone `zockdiewandan.online` auf Free aktiviert und aus den gespeicherten
Regeldetails erneut geprüft: 50 Requests / 10 Sekunden, Block / 10 Sekunden,
IP-Zähler, Active, die unten aufgeführten Pfade und `not cf.client.bot`.
Vor der Einrichtung am 05.10.2026 bestanden keine eigenen Custom- oder
Rate-Limit-Regeln und keine zusätzlich manuell eingerichteten Managed-Regeln.
Cloudflares automatisch aktiver Free-Managed-Grundschutz ist davon zu
unterscheiden; eine leere Liste eigener Regeln bedeutet nicht fehlenden
Managed-Schutz. Die Auth-Regel belegt weiterhin den einen Rate-Limit-Platz.

The rule is active in the Free zone and was verified by re-opening its saved
details. Before its creation on 2026-10-05, there were no custom or rate-limit
rules and no additional manually configured managed rules. Cloudflare's
automatically active Free Managed protection is separate: an empty list of
custom configurations does not mean managed protection is absent. The auth
rule still occupies the single rate-limit slot. No plan or DNS setting changed.

Am 11.10.2026 wurde zusätzlich die unten dokumentierte Scanpfad-Regel aktiviert
und erneut als **Active** gelesen; das Dashboard zeigt einen von fünf
Custom-Regelplätzen belegt. Der neue Origin-Firewall- und Real-IP-Umbau ist in
zwei Schritten getrennt: Die Origin-Firewall ist aktiviert und produktiv
geprüft; die Real-IP-Auflösung folgt erst nach dem Backend-Rollout von 2.49.1.
Die bereits aktiven Edge-Regeln bleiben unabhängig davon wirksam.

On 2026-10-11, the scan-path rule documented below was also deployed and
re-read as **Active**; the dashboard shows one of five custom-rule slots used.
The origin firewall is active and production checks have passed. Real-IP
resolution follows only after the 2.49.1 backend rollout. The active edge rules
remain independent of that work.

## Prüfung / Assessment

Die Anwendung schützt bereits fehlgeschlagene Passwort-Anmeldungen (5 pro
15 Minuten je Netzwerk-/Kontoschlüssel), Registrierung, E-Mail-Versand und
Spielanlage. Die vorhandene Telemetrie besitzt eigene Mengenbegrenzungen.
Der laufende Nginx schützt reguläre HTTP-Anfragen mit 20 Requests/Sekunde und
einem Burst von 80 je `$binary_remote_addr`; WebSocket-Verbindungen verwenden
eine eigene Location. Diese Konfiguration wurde auf `zdwa` gelesen.

Cloudflare ist vorgeschaltet. Im gelesenen Ausgangszustand vor dem
freigegebenen Real-IP-Umbau bezieht sich der Nginx-Schlüssel auf die verbindende
Proxy-Adresse; es gibt dort keine
`real_ip_header CF-Connecting-IP`-Umschreibung. Dieser Zähler entspricht daher
nicht zuverlässig einzelnen Besuchern. Vor einer Verschärfung am Origin müssen
vertrauenswürdige Proxy-Netze und die Adresskette geprüft werden. Keine beliebigen
Client-Header als echte IP übernehmen. Die unten beschriebene Header-Vorstufe
ist bereits aktiv. Die Real-IP-Include gehört zur Konfiguration ab 2.49.1
und wird erst nach dem Backend-Rollout nach der unten beschriebenen Folge aktiviert.

Existing application protection covers failed password logins (5 per 15 minutes
per network/account key), registration, account emails and game creation.
Telemetry has independent volume limits. Live Nginx configuration limits regular
HTTP traffic to 20 requests/second with a burst of 80 per `$binary_remote_addr`,
with a separate WebSocket location. Before the authorized Real-IP change, its
key describes the connecting proxy address, not reliably one visitor. The
header preparation described below is live. The Real-IP include is part of
the 2.49.1 configuration and must follow the backend rollout as described below. Tightening the limit requires a verified proxy/address chain.

Ein gezieltes Cloudflare-Burstlimit ist sinnvoll, weil es missbräuchliche
Anmelde- und E-Mail-Aufrufe vor dem Origin reduziert. Ein pauschales niedriges
Limit für die gesamte Website wäre unpassend: PWA-Updates, Dateien, mehrere
Spieler hinter einer Adresse und Spiel-APIs können legitime Bursts verursachen.
Die neue HTTP-Ländermessung liefert Tagesaggregate, keine individuellen
Sekundenraten; daraus wird kein vermeintlich präzises IP-Limit berechnet.

A targeted edge burst limit can reduce abusive authentication/email requests
before they reach the origin. A low whole-site cap could interfere with PWA
updates, assets, shared networks and game APIs. The new daily request counters
do not measure individual IP burst rates and cannot calibrate such a limit.

## Aktiver Auth-Burstschutz / Active auth burst protection

[cloudflare-auth-rate-limit.json](cloudflare-auth-rate-limit.json) enthält eine
Referenz der einzelnen ergänzenden Regel für Passwort-Login, Registrierung, Passwort-Reset,
E-Mail-Anforderung und Passkey-Anmeldung: mehr als 50 Requests in 10 Sekunden
je IP/Cloudflare-Rechenzentrum, danach 10 Sekunden Blockierung. Die Schwelle ist
ein vorsichtiger Startwert, kein aus Produktion abgeleiteter Optimalwert.
Cloudflare-verifizierte Bots (`cf.client.bot`) sind ausgenommen. Die normale
Sitzungsabfrage, Spielaktionen, statische Dateien und WebSockets liegen außerhalb
der Regel. Keine CAPTCHA-/HTML-Challenge auf JSON-API-Antworten verwenden.

The active rule covers password login, registration, reset/email requests and
passkey sign-in: over 50 requests per 10 seconds per IP/Cloudflare data center,
followed by a 10-second block. This conservative starting point is not a
production-calibrated optimum. Verified bots are excluded. Session polling,
game actions, assets and WebSockets are outside its scope. An HTML challenge
must not replace a JSON API response.

Der Free-Tarif bietet laut aktuell geprüfter
[Cloudflare-Dokumentation](https://developers.cloudflare.com/waf/rate-limiting-rules/)
eine Rate-Limit-Regel mit IP-Zähler und 10-Sekunden-Fenster. Der konkrete Tarif
und verfügbare Regelplatz wurden im Konto geprüft. Bei weiteren Änderungen
DNS-Proxy-Status und vorhandene Regeln erneut prüfen. Regeln niemals pauschal ersetzen und keinen
bezahlten Tarif ohne gesonderten Auftrag buchen.

According to the current [rate limiting documentation](https://developers.cloudflare.com/waf/rate-limiting-rules/),
Free supports one IP-based rate rule with a 10-second window. Actual plan,
proxied DNS and existing rule usage must be inspected first. Append to the
existing ruleset using the [documented API](https://developers.cloudflare.com/waf/rate-limiting-rules/create-api/)
or dashboard; do not replace existing protection or purchase a plan implicitly.

Nach Aktivierung die gespeicherte Regel erneut lesen, echte Anmeldungen und
Spielverbindungen normal prüfen und Security Events auf Fehlblockierungen
beobachten. Kein künstlicher Lastangriff gegen Produktion. Bei Problemen nur
diese neue Regel deaktivieren; die bisherige Absicherung bleibt erhalten.

After activation, re-read the saved rule, verify normal sign-in and gameplay
connectivity, and review Security Events for false positives. Do not load-test
production. Roll back by disabling only this added rule.

## Aktive Scanpfad-Regel / Active scan-path rule

[cloudflare-scan-block.json](cloudflare-scan-block.json) enthält die aktivierte
Expression mit `action: block` und `enabled: true`, ohne erfundene Regel-ID.
Sie gilt ausschließlich für `zockdiewandan.online`,
`www.zockdiewandan.online`, `zdwa.zockdiewandan.online` und
`zilch.zockdiewandan.online`. Cloudflare-verifizierte Bots sind ausgenommen.

Die Regel blockiert bekannte, von dieser Anwendung nicht angebotene
Scanpfade: PHP-/WordPress-Endpunkte, `.env`, Git/SVN/Hg-Verzeichnisse, CGI,
Server-Status und Actuator. Profilpfade unter `/spieler/`, `/zdwa/spieler/`,
`/zilch/spieler/`, `/api/players/` und `/api/zilch/players/` sind ausgenommen,
damit zulässige Kontonamen etwa mit `.php` keine Fehlblockierung verursachen.
Die Expression prüft den kleingeschriebenen URI-Pfad, keine Länder oder
selbst angegebenen Browserkennungen. Normale Anmeldung, Spiel-APIs, Dateien,
PWA-Manifeste und WebSocket-Routen fallen nicht in diese Pfadmuster.

Beim Rollout am 11.10.2026 hat Cloudflare die Expression akzeptiert. Die
gespeicherte Regel wurde erneut als aktiv geprüft; `/.env` erhielt am Edge
HTTP 403, während beide Produkt-Healthchecks weiterhin HTTP 200 lieferten.
Das ist eine konkrete Pfad- und Erreichbarkeitsprüfung, kein Lasttest und keine
pauschale Zusage, dass jeder Scanner erkannt wird. Bei Fehlblockierungen nur
diese neue Custom-Regel deaktivieren; den Auth-Burstschutz beibehalten.

[cloudflare-scan-block.json](cloudflare-scan-block.json) records the deployed
expression with `action: block` and `enabled: true`, without an invented rule
ID. It is limited to the four product hosts listed above and excludes
Cloudflare-verified bots. It blocks unsupported PHP/WordPress endpoints,
`.env`, Git/SVN/Hg directories, CGI, server-status and Actuator paths.
The listed player-profile paths are excluded so valid names such as those
ending in `.php` are not falsely blocked. Matching uses the lowercase URI
path, not countries or self-declared browser agents; ordinary sign-in,
game APIs, assets, manifests and WebSocket routes do not match these patterns.

During the 2026-10-11 rollout, Cloudflare accepted the expression and the saved
rule was re-read as active. `/.env` returned HTTP 403 at the edge while both
product health checks returned HTTP 200. This proves the checked path and
reachability, not load behavior or complete scanner detection. Roll back by
disabling only this new custom rule; retain auth burst protection.

## Origin-Firewall: aktiv / Origin firewall: active

Am 11.10.2026 um 14:30:50 UTC wurde UFW auf ausschließlich die
[offiziellen Cloudflare-IPv4-/IPv6-Netze](https://www.cloudflare.com/ips/)
für eingehendes TCP 80/443 begrenzt. Die erneute Regelprüfung ergab 24 Regeln:
zwei unveränderte SSH-Regeln und 22 Cloudflare-Multiport-Regeln für 80/443.
Die vorherigen weltweiten Web-Freigaben wurden entfernt. Die aktuellen Listen
unter `https://www.cloudflare.com/ips-v4` und `https://www.cloudflare.com/ips-v6`
müssen bei Änderungen gemeinsam mit der Real-IP-Konfiguration aktualisiert
werden. DNS-only ist mit dieser Origin-Firewall kein öffentlicher Betriebsmodus.

Nach der Aktivierung lieferten beide öffentlichen Produkt-Healthchecks HTTP
200 und eine neue SSH-Verbindung funktionierte. Externe direkte
TLS-Verbindungen zum Origin liefen in den Verbindungs-Timeout. Der Profilpfad
`/spieler/wp-admin` blieb mit HTTP 200 erreichbar; WebSocket-/Presence-Aufrufe
auf beiden Produkt-Origins lieferten HTTP 101. Der Test
`certbot renew --dry-run` war für alle vier Zertifikatsnamen erfolgreich.
Der automatische Recovery-Timer wurde erst nach dem bestätigten Prüfmarker
deaktiviert. Diese Ergebnisse gelten für die Firewall- und Header-Vorstufe;
sie ersetzen die nachgelagerten Real-IP-Prüfungen nicht.

Geschützte Sicherungen und die manuelle Firewall-Rücknahme liegen unter
`/var/backups/rtd-cf-origin-20261011/`; bei Bedarf mit administrativen Rechten
das dortige `rollback.sh` ausführen. SSH und die bestehenden Cloudflare-Regeln
nicht nebenbei ändern. Der Docker-Backendport ist produktiv bereits durch
eine lokale, nicht versionierte `docker-compose.override.yml` an
`127.0.0.1:8000` gebunden. Dieser Zustand wurde mit Compose-Konfiguration,
Docker-Inspect und Socket-Ansicht geprüft; die Basis-Compose-Datei allein
bildet ihn nicht ab.

UFW was applied on 2026-10-11 at 14:30:50 UTC, restricting inbound origin TCP
80/443 to official Cloudflare IPv4/IPv6 networks. Rule read-back confirmed 24
rules: two unchanged SSH rules and 22 Cloudflare multiport rules for 80/443.
The previous worldwide web allowances were removed. Keep the published IP
lists and Real-IP configuration aligned. DNS-only cannot serve public traffic
through this origin firewall.

After activation, both public product health checks returned HTTP 200, a new
SSH connection succeeded, and external direct-origin TLS connections timed
out. `/spieler/wp-admin` remained available with HTTP 200, and WebSocket/
presence requests on both product origins returned HTTP 101. The Certbot
renewal dry run succeeded for all four certificate names. The recovery timer
was disarmed only after the verified marker. These checks cover the firewall
and header preparation, not the later Real-IP activation.

Protected backups and manual firewall recovery are in
`/var/backups/rtd-cf-origin-20261011/`; run its `rollback.sh` with administrative
privileges if necessary. Preserve SSH and the existing Cloudflare rules.
Production already binds the Docker backend to `127.0.0.1:8000` through a
local, unversioned Compose override, verified using Compose configuration,
Docker Inspect and the socket view; the base Compose file alone does not
describe this live binding.

## Proxy-Vertrauen ab 2.49.1 / Proxy trust from 2.49.1

Die Header-Vorstufe ist produktiv aktiv: Nginx überschreibt
`X-Forwarded-For` mit `$remote_addr` und `X-RTD-Cloudflare-Peer` mit
`$realip_remote_addr`, für HTTP und WebSockets. Die zusätzliche
[Real-IP-Include](../deploy/nginx/cloudflare-real-ip.conf) wird erst nach dem
Backend-Rollout nach der unten beschriebenen Folge aktiviert. Sie enthält die am 11.10.2026 geprüften 22 offiziellen Netze und
`real_ip_header CF-Connecting-IP`; nur ein direkter Peer aus diesen Netzen
darf die Besucheradresse setzen. Die Liste ist mit der Origin-Firewall
abzugleichen, wie in der [Cloudflare-Anleitung für Nginx](https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/)
beschrieben.

Das Backend von 2.49.1 startet über
`app.asgi:create_application --factory --no-proxy-headers`.
[app/asgi.py](../app/asgi.py) legt die
[Proxy-Vertrauensschicht](../app/proxy_headers.py) vor die vorhandene FastAPI-App.
Sie prüft den tatsächlichen Transport-Peer, bevor Uvicorns
`ProxyHeadersMiddleware` HTTP- und WebSocket-Besucheradressen auflöst.
`FORWARDED_ALLOW_IPS` muss genau das geprüfte Docker-Gateway enthalten
(auf dieser Produktion `172.18.0.1`), keinen Wildcard-Wert.

Nur von diesem lokalen Proxy wird ein einzelner gültiger Cloudflare-Peer aus
dem von Nginx überschriebenen Header als privater ASGI-Nachweis übernommen.
Die Länderprüfung nutzt diesen Nachweis statt der bereits aufgelösten
Besucheradresse; ohne verifizierten Edge-Peer oder gültigen Ländercode bleibt
das Land unbekannt. Nicht vertrauenswürdige Peers und doppelte oder mehrteilige
Edge-Header ergeben keinen solchen Nachweis. HTTP-Schutz und
WebSocket-Kontingente erhalten dieselbe Besucheradresse. Der Nachweis bleibt
im Request-/Verbindungskontext und fügt der Telemetrie keine gespeicherte IP
hinzu.

The header preparation is live: Nginx overwrites `X-Forwarded-For` with
`$remote_addr` and `X-RTD-Cloudflare-Peer` with `$realip_remote_addr` for HTTP
and WebSockets. Activate the additional Real-IP include only after the
backend rollout using the sequence below. It contains
the 22 official ranges checked on 2026-10-11 and trusts `CF-Connecting-IP`
only from direct peers in those ranges. Keep it aligned with the firewall.

The 2.49.1 backend uses
`app.asgi:create_application --factory --no-proxy-headers`.
Its outer ASGI wrapper validates the physical transport
peer before Uvicorn resolves forwarded HTTP and WebSocket visitor addresses.
`FORWARDED_ALLOW_IPS` must contain the verified Docker gateway only
(`172.18.0.1` on this production), never a wildcard. Only that local proxy may
provide a single valid Cloudflare peer through the overwritten header.
Country validation uses this private ingress evidence rather than the
resolved visitor address; unverified peers, duplicate/multiple edge values or
invalid countries yield an unknown country. HTTP and WebSocket limits receive
the same visitor address. The evidence remains transient and adds no stored
IP address to telemetry.

### Aktivierungsreihenfolge und Rücknahme / Activation order and rollback

1. Vollständige CI und Backend-Deployment von 2.49.1 abschließen. Den
   tatsächlichen Container-Start mit Factory, `--no-proxy-headers`, dem
   geprüften `FORWARDED_ALLOW_IPS` und erfolgreichen Healthchecks prüfen.
   Erst danach die Real-IP-Include auf den Server kopieren.
2. Die aktive Nginx-Site geschützt sichern. Die ursprüngliche Sicherung dieses
   Umbaus liegt unter
   `/root/rollthedice-security-20261011-proxy/rollthedice.conf.before`.
   Vor Real-IP zusätzlich die bereits geprüfte Header-Vorstufe als
   `/root/rollthedice-security-20261011-proxy/rollthedice.conf.headers` sichern.
   Die neue Include aus dem freigegebenen Checkout installieren:

   ```bash
   sudo install -m 0644 -- deploy/nginx/cloudflare-real-ip.conf /etc/nginx/conf.d/cloudflare-real-ip.conf
   sudo nginx -t
   ```

   Nur nach erfolgreichem `nginx -t` mit `sudo systemctl reload nginx`
   aktivieren; bei einem Fehler nicht reloaden.
3. Nach dem Reload die tatsächlich geladene Konfiguration und die
   Besucher-/Edge-Trennung prüfen. Beide Produkt-Healthchecks, normale
   Anmeldung, Spiel- und Presence-WebSockets sowie die direkte Origin-Sperre
   erneut prüfen. Gefälschte Proxy-/Länderheader müssen untrusted bleiben;
   Länder müssen trotz Besucher-IP-Auflösung weiter korrekt zugeordnet werden.
   Die Real-IP-Aktivierung erst mit diesen produktiven Nachweisen als geprüft
   markieren. Lokale Regressionstests beweisen keine produktive Firewall.
4. Für den Proxy-Rollback ausschließlich die neu installierte
   `/etc/nginx/conf.d/cloudflare-real-ip.conf` entfernen und die geprüfte
   Header-Vorstufe beibehalten; bei Bedarf die Site aus `.headers` zurückspielen.
   Erst nach erfolgreichem `nginx -t` graceful reloaden. Die alte `.before`-Site
   benötigt auch das alte Backend: ohne den neuen Edge-Header würde die
   ASGI-Schicht von 2.49.1 Länder als unbekannt behandeln. Keine anderen Includes
   entfernen. Dieser
   Rollback lässt die Cloudflare-Regeln und die Origin-Firewall unverändert;
   deren separate Rücknahme ist oben beschrieben.

Finish full CI and the 2.49.1 backend rollout first, then verify the actual
factory command, `--no-proxy-headers`, exact trusted gateway and health checks.
Only then copy the Real-IP include, retain the protected site backup and run
`nginx -t`. Reload only after successful validation. After reload, verify the
loaded configuration, visitor/edge separation, both health checks, ordinary
sign-in, game/presence WebSockets, direct-origin rejection and resistance to
spoofed proxy/country headers. Mark Real-IP as verified only after those live
checks; local tests do not prove the firewall.

For proxy rollback, remove only the newly installed
`/etc/nginx/conf.d/cloudflare-real-ip.conf` and retain the verified forwarding
headers. Before activation, save this header stage as
`/root/rollthedice-security-20261011-proxy/rollthedice.conf.headers`; restore that
site if necessary, validate and gracefully reload. Restoring the original
`.before` site also requires the old backend, since 2.49.1 needs the overwritten
edge header to retain country attribution. Preserve unrelated includes, the
Cloudflare rules and the origin firewall; firewall recovery is separate.

## Bots / Request agents

Das Dashboard speichert nur feste Clientfamilien aus der angegebenen
Browserkennung, etwa Googlebot, Bingbot, Applebot, KI-Crawler, curl und Python.
Diese Angaben sind **nicht verifiziert** und keine Grundlage für Bot-Ausnahmen.
Automatisierung kann normale Browserkennungen senden. Cloudflares
[verifizierte Bots](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/cf.client.bot/)
sind eine gesonderte Edge-Prüfung und werden hier nicht aus einem beliebigen
HTTP-Header erfunden. Die App führt keine DNS-Prüfung je Request aus.

The dashboard's fixed request-agent families are self-declared and unverified.
They cannot justify bot exemptions; automation can mimic browser agents.
Cloudflare's verified-bot signal is separate. The app neither trusts an arbitrary
verification header nor performs per-request DNS verification.
