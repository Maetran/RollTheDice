---
version: 1
slug: "app-static-hausdepp-html"
primary_target: "app/static/hausdepp.html"
related_targets: ["frontend/hausdepp/index.js","frontend/hausdepp/motion.js","frontend/styles/hausdepp.css","frontend/i18n/catalog.js","app/static/hausdepp-lobby.html","app/static/hausdepp-rules.html"]
---

# Hausdepp lobby and table

Mode: Operate. Owner-only first playable increment for 2–6 participants, including server-controlled computers. Mobile first; portrait and landscape on phone, tablet and desktop. User selected Stammtisch-Runde explicitly on 2026-10-16. Keep the established walnut table and the supplied double-German Tell-pattern cards. Shared suite account, chat, reactions and game selection remain available. Rules and future scoring/achievements/account surfaces belong to the same product; do not invent a scoring system.

## Direction contract

THESIS: One communal card table, with people arranged around the live pile and the player's readable hand in the foreground.

OWN-WORLD: Existing walnut raster, natural ivory card faces, oxblood action accents and restrained brass turn markers; a self-hosted characterful display face with plain system UI controls. Real Tell-pattern card art carries the scene.

STORY: Choose a table or start with a computer, complete the mandatory private bottom peek one tap per card, then play by tapping a legal hand card immediately. Further same-rank taps queue behind acknowledged commands. Understand whose turn it is, when afterthrow remains possible, and who has the next refill obligation; take a chance or pick up through the physical piles.

FIRST VIEWPORT: Compact suite header; opponents around a centred face-up pile and face-down stock; one turn sentence; a compact natural hand fan sorted from low left to 10 right. Card faces preserve the original Tell artwork while accessible names identify suit and rank. The piles carry their own action captions; there is no separate hand confirmation. On low landscape the hand and action guidance share the lower edge; desktop adds a persistent social rail.

FORM: Stammtisch-Runde, grounded candidate 1, user-selected pick from direction seed 66f985a7. Seven grounded candidates: Stammtisch-Runde, Bierdeckel, Kartenmacher-Druckbogen, Wirtshaustafel, Vereinsabzeichen, Speisekarte, Kegelbahn-Spielzettel. Hand hover/focus and committed-command feedback stay brief. Nonblocking card-back deal ghosts complete within 900ms and run once per game/deal version, with no reload or reconnect replay. Pile clearing has one acknowledgement. The first refill obligation has a soft red frame and “Du musst ziehen” / “You must draw”; reduced motion keeps it static and skips dealing motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Current interaction contract

- The mandatory pre-deal bottom peek inspects one card per tap. A 10 succeeds immediately and must be taken. Ace chains remain private until a following 10 succeeds; then the inspected aces and that 10 are briefly public and taken. Any other rank ends the peek without taking or publishing the chain.
- Hand taps play immediately, including further same-rank taps through the acknowledgement queue. No selected state, `aria-pressed`, rank badges or confirmation step belongs on hand cards.
- Keyboard navigation reveals the full rotated hand card with an (8px) inset within the hand’s scroll bounds. Only `:focus-visible` starts the correction; it runs one animation frame after native focus scrolling, measures the actual rotated card and hand viewport, and adjusts horizontal scroll only while the same card remains focused.
- Refill debts reserve only the stock in FIFO order. The head draws all missing cards up to three with one tap; nobody else may draw or take a chance while a debt remains. Legal hand play and pickup can proceed, including the next player’s hand play before the previous refill and a burner’s replay before their own refill.
- Delayed refilling never rewinds the turn or restores afterthrow rights. The next player’s first accepted gameplay action closes afterthrow. Taking a chance requires an empty debt queue.
- Current source measurements and motion live in `DESIGN.md`, `frontend/styles/hausdepp.css`, `frontend/hausdepp/index.js` and `frontend/hausdepp/motion.js`; labels live in `HAUSDEPP_MESSAGES`.

## Current source and verification evidence

The final low-landscape source uses (27px/86px/26px) opening grid rows, a (136px) stock/pile region spanning rows two and three, event copy in the fourth right-hand row with (35px) top spacing, and action guidance in the fifth with (8px 0 48px) padding. The hand stays (79px/44px) in low landscape. Tablet landscape keeps (112px/66px) cards/step and (18px 10px) vertical hand padding. The fan uses `align-items: flex-start` to retain each card’s (36:57) ratio; its extra (24px) minimum-height allowance provides rotation clearance without stretching card faces.

`.impeccable/review/hausdepp-live-validation.md` records the current local checks. The corresponding evidence set contains 40 `hausdepp-live-*.png` captures; the Hausdepp HTML entry points reference build fingerprint `b045d6e18205`. Large-hand tail evidence uses viewport captures after bringing the hand into view; the start captures retain header context. Visual review is tracked separately from these source and test records. This evidence is separate from the earlier milestone below.

## Earlier finish milestone

The following evidence predates the direct-play fan, interactive peek and FIFO refill changes. It records that earlier milestone only and is not current visual or interaction QA.

2026-10-16: a delegated review recorded six material corrections in
`.impeccable/review/hausdepp-finish-review.md`. The bounded correction and
handoff verdict scored all six resolved (`disposition: ship`) in
`.impeccable/review/hausdepp-verdict.md`; this is the scope of that approval.
The earlier 32 captures referenced by those reviews cover seven viewport variants, six-seat
layouts and an explicitly synthetic 35-card hand. At that milestone, the own
hand and play control fit 844×390 and 1024×768 landscape; the six-seat tablet has a measured minimum
9.22px clearance between player metadata and central piles. `DESIGN.md` and the
schema-2 sidecar record the separate Hausdepp world and preserve dashboard
styles. Both shipped card rasters carry provenance. No deployment was made.
