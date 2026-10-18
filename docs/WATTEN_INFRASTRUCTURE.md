# Watten: geschlossene Domain-Reservierung / Closed domain reservation

Dieses Paket bereitet ausschliesslich `watten.zockdiewandan.online` vor.
DNS-/Origin-Einrichtung ist vom Owner beauftragt; die öffentliche
Spielveröffentlichung und ein App-Deployment bleiben getrennt freizugeben.
Die Reservierung antwortet auf HTTPS mit DE/EN-Hinweis und HTTP 503,
`Cache-Control: no-store` und `X-Robots-Tag: noindex, nofollow`.
`/robots.txt` liefert 200 und sperrt alle Crawler. Konto-, API-, Worker-,
Manifest-, Sitemap- und WebSocket-Pfade erreichen keinen Anwendungsprozess.

This package reserves the fixed Watten hostname without releasing the game.
HTTPS serves a bilingual HTTP 503 holding response with no-store/noindex;
robots disallows all crawling. No request is forwarded to the application.
Public release, application deployment and Search Console submission remain
separate gates.

## Tatsächlich geprüft am 18.10.2026 / Verified audit

- Öffentlicher lokaler DNS-Resolver: Watten A/AAAA leer, A-Abfrage NXDOMAIN;
  reguläres HTTPS kann den Namen nicht auflösen. Direkte UDP-Abfragen beider
  autoritativer Nameserver liefen in dieser lokalen Umgebung in den Timeout.
- Cloudflare-Dashboard der richtigen Zone: authentifiziert, Free, DNS Full;
  Suchfilter `watten` zeigt **No DNS records**. Apex, `www`, `zdwa`, `zilch`
  und `hausdepp` sind als A-Einträge auf `217.154.16.72` mit Proxy/Auto vorhanden.
- TLS-Übersicht: **Full**, automatischer Modus. Das ist kein Nachweis für
  Full (strict); dieses Paket ändert die bestehende Zonenrichtlinie nicht.
  Eine TLS-Verbindung mit Watten-SNI zur vorhandenen Edge-IP validiert die
  System-Vertrauenskette und den Namen; das Edge-Zertifikat deckt Apex und
  `*.zockdiewandan.online` ab (bis 03.12.2026).
- `ssh zdwa` erreicht den Origin. Produktionscheckout ist sauber auf `master`,
  Commit `80bc42df17eb5852a5153582b263f6d065138f35`. Anwendungsport ist nur
  `127.0.0.1:8000` veröffentlicht. Es gibt keinen Watten-Vhost und keine
  Watten-Zertifikatslinie.
- `nginx -t` besteht; bestehende Warnungen betreffen doppelte `_`-HTTP-Namen.
  `conf.d` wird vor `sites-enabled` geladen. Die vorhandene Systemsite
  `sites-enabled/default` erklärt jedoch `80 default_server` und
  `[::]:80 default_server` ausdrücklich; neue benannte Watten-Vhosts ändern
  deshalb den HTTP-Default nicht. Der Helfer verlangt beide Deklarationen
  vor jeder Änderung aus der tatsächlich geladenen Konfiguration.
  Real-IP ist aktiv. UFW ist aktiv: SSH bleibt weltweit erlaubt, 80/443 nur
  für die 22 bestehenden Cloudflare-IPv4-/IPv6-Netze. Keine Firewalländerung.
- Apex/`www`/Zilch/Hausdepp: echte HTTPS-GETs `/api/health` liefern 200;
  `zdwa` liefert erwartungsgemäss 308 auf die Apex-Origin.
- Bestehende Origin-Zertifikate: Apex/`www`/ZDWA/Zilch bis 03.12.2026,
  separate Hausdepp-Linie bis 14.01.2027. `certbot.timer` aktiv und enabled.
- Search Console: `sc-domain:zockdiewandan.online` ist auswählbar. Die
  Einstellungen bestätigen **Du bist ein bestätigter Inhaber** im aktiven
  Manuel-Henn-Konto. Keine neue Property und keine Rechteerweiterung nötig.
  Keine Watten-Sitemap eingereicht.

These are read-only observations, not a completed Watten activation. The
existing Cloudflare app session and `ssh zdwa` provide the necessary access;
no new credential was requested or created. Secret values were not printed.

## Geprüftes Aktivierungspaket / Activation package

- `deploy/nginx/watten-reserved.conf` ist eine eigene `conf.d`-Datei; die
  bestehende Suite-Site wird nicht ersetzt.
- `scripts/activate_watten.sh` arbeitet standardmässig lesend. Voraussetzung
  ist ein expliziter proxied A-Eintrag `watten → 217.154.16.72`; DNS-only ist
  mit der bestehenden Origin-Firewall kein Betriebsmodus.
