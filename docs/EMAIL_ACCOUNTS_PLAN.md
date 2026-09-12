# E-Mail-Konten: Machbarkeit und Plan

Stand: 12.09.2026. **Passkeys und Fairplay sind für den Produktions-Rollout
freigegeben. Der Deploy prüft die Bereitschaft vor Veröffentlichung des
Versionshinweises. E-Mail-Funktionen bleiben
mit `ROLLTHEDICE_EMAIL_ENABLED=0` ausgeschaltet.** Versanddienst und gewünschter
Absender `noreply@zockdiewandan.online` werden später in Work eingerichtet.
Beide Feature-Flags bleiben in den Konfigurationsvorlagen standardmäßig `0`;
der ausgewählte Produktions-Rollout setzt nur `ROLLTHEDICE_PASSKEYS_ENABLED=1`.
Der tatsächliche Deployment-Status steht im
[Sicherheitsreview](ACCOUNT_SECURITY_REVIEW_2026-09-12.md).

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

Die E-Mail-Ausbaustufe ist implementiert und bleibt bis zur späteren Einrichtung
ausgeschaltet. Die folgenden E-Mail-Abläufe beschreiben das Verhalten nach der
Aktivierung. Passkeys sind unabhängig davon für den aktuellen Rollout ausgewählt:

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
- WebAuthn-Passkeys sind als bevorzugte Anmeldung vorbereitet. Der Browser
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

Nach der späteren E-Mail-Aktivierung verschickt die App ausschließlich Kontomails an die Nutzer:
Adressbestätigung, angeforderter Passwort-Reset und eine kurze Bestätigung nach
erfolgtem Reset. Keine Kopie an dich, keine Newsletter, kein persönliches
Postfach und kein eigener Mailserver. Dafür braucht es trotzdem einen Dienst,
der diese automatischen E-Mails tatsächlich zustellt.

Der vorbereitete Versand verwendet **Resend über die HTTP-API**.
Gewünschter Absender ist `noreply@zockdiewandan.online`, der später in Work
nach Verifizierung der Domain eingerichtet wird. Diese Adresse benötigt kein
separates Postfach.
Eingehende E-Mails werden nicht aktiviert. Technische Zustellfehler lassen sich
beim Anbieter bzw. in der Anwendung erkennen, ohne sie an dich weiterzuleiten.
Quellen: [Absender ohne Postfach](https://resend.com/docs/knowledge-base/how-do-i-create-an-email-address-or-sender-in-resend),
[separates Aktivieren des Empfangs](https://resend.com/docs/dashboard/receiving/custom-domains).

Die Absenderdomain wird mit den vom Anbieter vorgegebenen SPF-/DKIM-Einträgen
verifiziert; DMARC wird passend ergänzt. Das umfasst gegebenenfalls einen
Return-Path-MX für technische Rückmeldungen und ist kein Benutzerpostfach.
Bestehende Mail-DNS-Einträge der Hauptdomain müssen dafür nicht ersetzt werden.
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
Sitzungswiderruf und das Wechseln zwischen beiden Spielen. Vor Aktivierung wird
die Absenderdomain verifiziert; beide Spiele verwenden denselben Resend-Sender.
Das bestehende Deployment bleibt erhalten.

## Later email activation and selected passkey rollout

1. Configure the requested `noreply@zockdiewandan.online` sender later in Work.
   Verify its domain with Resend and add only the SPF/DKIM/DMARC
   records it supplies. Do not replace existing mail records or enable incoming
   routing. The sender address needs no mailbox.
2. Store a restricted Resend API key and the verified sender only in the
   production secret store. Set `ROLLTHEDICE_EMAIL_ENABLED=1` only after both
   values are present and the normal test suite has passed.
3. Keep `ROLLTHEDICE_COOKIE_SECURE=1`, a controlled cookie domain and the two
   fixed HTTPS product origins. Test the registration and reset flow only with
   a designated test recipient, never a real player account.
4. The selected production rollout enables passkeys separately with
   `ROLLTHEDICE_PASSKEYS_ENABLED=1`, while email stays off. Set the
   RP ID exactly to the hostname of `ROLLTHEDICE_SITE_ORIGIN`; both configured
   origins must be HTTPS in production. Test registration, sign-in, removal and
   password fallback on an authenticator-backed test account.
5. Roll back email registration, email actions or passkey login by setting the
   corresponding feature flag to `0`. Existing credentials and confirmed
   addresses remain stored. Password sign-in continues to work, including an
   already confirmed email identifier; legacy password registration is restored
   while the email feature is off.

## English summary

The selected production rollout enables passkeys and Fairplay; the deployment
checks readiness before publishing its release notice. Email features remain disabled. The Resend
sending service and requested `noreply@zockdiewandan.online` sender will be
configured later in Work. Email confirmation, password recovery and confirmed
email login need no personal mailbox, inbound service, operator copy or
newsletter. Passkeys are the preferred supported-device sign-in choice, scoped
to the fixed ZDWA WebAuthn relying party and controlled Zilch subdomain. Password
sign-in and existing username/password registration remain available.
