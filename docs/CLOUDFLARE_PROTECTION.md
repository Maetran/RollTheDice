# Cloudflare-Schutz / Cloudflare protection

Stand / Reviewed: 2026-10-05. Die Dashboard-Erweiterung und Cloudflare-Regeln
sind getrennte Änderungen. **RollTheDice: Auth API Burstschutz** wurde in der
Zone `zockdiewandan.online` auf Free aktiviert und aus den gespeicherten
Regeldetails erneut geprüft: 50 Requests / 10 Sekunden, Block / 10 Sekunden,
IP-Zähler, Active, die unten aufgeführten Pfade und `not cf.client.bot`.
Vorher bestanden dort keine Custom-, Rate-Limit- oder Managed-Regeln. Die neue
Regel belegt den einen Rate-Limit-Platz des Tarifs.

The rule is active in the Free zone and was verified by re-opening its saved
details. No custom, rate-limit or managed rules existed before this change.
Only the single new rate-limit rule was added; no plan or DNS setting changed.

## Prüfung / Assessment

Die Anwendung schützt bereits fehlgeschlagene Passwort-Anmeldungen (5 pro
15 Minuten je Netzwerk-/Kontoschlüssel), Registrierung, E-Mail-Versand und
Spielanlage. Die vorhandene Telemetrie besitzt eigene Mengenbegrenzungen.
Der laufende Nginx schützt reguläre HTTP-Anfragen mit 20 Requests/Sekunde und
einem Burst von 80 je `$binary_remote_addr`; WebSocket-Verbindungen verwenden
eine eigene Location. Diese Konfiguration wurde auf `zdwa` gelesen.

Cloudflare ist vorgeschaltet. Der Nginx-Schlüssel bezieht sich in der aktuell
gelesenen Konfiguration auf die verbindende Proxy-Adresse; es gibt dort keine
`real_ip_header CF-Connecting-IP`-Umschreibung. Dieser Zähler entspricht daher
nicht zuverlässig einzelnen Besuchern. Vor einer Verschärfung am Origin müssen
vertrauenswürdige Proxy-Netze und die Adresskette geprüft werden. Keine beliebigen
Client-Header als echte IP übernehmen.

Existing application protection covers failed password logins (5 per 15 minutes
per network/account key), registration, account emails and game creation.
Telemetry has independent volume limits. Live Nginx configuration limits regular
HTTP traffic to 20 requests/second with a burst of 80 per `$binary_remote_addr`,
with a separate WebSocket location. Its current key describes the connecting
proxy address, not reliably one visitor. Tightening that origin limit requires
reviewing the trusted proxy/address chain first.

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

## Aktivierte Regel / Active rule

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
