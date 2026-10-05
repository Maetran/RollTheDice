# Passkey-Flow-Audit / Passkey flow audit

Stand / Reviewed: 2026-10-05, Produktversion / product version 2.47.0.

Beide Spiele verwenden dieselbe Kontoidentität und dieselben Kontosicherheits-APIs.
Die Anmeldung bot Passkeys bereits bevorzugt an. Die erneute Bestätigung von
Kontoeingriffen verlangte dagegen bisher ausschließlich das aktuelle Passwort.

Both games share an account identity and account-security APIs. Sign-in already
preferred passkeys, but sensitive account changes previously required the current
password again.

| Weg / Flow | Bevorzugter Weg / Preferred method | Alternative / Fallback |
| --- | --- | --- |
| Anmeldung / Sign-in | Passkey | Benutzername oder bestätigte E-Mail + Passwort / Username or verified email + password |
| Konto erstellen / Create account | Name + neuer Passkey direkt auf beiden Landingpages / Name + new passkey directly on both landing pages | E-Mail-Bestätigung und Passwortwahl, ohne E-Mail-Dienst Name + Passwort / Email confirmation and password choice, or name + password when email is disabled |
| Backup-Passwort festlegen / Set backup password | Vorhandener Passkey bestätigt neues Passwort / Existing passkey confirms new password | Optional, keine Voraussetzung für Passkey-Registrierung / Optional, not required for passkey signup |
| Profil: Benutzername / Profile: username | Vorhandenen Passkey bestätigen / Confirm existing passkey | Aktuelles Passwort / Current password |
| E-Mail ergänzen oder ändern / Add or change email | Passkey, danach E-Mail-Bestätigung / Passkey, then email confirmation | Aktuelles Passwort, danach E-Mail-Bestätigung / Current password, then email confirmation |
| Passwort ändern / Change password | Passkey bestätigt Identität; neues Passwort wird eingegeben / Passkey verifies identity; enter the new password | Aktuelles Passwort / Current password |
| Weiteren Passkey hinzufügen / Add another passkey | Vorhandener Passkey, dann neuen erstellen / Existing passkey, then create a new one | Aktuelles Passwort / Current password |
| Passkey entfernen / Remove passkey | Vorhandener Passkey / Existing passkey | Aktuelles Passwort / Current password |

Passkey wird angeboten, wenn das Gerät WebAuthn unterstützt, der Server Passkeys
für die aktuelle Herkunft freigibt und das Konto einen Passkey besitzt. Ein
Abbruch löst keine Kontoänderung aus und schaltet nicht heimlich auf ein anderes
Verfahren um. Die Passwortalternative bleibt zugänglich, wenn das Konto ein
Passwort besitzt. Reine Passkey-Konten erhalten andernfalls einen Hinweis auf
einen unterstützten Browser beziehungsweise ein Gerät mit ihrem Passkey. Der
letzte Passkey bleibt geschützt, bis ein weiterer Passkey oder ein
Backup-Passwort vorhanden ist.

Passkeys are offered when WebAuthn is supported, the current origin is enabled
and the account has a credential. Cancelling does not change the account or
silently switch authentication methods. Password fallback remains reachable
when the account has a password; passkey-only accounts receive browser/device
guidance instead. The last passkey cannot be removed without another credential
or a backup password.

## Abgrenzung / Boundaries

- **Erster Passkey eines bestehenden Passwortkontos:** Erfordert einmalig das aktuelle Passwort; ohne vorhandenen
  Passkey kann keine Passkey-Assertion bestätigt werden. / **First passkey:**
  requires the current password once; there is no existing credential to assert.
- **Neuregistrierung:** Name und neuer Passkey genügen. Die fünfminütige Challenge
  bindet Browser-Cookie, Name, User-Handle, Sprache und Herkunft; erst erfolgreiche
  WebAuthn-Prüfung erstellt Konto, Credential und Sitzung in einer Transaktion.
  / **New registration:** name and a new passkey suffice. The five-minute challenge
  binds the browser cookie, name, user handle, language and origin; successful
  verification creates account, credential and session atomically.
- **Einrichtungshinweis:** Höchstens alle sieben Tage pro Konto, atomar über
  Geräte und beide Spiele reserviert und um weitere sieben Tage wegklickbar.
  Konten mit Passkey, nicht unterstützte Browser und erforderliche Passwortwechsel
  erhalten keinen Hinweis. / **Setup reminder:** atomically reserved at most
  every seven days per account across games/devices, dismissible for another
  seven days. Existing credentials, unsupported browsers and required password
  changes suppress it.
- **Passwort vergessen/Reset:** Ein vorhandener Passkey erlaubt den direkten
  Rückweg zur Anmeldung. Ein bewusst abgeschlossener E-Mail-Reset setzt ein
  neues Passwort, meldet alle Geräte ab und entfernt alte Passkeys. /
  **Forgot/reset password:** an existing passkey provides a route back to sign-in.
  Completing email recovery sets a new password, revokes sessions and removes
  old passkeys.
- **Admin-Ersteinrichtung/Zwangswechsel:** Temporäre Passwörter bleiben ein
  Wiederherstellungs-/Einrichtungsweg. Ein Admin-Reset entfernt bisherige
  Passkeys. / **Admin setup/mandatory change:** temporary passwords remain a
  bootstrap/recovery path; admin recovery removes existing passkeys.
- **Spielraum-Passwort:** Ein Raumcode schützt einen Spielbeitritt und ist kein
  Nachweis der Kontoidentität. Er wird nicht durch Passkeys ersetzt. /
  **Room password:** a join code protects room access, not account identity,
  and is not replaced by a passkey.

## Sicherheitsvertrag / Security contract

Passkey-Bestätigungen sind an Konto, Sitzung, Herkunft und Aktion gebunden,
gelten höchstens fünf Minuten und werden zusammen mit der Kontoänderung einmalig
verbraucht. Die WebAuthn-Prüfung verlangt Benutzerverifikation und prüft die
Signatur, Challenge, RP-ID und Herkunft. Die Bestätigung erstellt keine neue
Login-Sitzung und kann nicht zu einem anderen Konto wechseln. CSRF-Schutz,
Ratenbegrenzung und bisherige Passwortprüfung bleiben erhalten.

Confirmations are account-, session-, origin- and action-bound, last at most
five minutes and are consumed once in the account-change transaction. WebAuthn
requires user verification and validates the signature, challenge, RP ID and
origin. Reauthentication never replaces the login session with another account.
CSRF protection, rate limits and password fallback checks remain in place.

Grundlage für die WebAuthn-Prüfung / WebAuthn verification reference:
[W3C: Verifying an authentication assertion](https://www.w3.org/TR/webauthn/#sctn-verifying-assertion).
