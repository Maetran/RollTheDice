# Kontoeinstellungen: Umsetzung und Abnahme

Stand: 12.09.2026. Die Kontostruktur ist umgesetzt. Der autorisierte vollständige
Produktions-Rollout umfasst außerdem die Aktivierung des geprüften Mailversands.
Die zuvor gesperrten Browser-/Serverzugriffe funktionieren in der aktuellen Sitzung.

## Änderung

Beide Spiele verwenden innerhalb des bestehenden Einstellungen-Tabs vier
native, per Tastatur bedienbare Themenbereiche in derselben Reihenfolge:
Profil & Zugang, Sprache & Spiel, Mitspieler & Hinweise, Hilfe & Neuigkeiten.
Zugang ist zunächst offen. Passkeys stehen vorne; Profilbearbeitung und
Passwortwechsel öffnen sich bei Bedarf. Mail-/Passkey-Featureflags verbergen
nur ihren eigenen Block. Die übrigen Kontofunktionen bleiben zugänglich.

ZDWA speichert Sprache und Lobby-Chat über die bereits vorhandenen separaten
Endpunkte. Der gemeinsame Spieleinstellungs-Endpunkt behandelt eine fehlende
Sprache als unverändert; mitgesendete Werte bleiben auf Deutsch/Englisch
beschränkt. Dadurch setzt Gameplay-Speichern keine getrennt gespeicherte
Sprache oder Chat-Auswahl zurück. Keine Migration, kein neues Auth-Verfahren
und keine Änderung der Spielwertung.

Push-Direkteinstieg und ein erforderlicher Passwortwechsel öffnen ihren
Themenbereich vor Fokus/Scrollen. Reduzierte Bewegung wird berücksichtigt.
Die ZDWA-Tabs unterstützen nun ebenfalls Pfeiltasten, Home/End und einen
einzigen aktiven Tabstopp. Neue Texte sind DE/EN vorhanden; Kontoseiten
bleiben `noindex`. README, Changelog und Release-Notiz sind aktualisiert.

## Prüfstand

- `npm run lint`: bestanden, einschließlich Produktlieferung, Lokalisierung,
  SEO, Build-Synchronität und Assetversion.
- `pytest -q tests/test_user_accounts.py tests/test_email_accounts.py
  tests/test_passkeys.py`: **92 bestanden, 46 Subtests bestanden**.
- Regression für Gameplay-Speichern nach separat gespeicherter Sprache EN
  und deaktiviertem Chat bestanden, sowohl ohne Sprachfeld als auch mit null.
- Unabhängiger Logikreview: kein neuer CSRF-/Featureflag-/Speicherungsfehler
  gefunden; versehentliche Änderungen außerhalb des Kontos entfernt.
- App-Lifespan mit isolierter Testkonfiguration startet erfolgreich.
- Die nativen Passkey-Browsertests bestehen auf dem aktuellen Build: 6 Fälle,
  einschließlich Anmeldung zwischen Hauptdomain und Zilch-Subdomain.
- Namensänderungen: 6 Browserfälle bestanden, beide Spiele in DE/EN.
- Desktop und 375-Pixel-Mobilansicht beider Spiele in beiden Sprachen visuell
  geprüft. Lesbarkeit der Zilch-Einleitung und Platz für die ZDWA-Tabs korrigiert.
  Keine horizontalen Überläufe; die vier Bereiche und Passkeys sind gut erreichbar.
- Der Standardlauf prüft 93 Fälle für Konten, Kontoaufbau, E-Mail-Registrierung,
  Zilch, Spielerauswahl, Push und Versionshinweise. Nach der Umstrukturierung
  wurden veraltete Testannahmen zu Preview-Namen, Pflichtpasswort und bereits
  geöffneten Karten angepasst; Produktionsberechtigungen bleiben unverändert.
  Der abschließende gezielte Lauf besteht alle 32 Fälle (Kontoaufbau, aktive
  E-Mail-Einstellungen und Versionshinweise). Insgesamt sind **109 verschiedene
  Browserfälle grün**, einschließlich der nativen Passkey- und Namensänderungstests.

## Rollout

Lint und alle relevanten Backend-/Browserprüfungen sind abgeschlossen. master wird mit dem vorhandenen Deployskript vollständig
veröffentlicht: Datenbackup, Build, Datenbank-/Healthprüfung und regulärer
Versionshinweis. Es gibt keinen Testversand von Versions-Pushes an echte Konten.
Das [Mailprotokoll](MAIL_SETUP_2026-09-12.md) hält DNS, Versandprüfung und
E-Mail-Aktivierung getrennt fest. In den Tests wurden keine echten Konten geändert.

## English

Both games share four settings groups, with sign-in first, optional edit forms,
isolated feature visibility and independent language/chat/gameplay saves.
Lint and 92 backend tests plus 46 subtests pass. Native passkeys and username
changes each pass six browser tests. Desktop/mobile DE/EN visual review passes.
All 109 distinct browser cases are green, including the focused email-enabled
checks. The release is ready for the authorized full deployment. Email delivery has
been independently checked against Resend and a designated real inbox.
