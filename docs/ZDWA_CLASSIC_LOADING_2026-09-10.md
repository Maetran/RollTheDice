# ZDWA Classic: loading and handwriting — 2026-09-10

## Scope and method

The supplied Safari screenshot shows a signed-in Classic lobby, sustained
JavaScript/layout activity and a Cloudflare challenge frame. A screenshot is
not an exportable trace; its exact trigger and elapsed timings cannot be proved
from that image alone. Baseline: production/source commit `52bdbd7`.

Chrome-DevTools MCP was unavailable. Measurements instead use real Chromium
DevTools Protocol traces, CPU profiles and PerformanceObservers via Playwright.
Fresh 1280 × 900 browser contexts selected Classic, disabled service workers
and, for the cold-load baseline, browser cache. No CPU/network throttling was
applied. Each cold-load trace continued seven seconds after load. These are
individual local lab observations, not field percentiles or a mobile score.
Production browsing was anonymous and read-only; authenticated race tests use
disposable local fixtures, never real accounts or push recipients.

Temporary raw evidence: `/tmp/zdwa-perf-before-XqzDoS/`, including `local.json`,
`production.json`, `production-login-focus.json`, CPU profiles, metrics and PNGs.

## Findings

### Unnecessary registration challenge: reproduced

The previous `auth-controller.js` started Turnstile on any username/password
focus. Initialization awaited `/api/auth/me` without checking whether the result
was already authenticated. Focusing the form before a delayed authenticated
response therefore downloaded the script and rendered into a now-hidden form.
The isolated reproduction recorded one challenge-script request, one widget
render and `loginForm.hidden === true`. Successful login also left an existing
widget running. Restored focus/autofill is a plausible trigger for the supplied
Safari screenshot, not a proven reconstruction of that particular visit.

A separate real production trace focused the anonymous login field without
registering. This started a challenge frame, WebRTC and worker activity:

| Renderer work over the focus trace | Application | Challenge frame |
| --- | ---: | ---: |
| Total renderer-main task duration | 109 ms | 896 ms |
| Tasks longer than 50 ms | 0 | 4 |
| Longest renderer-main task | 23 ms | 286 ms |

The challenge's JavaScript function calls alone consumed 747 ms. These are
trace durations for separate processes; they must not be added to LCP or
interpreted as sustained 99% CPU. Page-level long-task observers omit the
cross-origin challenge process, which is why the complete trace matters.

### Font and first paint: not the observed bottleneck

| Cold-load measurement | Local origin | Public production |
| --- | ---: | ---: |
| Document TTFB | 11 ms | 1,821 ms |
| LCP | 64 ms | 1,884 ms |
| Cumulative layout shift | 0 | 0.00043 |
| Main-page long tasks | 0 | 0 |

LCP was the introductory paragraph, not a score cell or font resource.
For this text LCP the decomposition is TTFB 1,821 ms, resource-load delay 0 ms,
resource-load duration 0 ms, and element render delay approximately 63 ms.
Its font arrived later without moving the LCP: bundled Kalam uses
`font-display: optional`. The severe Safari duration is not reproduced by this
ordinary guest load, and this table is not a before/after improvement claim.

Public resource durations in the same cold trace:

| Resource | Start after navigation | Duration |
| --- | ---: | ---: |
| `/static/shell.js` | 1,831 ms | 29 ms |
| `/static/lobby.css` | 1,831 ms | 17 ms |
| `/static/lobby.js` | 1,831 ms | 313 ms |
| Kalam bold WOFF2 | 1,850 ms | 71 ms |
| Kalam regular WOFF2 | 1,852 ms | 758 ms |
| `/api/auth/me`, shell | 1,875 ms | 180 ms |
| `/api/auth/me`, lobby | 2,146 ms | 74 ms |

The approximately 44 KiB of fonts already have versioned URLs and immutable
cache headers. The main lobby content is present before auth completes. There
is no evidence here for replacing the fonts or rewriting the render pipeline.
Separate bundles currently request auth twice; this existing behavior is not
the demonstrated challenge race and is unchanged in this bounded fix.

### Origin, database and transport: separate observations

Read-only server checks found CPU 0.62%, container memory 129/384 MiB, nine
processes and 315 MiB available host memory. Direct-origin TTFB was approximately
1 ms for auth/health, 1.5 ms for HTML and 16 ms for the leaderboard. No current
memory, process or database bottleneck was established.

