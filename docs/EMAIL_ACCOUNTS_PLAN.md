# E-Mail-Konten: Machbarkeit und Plan

Stand: 12.09.2026. **Passkeys und Fairplay sind produktiv. E-Mail ist für den
nächsten vollständigen Rollout nach Versand- und Funktionsabnahme ausgewählt.**
Resend, die verifizierte Absenderdomain für `noreply@zockdiewandan.online` und
der eingeschränkte serverseitige Schlüssel sind eingerichtet. Öffentliche
DNS-Prüfungen und die Providerannahme isolierter Registrierungs-/Reset-Testmails
sind erfolgreich. Der Nutzer hat beide echten, gekennzeichneten Testmails ohne
aktive Kontolinks im Posteingang bestätigt; Mailheader wurden nicht ausgelesen.
Die Abnahmeschritte stehen im [Versandprotokoll](MAIL_SETUP_2026-09-12.md).
Der Zielzustand des freigegebenen Rollouts ist `ROLLTHEDICE_EMAIL_ENABLED=1`
zusammen mit `ROLLTHEDICE_PASSKEYS_ENABLED=1`. Die Konfigurationsvorlagen
aktivieren weiterhin nichts automatisch. Deployment-Ergebnisse werden im
[Sicherheitsreview](ACCOUNT_SECURITY_REVIEW_2026-09-12.md) festgehalten.

## Einschätzung

Gut machbar, mit überschaubarem bis mittlerem Aufwand. Das Projekt braucht keinen
neuen Auth-Anbieter und keinen Umbau der Spiele: ZDWA und Zilch teilen bereits
`User`, Passwort-Hashes, serverseitige Sitzungen und feste Konto-IDs.
`app/auth.py` enthält Anmeldung und Passwortwechsel, `app/api_auth.py` die API,
`app/auth_protection.py` Schutz vor häufigen Versuchen. SQLAlchemy/Alembic sind
für zusätzliche Felder und Tabellen vorhanden. Vor diesem Branch gab es keine
E-Mail-Adresse am Konto und keinen E-Mail-Versand. Der Branch ergänzt diese
Bausteine, ohne eine bestehende Konto-ID oder Spielzuordnung zu ändern.

## Umsetzungsstand und gewählter Rollout

Die E-Mail-Ausbaustufe ist implementiert; Versanddienst und Serveranbindung
sind eingerichtet. Die folgenden Abläufe beschreiben das Verhalten nach der
Abnahme und Aktivierung. Passkeys bleiben davon unabhängig verfügbar:

- Neue Konten speichern zunächst nur eine befristete Anmeldung. Erst der
  E-Mail-Link und die eigene Passwortwahl erzeugen das Konto mit bestätigter
  Adresse. Unbestätigte Anfragen reservieren weder Namen noch Adressen; die
  Eindeutigkeit wird beim Abschluss atomar geprüft. Bei ausgeschaltetem
  E-Mail-Feature bleibt die bisherige Registrierung mit Passwort verfügbar.
- Bestehende Konten können eine Adresse ergänzen oder ändern. Die bisherige
  bestätigte Adresse bleibt gültig, bis die neue Adresse bestätigt wurde.
- Anmeldung akzeptiert weiterhin Benutzernamen und zusätzlich bestätigte
  E-Mail-Adressen. Passwort-Reset-Anfragen bleiben bei bekannten und unbekannten
  Adressen gleichartig; ein erfolgreicher Reset widerruft bestehende Sitzungen,
  Passkeys und offene Adressänderungen. Auch bereits laufende Prüfungen eines
  alten Passworts können danach keine neue Sitzung anlegen.
- Resend wird ausschließlich über seine serverseitige HTTP-API angesprochen.
  Der Versand umfasst Registrierungsbestätigung, Adressbestätigung, angeforderten
  Passwort-Reset und die Bestätigung nach einem Reset. Es gibt keinen Empfang,
  kein Betreiber-CC, keinen Newsletter und kein benötigtes persönliches
  Postfach.
- Registrierungs- und Reset-Mails werden nach der neutralen HTTP-Antwort
  versandt. Eine angenommene Anfrage ist keine Zustellgarantie. Der
  Hintergrundversand ist keine dauerhafte Warteschlange: Bei einem Neustart
  zwischen Antwort und Versand kann ein erneuter Versuch nötig sein. Bereits
  versandte, gültige Links bleiben beim Wiederholen gültig. Zeitnahe und
  parallele Anfragen werden je IP und Ziel begrenzt.
- Einmal-Token werden nur gehasht gespeichert, haben Zweck und Ablaufzeit und
  erscheinen in Links ausschließlich im URL-Fragment. Die kurzen Aktionsseiten
  sind `noindex`, `no-store` und entfernen das Fragment vor weiterer Bedienung.
- WebAuthn-Passkeys sind als bevorzugte Anmeldung verfügbar. Der Browser
  verwendet discoverable Credentials mit verpflichtender Benutzerbestätigung;
  der Server speichert nur Credential-ID, öffentlichen Schlüssel, Counter und
  optionalen Gerätenamen. Die feste RP-ID ist der ZDWA-Host und erlaubt die
  kontrollierte Zilch-Subdomain. Das Passwort bleibt eine Rückfall-Anmeldung.