- Mit `APPLY=1` wird ein enger temporärer HTTP-01-Vhost angelegt. Jeder Versuch
  hat einen neuen zufälligen Pfad und Token. Nur eine öffentliche HTTP-200-
  Antwort mit exakt denselben Bytes erlaubt den Certbot-Antrag; keine
  Redirects, TLS-Ausnahmen oder abgeschalteten Schutzschichten.
- Separate Linie: `/etc/letsencrypt/live/watten.zockdiewandan.online/`.
  Hostabdeckung und mindestens sieben Tage Restlaufzeit werden geprüft.
- Eigener geprüfter Reload-Hook; unveränderte bestehende Hooks bleiben erhalten.
  Der permanente HTTP-Webroot wird nach finalem Reload erneut öffentlich
  bewiesen und mit `certbot renew --dry-run --cert-name ...` geprüft.
- Lokale SNI-/Kettenprüfung und öffentliche HTTPS-Prüfung verlangen die
  geschlossene Antwort auch für API, Worker, Sitemap und WebSocket-Pfade;
  `Set-Cookie` ist unzulässig. Alle fünf bisherigen Hosts werden vor und nach
  Aktivierung geprüft. Readiness ist auf zehn Versuche begrenzt.
- Unbekannte vorhandene Staging-Dateien, abweichende eigene Targets und
  unbekannte eigene Renewal-Hooks stoppen den Lauf. Bei Fehlern werden nur
  selbst angelegte Dateien entfernt oder die eigene vorherige Datei aus dem
  Backup wiederhergestellt. Ein ausgestelltes separates Zertifikat darf zur
  Diagnose und sicheren Wiederholung erhalten bleiben.

Origin commands after code review and the requested DNS setup, from an isolated
operator staging directory containing the two reviewed files:

```bash
bash scripts/activate_watten.sh
APPLY=1 bash scripts/activate_watten.sh
```

Der Helfer startet/stoppt keinen Container, verändert keine Produktionsdaten,
keinen produktiven Git-Checkout und keine existierende Nginx-Site. Er ist kein
App-Release und benötigt keinen `master`-Merge. DNS-Eintrag und eigene Dateien
vor der ersten Aktivierung mit Zeitpunkt/Prüfsumme im Ausführungslog erfassen.

For manual rollback, preserve the failed target as evidence, restore only the
logged previous Watten target (or remove only that target if it did not exist),
then validate with `sudo -n nginx -t` before a graceful reload. Preserve all
existing product sites, firewall rules, SSH and Cloudflare proxy settings.
Remove only the newly added Watten DNS record if returning to the absent-domain
state is intended; never replace the zone. A retained new certificate lineage
must be recorded for a reviewed retry or certificate-specific cleanup. Automatic
rollback does not delete certificates or unrelated renewal configuration.

## Spätere öffentliche Freigabe / Later public release

Die Reservierung wird erst durch eine geprüfte Watten-Originroute ersetzt,
wenn öffentliche Bereitstellung ausdrücklich freigegeben ist. Dabei Konto,
Passkeys, Origin/CSRF, Recoverylinks, Cookies, PWA/Worker/Push, Canonicals,
strukturierte Daten, `site_seo.py`, Navigationsvertrag, robots und die tatsächliche
Sitemap gemeinsam prüfen. Der alte Cloudflare-Scanregel-Referenzbestand nennt
nur vier ursprüngliche Hosts; vor öffentlicher Erweiterung Ist-Regel lesen und
den neuen Host bewusst aufnehmen, ohne bestehende Regeln zu ersetzen.

Nach freigegebenem Release und erfolgreichem öffentlichem HTTPS-/Canonical-/
Sitemap-Smoke `https://watten.zockdiewandan.online/sitemap.xml` in der
verifizierten Domain-Property einreichen und Googles Antwort nachlesen.
Während der Reservierung wird keine Sitemap angeboten oder eingereicht.
Einreichung und tatsächliche Indexierung sind getrennte Ergebnisse.

After the explicitly approved public release, submit the real, reachable Watten
sitemap through the verified domain property and verify the response. Submission
does not establish indexing. The holding response must never be described as a
released game.

## Lokale Nachweise / Local evidence

Gezielte Shell-Double-Tests prüfen Dry-run, unbekannte Dateien, DNS/Baseline,
exakte Challenge-Bytes, frische Token, TLS-/Cache-/Cookie-Fehler, Erneuerung und
Rücknahme. Ein isolierter lokaler Nginx-Container prüft die echte Konfiguration,
HTTPS mit eigener lokal vertrauter Test-CA, geschlossene Pfade und HTTP-01.
Das sind keine Produktions- oder vollständigen Push-Nachweise. Der gemeinsame
fertige Commit benötigt weiterhin den vorgeschriebenen vollständigen lokalen
Prüfablauf vor jedem Push.

Cloudflare-Referenz für die getrennte Origin-Zertifikatsanforderung:
[Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/).
