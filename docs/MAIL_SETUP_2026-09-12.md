# Mailversand und DNS / Email sending and DNS

Stand: 12.09.2026. Der Adapter verwendet Resend. Konfigurierter
sichtbarer Absender für beide Spiele: `noreply@zockdiewandan.online`.
Nur Registrierung, Adressbestätigung, angeforderte Passwort-Resets und die
Bestätigung nach einem Reset; kein persönliches Postfach, kein Betreiber-CC,
kein Newsletter. Der freigegebene vollständige Rollout aktiviert den Versand
mit `ROLLTHEDICE_EMAIL_ENABLED=1`.
Nach Prüfung der Eigenhosting-Alternative ist Resend im kostenlosen Tarif
ausgewählt. **Die Domain ist bei Resend verifiziert und versandbereit.**
DNS-Einrichtung und sichere Schlüsselablage auf dem Produktionsserver sind
abgeschlossen. Öffentliche DNS-Abfragen bestätigen SPF, DKIM und DMARC.
Ein isolierter App-Prozess auf dem Produktionsserver hat Registrierungs- und
Reset-Mails an Resends simulierte Testempfänger erfolgreich beim Anbieter
eingeliefert. Anschließend bestätigte der Nutzer den Eingang beider echten
Testmails aus dem finalen Adapter. Diese trugen einen Versandtest-Hinweis und
enthielten keine aktiven Kontolinks; bestehende Konten wurden nicht verändert.
SPF/DKIM/DMARC sind über DNS und Resends Domainprüfung bestätigt. Die Header
der empfangenen Testmails wurden nicht ausgelesen.

## Alternative: eigener SMTP-Versand

Direkter Versand vom vorhandenen Server ist grundsätzlich möglich, etwa mit
einem ausschließlich intern nutzbaren Postfix-Submission-Dienst und einer
dauerhaften Versandwarteschlange. Dafür braucht die App einen SMTP-Adapter;
der derzeitige Adapter spricht nur Resends HTTP-API.

Vor Installation sind feste Serveridentität, passende A-/PTR-Einträge,
ausgehender Port 25 sowie SPF, DKIM, TLS und DMARC zu prüfen. IONOS, das in der
Deployment-Dokumentation als Serveranbieter genannt ist, sperrt Port 25 für
die betreffenden Serverprodukte standardmäßig und verlangt gegebenenfalls
Freischaltung durch den Support. Der tatsächliche Portstatus dieses Servers
ist noch ungeprüft. Warteschlange, Rückläufer und Zustellreputation würden
zum eigenen Betrieb gehören. Persönliche Postfächer sind auch dafür nicht nötig.

