# Hausdepp flexible lobby — local QA, 18 October 2026

The owner selected **Platzkarten**, retained player calls/sharing, and requested
less information. This feature is prepared on `codex/hausdepp-flex-lobby` from
`origin/develop` (`f27c488`). Product version: **3.9.0**. This is local feature
validation, not a production deployment.

## Product and Impeccable review

- Existing walnut, forest green, card paper, card red and Georgia remain.
- One compact entry opens the favourite/custom prompt. The custom form contains
  fixed/open participants, quick game/tournament and optional password only.
- Two phone columns and three tablet/desktop columns show real participant
  names, CPUs and free seats. CPU removal has a labelled 44px target.
- A short mode line, occupancy/start reason and necessary controls replace
  permanently visible explanations. The prestart table hides gameplay controls.
- Player calls retain existing permission/cooldown checks; share/copy reuse the
  existing native sharing and clipboard fallback.
- Four personal frequent reactions stay stable within a room. Twelve choices
  open from the up-chevron. Narrow portrait and low landscape retain 44px
  targets; dismissing a modal over a card never plays that card.
- The favourite follows the account. It never stores a password. Concrete room
  passwords are isolated by account/room in browser session storage and sent
  only in WebSocket join payloads, never in URLs.

The independent source review corrected erased favourite-load errors, a
missing translated count in a rejected-start message, and admission of a new
human at a full rematch containing replaceable CPUs. Regression cases preserve
other invitees' reservations. No remaining actionable source finding was
reported. Native OS sharing/Push delivery was not sent to real accounts.

## Verification

All browser runs use one worker and disposable local SQLite on port 8068;
backend runs use `-n 0`. No second full automatic pool was started. Existing
servers and unrelated worktrees were left running.

- Backend foundation: 94 related tests passed before favourite integration.
- Favourite/waiting/rematch/integration/push: 71 tests and 58 subtests passed.
- Final focused backend/navigation/favourite/waiting run: **23 tests and 95
  subtests passed**. Includes migration upgrade/downgrade and actual HTTP and
  WebSocket controls. Final rematch capacity fix: **3 focused cases passed**.
- Browser creation/password/favourite/place-card/product/waiting checks:
  **26 passed, 1 capture-only case skipped**. Coverage includes DE/EN at 320,
  768 and 1440px, manual start, CPU add/remove/replacement, host transfer,
  password retry on a shared link, reload/resume and creation/read failures.
- Supplementary reaction checks: **10 passed**, including six viewports,
  confirmed-own frequency, stable positions, storage corruption, disconnect
  and dismissal without a card play.
- Supplementary invitation, public discovery and tournament checks passed;
  capture-only cases are opt-in. Existing lobby/gameplay checks were adapted
  to the new creation prompt instead of bypassing the UI.
- Standalone reaction model checks: **5 passed** with
  `node --test tests/hausdepp-reactions-model.test.mjs`.
- `npm run lint`, `npm run check:security` and `git diff --check` passed.
  Lint covers static build synchronization, product delivery, DE/EN and SEO.

Phone, tablet and desktop captures were visually inspected. Temporary captures
and logs are task artifacts, not new shipping artwork. No new public route or
SEO identity is introduced; personal/game routes keep their existing noindex.
The navigation contract references the added browser flows.

## Accepted packet updates and narrow-phone follow-up

The owner accepted the place-card design and requested immediate display of a
growing open packet. The browser regression reproduced the original glitch:
the first accepted render already had count/run **2**, but packet opacity was
**0** and an old-packet picture still covered it. Its flight kept the new fan
hidden until the presentation finished.

Confirmed prefix growth now exposes the real packet immediately. Obsolete pile
flights, masks and queued pictures are removed; the new flight remains purely
decorative. First-frame probes freeze the actual effects before paint, so the
assertions cannot pass merely by waiting for an animation to finish. They cover
own launches, remote two-card plays, successful gambling, rapid afterthrows,
same-version acknowledgements, reduced motion and growth during a previous
clearing presentation. Failed-gamble narration and hand-receipt identity keep
their existing checks.

The expanded layout run also caught a 320px regression: a two-row reaction dock
removed 46px from the board and caused pile/seat overlap. The dock now fits
seven 44px controls into one row using its side margins. Existing geometry and
touch-target assertions remain unchanged. Five affected table-presence checks
and all ten reaction checks passed after rebuilding.

The focused backend/navigation suite passed **29 tests**, including actual
admission into a full waiting table until all CPUs have been replaced; player
calls stop once all six seats are human. `npm run check:quality` passed with
rebuilt asset version `4b1932e7511f`. The independent motion review reported no
remaining production finding. Auth/logout and device-switch fixes belong to a
separate parallel task and are unchanged by this work.

Final full `hausdepp.spec.js` run: **30 passed, 2 opt-in capture cases skipped**
in 1.6 minutes, including all three first-frame packet regressions and both
previously failing narrow-table checks. The ten flexible-lobby cases also
passed in the expanded run before the narrow-dock correction.
A final optional 320px capture case passed; the native screenshot was visually
inspected and shows all seven controls without clipping or covered cards.

## Existing animation contracts aligned with immediate packet updates

The next complete CI run exposed 16 old animation expectations in browser
shard 2: they still required stationary copies of the previous packet and a
queued second throw. Those expectations contradicted the accepted immediate
packet behaviour. The own-launch test now retains its single-element adoption
check and also requires the real accepted cards and count to be visible.
Rapid-play checks require zero presentation delay, cancellation of the
superseded flight, same-version identity and disconnect cleanup.

The 14 device geometry cases now inspect the real packet and its artwork in
start, rest and arrival frames, including size, position, rotation, card order
and effective opacity. Incoming flights still have to arrive at the current
card's exact pose; clearing keeps its previous-packet and burn-frame checks.
The targeted run passed **17 tests** in 30.1 seconds, including the own launch,
rapid play, every geometry/burn viewport and resize cleanup. Only browser tests
changed; the product bundle and release version remain unchanged.
