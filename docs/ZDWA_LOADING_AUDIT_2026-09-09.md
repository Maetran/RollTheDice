# ZDWA loading audit — 2026-09-09

## Produktionsbefund / Production findings

Source: [saved mobile PageSpeed report](https://pagespeed.web.dev/analysis/https-zockdiewandan-online/tj6ohyhr3a?form_factor=mobile),
collected 2026-09-09 at 07:41:31 UTC with Lighthouse 13.4.1.
Target: `https://zockdiewandan.online/` (ZDWA, not Zilch).
Baseline repository: `1951ed6`.

| Metric | Mobile | Desktop |
| --- | ---: | ---: |
| Performance score | 76 | 100 |
| First Contentful Paint | 2.2 s | 0.3 s |
| Largest Contentful Paint | 5.3 s | 0.6 s |
| Speed Index | 4.5 s | 0.6 s |
| Total Blocking Time | 0 ms | 0 ms |
| Cumulative Layout Shift | 0 | 0.015 |

These are the report's simulated lab metrics, not field percentiles or a
comparison against an earlier release. No earlier ZDWA report was supplied.
The observed mobile LCP inside the underlying trace is 2,352 ms; it must not
be confused with the simulated 5,260 ms used for scoring.

1. **The automatic release dialog is the LCP.** The selected element is
   `dialog.release-notes-dialog > div.release-notes-body > ul.release-notes-changes > li`,
   the 318 × 96 px paragraph about Classic's green felt. The final screenshot
   shows this dialog covering the lobby. Fresh guest storage previously counted
   as an unread update, so the page replaced its first impression with a modal
   after fetching releases. The LCP breakdown attributes 2,350 ms to element
   render delay in the observed trace.
2. **Registration verification starts before registration is requested.**
   `initializeAuthentication()` eagerly initialized Turnstile for every lobby
   visit. The report contains seven HTTPS challenge requests totaling 508,386
   transferred bytes (about 496 KiB), including the iframe and challenge payload.
   These requests are unnecessary for reading the lobby or starting a guest game.
   The screenshot shows the running widget behind the release dialog.
3. **CSS is a smaller remaining cost.** `lobby.css` transfers 18,200 bytes
   including response overhead. Lighthouse estimates 150 ms savings from
   render blocking/unused CSS; those estimates overlap and must not be added.
   Removing theme or account rules purely because a fresh guest did not exercise
   them would break other supported states.

The report also contains presence-WebSocket DNS failures. These are recorded
separately; the report does not establish that they caused the rendering delay.
It does not show main-thread blocking as the principal issue (TBT is zero).

## Änderungen / Changes

- Neue Gäste erhalten einen lokalen Ausgangsstand je Spiel ohne automatisch
  geöffneten Versionsdialog. Spätere neue Versionen werden weiter angekündigt;
  bestehende Bestätigungen und Kontohinweise bleiben erhalten.
- Die ZDWA-Sicherheitsprüfung lädt erst beim Nutzen der Kontofelder oder bei
  „Registrieren“. Registrierungen warten weiterhin auf die Schutzkonfiguration
  und einen gültigen Token; die serverseitige Prüfung bleibt bestehen.

English: A first guest visit establishes a per-game release baseline without
opening the update dialog. Future releases and existing account announcements
remain supported. ZDWA loads registration verification on account-form intent,
while preserving the configured token requirement and server validation.

Turnstile's [explicit rendering API](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/#explicit-rendering)
supports this control over widget creation. The official script URL remains
unchanged; it is not proxied or cached locally.

## Messmethode / Measurement method

The saved report's embedded Lighthouse JSON was downloaded and parsed directly.
Chrome-DevTools MCP and a connected UI browser were unavailable. Local browser
checks use the project's Playwright Chromium installation and disposable test
data. Production accounts and version-push notifications are not test targets.

Local checks and production scores are reported separately. A new production
score requires a deployed change and a fresh mobile PageSpeed run.

## Lokaler Vergleich / Controlled local comparison

Baseline assets were isolated from commit `1951ed6`; the final candidate uses
fingerprint `8feab3710e64`. Each variant ran three times with Chromium 151,
Pixel 5 (393 × 727 CSS pixels, DPR 2.75), 4× CPU slowdown, 150 ms latency,
1.6 Mbit/s download and 0.75 Mbit/s upload. Identical local gzip servers used
neutral API fixtures, a fixed public guest-release response and 250 ms API
delay. Each fresh browser context was observed for eight seconds after load.
Turnstile was replaced by a no-op fixture, so its real download cost is excluded.

| CDP measurement, median of three runs | Before | After |
| --- | ---: | ---: |
| FCP | 616 ms | 616 ms |
| LCP | 1,528 ms | 616 ms |
| First-visit release modal | 3/3 runs | 0/3 runs |
| Turnstile script requests | 1 per run | 0 per run |
| JavaScript errors | 0 | 0 |

Before the fix, the intro paragraph painted first and a release-dialog list
item replaced it as LCP later. After the fix, the intro paragraph remains the
LCP. This isolates a 912 ms (60%) reduction in this fixture. Screenshots confirm
the unobscured mobile lobby. FCP is unchanged in these repeated observed runs.

An additional pair of Lighthouse 13.4.1 **simulated** mobile runs, with the
CAPTCHA domain blocked, produced FCP 1,537 → 1,053 ms, LCP 1,988 → 1,507 ms and
SI 1,537 → 1,053 ms. Both completed without warnings. This is one sample per
variant; the simulated FCP change differs from the repeated CDP observations
and should not be presented as a reliable production saving. Earlier runs
using Lighthouse's `devtools` throttling hit its quiet-window timeout because
the lobby polls games every four seconds; those runs were discarded.

The browser suite partly ran concurrently, so small timing differences may be
measurement noise. Real CDN/server conditions, live games and CAPTCHA payloads
are absent. Production FCP/SI improvements and a new production score remain
unverified until deployment and a fresh PageSpeed run.

Temporary evidence (not committed): `/tmp/zdwa-performance-comparison.md`,
`/tmp/zdwa-perf-baseline.json`, `/tmp/zdwa-perf-candidate.json`, corresponding
PNG screenshots and `/tmp/zdwa-local-lighthouse-simulated-{baseline,candidate}.json`.
The reproduction harness is `/tmp/zdwa-perf-cdp.cjs` plus
`/tmp/zdwa-perf-server.cjs`; both temporary servers were stopped after testing.

## Prüfung / Validation

- `npm run lint`: passed, including product delivery, localization, SEO,
  generated assets and version consistency.
- Full backend suite: **456 passed**, 78.81% coverage. After the asset build,
  the 36 HTTP-shell, release-copy and localization tests also passed.
- Full browser suite exercised **177 cases**. One new language-race fixture
  initially conflicted with account-language auto-reload; it was corrected to
  isolate the intended language switch using a returning guest. All other
  **176 cases passed**, including all eight deferred-registration checks.
  The complete release-notes spec then passed again: **21/21**, including the
  corrected language-race case. All 177 browser cases are thereby verified.
- At completion of the local audit, no production deployment or notification
  dispatch had been performed. The subsequent user-authorized rollout uses
  `SILENT_RELEASE=1` with the normal backup and health-check workflow; it does
  not publish the prepared release notice or create a new in-app history entry.