Quellen: [IONOS: Port 25 freischalten](https://www.ionos.com/help/server-cloud-infrastructure/firewall-policies/unblocking-port-25-for-sending-emails/),
[Google: Absenderrichtlinien](https://support.google.com/mail/answer/81126?hl=de).

## Geprüfter Bestand

Die Cloudflare-DNS-Verwaltung der Domain ist erreichbar. Vor Änderungen wurden
folgende Mail-Einträge gelesen; API-Schlüssel und Kontodaten gehören nicht in
dieses Dokument:

| Name | Typ | Inhalt |
| --- | --- | --- |
| `@` | MX, Priorität 0 | `.` (Null MX) |
| `@` | TXT | `v=spf1 -all` |
| `_dmarc` | TXT | `v=DMARC1; p=reject; sp=reject` |
| `zdwa` | MX, Priorität 0 / TXT | `.` / `v=spf1 -all` |
| `zilch` | MX, Priorität 0 / TXT | `.` / `v=spf1 -all` |

Das war der Ausgangsbestand vor der Einrichtung. Anschließend wurden die
folgenden, von Resend erzeugten Einträge in Cloudflare gespeichert und durch
Resend erfolgreich verifiziert:

| Name | Typ | Inhalt |
| --- | --- | --- |
| `resend._domainkey` | TXT | Der von Resend erzeugte öffentliche DKIM-Schlüssel (`p=MIGfMA0G…GXkD9wIDAQAB`) |
| `send` | TXT | `v=spf1 include:amazonses.com ~all` |
| `send` | MX, Priorität 10 | `feedback-smtp.eu-west-1.amazonses.com` |

Alle neuen Einträge verwenden TTL Auto und DNS only. Der Root-Null-MX wurde
entfernt; Root-SPF, DMARC und die Null-MX-/SPF-Einträge der Spiel-Subdomains
sind erhalten. Die Domain verwendet Region Irland (`eu-west-1`), Versand an,
Empfang aus und keine Tracking-Konfiguration. **Enforced TLS** ist gespeichert:
Kontomails werden nur über verschlüsselte Verbindungen zugestellt; unterstützt
ein Empfängerserver kein TLS, scheitert die Zustellung.

Resend zeigt **Verified** und „Your domain is ready to send emails“.
Der Schlüssel `RollTheDice production account mail` besitzt ausschließlich
`Sending access`, ist auf `zockdiewandan.online` beschränkt und liegt sicher in
der serverseitigen `.env`. Sein Wert und Testempfänger stehen weder in diesem
Dokument noch im Repository.

Beim ersten Versandversuch lehnte der vorgeschaltete Dienst den HTTP-Client
mit `403 / 1010` ab. Der Adapter sendet jetzt den expliziten User-Agent
`RollTheDice/1.0 (+https://zockdiewandan.online)`, wie von Resend gefordert.
Mit dieser Korrektur akzeptierte Resend Registrierungs- und Reset-Mails aus
dem isolierten App-Prozess. Das öffentliche Feature-Flag blieb dabei `0`;
keine bestehenden Spielerkonten waren Teil dieser Probe.

## Abnahme und Releaseanleitung

DNS, Provideranbindung und Posteingang sind abgenommen. 92 Backendtests mit
46 Unterfällen einschließlich Registrierungsbestätigung und Passwort-Reset
sind erfolgreich. Diese Abläufe verwenden isolierte Testkonten und Datenbanken;
die echten Versandproben hatten absichtlich keine aktiven Kontolinks.
Lint und alle 109 verschiedenen Browserfälle sind ebenfalls erfolgreich,
einschließlich aktivierter E-Mail-Einstellungen in DE/EN für beide Spiele.
Damit ist die Abnahme für den freigegebenen vollständigen Deploy abgeschlossen.

1. In Resend `zockdiewandan.online` als Versanddomain hinzufügen. Empfang sowie
   Open-/Click-Tracking ausgeschaltet lassen; Bestätigungslinks sollen nicht
   umgeschrieben werden. Keine kostenpflichtige Erweiterung erforderlich für
   die Einrichtung innerhalb des verfügbaren kostenlosen Kontingents.
2. Nur die tatsächlich von Resend angezeigten DNS-Werte übernehmen: DKIM-TXT
   typischerweise unter `resend._domainkey`, SPF-TXT und Return-Path-MX unter
   `send`. MX-Ziel und DKIM-Schlüssel sind domain-/regionsabhängig und dürfen
   nicht aus Beispielen kopiert werden. Es entsteht kein Benutzerpostfach.
3. Den Root-Null-MX vor echtem Versand entfernen: RFC 7505 Abschnitt 4.2 rät
   von Null MX auf sichtbaren From-Domains ab; Empfänger dürfen solche Mails
   ablehnen. Die Null-MX-Einträge der Spiel-Subdomains können bestehen bleiben.
   Ohne Root-MX fällt eingehende Zustellung auf A/AAAA zurück; dadurch wird
   kein Maildienst eingerichtet. Der Webserver braucht keinen SMTP-Dienst.
4. Root-SPF `-all` kann bestehen bleiben, solange Resend den Envelope-Sender
   auf `send.zockdiewandan.online` mit dessen eigenem SPF verwendet. DMARC
   `p=reject; sp=reject` bleibt bestehen: korrekt zur From-Domain ausgerichtetes
   DKIM genügt für DMARC. Keine zusätzliche DMARC- oder SPF-Zeile am selben
   Namen ergänzen und die bestehende Schutzrichtlinie nicht abschwächen.
5. Resends Domainprüfung erfolgreich abschließen. Einen API-Key ausschließlich
   mit Versandrecht und Beschränkung auf diese Domain verwenden; nur im
   Produktions-Secretstore ablegen, niemals im Repository oder Chat.
6. Versand vor Aktivierung zuerst in einem isolierten Prozess testen.
   `delivered+signup@resend.dev` ist Resends
   simulierter Testempfänger und prüft API-/Absenderannahme. Das beweist noch
   keine Zustellung in einem realen Posteingang. Zusätzlich den Eingang
   gekennzeichneter Registrierungs- und Reset-Testmails ohne aktive Kontolinks
   beim ausdrücklich gewählten Testempfänger bestätigen lassen. Bestätigung
   und Reset gesondert mit isolierten Testkonten und Datenbanken prüfen.
   Für einen zusätzlichen Nachweis der empfangenen Authentifizierungsergebnisse
   SPF/DKIM/DMARC in den Mailheadern kontrollieren; dieser Headernachweis wurde
   bei der aktuellen Abnahme nicht erhoben. Keine Tests an echten Spielerkonten.
7. Nach erfolgreichen Backend- und Browserprüfungen sowie dokumentierter
   Versandabnahme den vollständigen Deploy mit `ROLLTHEDICE_EMAIL_ENABLED=1`
   durchführen. Beide Produkt-Origins müssen danach in `/api/auth/me`
   `registration.email_enabled=true` melden. Gesundheit, Registrierungseinstiege
   und die vorhandenen Konto-/Spielzuordnungen prüfen. Der erfolgreiche Deploy
   wird im Deployment-Marker und Releaseprotokoll festgehalten.

Zielkonfiguration dieses Releases (der API-Key ist hinterlegt und hier ausgelassen):

```dotenv
ROLLTHEDICE_EMAIL_ENABLED=1
ROLLTHEDICE_EMAIL_FROM=noreply@zockdiewandan.online
```

`EMAIL_FROM` akzeptiert eine reine Mailadresse, keinen zusätzlichen Anzeigenamen.
Das Aktivieren mit `EMAIL_ENABLED=1` ändert die Registrierung beider Spiele
gemeinsam auf Bestätigung per Mail. Bestandskonten können danach eine Adresse
ergänzen. Passkeys und Passwort-Anmeldung bleiben verfügbar.
Bei Problemen das E-Mail-Flag wieder auf `0` setzen und den Dienst mit dieser
Konfiguration neu erstellen. Bestätigte Adressen bleiben gespeichert;
Benutzername/Passwort-Anmeldung und bereits bestätigte E-Mail-Anmeldung bleiben
nutzbar, die bisherige Registrierung mit Passwort wird wieder angeboten.

## Betriebsgrenzen

Resend Free nennt derzeit 3.000 E-Mails pro Monat und 100 pro Tag. Alle
Kontomails teilen dieses Kontingent. Die Anwendung prüft beim Start die lokale
Konfiguration, nicht die tatsächliche Domainfreigabe oder Zustellung. Sie
versucht jeden Versand höchstens zweimal mit derselben Idempotency-ID.
Hintergrundversand ist keine dauerhafte Warteschlange; ein Neustart oder ein
erschöpftes Anbieterlimit kann einen erneuten Versuch durch den Nutzer nötig
machen. Neutrale Antworten auf Reset-Anfragen beweisen keinen Versand.

## English

The existing adapter uses Resend, with `noreply@zockdiewandan.online` as the
requested sender for both games. Resend now confirms the domain as verified
and ready to send. Provider-issued DKIM and `send` return-path SPF/MX records
were added in Cloudflare; only the root null MX was removed. Existing root SPF,
strict DMARC and the game subdomain mail records remain intact. Region is
Ireland, receiving and tracking are off, and enforced TLS is enabled. Public
DNS queries confirm SPF, DKIM and DMARC. The domain-restricted sending-only
key is stored securely in the production server's `.env`; its value and test
recipient identities are excluded from repository documentation.
An isolated application process on the production server successfully submitted
registration and reset messages to Resend's simulated recipients after adding
the explicit application User-Agent required to avoid `403 / 1010` rejection.
Provider acceptance was followed by real inbox verification: the user confirmed
both registration and reset test messages from the final adapter. They were
clearly marked as delivery tests, contained no active account links and changed
no existing accounts. Received message headers were not inspected; DNS and
Resend domain verification provide the recorded SPF/DKIM/DMARC evidence.
92 backend tests with 46 subtests, including confirmation and recovery, passed
using isolated accounts and databases. Lint and all 109 distinct browser cases also pass, including email-enabled
account settings in both games and languages. The full deployment is authorized.
The user selected Resend's free plan after considering direct SMTP sending
from the existing server. The self-hosted option would need an SMTP adapter, suitable
A/PTR and authentication records, an outgoing port 25 check and possibly
provider unblocking, plus queue and delivery monitoring.

Complete the acceptance checks and run the authorized full deployment with
`ROLLTHEDICE_EMAIL_ENABLED=1` and verify both products' feature status and health.
Use a designated mailbox and isolated account for confirmation and recovery
tests. Do not use real player accounts. Setting the email flag back to `0` and
recreating the service restores legacy registration while preserving account
data and existing password/passkey access.

## Quellen / Sources

- [Resend: Cloudflare DNS setup](https://resend.com/docs/knowledge-base/cloudflare)
- [Resend: Domain verification](https://resend.com/docs/dashboard/domains/introduction)
- [Resend: Tracking](https://resend.com/docs/dashboard/domains/tracking)
- [Resend: API-key permissions](https://resend.com/docs/dashboard/api-keys/introduction)
- [Resend: Test recipients](https://resend.com/docs/dashboard/emails/send-test-emails)
- [Resend: Required User-Agent and error 1010](https://resend.com/docs/knowledge-base/403-error-1010)
- [Resend: Pricing](https://resend.com/pricing)
- [RFC 7505, section 4.2: Null MX and sending](https://www.rfc-editor.org/rfc/rfc7505#section-4.2)
- [RFC 7489, section 4.2: DMARC authentication](https://www.rfc-editor.org/rfc/rfc7489#section-4.2)
