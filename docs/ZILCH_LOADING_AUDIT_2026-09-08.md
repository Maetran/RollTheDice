# Zilch loading audit — 2026-09-08

## Ergebnis / Result

Die massive Verzögerung ist reproduziert, aber nicht allein durch LCARS
verursacht. Ein echter Produktionslauf zeigte auch nach 47 Sekunden keine
Lobby: Die JavaScript-Downloads waren noch nicht abgeschlossen und die
Auth-Abfrage hatte noch gar nicht begonnen. Gesunde Läufe derselben Version
erreichten dagegen 204–216 ms LCP. Der konkrete gemeldete 15,43-s-Lauf liegt
nicht als Trace vor und kann daher nicht nachträglich eindeutig zerlegt werden.

Separat nachgewiesen und lokal korrigiert: Die öffentliche Lobby wartete auf
Auth; die neue unversionierte LCARS-Schrift provozierte Revalidierungen und
späte Schriftwechsel erzeugten zusätzliche Layout-Sprünge. Der Schriftwechsel
setzte den LCP in den gemessenen Chromium-Läufen **nicht** neu.

English: Production intermittently stalled before the application scripts
finished, independently of authentication. Local fixes remove public-rendering
dependence on auth and late font swaps, and correct font caching. They do not
establish that the separate public transport/TLS problem is resolved.

Status at completion of the measurements: local implementation and verification;
**no deployment, restart of production, CDN change or notification dispatch**
was performed as part of the audit. The subsequent user-authorized silent
rollout uses the regular backup/health-check workflow with `SILENT_RELEASE=1`;
it does not publish the prepared release notice or change CDN/TLS settings.

## Method and artifacts

- Baseline: clean `master`, commit `88dad2b`.
- Final verified local assets: `7ef0fa8282aa`.
- Actual Chromium CDP `Tracing.start` recordings, Network events, Navigation
  and Resource Timing, LCP/LayoutShift observers, font events and screenshots.
  DevTools MCP was unavailable; Playwright's Chromium CDP session recorded the
  real performance traces instead. This was not a curl-based LCP estimate.
- Desktop: 1440×900, fresh context, browser cache disabled, service workers
  blocked, no CPU/network throttling unless the row explicitly delays a request.
  Local public server: `http://127.0.0.1:8040/zilch`, disposable SQLite database.
- Production: anonymous, read-only HTTPS requests. Local versus production
  figures are separate; different machine/network/cache conditions are not
  presented as a production before/after experiment.
- CLS uses the largest session window, excluding recent user input. The late
  font shift is reported separately, not added across distant CLS windows.
- Reproduction harness: `/tmp/rollthedice-zilch-perf.mjs`.
  Run `node /tmp/rollthedice-zilch-perf.mjs URL LABEL lcars [font|auth|scripts] [6000]`.
- Raw `.json`, `.trace.json` and `.png` artifacts:
  `/tmp/rollthedice-zilch-perf.0D4ewL/`. Open a `.trace.json` in Chrome DevTools
  Performance. Files named `before-local-*`, `final-local-*` and
  `before-production-*` identify the scenarios below (`after-local-*` are an
  earlier verification before the English-only timing fix). Temporary artifacts are
  not committed; the regression spec is the durable automated reproduction.

## Local before/after

LCP is the actual lobby H1, not the previous loading placeholder. Single lab
samples, not percentiles or guarantees for real users. Times in milliseconds.

| Scenario | LCP before → after | CLS before → after | Interpretation |
| --- | ---: | ---: | --- |
| LCARS, normal local load | 60 → 52 | 0.20420 → 0.04099 | Main improvement is stable initial content |
| Auth artificially delayed 6 s | 6052 → 36 | 0.22794 → 0.03833 | Lobby paint no longer depends on auth |
| Font artificially delayed 6 s | 60 → 124 | 0.20312 → 0 | Optional font's short block period trades about 64 ms for no late swap |
| Classic, normal local load | 64 → 40 | 0.21566 → 0.04572 | No Antonio request in either case |
| Both app scripts delayed 6 s | not sampled → 36 | not sampled → 0.04099 | Real server H1 paints; interactive controls still require JS |

In the delayed-font baseline, a further shift of **0.01782** occurred at
6040 ms when Antonio finished. After the fix there was **no** shift on font
completion at approximately 6016 ms. The existing placeholder-to-lobby change
was much larger: about 0.196–0.222 before the fix. Small remaining shifts come
from header/account/list hydration, not a late font swap.

### LCP subparts

