# Hausdepp lobby and table

## Owner revision — 2026-10-16

The owner now explicitly asks for Hausdepp's own identity: forest green,
card-paper white, card red and strong Georgia serif headings replace the
handwritten Zilch resemblance. Walnut, genuine Tell faces, the direct-play fan
and source-to-destination card transfers remain. Navigation follows Lobby,
standings, rules, account; functional anchors retain their destinations but
look like clear buttons. Groups align evenly (2×2 account shortcuts on narrow
screens). The lobby's compact animated demo hand sits beside the title/motto,
keeping the create-table form higher on phones. Its calm 3–4s changes are only
presentation and pause for hidden pages/reduced motion.

Opponents form a semicircle around the real piles. Public account avatars and
3s reaction bubbles identify the sender, including one's own echoed reaction.
Fifty random male/female CPU names are unique at a table and stable through a
tournament. Twelve photographic prop variants occupy measured free table
areas, fewer/smaller on mobile, with minimal steam, foam and candle motion.
Decorative dice do not affect rules. All effects respect reduced motion.

Points now pace common goals across distinct completed rounds and keep earned
entries first within each group. Shared suite navigation, install identity,
owner access and monitoring remain separate concerns. Technical local QA and
capture evidence do not grant owner appearance/UX acceptance.

Mode: Operate. Owner-only first playable increment for 2–6 participants, including server-controlled computers. Mobile first; portrait and landscape on phone, tablet and desktop. User selected Stammtisch-Runde explicitly on 2026-10-16. Keep the established walnut table and the supplied double-German Tell-pattern cards. Shared suite account, chat, reactions and game selection remain available. Rules and future scoring/achievements/account surfaces belong to the same product; do not invent a scoring system.

## Direction contract

THESIS: One communal card table, with people arranged around the live pile and the player's readable hand in the foreground.

OWN-WORLD: Existing walnut raster, natural ivory card faces, oxblood action accents and restrained brass turn markers; a self-hosted characterful display face with plain system UI controls. Real Tell-pattern card art carries the scene.

STORY: Choose a table or start with a computer, understand whose turn it is, select matching cards, then lay, gamble or take. A visible afterthrow state explains the fleeting opportunity.

FIRST VIEWPORT: Compact suite header; opponents around a centred face-up pile and face-down stock; one turn sentence; a broad bottom hand region and reachable labelled actions. On landscape the hand and actions use the long lower edge; desktop adds a persistent social rail.

FORM: Stammtisch-Runde, grounded candidate 1, user-selected pick from direction seed 66f985a7. Seven grounded candidates: Stammtisch-Runde, Bierdeckel, Kartenmacher-Druckbogen, Wirtshaustafel, Vereinsabzeichen, Speisekarte, Kegelbahn-Spielzettel. Card selection lifts once; pile clearing is the one authored motion and honours reduced motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance


## Confirmed interaction refinement — 2026-10-16

The original direction remains. The user replaced card selection/confirmation
with immediate play on hand-card taps. Own cards form a compact natural fan,
sorted low left to tens right, using original art without added rank labels.
The designated peeker actively taps through bottom inspection; a brief,
nonblocking deal animates card backs across the walnut table. The next player
may play while earlier refills remain due. Only stock access follows FIFO debt
order: later players cannot draw or gamble until the earlier player refills.
The responsible player sees a gentle red frame and “Du musst ziehen” /
“You must draw”; reduced motion keeps that warning static. Delayed draws never
rewind the turn or an expired additional-card window. Own-burn hand replay may
proceed before refilling, while stock access remains ordered.

## Confirmed card and transfer refinement — 2026-10-16

The Stammtisch direction and the player's existing sorted natural hand remain.
The user requires the cards themselves to feel valuable: preserve the real Tell
motifs, native 36:57 proportions and clean rounded paper edges. Each face uses
measured photographic corners with an affine frame and inner paper clip;
thirty-five retain the supplied photograph, while leaf 10 uses a licensed
higher-resolution nonglare leaf/tree photograph. Source raster pixels stay
unchanged. Measured, bounded gain-only sRGB white-point grading balances the
photographed paper toward shared ivory. Credits and the precise source
exception remain in `docs/HAUSDEPP_ASSETS.md`.

Every opponent displays exactly one back per public hand card (0–36), with a
small turn/debt avatar above the fan and readable name/count. Compress overlap
for small screens; keep the own hand unchanged. No hidden opponent faces or
identifiers enter the fan or private card-flight markup.

New accepted card transfers must explain the actual source and receiving
destination: stock to hands for deal/refill/peek receipt, pile to hand for
pickup, hand to pile for play/afterthrow, stock to pile for chance and pile to
the burned area for clearing. A failed chance has both stock → pile and
pile → hand stages. Capture removed sources before rendering and receiving
destinations after rendering; use the stock's current visible position. Keep
flights pointer-inert, screen-reader-hidden, bounded to 900ms and free of
gameplay locks. Reduced motion marks the destination without travel. Only the
next consecutive accepted version animates, so loading, reconnecting, duplicate
or UI-only renders and skipped history remain quiet.

The current validation and build identity belong in
`.impeccable/review/hausdepp-hands-validation.md`. Prior finish and
`hausdepp-live-*` records retain their historical review scope; they do not
approve this refinement.


Final local QA for this revision: bundle `0f737870befb`, 22 manifest-listed
captures, no remaining visible blocker in independent review. The corrected
compact out-of-play caption reserves a separate inline row. One 850ms anonymous
card-back shuffle appears before cutting, without input locks; command/phase/
socket cleanup, reduced motion and once-per-round session suppression are
tested. Table names now come from 50 paired DE/EN owner-name templates; the
manual name field is removed. CPU rounds grant 2 whole EP after 75% reduction
and per-round flooring, human-only rounds 10, achievements full. Native
installation and actual OS Push delivery remain outside headless proof.
See `docs/HAUSDEPP_LOCALHOST_TEST_2026-10-16.md`. Owner acceptance remains open.


## Owner-approved place-card lobby — 2026-10-18

Owner selected Platzkarten for the creation block and waiting room. A compact
entry opens a two-choice prompt: create the saved account favourite or define a
mode. Configuration stays short: fixed/open count, quick game/tournament and
optional password. CPUs are added/removed in the waiting room. Open tables start
manually at two to six participants; fixed tables need the selected capacity.
Humans use free seats first, then replace a CPU at a full prestart table.

The owner explicitly retains player calls and sharing and asks for less
information. Use readable 2-column phone / 3-column tablet-desktop place cards,
a short mode line and only necessary status hints. Reuse native share/copy and
player-call permissions/cooldowns. Favourites store settings across devices,
never passwords. Four personal frequent reactions plus an up-chevron open a
12-symbol picker; positions stay stable during a room. Scope stays within the
creation block, waiting block and the requested reaction control.

Local validation and independent review are recorded in
`docs/HAUSDEPP_FLEX_LOBBY_QA_2026-10-18.md`. A feature-branch build is not a
production deployment; no real-account calls or share sends are QA actions.