Public IPv4 requests returned HTTP 200: auth 130–343 ms, health 65–320 ms and
leaderboard 112–298 ms across HTTP/1.1 and HTTP/2. HTML varied between roughly
1.1 and 1.8 seconds in the recorded checks. Two Node fetch timeouts were not
reproducible with curl; IPv6 connectivity was unavailable from the local test
environment before any HTTP response. This is not proof of an auth-service
failure. No Cloudflare 525 was observed. Variable public document latency
remains a separate network/CDN/origin-path observation, not something the
frontend patch can claim to eliminate.

## Bounded changes

- Turnstile starts only after explicit **Register / Registrieren**. Plain login
  focus and autofill do not trigger it. Auth-state/generation checks prevent
  obsolete initialization or callbacks, and login removes an old widget.
  Registration still waits for confirmed configuration and a fresh token;
  server-side verification is unchanged. No widget, secret or Cloudflare
  configuration is changed.
- Classic score entries use inline SVG centre-line digit paths, sequential
  strokes and pen lifts. Animation lasts approximately 440–630 ms for one to
  three digits. The completed paths remain, without switching to font outlines.
  Accessible numeric text is present immediately. Scores and controls never
  wait, and no network requests, timers or frame-polling loops are introduced.
- Only new authoritative writes animate, including opponents and teams.
  Hydration, reconnects, existing values and read-only history do not replay.
  Reduced motion shows complete ink immediately; Light, Dark and Zilch retain
  their presentation. Re-rendering during a stroke preserves elapsed progress.

## Controlled regression comparison

Three local Chromium runs per variant held authenticated `/api/auth/me`
responses for 800 ms and focused the login input before identity completed.
The old production lobby bundle was isolated from `52bdbd7`; candidate assets
used the new focus/auth guards. Turnstile was a no-op local fixture, so these
runs deliberately exclude its real CPU/network cost.

| Measurement | Before | After |
| --- | ---: | ---: |
| Unwanted challenge-script requests | 1 per run | 0 per run |
| Widget rendered inside hidden login form | 3/3 runs | 0/3 runs |
| Median LCP | 64 ms | 60 ms |
| CLS, including delayed identity UI change | 0.04791 | 0.04791 |

The small LCP difference is measurement noise, not a claimed speed gain.
The measured improvement is removal of unnecessary challenge work. Final
registration/lifecycle tests also exercise the real local backend and confirm
that the normal registration path remains usable.
Raw comparison traces: `/tmp/zdwa-race-comparison-XfN6Y1/`.

The stalled-font/auth regression holds both requests for three seconds. In
the Chromium check, the main content was visible by 130 ms, and late font CLS
was zero. WebKit also painted before request release and kept exactly the same
heading geometry; it does not expose the Layout Shift API, so no WebKit CLS
number is claimed. The actual two-digit writing trace measured approximately
527 ms and numerous intermediate stroke lengths rather than opacity changes.

## Validation

- `npm run lint`: passed, including localization, SEO, product delivery,
  generated assets and fingerprint consistency (`80291a90d02d`).
- Relevant backend suite: **150 passed**, plus **17 subtests passed**. Scope:
  accounts/registration, HTTP delivery, localization, roll controls, scoring,
  turn/poker logic, Classic fonts, game WebSockets, resume/pause and release notes.
  Existing SQLite datetime-adapter deprecation warnings remain.
- **97 Chromium cases and 19 WebKit cases verified:** 14 loading/security and
  five handwriting cases in each engine, plus 78 broader Chromium account,
  game, Classic, release-notice, PWA and LCARS checks.
- During development, tests caught a Promise-chaining typo in registration;
  it was fixed before the final build and full registration checks passed.
  The shared-server presence-count test also conflicted with parallel game
  tests (three online users instead of its isolated expectation of two).
  All 42 account/smoke cases were therefore repeated on an isolated server
  with one worker; the other independent suites used four workers.
- Mobile/desktop handwriting screenshots with zero, two- and three-digit
  values were visually inspected. No rule or control change requires a new
  gameplay guide, and no new page or UI string was introduced.

Deployment is explicitly authorized as silent: no version push or in-app
announcement. Post-deployment public timings are separate samples; they must
not be presented as a controlled gain over a different network run.
