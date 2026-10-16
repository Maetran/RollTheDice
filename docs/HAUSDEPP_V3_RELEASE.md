# Hausdepp V3.0 – öffentlicher Start / public launch

## Freigabe / access

Der Owner hat den öffentlichen Start ausdrücklich freigegeben: Lobby und Regeln
sind ohne Anmeldung erreichbar; alle aktiven, angemeldeten Konten dürfen spielen.
Eigene Kontodaten, laufende Hände und persönliche Ergebnisse bleiben geschützt.
Hausdepp-Messwerte in Mission Control bleiben an das Founder-Konto gebunden.

The owner explicitly approved the public launch. The lobby and rules are public;
all active signed-in accounts can play. Personal accounts, live hands and results
remain protected. Hausdepp's Mission Control dataset remains founder-only.

## Veröffentlichung / publication

- Gemeinsame Produktversion / shared product version: **3.0.0**.
- Kanonische Lobby / canonical lobby:
  `https://hausdepp.zockdiewandan.online/hausdepp`.
- Eigene Sitemap / dedicated sitemap: genau die öffentliche Lobby und Anleitung;
  persönliche Seiten bleiben `noindex` / exactly the public lobby and rules;
  personal pages remain `noindex`.
- Reguläre DE/EN-Ankündigung für alle drei Spiele, mit vorhandenen Push-Opt-ins
  und deduplizierter Konto-Zustellung / normal DE/EN announcement for all three
  games, preserving push opt-ins and account-level delivery deduplication.
- Eigenes Origin-Zertifikat mit HTTP-01-Erneuerung durch den bestehenden
  Cloudflare-Proxy; bestehende Zertifikate und Firewall bleiben erhalten /
  separate origin certificate with HTTP-01 renewal through the existing
  Cloudflare proxy; existing certificates and firewall are preserved.

## Daten und Installation / data and installation

Migration 0059 erweitert nur die zulässigen Geräte-Kontexte zweier Push-Tabellen.
Die Migration erhält Konten, Sitzungen, Geräte-Schlüssel, veröffentlichte
Release-Belege und Hausdepp-Fortschrittsbestätigungen. Ein verlustbehaftetes
Downgrade mit Hausdepp-Geräten wird abgelehnt.

Migration 0059 extends the allowed device context in two push tables. Existing
accounts, sessions, device keys, frozen release recipients and Hausdepp progress
receipts are preserved. A lossy downgrade with Hausdepp devices is rejected.

Installierte Hausdepp-Apps behalten ihren Geräte-Kontext auch auf gemeinsamen
Kontoseiten. Registrierung aktiviert keine Push-Kategorie automatisch; ein
Hausdepp-Gerät wird nicht als Empfänger einer ZDWA-Tageserinnerung behandelt.
Die bestehende enge Worker-Grenze `/hausdepp` bleibt erhalten.

Installed Hausdepp apps retain their device context on shared account pages.
Registration does not opt into a push category; Hausdepp devices do not receive
ZDWA daily reminders by fallback. The existing narrow `/hausdepp` worker scope
is retained.

Die eigene Hausdepp-Origin ist beim produktiven gemeinsamen Passkey-RP fest
freigegeben. Anmeldung und erneute Kontobestätigung bleiben auf dieser Origin;
andere Hosts und abweichende Bestätigungs-Ursprünge bleiben ausgeschlossen.
Eigene oder lokale RPs erhalten dadurch keine zusätzliche Produktions-Origin.

The fixed Hausdepp origin is allowed by the shared production passkey RP.
Sign-in and sensitive account confirmations stay on that origin; other hosts
and mismatched ceremony origins remain rejected. Custom and local RPs do not
inherit an unrelated production origin.

## Prüfungen / verification

Lokaler Release-Kandidat: **1’122 Backend-Tests**, **84,22 % Abdeckung**;
`npm run check:quality` grün. Nach dem letzten CSS-Build sind zusätzlich 46
HTTP-/SEO-/PWA-/Navigationsprüfungen, 30 öffentliche/responsive Browserfälle
und vier native Passkey-Fälle grün. Die Passkey-Fälle verwenden echte
Chromium-WebAuthn-Zeremonien und virtuelle Testschlüssel auf einer vollständig
nach Loopback geleiteten Hausdepp-Origin, mit Deutsch/Englisch und
Browser-/PWA-Darstellung. Es entsteht keine Produktionsanfrage.

Local release candidate: **1,122 backend tests**, **84.22% coverage** and a green
`npm run check:quality`. After the last CSS build, 46 HTTP/SEO/PWA/navigation
checks, 30 public/responsive browser cases and four native passkey cases also
pass. The passkey cases use real Chromium WebAuthn ceremonies with virtual test
keys on a fully loopback-relayed Hausdepp origin, covering German/English and
browser/PWA presentation. No production request is sent.

Der breite Browserlauf hat veraltete Vorschau-/Anmeldeannahmen und zwei echte
Layoutfehler aufgedeckt. Die korrigierten Fälle sind erneut geprüft; die CI
wiederholt vor dem Deploy die gesamte Hauptsuite, Benutzernamenwechsel und
beide nativen Passkey-Suiten auf dem eingecheckten Stand. Physische iOS-/Android-
Installation und echte Betriebssystem-Pushanzeige werden damit nicht behauptet.

The broad browser run exposed outdated preview/sign-in assumptions and two
actual layout defects. Corrected cases were rerun; before deployment, CI repeats
the full main suite, username changes and both native passkey suites on the
committed revision. This does not claim physical iOS/Android installation or
real operating-system push display has been verified.

Die vollständige lokale Prüfung und die CI müssen vor dem produktiven Rollout
grün sein. Der Deploy prüft anschliessend echte HTTPS-Aufrufe aller Produkt-Hosts,
die tatsächlich laufende Produktversion, die gebauten Hausdepp-Assets,
öffentliche Canonicals, Sitemap und PWA-Grenzen, bevor eine Ankündigung in die
Outbox gelangt. Die Sitemap wird erst danach in Search Console eingereicht.

The full local verification and CI must pass before production rollout. Before
queueing an announcement, deployment checks real HTTPS across all product hosts,
the running version, built Hausdepp assets, public canonicals, sitemap and PWA
boundaries. The sitemap is submitted to Search Console only after those checks.

Die bisherigen Spielregel-, Punkte-, Turnier-, Darstellungs- und Geräteprüfungen
sind in [der lokalen Prüfung](HAUSDEPP_LOCALHOST_TEST_2026-10-16.md) dokumentiert.
Dieser historische Bericht beschreibt den damaligen privaten Zugang; die oben
ausdrücklich freigegebene öffentliche V3-Regel ersetzt diese Zugangsbeschränkung.

Existing gameplay, scoring, tournament, presentation and device checks are
recorded in [the local verification](HAUSDEPP_LOCALHOST_TEST_2026-10-16.md).
That historical report describes the former private access; the explicitly
approved public V3 policy above supersedes that restriction.
