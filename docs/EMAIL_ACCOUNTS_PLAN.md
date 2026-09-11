# E-Mail-Konten: Machbarkeit und Plan

Stand: 11.09.2026. **Nur Planung; keine E-Mail-Funktion implementiert oder aktiviert.**

## Einschätzung

Gut machbar, mit überschaubarem bis mittlerem Aufwand. Das Projekt braucht keinen
neuen Auth-Anbieter und keinen Umbau der Spiele: ZDWA und Zilch teilen bereits
`User`, Passwort-Hashes, serverseitige Sitzungen und feste Konto-IDs.
`app/auth.py` enthält Anmeldung und Passwortwechsel, `app/api_auth.py` die API,
`app/auth_protection.py` Schutz vor häufigen Versuchen. SQLAlchemy/Alembic sind
für zusätzliche Felder und Tabellen vorhanden. Es gibt bisher keine
E-Mail-Adresse am Konto und keinen E-Mail-Versand.

Meine projektspezifische Schätzung für eine fertige erste Version einschließlich
Bestandskonten, DE/EN, Tests und Einrichtung: **2–4 Entwicklungstage**.
Ein Versandprototyp ist deutlich kleiner; die verlässlichen Bestätigungs- und
Wiederherstellungsabläufe machen den größten Teil aus. DNS-Verifizierung oder
Freischaltung beim Versanddienst können zusätzliche Wartezeit verursachen.

## Was du selbst betreiben musst

Die App verschickt automatisch ausschließlich Kontomails an die Nutzer:
Adressbestätigung, angeforderter Passwort-Reset und eine kurze Bestätigung nach
erfolgtem Reset. Keine Kopie an dich, keine Newsletter, kein persönliches
Postfach und kein eigener Mailserver. Dafür braucht es trotzdem einen Dienst,
der diese automatischen E-Mails tatsächlich zustellt.

Als einfache erste Wahl schlage ich **Resend über die HTTP-API** vor.
Ein Absender wie `konto@auth.zockdiewandan.online` genügt nach Verifizierung der
Domain; diese Adresse muss kein separat eingerichtetes Postfach sein.
Eingehende E-Mails werden nicht aktiviert. Technische Zustellfehler lassen sich
beim Anbieter bzw. in der Anwendung erkennen, ohne sie an dich weiterzuleiten.
Quellen: [Absender ohne Postfach](https://resend.com/docs/knowledge-base/how-do-i-create-an-email-address-or-sender-in-resend),
[separates Aktivieren des Empfangs](https://resend.com/docs/dashboard/receiving/custom-domains).

Die Versand-Subdomain wird mit den vom Anbieter vorgegebenen SPF-/DKIM-Einträgen
verifiziert; DMARC wird passend ergänzt. Das umfasst gegebenenfalls einen
Return-Path-MX für technische Rückmeldungen und ist kein Benutzerpostfach.
Bestehende Mail-DNS-Einträge der Hauptdomain müssen dafür nicht ersetzt werden.
[Domain-Verifizierung](https://resend.com/docs/dashboard/domains/introduction).

Aktuell enthält Resends kostenloser Transaktionsmail-Tarif **3.000 E-Mails pro
Monat, höchstens 100 pro Tag**. Pro kostet **20 USD/Monat für 50.000 E-Mails**
ohne Tageslimit. Für einen kleinen Nutzerkreis dürfte der kostenlose Tarif
reichen; Bestätigungen, erneute Zustellversuche und Passwort-Resets verbrauchen
dasselbe Kontingent. Das ist eine Einschätzung, da das erwartete Volumen nicht
bekannt ist. [Aktuelle Preise](https://resend.com/pricing).

## Vorgeschlagener Ablauf

1. **Neue Registrierung:** Benutzername und E-Mail-Adresse eingeben. Die App
   legt eine befristete Registrierungsanfrage an und schickt einen Link. Die
   Adresse und der gewünschte Name werden normalisiert und auf Konflikte
   geprüft; ein bestehendes Konto wird dabei niemals überschrieben.
2. **Adressbestätigung:** Der Link öffnet eine Seite, auf der der Nutzer sein
   Passwort selbst setzt und die Registrierung ausdrücklich abschließt.
   Erst danach entsteht das nutzbare Konto. Ein automatischer Link-Vorababruf
   durch Mailprogramme darf den Token nicht verbrauchen. Vorschlag: Link
   24 Stunden gültig, erneutes Anfordern mit Wartezeit, alte Anfragen bereinigen.
   Damit ist der gewünschte Ablauf „Anmelden und per E-Mail bestätigen“
   abgedeckt; Newsletter-Einwilligungen sind kein Bestandteil dieser Funktion.
3. **Anmelden:** Benutzername oder bestätigte E-Mail-Adresse plus Passwort.
   Der Benutzername bleibt der öffentliche Spielname. E-Mail-Adressen erscheinen
   weder in Profilen noch in Chat, Ranking, Spielansichten oder Push-Nachrichten.
4. **Passwort vergessen:** E-Mail-Adresse eingeben, Reset-Link öffnen, neues
   Passwort setzen. Vorschlag: 30 Minuten Gültigkeit. Danach werden bestehende
   Sitzungen und weitere Reset-Tokens ungültig, anschließend normale Anmeldung.
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

Zu prüfen sind insbesondere abgelaufene und bereits benutzte Links, parallele
Bestätigungen, doppelte Adressen, ausbleibende Zustellung, Wiederholungen,
Sitzungswiderruf und das Wechseln zwischen beiden Spielen. Vor Umsetzung werden
Absenderdomain und Versanddienst festgelegt; die Empfehlung ist ein gemeinsamer
Versand für beide Spiele. Das bestehende Deployment bleibt erhalten.

## English summary

Planning only; email registration and sending remain unimplemented. The shared
account system can support email verification, password resets and optional
email linking for existing users without changing game identities. Estimated
effort is 2–4 development days including bilingual flows, migration and tests.
The proposed Resend integration sends account emails automatically; no personal
mailbox, inbound mail service or self-hosted mail server is required.
