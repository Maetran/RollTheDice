# Passkey-Flow-Audit / Passkey flow audit

Stand / Reviewed: 2026-09-20, Produktversion / product version 2.37.0.

Beide Spiele verwenden dieselbe Kontoidentität und dieselben Kontosicherheits-APIs.
Die Anmeldung bot Passkeys bereits bevorzugt an. Die erneute Bestätigung von
Kontoeingriffen verlangte dagegen bisher ausschließlich das aktuelle Passwort.

Both games share an account identity and account-security APIs. Sign-in already
preferred passkeys, but sensitive account changes previously required the current
password again.

| Weg / Flow | Bevorzugter Weg / Preferred method | Alternative / Fallback |
| --- | --- | --- |
| Anmeldung / Sign-in | Passkey | Benutzername oder bestätigte E-Mail + Passwort / Username or verified email + password |
| Profil: Benutzername / Profile: username | Vorhandenen Passkey bestätigen / Confirm existing passkey | Aktuelles Passwort / Current password |
| E-Mail ergänzen oder ändern / Add or change email | Passkey, danach E-Mail-Bestätigung / Passkey, then email confirmation | Aktuelles Passwort, danach E-Mail-Bestätigung / Current password, then email confirmation |
| Passwort ändern / Change password | Passkey bestätigt Identität; neues Passwort wird eingegeben / Passkey verifies identity; enter the new password | Aktuelles Passwort / Current password |
| Weiteren Passkey hinzufügen / Add another passkey | Vorhandener Passkey, dann neuen erstellen / Existing passkey, then create a new one | Aktuelles Passwort / Current password |
| Passkey entfernen / Remove passkey | Vorhandener Passkey / Existing passkey | Aktuelles Passwort / Current password |

Passkey wird angeboten, wenn das Gerät WebAuthn unterstützt, der Server Passkeys
für die aktuelle Herkunft freigibt und das Konto einen Passkey besitzt. Ein
Abbruch löst keine Kontoänderung aus und schaltet nicht heimlich auf ein anderes
Verfahren um. Ohne nutzbaren Passkey bleibt die Passwortalternative zugänglich.

Passkeys are offered when WebAuthn is supported, the current origin is enabled
and the account has a credential. Cancelling does not change the account or
silently switch authentication methods. Password fallback remains reachable.

## Abgrenzung / Boundaries

- **Erster Passkey:** Erfordert einmalig das aktuelle Passwort; ohne vorhandenen
  Passkey kann keine Passkey-Assertion bestätigt werden. / **First passkey:**
  requires the current password once; there is no existing credential to assert.
- **Neuregistrierung:** Bestätigungslink und erste Passwortwahl bleiben der
  bestehende Einrichtungsweg. Dieses Release führt keine passwortlose
  Kontoerstellung ein. / **New registration:** email confirmation and initial
  password choice remain the existing setup flow; this release does not add
  passwordless account creation.
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