Die Datenbankrevisionen `20260912_0037` bis `20260912_0039` sind additiv. Sie
halten E-Mail-Identität und kurzlebige Token, abgebrochene gestartete Spiele
sowie Passkey-Credentials und kurzlebige WebAuthn-Ceremonies getrennt von
Spielergebnissen.

Meine projektspezifische Schätzung für eine fertige erste Version einschließlich
Bestandskonten, DE/EN, Tests und Einrichtung: **2–4 Entwicklungstage**.
Ein Versandprototyp ist deutlich kleiner; die verlässlichen Bestätigungs- und
Wiederherstellungsabläufe machen den größten Teil aus. DNS-Verifizierung oder
Freischaltung beim Versanddienst können zusätzliche Wartezeit verursachen.

## Was du selbst betreiben musst

Nach der E-Mail-Aktivierung verschickt die App ausschließlich Kontomails an die Nutzer:
Adressbestätigung, angeforderter Passwort-Reset und eine kurze Bestätigung nach
erfolgtem Reset. Keine Kopie an dich, keine Newsletter, kein persönliches
Postfach und kein eigener Mailserver. Dafür braucht es trotzdem einen Dienst,
der diese automatischen E-Mails tatsächlich zustellt.

Der Versand verwendet **Resend über die HTTP-API** mit explizitem
Anwendungs-User-Agent. Konfigurierter Absender ist `noreply@zockdiewandan.online`;
die Domain ist verifiziert. Diese Adresse benötigt kein separates Postfach.
Eingehende E-Mails werden nicht aktiviert. Technische Zustellfehler lassen sich
beim Anbieter bzw. in der Anwendung erkennen, ohne sie an dich weiterzuleiten.
Quellen: [Absender ohne Postfach](https://resend.com/docs/knowledge-base/how-do-i-create-an-email-address-or-sender-in-resend),
[separates Aktivieren des Empfangs](https://resend.com/docs/dashboard/receiving/custom-domains).

Die Absenderdomain ist mit den vom Anbieter vorgegebenen SPF-/DKIM-Einträgen
verifiziert; der vorhandene strikte DMARC-Eintrag bleibt erhalten. Unter `send`
liegen SPF und Return-Path-MX für technische Rückmeldungen, kein Benutzerpostfach.
Der bei der Einrichtung gefundene Root-Null-MX wurde entfernt, weil Empfänger
sonst laut RFC 7505 Abschnitt 4.2 Mails des gewünschten Root-Absenders ablehnen dürfen.
Das richtet kein Postfach ein; Einzelheiten stehen im
[DNS-Protokoll](MAIL_SETUP_2026-09-12.md).
[Domain-Verifizierung](https://resend.com/docs/dashboard/domains/introduction).

Die ursprüngliche Preisschätzung verwendete für Resends kostenlosen Tarif **3.000 E-Mails pro
Monat, höchstens 100 pro Tag**. Pro kostet **20 USD/Monat für 50.000 E-Mails**
ohne Tageslimit. Für einen kleinen Nutzerkreis dürfte der kostenlose Tarif
reichen; Bestätigungen, erneute Zustellversuche und Passwort-Resets verbrauchen
dasselbe Kontingent. Das ist eine frühere Planungsschätzung, da das erwartete
Volumen nicht bekannt ist; Preise vor Aktivierung erneut prüfen.
[Aktuelle Preise](https://resend.com/pricing).

## Vorgeschlagener Ablauf

1. **Neue Registrierung:** Benutzername und E-Mail-Adresse eingeben. Die App
   legt eine befristete Registrierungsanfrage an und schickt einen Link. Die
   Adresse und der gewünschte Name werden normalisiert und auf Konflikte
   geprüft; ein bestehendes Konto wird dabei niemals überschrieben.
2. **Adressbestätigung:** Der Link öffnet eine Seite, auf der der Nutzer sein
   Passwort selbst setzt und die Registrierung ausdrücklich abschließt.
   Erst danach entsteht das nutzbare Konto. Ein automatischer Link-Vorababruf
   durch Mailprogramme darf den Token nicht verbrauchen. Der Link ist
   24 Stunden gültig, erneutes Anfordern mit Wartezeit, alte Anfragen bereinigen.
   Damit ist der gewünschte Ablauf „Anmelden und per E-Mail bestätigen“
   abgedeckt; Newsletter-Einwilligungen sind kein Bestandteil dieser Funktion.
3. **Anmelden:** Bevorzugt per Passkey auf unterstützten Geräten, alternativ
   Benutzername oder bestätigte E-Mail-Adresse plus Passwort.
   Der Benutzername bleibt der öffentliche Spielname. E-Mail-Adressen erscheinen
   weder in Profilen noch in Chat, Ranking, Spielansichten oder Push-Nachrichten.
4. **Passwort vergessen:** E-Mail-Adresse eingeben, Reset-Link öffnen, neues
   Passwort setzen. Der Link ist 30 Minuten gültig. Danach werden bestehende
   Sitzungen, Passkeys, weitere Reset-Tokens und offene Adressänderungen
   ungültig; anschließend erfolgt die normale Anmeldung. Passkeys können
   danach neu eingerichtet werden. Ein gewöhnlicher Passwortwechsel in den
   Einstellungen behält vorhandene Passkeys.
5. **Bestehende Konten:** Anmeldung mit Benutzername bleibt möglich. In den
   Einstellungen lässt sich eine E-Mail-Adresse mit aktuellem Passwort und
   Bestätigungslink ergänzen. Erst bestätigte Adressen dürfen zum Reset dienen.
   Konten ohne E-Mail behalten vorerst den vorhandenen Admin-Reset.
   Adresswechsel bestätigen erst die neue Adresse, bevor sie die bisherige
   ersetzt. Es werden keine Konten allein anhand einer eingegebenen Adresse
   zusammengeführt.

## Geplante Änderungen

| Bereich | Umfang |
| --- | --- |
| Datenbank | Eindeutige normalisierte E-Mail, Bestätigungszeitpunkt; befristete Registrierungsanfragen und zweckgebundene Token-Datensätze |
| Backend | Registrierung bestätigen, Adresse ergänzen/wechseln, Bestätigung erneut senden, Reset anfordern und abschließen; Login um E-Mail erweitern |
| Versand | Kleine gemeinsame HTTP-Anbindung mit Timeout, begrenzten Wiederholungen/Idempotenz und verständlicher Fehlerbehandlung; API-Key nur serverseitig |
| Oberfläche | Beide Registrierungsseiten, Einstellungen, Bestätigungs- und Reset-Seiten, alle Texte und Mails DE/EN; private Seiten mit `noindex` |
| Bestand und Tests | Bestehende Konto-IDs erhalten; Testversand ausschließlich mit gemocktem Versanddienst/Testempfängern; Produktdokumentation und Release-Hinweis |

Tokens erhalten ausreichend Zufall, einen gespeicherten Hash, einen klaren
Zweck, Ablaufzeit und atomaren Einmalverbrauch. Reset-Anfragen antworten bei
bekannten und unbekannten Adressen gleichartig und mit vergleichbarem Timing.
Limits gelten pro IP und Zieladresse; bei Bedarf greift die vorhandene
Bot-Prüfung. Reset-Seiten und Logs dürfen Tokens nicht an Dritte weitergeben;
Links werden ausschließlich aus konfigurierten Produkt-Origins gebaut.
[OWASP-Empfehlungen zum Passwort-Reset](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

Die Regressionstests prüfen insbesondere abgelaufene und bereits benutzte Links, parallele
Bestätigungen, doppelte Adressen, ausbleibende Zustellung, Wiederholungen,
Sitzungswiderruf und das Wechseln zwischen beiden Spielen. Die Absenderdomain
ist verifiziert; beide Spiele verwenden denselben Resend-Sender.
Das bestehende Deployment bleibt erhalten.

## Email activation acceptance and existing passkeys

1. The `noreply@zockdiewandan.online` sender domain is verified with Resend.
   Its SPF/DKIM records and existing strict DMARC policy pass public DNS checks.
   Receiving and tracking remain off; the root null MX was removed, as recorded
   in the [DNS setup record](MAIL_SETUP_2026-09-12.md). No mailbox is required.
2. The domain-restricted sending key is stored only in the production server's
   `.env`. An isolated application process has submitted registration and reset
   messages successfully to Resend's simulated recipients. The user also
   confirmed both marked delivery-test messages in the real inbox. These had
   no active account links, and received headers were not inspected.
   Set `ROLLTHEDICE_EMAIL_ENABLED=1` for the
   authorized full deployment after sending acceptance and the normal test
   suite have passed; verify both products' public feature status afterward.
3. Keep `ROLLTHEDICE_COOKIE_SECURE=1`, a controlled cookie domain and the two
   fixed HTTPS product origins. Test the registration and reset flow only with
   a designated test recipient, never a real player account.
4. Keep existing passkeys enabled with `ROLLTHEDICE_PASSKEYS_ENABLED=1`. Set the
   RP ID exactly to the hostname of `ROLLTHEDICE_SITE_ORIGIN`; both configured
   origins must be HTTPS in production. Test registration, sign-in, removal and
   password fallback on an authenticator-backed test account.
5. Roll back email registration, email actions or passkey login by setting the
   corresponding feature flag to `0`. Existing credentials and confirmed
   addresses remain stored. Password sign-in continues to work, including an
   already confirmed email identifier; legacy password registration is restored
   while the email feature is off.

## English summary

Passkeys and Fairplay are live. The verified Resend sender
`noreply@zockdiewandan.online`, public SPF/DKIM/DMARC records and restricted
server-side key are ready. Resend accepted simulated registration/reset messages,
and the user confirmed both marked test messages in the real inbox. Received
headers were not inspected and no live account links were used. Email activation
is selected for the authorized full rollout after validation. Email confirmation,
recovery and confirmed-email login need
no personal mailbox, inbound service, operator copy or newsletter. Existing
accounts retain password and passkey sign-in; after activation new accounts
require email confirmation and a password selected by the mailbox owner.
