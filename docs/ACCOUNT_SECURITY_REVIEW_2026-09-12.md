# Account and Fairplay review — 12 September 2026

Scope: `feature/email-accounts`, including email registration/recovery, shared
ZDWA/Zilch passkeys, public manual-abort counters and six ZDWA Fairplay
achievements. The review phase performed no deployment, domain configuration,
provider activation, real account mail or release push.

## Selected release and deployment verification

The user has authorized merging to `master` and a production release of
passkeys plus Fairplay. The guarded deployment records its successful revision
in the server's private `rollthedice-last-deployed` Git marker after the health
check and release publication. The selected
production configuration enables `ROLLTHEDICE_PASSKEYS_ENABLED=1` and keeps
`ROLLTHEDICE_EMAIL_ENABLED=0`. The DE/EN release notice covers only passkeys,
manual-abort counters and the six zero-point ZDWA reminders.

Email sender/provider setup remains later work in Work, using the requested
`noreply@zockdiewandan.online` sender. No email activation is part of this
release. The existing password login and username/password registration remain
available. Passkeys use only the configured canonical ZDWA and Zilch origins;
unsupported aliases keep the password alternative.

## Findings resolved

| Area | Correction and evidence |
| --- | --- |
| Registration | Email-enabled registration creates no usable account before an explicit confirmation and password choice. Pending requests do not reserve a name/address. Final uniqueness is enforced transactionally. Legacy password registration remains available while email is disabled. |
| Email tokens | Purpose-bound, expiring hashes are consumed with an atomic claim. Concurrent/replayed confirmations and resets are rejected. Address changes invalidate resets bound to the old address. |
| Recovery | Recovery removes sessions, passkeys, open email changes and pending ceremonies. Conditional writes prevent a password/passkey proof already being verified from recreating access after recovery. Claims also bind to random tokens/credential material, preventing SQLite row-ID reuse from reviving an old proof. |
| Mail requests | Neutral registration/reset responses and deferred delivery remove provider timing from mailbox discovery. Concurrent requests cannot bypass the per-IP/target sending limits. No operator copy or incoming mailbox is configured. |
| Passkeys | Fixed RP and origin allowlist, discoverable credentials, user presence/verification, signed challenge/origin/RP checks, one-time ceremony cookies, session/CSRF binding for management, counter/credential ownership checks and bounded enrollment. Only public credential material is stored. |
| Active aborts | Only explicit actions on started games count, and only for the initiating account. Timeouts, connection loss, waiting-room cancellations, opponents and guests/CPU initiators do not count. Retries/restarts remain idempotent; replaced sockets cannot terminate a rejoined seat. |
| Solo privacy | New explicit Zilch Solo abandonment records feed only public counters. Existing private Solo history is not scanned or reclassified; no scorecard or private result becomes public. |
| Fairplay | Six ZDWA reminders at 1/5/10 manual aborts, separately for Solo/multiplayer. Exactly these six may award zero Ehrenberg Marks; scoring achievements keep their existing point range. Names, descriptions and profile explanations are available in DE/EN. |
| Pages and migrations | Action pages use noindex/no-store/no-referrer and no shared shell/PWA; fragments are removed before inspection and opening alone consumes no token. Upgrade/downgrade/upgrade regression checks preserve account identity, passwords, participant links and existing achievements. |
| Browser test isolation | Two existing redirect fixtures could bypass Playwright interception and read production HTML with a local test session. The fixtures now validate redirects locally and prevent that external hop; production account state was not changed. |

## Verification

`npm run lint` passed, including localization, product delivery, SEO, generated
bundle and asset-version checks. The full backend run passed **518 tests** with
**79.38% coverage**. Focused security tests include real CBOR attestations and
P-256 assertions, replay/expired token cases, concurrent operations, credential
ownership and recovery during active verification. Browser validation covers
both languages and products, preferred passkey login and password fallback,
email action pages, public counters and zero-point reminder rendering.
All **201 base browser cases** passed across the full run and corrected focused
reruns. The **six username/history browser tests** also passed. The initial
browser failures exposed two stale assertions after the new statistic section
and the redirect-fixture isolation issue documented above.
All **five native passkey browser tests** passed: four DE/EN product flows and
one actual cross-origin assertion from `rollthedice.localhost` to
`zilch.rollthedice.localhost` with all session cookies removed. The latter
checks the same credential/account, RP ID, signed origin, HTTP origin and
incremented authenticator counter. Both origins use Chromium's native secure
context rules without security flags or DNS changes. Total: **212 browser
cases** verified across the full and focused runs.

## Deliberate limits and activation work

- Deliberately disconnecting and waiting for a timeout remains uncounted under
  the requested active-only policy. The server cannot infer intent reliably.
- Deferred email delivery is not a durable queue. A process restart between
  acceptance and sending may require the user to retry; earlier valid links
  remain usable. Provider DNS verification and real delivery to a designated
  test recipient remain activation work.
- Browser passkeys are exercised with Chromium's virtual authenticator.
  Hardware/device and production HTTPS/cookie checks remain part of activation.
- Email and passkey feature flags default to off in configuration templates.
  This selected deployment explicitly enables passkeys only; email remains
  off. Release notes describe passkeys/Fairplay, while the email changes stay
  under Unreleased. No test proves the absence of every possible vulnerability.

## Deutsch

Die Prüfung hat konkrete Fehler bei Token-Einmalverbrauch, paralleler Recovery,
unbestätigten Namensreservierungen, Übersetzungen und Abbruchzuordnung behoben.
Es zählen ausschließlich ausdrücklich selbst abgebrochene gestartete Partien;
Timeouts und Verbindungsverlust bleiben ungezählt. Die sechs neuen
ZDWA-Fairplay-Hinweise vergeben null Rangpunkte. Der Nutzer hat den Merge nach
`master` und den Produktions-Rollout von Passkeys und Fairplay freigegeben;
der Deploy prüft die Bereitschaft vor Veröffentlichung des Versionshinweises.
E-Mail bleibt ausgeschaltet. Der
Versanddienst und der gewünschte Absender `noreply@zockdiewandan.online` werden
später in Work eingerichtet. Reale E-Mail-Zustellung gehört zu dieser späteren
Aktivierung; Geräte- und Produktionsprüfungen für Passkeys gehören zum
ausgewählten Rollout.
