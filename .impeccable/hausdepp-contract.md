# Hausdepp lobby and table

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
