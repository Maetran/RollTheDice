---
version: 1
slug: "app-static-hausdepp-html"
primary_target: "app/static/hausdepp.html"
related_targets: ["frontend/hausdepp/index.js","frontend/hausdepp/motion.js","frontend/hausdepp/cards.js","frontend/styles/hausdepp.css","frontend/i18n/catalog.js","app/static/hausdepp-lobby.html","app/static/hausdepp-rules.html","app/static/hausdepp-account.html"]
---

# Hausdepp lobby, table, rules and account

Mode: Operate. Owner-only development for 2–6 participants, including server-controlled computers. Mobile first; portrait and landscape on phone, tablet and desktop. User selected Stammtisch-Runde explicitly on 2026-10-16. Keep the established walnut table and the supplied double-German Tell-pattern cards. Shared suite account, chat, reactions and game selection remain available. The dedicated account shows real private outcomes and links shared settings; rules include a quick start and timing examples. Points and achievement conditions remain undecided. The owner explicitly has NOT accepted the UI/UX; technical QA does not change that status.

## Direction contract

THESIS: One communal card table, with people arranged around the live pile and the player's readable hand in the foreground.

OWN-WORLD: Existing walnut raster, natural ivory card faces, oxblood action accents and restrained brass turn markers; a self-hosted characterful display face with plain system UI controls. Real Tell-pattern card art carries the scene.

STORY: Choose a table or start with a computer, complete the mandatory private bottom peek one tap per card, then play by tapping a legal hand card immediately. Further same-rank taps queue behind acknowledged commands. Understand whose turn it is, when afterthrow remains possible, and who has the next refill obligation; take a chance or pick up through the physical piles.

FIRST VIEWPORT: Compact suite header; opponents around a centred face-up pile and face-down stock; one back per public opponent card, with a small turn/debt avatar over each fan; one turn sentence; the player's compact natural hand fan sorted from low left to 10 right. Card faces preserve the real Tell motifs inside clean rounded paper frames while accessible names identify suit and rank. The piles carry their own action captions; there is no separate hand confirmation. On low landscape the hand and action guidance share the lower edge; desktop adds a persistent social rail.

FORM: Stammtisch-Runde, grounded candidate 1, user-selected pick from direction seed 66f985a7. Seven grounded candidates: Stammtisch-Runde, Bierdeckel, Kartenmacher-Druckbogen, Wirtshaustafel, Vereinsabzeichen, Speisekarte, Kegelbahn-Spielzettel. Hand hover/focus and committed-command feedback stay brief. Every new accepted card transfer follows its measured source → receiving destination; private movement uses backs. Bounded stagger and two-stage failed-chance pickup complete within 900ms, remain pointer-inert and add no action lock. Only consecutive accepted versions animate; initial load, reload, reconnect, duplicate/UI-only and skipped states stay quiet. Reduced motion uses a stationary destination outline. The first refill obligation retains the soft red frame and “Du musst ziehen” / “You must draw”; reduced motion keeps that frame static.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Current interaction contract

- The mandatory pre-deal bottom peek inspects one card per tap. A 10 succeeds immediately and must be taken. Ace chains remain private until a following 10 succeeds; then the inspected aces and that 10 are briefly public and taken. Any other rank ends the peek without taking or publishing the chain.
- Hand taps play immediately, including further same-rank taps through the acknowledgement queue. No selected state, `aria-pressed`, rank badges or confirmation step belongs on hand cards.
- Keyboard navigation reveals the full rotated hand card with an (8px) inset within the hand’s scroll bounds. Only `:focus-visible` starts the correction; it runs one animation frame after native focus scrolling, measures the actual rotated card and hand viewport, and adjusts horizontal scroll only while the same card remains focused.
- Refill debts reserve only the stock in FIFO order. The head draws all missing cards up to three with one tap; nobody else may draw or take a chance while a debt remains. Legal hand play and pickup can proceed, including the next player’s hand play before the previous refill and a burner’s replay before their own refill.
- Delayed refilling never rewinds the turn or restores afterthrow rights. The next player’s first accepted gameplay action closes afterthrow. Taking a chance requires an empty debt queue.
- The own hand remains the established sorted natural fan. Opponents render exactly their projected public count as backs (0–36), with no hidden card faces or identifiers in the fan. Their name/count remain visible, with a translated seat label; the redundant visual fan is `aria-hidden`.
- Card art is measured and framed at native 36:57 proportions. Thirty-five faces use the supplied photograph; leaf 10 uses the licensed higher-resolution nonglare source in `docs/HAUSDEPP_ASSETS.md`. Original raster pixels remain unchanged. Gain-only paper white-point grading in explicit sRGB balances photographic cast toward shared ivory without inventing illustration.
- Capture the old hand/pile before DOM replacement and the receiving hand/current visible stock after it. Deal, refill, pickup, peek receipt, play, afterthrow, chance and burn have explicit paths; failed chance travels stock → pile → hand. Motion may delay visual arrival, never interaction. Closing the socket cancels flights and resets the baseline.
- Current source measurements and motion live in `DESIGN.md`, `frontend/styles/hausdepp.css`, `frontend/hausdepp/index.js`, `frontend/hausdepp/cards.js` and `frontend/hausdepp/motion.js`; labels live in `HAUSDEPP_MESSAGES`.

## Current source and verification evidence

The current product increment adds real lobby seat/status/action summaries, mixed
human/computer seat previews, a waiting-room copy-link fallback, read-only
spectating, the dedicated personal account and a linked bilingual rulebook.
Personal history paginates without linking to expired live rooms; round counts
are descriptive facts, never a points system. Prepared achievement copy explains
the ironic clever-to-Hausdepp direction without granting titles or awards.
Current technical verification belongs in
`.impeccable/review/hausdepp-product-validation.md`; owner acceptance remains open.

The low-landscape source retains (27px/86px/26px) opening grid rows, a (136px) stock/pile region spanning rows two and three, event copy in the fourth right-hand row with (35px) top spacing, and action guidance in the fifth with (8px 0 48px) padding. The own hand stays (79px/44px) in low landscape. Tablet landscape keeps (112px/66px) cards/step and (18px 10px) vertical hand padding. The own fan uses `align-items: flex-start` to retain each card’s (36:57) ratio; its extra (24px) minimum-height allowance provides rotation clearance without stretching card faces. Opponent fans compress their overlap for phones and low landscape. A single opponent uses a larger fan, arranged beside name/count in low landscape. Computer labels hide on phones, tablet landscape and low landscape, preserving the public name/count.

The preceding opponent-hand, card-art and transfer increment uses `.impeccable/review/hausdepp-hands-validation.md` as its local validation and build-identity record, with the `hausdepp-hands-*` evidence set. This source record does not itself assert that checks or visual review passed. Asset provenance and credits are owned by `docs/HAUSDEPP_ASSETS.md`.

## Prior interaction milestone

`.impeccable/review/hausdepp-live-validation.md`, `hausdepp-live-finish-review.md` and `hausdepp-live-verdict.md` record the preceding direct-play, active-peek and FIFO-refill milestone. Its 40 `hausdepp-live-*.png` captures predate exact-count opponent fans, the current paper framing/grading and transfer paths. Large-hand tail evidence uses viewport captures after bringing the hand into view; the start captures retain header context. That evidence remains useful for the scope it reviewed and does not verify this increment.

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