Manual waterfall attribution from the recorded timestamps; all values in ms.
When Antonio is already ready at the first H1 paint, its fetch is the font
resource below; font decoding and DOM/layout work remain in render delay.
When the first H1 uses a system fallback, there is no required LCP resource:
both resource columns are zero. Do not incorrectly put a six-second font
download that ends **after** LCP into that LCP's resource duration.
This follows the [LCP breakdown methodology](https://web.dev/articles/optimize-lcp).

| Trace | TTFB | Resource load delay | Resource load duration | Render delay | LCP |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before, local LCARS | 10.0 | 11.3 | 1.2 | 37.5 | 60 |
| After, local LCARS | 15.5 | 3.8 | 7.9 | 24.8 | 52 |
| Before, auth +6 s | 2.9 | 19.4 | 13.5 | 6016.2 | 6052 |
| After, auth +6 s | 3.1 | 3.5 | 4.5 | 24.9 | 36 |
| Before, font +6 s; fallback | 4.7 | 0 | 0 | 55.3 | 60 |
| After, font +6 s; fallback | 3.2 | 0 | 0 | 120.8 | 124 |
| Production healthy sample 1; fallback | 118.2 | 0 | 0 | 97.8 | 216 |
| Production healthy sample 3; fallback | 122.0 | 0 | 0 | 82.0 | 204 |

The stalled production trace had document TTFB 2555.6 ms and a **placeholder**
LCP of 2856 ms (300.4 ms render delay, no required LCP resource). The real lobby
never appeared within 47.01 seconds, so no honest completed main-content LCP
breakdown exists for that navigation. No long tasks explained the stall.

## Production resource measurements

Three serial curl rounds, compression enabled; seconds. JS/CSS used the
baseline content version `1949359fbdae`. Values are request total duration;
parentheses show TTFB. These are transport timings, not LCP measurements.

| Resource | Round 1 | Round 2 | Round 3 |
| --- | ---: | ---: | ---: |
| `/api/auth/me` | 0.411 (0.411) | 1.192 (1.191) | 0.361 (0.361) |
| `/static/zilch.js` | 1.177 (1.165) | 0.123 (0.121) | 0.287 (0.280) |
| `/static/zilch.css` | 0.133 (0.128) | 0.047 (0.047) | 0.043 (0.042) |
| `/static/zilch-lcars.css` | 0.045 (0.044) | 0.110 (0.110) | 0.093 (0.093) |
| `/static/antonio-lcars-v1.ttf` | 3.336 (3.329) | 8.884 (8.877) | 0.371 (0.365) |

Browser healthy sample 1 independently measured auth 33.5/32.4 ms (two
initial requests), JS 36.7 ms, CSS 19.5 ms, LCARS CSS 21.8 ms and font 70.1 ms.
The fast browser run and slow curl rounds demonstrate intermittency, not a
consistent slow database or a stable performance percentile.

The failing browser navigation around 19:10 UTC showed:

- HTML TTFB 2.556 s; CSS completed around 2.834 s.
- `shell.js` and `zilch.js` remained incomplete after 47 s. Background parsing
  started at 23.508 and 26.328 s, so this does **not** imply that zero bytes
  arrived. No `/api/auth/me` request had started.
- The font took 11.995 s: about 798 ms until headers, then another 11.20 s to
  completion. Ray ID `a380404caaee9be8-MUC`; `CF-Cache-Status: MISS`.
- Nginx logged matching successful 200 responses for shell/font at 19:10:04,
  emoji.js at 19:10:06 and zilch.js at 19:10:15. Existing logs lack request
  duration and Ray IDs; this correlation is by time/resource/user-agent, not
  definitive end-to-end tracing. Exact transport location remains unknown.

The apex `/zilch` also timed out once after 25 seconds, with client-to-edge
TLS already complete in 26 ms. Other samples took 119 ms and 3.418 s.

## Font/CDN/browser caching

- Before: unversioned TTF, 74,104 bytes, `font-display: swap`; origin
  `no-cache, must-revalidate`. Public samples were `REVALIDATED`, despite
  `max-age=14400, must-revalidate` in the public response.
- The worst revalidation sample waited 8.877 s before transferring the body
  in only 6.4 ms. Revalidation adds an avoidable origin round trip:
  [Cloudflare cache response definitions](https://developers.cloudflare.com/cache/concepts/cache-responses/).
- Adding the **current** content version to that same production font URL
  activated `public, max-age=31536000, immutable`. A warm edge HIT took
  59.9 ms TTFB / 65.0 ms total (`Age: 20`). A cold MISS still took
  2.961 s TTFB / 6.978 s total. These are different samples, not proof that
  caching repairs all transport failures. A stale/arbitrary `v` does not get
  immutable caching under the application's existing policy.
- After locally: the preload and CSS use the same content fingerprint; only
  selected LCARS preloads the font, with anonymous CORS matching `@font-face`.
  A second same-context navigation confirmed `Network.requestServedFromCache`,
  **0 transferred bytes / 0 ms** for the font. The heading used the custom
  Antonio font, confirmed with `CSS.getPlatformFontsForNode`.
- `font-display: optional` prevents a late replacement of fallback text.
  Tradeoff: on a slow first visit the fallback remains for that page; a warm
  future visit can use Antonio. The short initial block period is visible in
  the delayed-font after measurement. [Font rendering behavior](https://web.dev/articles/font-best-practices).
- WOFF2 was not introduced: the measured 74 KB body is not the dominant cause
  in the revalidation sample. Conversion alone would not remove auth gating
  or incomplete JS transfers; no extra asset pipeline is needed for this fix.
- Auth retains `no-store`; no account response is made publicly cacheable.

## Commit comparison and implementation

- `c9a9bc1`: initial LCARS theme. `3d34060`: refinement introducing Antonio TTF.
- `zilch.js` is byte-identical (208,482 bytes) at `c9a9bc1^`, `c9a9bc1` and
  `3d34060`. Auth/render ordering did not change in either LCARS commit.
  The auth gate predates LCARS (September 3); LCARS added font/revalidation/CLS
  exposure, not the original full-page auth dependency.
- The current baseline bundle was 208,785 bytes. Duplicate initial `/me`
  requests arise from separate shared-shell and Zilch bundles and also predate
  LCARS. Cross-bundle auth architecture is deliberately not refactored here.
- `app/main.py`: only a server-confirmed public lobby receives the early-render
  marker. The real H1 is already in HTML on both public Zilch `/` and legacy
  `/zilch`. Private/account routes retain their gate and noindex policy.
- `frontend/zilch/index.js`, `frontend/multigame/app-mode.js`: public controls
  render before auth; game submission, account identity and private/chat
  requests wait. Identity hydrates in place, preserving the H1 and selected
  options. Network failure leaves a read-only lobby; explicit denial revokes
  access. No client marker grants server API authority.
- `frontend/styles/zilch-lcars.css`, four Zilch HTML heads: optional/versioned
  font and theme-conditional preload. Asset build/version tooling now handles
  font URLs without a content-hash/rebuild loop.
- `frontend/shell/index.js`: translates the server-marked public hero early
  for English sessions even while the main Zilch module is stalled. The global
  translation lifecycle is unchanged.
- Generated JS/CSS, HTML/manifests and both service-worker cache versions are
  synchronized. Changes to unrelated HTML files are only asset fingerprints.
- README, bilingual changelog and a prepared DE/EN usability release notice
  describe the behavior. No new rule, scoring change or public route was
  introduced, so rules and the SEO registry need no content changes.

## Server, database and TLS

Application-local anonymous auth was 0.99–1.09 ms TTFB; local nginx HTTPS
about 17 ms. Local JS/CSS/font requests took about 1–2 ms TTFB. This argues
against application work as the cause of the measured multi-second waits;
authenticated database workloads were not measured and are not ruled out.

At the snapshot, the app used about 148 MiB of a 384 MiB container limit,
CPU 0.16%, no OOM/restart loop, no active swapping or I/O pressure. The host
had about 350 MiB available RAM. Disk usage was 86% with roughly 1.3 GiB free:
limited headroom, but not an observed bottleneck. A preceding host reboot
explained existing 18:49–18:50 upstream resets; no reboot was performed here.

**525 was not reproduced and is not declared fixed.** The current certificate
had correct SANs and was valid until December 3, 2026; verified SNI-aware
direct HTTPS worked. Intermittent Cloudflare-to-origin TLS failures still
require separate correlation of timestamp/Ray ID with origin TLS logs and
Cloudflare analytics. [Cloudflare's 525 definition](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-525/).

Likewise, the incomplete public JS downloads remain an independently open
transport issue. Next diagnostic step is a targeted failing browser NetLog
plus correlated edge/origin request timing, not speculative memory tuning or
weaker TLS settings. Permissions-Policy console warnings do not explain the
recorded pre-auth network stalls.

## Verification

- `npm run lint`: Ruff, Vulture, product/i18n/SEO, generated build and asset
  version checks passed.
- Full backend suite: **451 passed**, 4 pytest-xdist workers, 17.00 s in the
  final run. Includes public/private route marker and immutable font URL tests.
  Existing sqlite datetime-adapter and httpx per-request-cookie deprecation
  warnings remain; no test failed.
- Existing browser coverage: **53 passed**, 4 workers, 50.6 s, across
  `zilch-product-ui`, `multigame`, `pwa-product-isolation` and
  `zilch-game-screen-fixture`.
- New loading suite plus existing LCARS theme test: **8 passed**, 15.0 s, including
  delayed/blocked font, delayed/failed auth, delayed JS, theme-specific font
  loading, early English translation, preserved choices and the private access guard. Baseline public
  loading assertions failed before the fix; the private guard already passed.
- Mobile 390×844 regression sample with both font/auth blocked around 4 s:
  main content 118.9 ms, LCP 124 ms, late-font CLS 0, total CLS 0.00405.
  Delayed JS 3.5 s: hero 40.2 ms, LCP 44 ms, CLS 0.04556. A completely blocked
  font still allowed the desktop form at 56.2 ms.
- Browser results: `/tmp/zilch-loading-final-en-results.json`; failure traces
  from the baseline are under `/tmp/zilch-loading-baseline/`.

These are local regression guarantees under controlled delays, not a claimed
post-deployment production measurement or a complete fix of the open network
issue.
