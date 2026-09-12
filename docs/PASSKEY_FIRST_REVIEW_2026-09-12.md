# Passkey zuerst / Passkey first

Stand: 12.09.2026. Der autorisierte Release stellt Passkeys in ZDWA und Zilch
bei der Anmeldung nach vorne. Die bestehende Passwort-Anmeldung liegt in
beiden Oberflächen hinter dem ausdrücklich gewählten Schritt „Mit Passwort
anmelden“. Auch bei deaktivierten oder nicht unterstützten Passkeys bleibt
sie über diesen Schritt erreichbar. Ein abgebrochener Passkey-Versuch öffnet
die Passwortfelder nicht automatisch; ein sichtbarer Alternativknopf führt
bei Bedarf dorthin und setzt den Fokus.

## Einrichtungshinweis

Angemeldete Konten ohne Passkey erhalten in Lobby und Konto einen Hinweis mit
direktem Link zum Einrichtungsformular. Die Ermittlung verwendet einen aktuellen,
nur dem eigenen Konto sichtbaren Boolean in `/api/auth/me`, keine öffentliche
Namensabfrage. Erforderliche Passwortwechsel haben Vorrang. Bei deaktiviertem
Feature oder fehlender Browserunterstützung erscheint keine unbenutzbare
Einrichtungsaufforderung. Laufende Spiele werden nicht unterbrochen.

Nach dem Einrichten verschwindet der Hinweis; nach dem Entfernen des letzten
Passkeys kehrt er zurück. Der ausdrückliche Einrichtungslink öffnet die richtige
Kontokarte und fokussiert das Formular. Versions-Popups werden auf dieser
Zielseite aufgeschoben; ihre Historie und ungelesene Markierung bleiben erhalten.
Die Einrichtung benötigt weiterhin das aktuelle Passwort und einen bewussten
Nutzerklick; CSRF, WebAuthn-Prüfungen und Passwort-Recovery bleiben erhalten.

## Zustandsprüfung

Der zusätzliche Review fand zwei veraltete Zustände: einen späten Zilch-Mount
nach langsam geladenen Statistiken und voneinander unabhängige Auth-Caches in
mehreren Seitenbundles. Der Hinweis wird jetzt vor solchen Seitenabfragen
gebunden; Identität, laufende Abfragen und deren Generation teilen sich einen
rein flüchtigen Zustand innerhalb derselben Browserseite. Alte Antworten nach
Passkey-Einrichtung, Logout oder Kontowechsel können den aktuellen Zustand nicht
wiederherstellen. Bei invalidiertem leerem Cache wird die Identität neu aufgelöst.

Drei gesonderte Browsertests mit zwei separat gebauten Bundles sichern diese
Fälle, einschließlich einer echten Chromium-WebAuthn-Erstellung. Desktop/Mobil
und DE/EN der Anmeldung wurden in acht Ansichten visuell geprüft. Vorhandene
Login-Tests öffnen die Passwortfelder über denselben sichtbaren Schritt wie
Nutzer; die Tests umgehen keine Anmeldung.

## Abnahme

- `npm run lint` bestanden, einschließlich Produktlieferung, DE/EN, SEO und
  synchronisierten Assets.
- 94 relevante Backendtests und 46 Unterfälle bestanden.
- Insgesamt 249 verschiedene Browserfälle grün nach gezielten Wiederholungen:
  vollständiger Standardumfang, zusätzliche Zustandsregressionen, native
  WebAuthn-Flows und Namensänderungen.
- Acht Loginansichten und vier Einrichtungshinweise in DE/EN visuell geprüft;
  Desktop sowie schmale Mobilansichten ohne Überlauf. Der Einrichtungslink
  wird in beiden Spielen als gut erreichbare Schaltfläche dargestellt.
- Testkorrekturen betreffen den bewusst zusätzlichen Passwortschritt,
  konsistente Login-Fixtures und isolierte Testkonto-Erstellung. Produktseitige
  Schutzmechanismen und Testassertionen bleiben erhalten.

Der vollständige Release erfolgt auf master mit dem vorhandenen Deployskript,
Datenbackup, Healthprüfung und regulären DE/EN-Versionshinweisen. Passkeys und
E-Mail bleiben aktiviert. Es gibt keinen Test-Versionspush an echte Konten.

## English

Both games lead with passkeys and reveal password fields only after an explicit
“Sign in with password” step. Signed-in accounts without credentials receive a
setup reminder in the lobby and account page. It disappears after enrollment
and returns when the final credential is removed. Required password changes
have priority; active games remain uninterrupted.

The current credential-presence flag is private to the authenticated account.
Setup still requires password reauthentication, CSRF protection and explicit
user interaction. Shared in-memory identity state prevents delayed responses
from separate bundles restoring an obsolete credential or account state.
Three dedicated browser tests cover enrollment, logout and account switching;
both languages and mobile/desktop login layouts have been visually checked.
