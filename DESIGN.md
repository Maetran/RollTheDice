---
name: RollTheDice — dashboard themes and Hausdepp
description: Recorded dashboard themes and the separately scoped Hausdepp Stammtisch world.
colors:
  nexus-lime: '#c4f279'
  nexus-blue: '#9ec9e1'
  nexus-amber: '#efbd78'
  nexus-danger: '#ffa597'
  nexus-ink: '#0b100f'
  nexus-panel: '#141b18'
  nexus-surface: '#19231d'
  nexus-line: '#344139'
  nexus-text: '#edf2e9'
  nexus-muted: '#a6b6ab'
  nexus-control: '#18211a'
  nexus-control-hover: '#253320'
  nexus-control-line: '#52634f'
  nexus-lime-ink: '#11190f'
  nexus-lime-hover: '#d4ff95'
  nexus-selected: '#29371f'
  mission-ink: '#080d16'
  mission-panel: '#101925'
  mission-line: '#233040'
  mission-text: '#eef4fb'
  mission-muted: '#93a6bb'
  mission-cyan: '#6ee7de'
  mission-amber: '#f4c77b'
  mission-danger: '#ff9c9c'
  lcars-void: '#0a0c12'
  lcars-panel: '#11141b'
  lcars-line: '#41404e'
  lcars-text: '#f2eadb'
  lcars-muted: '#b5acbf'
  lcars-apricot: '#c49472'
  lcars-apricot-bright: '#d7ad86'
  lcars-lilac: '#a18baf'
  lcars-blue: '#7184ad'
  lcars-cyan: '#78aab4'
  lcars-focus: '#fff3c4'
  hausdepp-paper: '#f5efdf'
  hausdepp-ink: '#30271f'
  hausdepp-muted: '#6b5949'
  hausdepp-red: '#9c292b'
  hausdepp-red-hover: '#7e2022'
  hausdepp-gold: '#e6c98a'
  hausdepp-edge: '#cdbb9c'
  hausdepp-wood: '#35271f'
  hausdepp-white: '#fffdf7'
  hausdepp-draw-frame: '#ed8379'
  hausdepp-draw-text: '#ffd4c7'
typography:
  nexus-display:
    fontFamily: '"Nexus Display", sans-serif'
    fontSize: clamp(36px, 3.8vw, 62px)
    fontWeight: 800
    lineHeight: 1.07
    letterSpacing: -.035em
  nexus-section:
    fontFamily: '"Nexus Display", sans-serif'
    fontSize: clamp(23px, 2.25vw, 32px)
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: -.025em
  nexus-title:
    fontFamily: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 16px
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: -.015em
  nexus-body:
    fontFamily: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
  nexus-label:
    fontFamily: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.6
  nexus-data:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace
    fontSize: clamp(28px, 3.2vw, 46px)
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: -.035em
  hausdepp-display:
    fontFamily: '"Hausdepp Sign", cursive'
    fontSize: clamp(58px,7vw,96px)
    fontWeight: 700
    lineHeight: 1.1
  hausdepp-heading:
    fontFamily: '"Hausdepp Sign", cursive'
    fontSize: 34px
    fontWeight: 700
    lineHeight: 1.15
  hausdepp-body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 16px
    lineHeight: 1.75
  hausdepp-interface:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 14px
  hausdepp-support:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 13px
    lineHeight: 1.6
rounded:
  nexus-tag: 4px
  nexus-small: 5px
  nexus-control: 6px
  nexus-stage: 8px
  nexus-panel: 12px
  hausdepp-field: 6px
  hausdepp-card: 6.7% / 4.2%
  hausdepp-control: 8px
  hausdepp-paper: 12px
  hausdepp-create: 14px
  hausdepp-sheet: 16px
spacing:
  nexus-tight: 4px
  nexus-small: 8px
  nexus-control: 12px
  nexus-grid: 16px
  nexus-compact-panel: 20px
  nexus-panel: 24px
  nexus-section: 46px
  hausdepp-small: 8px
  hausdepp-hand-step: 66px
  hausdepp-control: 12px
  hausdepp-form-gap: 16px
  hausdepp-inset: 20px
  hausdepp-paper: 24px
  hausdepp-create: 32px
components:
  nexus-button-primary:
    backgroundColor: '{colors.nexus-lime}'
    textColor: '{colors.nexus-lime-ink}'
    rounded: '{rounded.nexus-control}'
    padding: 0 15px
    height: 44px
  nexus-button-primary-hover:
    backgroundColor: '{colors.nexus-lime-hover}'
    textColor: '{colors.nexus-lime-ink}'
  nexus-button-secondary:
    backgroundColor: '{colors.nexus-control}'
    textColor: '{colors.nexus-text}'
    rounded: '{rounded.nexus-control}'
    padding: 0 13px
    height: 44px
  nexus-select:
    backgroundColor: '{colors.nexus-control}'
    textColor: '{colors.nexus-text}'
    rounded: '{rounded.nexus-control}'
    padding: 0 12px
    height: 44px
  nexus-navigation:
    textColor: '{colors.nexus-muted}'
    rounded: '{rounded.nexus-control}'
    padding: 0 12px
    height: 44px
  nexus-country-tag:
    backgroundColor: '#23301e'
    textColor: '{colors.nexus-lime}'
    rounded: '{rounded.nexus-tag}'
  nexus-metric:
    backgroundColor: '{colors.nexus-panel}'
    textColor: '{colors.nexus-text}'
    padding: 22px 24px 20px
  nexus-panel:
    backgroundColor: '{colors.nexus-panel}'
    textColor: '{colors.nexus-text}'
    rounded: '{rounded.nexus-panel}'
    padding: '{spacing.nexus-panel}'
  nexus-favorite:
    backgroundColor: transparent
    textColor: '{colors.nexus-muted}'
    rounded: '{rounded.nexus-control}'
    padding: '0'
    size: 40px
  nexus-favorite-selected:
    backgroundColor: '{colors.nexus-selected}'
    textColor: '{colors.nexus-lime}'
  hausdepp-button-primary:
    backgroundColor: '{colors.hausdepp-red}'
    textColor: '{colors.hausdepp-white}'
    rounded: '{rounded.hausdepp-control}'
    padding: 13px 20px
  hausdepp-button-primary-hover:
    backgroundColor: '{colors.hausdepp-red-hover}'
    textColor: '{colors.hausdepp-white}'
  hausdepp-button-paper:
    backgroundColor: '{colors.hausdepp-paper}'
    textColor: '{colors.hausdepp-ink}'
    rounded: '{rounded.hausdepp-control}'
    padding: 11px 17px
  hausdepp-field:
    backgroundColor: '{colors.hausdepp-white}'
    textColor: '{colors.hausdepp-ink}'
    rounded: '{rounded.hausdepp-field}'
    padding: 11px 12px
  hausdepp-navigation:
    textColor: '{colors.hausdepp-paper}'
    padding: 12px 0
  hausdepp-paper:
    backgroundColor: '{colors.hausdepp-paper}'
    textColor: '{colors.hausdepp-ink}'
    rounded: '{rounded.hausdepp-paper}'
    padding: '{spacing.hausdepp-paper}'
  hausdepp-active-seat:
    backgroundColor: '{colors.hausdepp-gold}'
    textColor: '#59412e'
    rounded: 50%
    size: 22px
---

# Design System: RollTheDice dashboard themes and Hausdepp

## Overview

**Creative North Star: "The Field Engineering Console"**

NEXUS treats private telemetry as a set of instruments: an ink field, mineral-green bays, decisive display lettering and tabular measurements. Its restrained lime, blue and amber accents distinguish selection, comparison and caution. Real charts and the globe supply the visual media; no raster artwork is required.

This record describes the built dashboard at `/admin/dashboard`, not a replacement identity for RollTheDice or either game. All `nexus-*` tokens and component examples apply only when the dashboard selects `nexus`. Mission Control remains the default, and LCARS remains a separate selectable design. Their namespaced palette samples preserve existing ownership; their full source styles remain authoritative. The surface-specific composition and direction contract live in `.impeccable/surfaces/app-static-dashboard-html.md`.

**Key Characteristics:**
- A distinct additional dashboard theme with explicit ownership boundaries.
- Heavy authored headings, plain interface labels and tabular measured values.
- Flat, ruled instrument surfaces with restrained selection and state color.
- Responsive instruments and real-node favorites that retain their controls.

**The Theme Boundary Rule.** Apply NEXUS tokens only to the dashboard’s explicit nexus state; preserve Mission Control, LCARS and both game appearances.

Evidence: `app/static/dashboard.html`; `frontend/styles/dashboard-nexus.css`; retained `dashboard-base.css`, `dashboard-analysis.css`, `dashboard-design.css`, `dashboard-globe.css` and `dashboard-lcars.css`; `frontend/dashboard.js`; `frontend/dashboard/analysis.js`; `frontend/dashboard/favorites.js`; `frontend/dashboard/globe.js`. The static dashboard bundle is generated from these frontend sources.


### Hausdepp: Stammtisch-Runde

**Creative North Star: "Stammtisch-Runde"**

Hausdepp adds its own Stammtisch world: walnut, ivory playing cards, oxblood actions and brass turn cues. The actual double-German Tell-pattern deck supplies the illustration; handwritten display lettering gives the table a familiar voice while ordinary interface text stays plain and readable.

All `hausdepp-*` records apply only to the Hausdepp pages that load `frontend/styles/hausdepp.css`. They record its existing `--hd-*` properties and component styles; they do not replace dashboard tokens or the appearances of ZDWA and Zilch. The surface composition and approved direction remain in `.impeccable/surfaces/app-static-hausdepp-html.md` and `.impeccable/hausdepp-contract.md`.

**Key Characteristics:**

- Hausdepp: one shared walnut table, carefully framed Tell-pattern card imagery and compact natural hand fans.
- Hausdepp: Kalam display lettering paired with plain platform interface type.
- Hausdepp: oxblood actions, ivory paper surfaces and brass state cues.
- Hausdepp: direct card taps and real pile controls whose labels and availability follow the current game state.

**The Hausdepp Scope Rule.** Apply the Stammtisch tokens only to Hausdepp; retain each existing game and dashboard theme with its current owner.

Evidence: `frontend/styles/hausdepp.css`, `frontend/hausdepp/index.js`, `frontend/hausdepp/motion.js`, `frontend/hausdepp/cards.js` and `HAUSDEPP_MESSAGES` in `frontend/i18n/catalog.js`. The current increment covers exact-count opponent backs, card paper framing and grading, and source-to-destination card motion. Its local verification and build identity belong in `.impeccable/review/hausdepp-hands-validation.md` with the `hausdepp-hands-*.png` capture set; source documentation alone is not a QA verdict. The `hausdepp-live-*` validation and review records cover the preceding direct-play, peek and FIFO refill milestone. The original `hausdepp-finish-review.md` and `hausdepp-verdict.md` cover an earlier milestone. Neither historical evidence set verifies this increment.

## Colors

The NEXUS palette is dark mineral green with a bright operational accent. Namespaced token values in the frontmatter are the recorded source values; aliases such as the legacy CSS name `--cyan` acquire their NEXUS meaning only inside the selected theme. Sidecar tonal ramps are synthesized preview aids, not additional shipped palette values.

### Primary

- **NEXUS lime:** primary refresh action, selected stars, focus outlines, live-visit instrument and the first comparison series.

### Secondary

- **NEXUS ice blue:** comparative traffic and secondary rank/geographic values; it is a data distinction rather than a second primary action.

### Tertiary

- **NEXUS warm amber / danger:** caution and adverse measurement states. Explanatory copy carries the meaning alongside the color.

### Neutral

- **Ink / mineral panel / instrument surface:** the page ground, flat instrument bays and nested surfaces.
- **Ruled line / pale text / muted text:** fine structural divisions, primary content and explanatory labels.
- **Control / control hover / control line:** the native control substrate and its interactive boundary.
- **Retained Mission Control:** the `mission-*` samples come from `dashboard-base.css`; its blue-black ground, cyan/amber telemetry and existing layered treatment remain in place.
- **Retained LCARS:** the `lcars-*` samples come from `dashboard-lcars.css`; its warm apricot, lilac, blue and black console world, Antonio face and shaped rails remain in place. The samples are not a complete LCARS palette migration.

**The Signal Role Rule.** Use lime for action and selected instruments, blue for comparison, amber for caution and danger color for adverse or error state; retain text explanations alongside color.


### Hausdepp palette

The `hausdepp-*` palette records the nine `--hd-*` color properties in `hausdepp.css` plus the source-owned urgent-draw frame and text colors. **Primary:** oxblood red identifies the main action and darkens on hover. **Secondary:** brass gold marks the active seat, actionable stock caption, peeking stock and focus against walnut. **Urgent state:** the soft red frame marks the first outstanding refill, paired with pale-red “Du musst ziehen” / “You must draw” text for that viewer. **Neutral:** walnut grounds the table; ivory paper and warm white support cards, form and chat surfaces; dark ink, muted brown and the paper-edge color carry content and boundaries. Paper inputs and links use oxblood focus so the outline remains visible on ivory. Labels, availability and the turn sentence carry state meaning alongside color. These colors remain scoped to Hausdepp.

## Typography

**Display Font:** Bricolage Grotesque, self-hosted under the CSS family `Nexus Display`, with sans-serif fallback (800). The font uses `font-display: swap`.

**Body Font:** the platform UI sans-serif stack, for plain controls and explanatory prose.

**Measurement Font:** the inherited monospace stack, with tabular numerals for KPI and live-readout values.

The heavy, tightly spaced display face names the workspace and its major sections. It does not spread into dense chart labels. The exact desktop ramps are in the frontmatter: display, section, panel title, body, label and data are distinct roles.

Phone overrides set the hero to (39px), section headings to (25px), panel headings to (16px), KPI values to (28px), KPI labels to (12px) and supporting KPI text to (11px). Below (359px), the hero is (34px), values (25px) and KPI labels (11px). At very wide desktops (1700px and above), six-column KPI values use (35px). Chart axes and dense diagram labels use (12px) source text with the responsive geometry described below. Small ancillary metadata remains a separate role and is not the default text size.

NEXUS functional HTML labels have an (11px) minimum, including hourly values,
globe instructions, page metrics rows and pause controls. Branding metadata
also uses at least (11px). The legacy themes retain their existing type scales.

**The Measurement Rule.** Keep numbers tabular, units and scope nearby, and missing or incomplete values explicit; visits never become claims about unique people.

Incumbent typography stays with its source owner: Mission Control uses its existing UI/Inter and monospace rules; LCARS uses self-hosted Antonio through `Zilch LCARS`. Neither is replaced by NEXUS Display.


### Hausdepp type

**Display Font:** self-hosted Kalam bold, exposed as `"Hausdepp Sign", cursive` (700) with `font-display: swap`. It names the brand, welcome, table and paper-panel headings, the rulebook title, plus the empty-pile inscription. The lobby display uses the frontmatter ramp and becomes (64px) on phones; the brand uses (30px), then (27px) on phones and (25px) on narrow phones and low landscape tables.

**Body and Interface Font:** `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. The rulebook uses the recorded body role, with (15px) phone prose; the introduction uses (17px/1.65), then (15px) on phones. Controls, navigation, player names, turn copy and accessible card names stay in the UI face. Card faces show only the original artwork; no added rank labels or badges overlay it. Counts use tabular numerals where set in the source.

The create-panel heading uses the recorded heading role, then (30px) on phones; the table heading uses (25px), (22px) on phones and (19px) in low landscape. Supporting text varies with its actual purpose: (13px) form notes, (12px) connection and hand metadata, and (11px) landscape stack captions. The non-action computer designation uses (11px) on desktop and hides on phones, tablet landscape and low landscape. Player names and card counts remain visible. These are observed component treatments, not a global small-text default.

**The Hausdepp Display Rule.** Use Hausdepp Sign for branding, display headings and the empty-pile inscription; keep actions, rules prose, names and counts in the platform UI stack.

## Layout

NEXUS uses an instrument workspace within a centered shell with a maximum width of (1820px). Shared panel gaps are (16px), normal bay padding is (24px), sections are separated by (46px), and ordinary controls retain a minimum height of (44px). The star is a deliberately compact (40px) square control.

- **Desktop, 1280px and above:** fixed left navigation rail (220px), shell padding (0 38px 0 262px), vertically stacked section links and tools. The KPI deck uses three equal columns; at (1700px) it becomes six columns.
- **Tablet, 701–1279px:** shell side padding (28px), wrapping header tools and seven equal horizontal section links. The KPI deck remains three columns. Traffic panels stack at (1100px); geography keeps a (250px) sidebar until (850px), then stacks with a two-column summary sidebar.
- **Phone, 700px and below:** side padding (17px), four-column wrapping navigation, stacked hero/status, two side-by-side labeled filters, two KPI columns, (34px) section spacing and panel padding (20px 16px). Analysis and context grids stack. Geography has a (325px) stage. The third live-readout item is hidden; the visible period filter retains its scope.
- **Narrow phone, 359px and below:** side padding (12px), reduced display/data sizes and geography stage height (285px). The two-column KPI structure remains.

The favorites bay reserves space above the ordinary KPI deck. Its six-track desktop grid places up to three ordinary metrics across; exactly two metrics each span half the bay. A single favorite metric spans the bay with its value aligned opposite its label, and favored analysis panels span the full width. On phones the bay uses two tracks. When all panels have moved out of a source section, that empty source section hides; one remaining panel expands to the available width.

Daily traffic and server-trend plots use the actual NEXUS container width and height (255px chart region), with geometry shared by axes, cursors and markers. Resize performs a layout update without resetting analysis selection. Dense phone heatmap, page-bubble and journey diagrams instead pan horizontally inside their own containers: minimum SVG widths are (700px), (720px) and (720px), with a visible localized pan hint. Chart selection controls and table alternatives stay outside the pan region.

**The Readable Geometry Rule.** Simple NEXUS plots use measured container geometry; dense phone diagrams keep readable internal dimensions and pan within their own viewport.

The final evidence set is `.impeccable/review/desktop.png`, `mobile.png`, `tablet.png`, `tablet-landscape.png`, `narrow.png`, the corresponding `-viewport.png` files and `desktop-empty*.png`. The initial finish review and its scored correction verdict remain separate records.


### Hausdepp layout

Owner UI/UX acceptance is explicitly pending. These records describe the current
development implementation and technical checks, not an approved final design.
Lobby cards expose actual human/computer seats, state and the relevant join,
resume, watch or history action. The waiting room names occupied and open seats
and offers a copyable account-protected link. `/hausdepp/konto` is a dedicated
private overview with factual round counts, paginated personal outcomes and a
link to common profile/sign-in settings. Its achievement area explains the
agreed ironic progression while conditions and scores remain undecided. The
rulebook uses a quick start, section links and six concrete timing/play examples.
Evidence for this increment lives in
`.impeccable/review/hausdepp-product-validation.md`.

The Hausdepp shell is centered within (1380px), with normal insets of (42px 28px 18px). The lobby pairs the welcome/card arrangement with an ivory create form, then lists tables and the shared chat. At (700px) and below it becomes one column, uses (16px) side padding, and wraps the header navigation below the brand and suite tools. During phone play the extra header navigation hides; rules remain reachable beside the social controls.

The live table places opponents above and, for four or five opponents on desktop, around the central stock and face-up pile. The player’s hand sits in a compact, overlapping natural fan below its count. Its sort runs from low ranks on the left to 10 on the right; the fan follows a shallow arc rather than making a row of separate tiles. Cards retain the source viewport ratio (36:57). The fan aligns cards to its start edge (`align-items: flex-start`); its extra (24px) minimum-height clearance accommodates rotation and never stretches the card height. Base hand cards are (126px) wide with a (66px) step; phone cards use (112px/55px), and narrow-phone cards (100px/48px). Horizontal overflow keeps a large hand reachable. Keyboard focus reveals the rotated card inside the hand viewport with an (8px) inset, subject to the browser’s scroll bounds. This correction starts only for `:focus-visible`, runs on the next animation frame after native focus scrolling, and adjusts horizontal scroll only if the same card still holds focus. The original card artwork stays unobscured by invented rank badges.

Every opponent has one face-down card per public hand count, from zero to the complete (36-card) deck. Overlap compresses the fan without replacing cards with a decorative three-card symbol. Base backs are (34px) wide, with a (12px) step capped at (60px) total spread. The circular (22px) turn/debt avatar overlays the fan; name and count stay below it. Phones use (24px/8px), capped at (30px), while a single opponent keeps a larger (34px) fan and (70px) maximum spread. Low landscape uses (22px/7px), capped at (28px); a single opponent instead has a (36px) fan beside their name/count in a two-column seat. Opponent fans contain only backs and public metadata, never hidden card identifiers or faces.

At (1100px) and above, a (270px) social rail sits beside the table with a (32px) gap and an in-flow chat. Below that threshold, chat opens as a bottom sheet above a backdrop and respects the bottom safe area. At (359px) and below, card sizes and social spacing compact further. Low landscape, up to (600px) viewport height, uses two table columns: opponents and turn copy on the left, stock/pile and event copy on the right, with the hand and actions along the lower edge. The first three grid rows are (27px/86px/26px). Opponents occupy the second row; the stock/pile spans rows two and three with a (136px) region. Event copy sits in the fourth right-hand row with (35px) top spacing; action guidance sits in the fifth right-hand row with (8px 0 48px) padding, leaving room for social controls. Hand cards use (79px) with a (44px) step, and central cards use (58px). Tablet landscape at (701–1099px) wide and (601–850px) high keeps a stacked table with compact (136px/177px) opponent/centre rows, (85px) central cards with (10px) stack gaps, and (112px) hand cards with the inherited (66px) step and (18px 10px) vertical padding. Keep these source-owned orientation overrides together.

## Elevation & Depth

NEXUS is flat and layered by tone and rules. Panels and the globe stage explicitly remove box shadows. The theme hides the incumbent scan/grid pseudo-elements, radar, decorative panel symbols and metric sparks rather than turning them into a new visual motif. Chart filters that add glows are removed for the selected NEXUS instruments. This does not prohibit or rewrite effects owned by Mission Control or LCARS.

**The Ruled Bay Rule.** Separate NEXUS instruments with tonal surfaces and fine borders; panel and geography-stage shadows are explicitly removed.

State motion is brief: the star changes color, background and border over (180ms ease-out); panels retain the shared border transition (250ms). The explicit animation pause and system reduced-motion preference preserve stable information. Reduced motion removes NEXUS transitions and smooth scrolling; the shared dashboard also suppresses chart/metric entrance animation and gauge transitions.


### Hausdepp material and motion

Walnut is the shipped Zilch table raster under a dark veil, not a procedural substitute. Paper forms and chat surfaces lift above it; actual cards carry short physical shadows, while turn and keyboard-focus cues use brass outlines. The create form uses (`0 14px 40px #120b0766`); a card uses (`0 5px 12px #180d0870`); the mobile chat sheet uses (`0 -10px 30px #150d0870`). The face-down stock adds offset paper edges to suggest a finite stack. Asset origin, license and generation prompt remain in `docs/HAUSDEPP_ASSETS.md`; the back is generated from the owner’s reference and is not represented as an original scan.

The fan settles over (130ms) with `cubic-bezier(.16,1,.3,1)`. Hover or keyboard focus raises a playable card by (12px); a card already sent or queued rises (18px) and fades while awaiting acceptance. These are action acknowledgements, with no selection stage.

Card transfers use the same easing and measured origins and destinations. The old hand or pile is measured before rendering the accepted state; receiving hands and the stock’s current visible position are measured after it. This lets refill and deal cards start at the stock, pickup cards start at the old pile, and played cards start at their removed hand position. Receiving cards visually appear with their arrival while remaining immediately interactive. Initial dealing, successful peek receipt, refilling, pickup, play, afterthrow, taking a chance and burning have explicit paths. A failed chance first travels stock → pile, then pile → receiving hand. Flights take (300–400ms) with group-specific bounded stagger; even the two-stage pickup completes within (900ms). They are pointer-inert and screen-reader-hidden, and add no gameplay lock. Private transfers show card backs; only permitted own or public cards may show faces.

Motion runs only for the next consecutive accepted game version. First load, reload, reconnect, duplicate/UI-only renders, skipped versions and hidden-document renders establish a quiet baseline rather than replaying past actions. Socket close resets the baseline after its disconnected render and cancels its flights. Own cards retain their card-keyed DOM nodes; opponent seats and public back positions also retain their nodes, so ACKs and UI-only updates preserve visual arrival. Reduced motion replaces travel with a stationary (240ms) destination-outline receipt. The first refill obligation retains its soft red (1.6s) border pulse; other debtors retain a static red avatar outline. Reduced motion removes transitions and keeps draw frames static. Labels and legal-action state remain understandable without animation.

## Shapes

Fine one-pixel rules and restrained corners define the instrument bays. Native controls and stars use (6px) corners, instrument panels and the enclosing KPI deck (12px), the globe stage (8px), and compact country tags (4px). Individual KPI cells have square corners inside their enclosing deck; favored metrics receive their own rounded outline. A country-code tag and selected geographic row are existing dashboard patterns, not a new all-purpose badge system. LCARS retains its distinct pill and elbow geometry in its own theme.


### Hausdepp forms and cards

Hausdepp uses lightly rounded paper, not the dashboard’s instrument geometry: fields have (6px) corners, card faces and opponent backs proportional (6.7% / 4.2%) corners, piles and the stock (7px), ordinary controls (8px), paper sections (12px), the create form (14px), and the mobile sheet (16px) top corners. Player initials sit in circular avatars. Fine brown paper-edge borders distinguish editable fields; an empty pile or exhausted stock uses a dashed boundary.

All (36) card faces use measured photographic paper corners and an averaged affine frame in a native (360×570) SVG. An (8-source-pixel) inset excludes photographed cuts and shadows; a rounded inner paper clip, ivory ground and fine warm edge give the cards one clean silhouette. The image is not split into triangles. Thirty-five faces retain the supplied Tell photograph; leaf 10 uses the licensed higher-resolution, nonglare leaf/tree photograph recorded in `docs/HAUSDEPP_ASSETS.md`. Original raster pixels remain unchanged. Read-only paper-margin measurements supply bounded per-channel gains (0.90–1.34) toward the shared ivory `#f7f4eb`. This is deliberate exposure and white-point grading in sRGB, with no offsets or invented illustration; the SVG filter is confined to the clipped (360×570) card frame. Preserve the real motif, fine ink and quiet paper edge instead of stretching a rectangular crop or redrawing the artwork.

## Components

### Buttons and fields

The primary refresh button uses lime with dark text, horizontal padding (15px) and a (44px) minimum height. Secondary controls use the dark control surface, a fine border and plain UI labels. Hover raises the control surface and changes its boundary and foreground; disabled controls reduce opacity. Native selects keep their platform interaction, (44px) height and visible labels. NEXUS focus uses a (2px) lime outline with (4px) offset; focus inside the lime live-session instrument uses a dark outline with an inset (−4px) offset so its star remains visible within the clipped card.

### Navigation

Section navigation uses inline SVG instrument icons and plain links. It changes from a fixed desktop rail to horizontal tablet links and a wrapping phone grid. At tablet/phone sizes the icons hide while link text remains. The first favorites link receives the selected-surface treatment; it does not claim to be a scroll-position tracker. The design switcher offers Mission Control, LCARS and NEXUS; invalid or absent local preference resolves to Mission Control.

### Instrument deck and panels

The KPI deck uses ruled cells with unit/scope hints and comparison text. The live-session cell has the lime surface; its label, measurement and star all switch to dark foregrounds. Analysis panels keep heading, selection controls, readable chart, explanatory readout and table access together. Missing values remain dashes and unavailable measurements stay explicit. Empty, stale, refresh-error and revoked-access states retain their existing behavior.

### Favorites

The outlined star becomes filled on selection, and the original element moves into the top favorites bay with its IDs, controls, selection and event bindings intact. Unpin restores the anchored source location. Visible count and status copy report the result; an empty bay explains the next action.

**The Real Instrument Rule.** Favoriting moves the original live instrument and its IDs into the top bay; it never creates a second chart or a static summary.

**The Visible Focus Rule.** An explicit pin or unpin keeps focus on the moved star and reveals it; background refresh restores focus without moving the viewer’s scroll position.

The saved list uses the browser key `rollthedice:dashboard:favorites:<verified numeric viewer id>`. It is local browser preference, not server synchronization. Storage failure falls back to the current open page and is explained visibly. Changing away from NEXUS restores original nodes to their source positions; returning restores that viewer’s selected instruments. Main section fragments continue to reach their primary panel even when it is in the favorites bay. Explicit pin/unpin reveals the focused star with nearest-edge scrolling, using instant behavior when paused or reduced motion is active.

### Geographic instrument

The actual data-driven globe/map, country list, selected-country readout and view controls remain one instrument. Lime identifies the selected state, blue distinguishes a comparative value, and approximation notes explain the precision of measured origins. The stage and summary reflow according to the observed layout thresholds rather than becoming a separate mobile product.


### Hausdepp controls and state

The oxblood primary action has warm-white text, (13px 20px) padding and a (46px) minimum height. Neutral paper controls use dark ink. Visible keyboard focus, including on hand cards, is a (3px) brass outline with a (4px) offset against walnut. Fields and links on ivory use oxblood. Disabled general controls reduce opacity; unavailable hand cards retain their shape and instead darken through brightness.

Navigation remains plain labelled links with a brass underlined current page. Native language and player-count selects retain platform interaction. The account and game switcher remain part of the shared suite. Inputs are light paper with a paper-edge border and a visible caret/focus state. The create form bounds computers to fewer than the selected total seats.

The suite picker now owns the shared `[data-game-switch]` disclosure. Its trigger
shows the current game's authored SVG icon, full name and chevron, including on
phones. All permitted games appear as named native links with descriptions and
an explicit current marker; two-game audiences use the same chooser as the
founder's three-game audience. Desktop uses a 360px anchored panel and phones
up to 600px use a bottom sheet with inert background and contained focus. Close,
Escape, outside dismissal and arrow/Home/End navigation are supported. Existing
dice-table leave flows remain in place. PWA destinations and worker ownership
follow `docs/GAME_SWITCHER.md`. Technical checks live in
`.impeccable/review/suite-picker-validation.md`; owner UI/UX acceptance is pending.

**The Hausdepp Card Truth Rule.** Use the licensed 36-card Tell-pattern artwork with its measured paper frames, shared ivory grading and original motifs; preserve the order 6, 7, 8, 9, Unter, Ober, König, Ass, 10, with 10 highest. Source ownership and the leaf-10 exception remain recorded in `docs/HAUSDEPP_ASSETS.md`.

Each hand card is a button with its translated suit and rank as an accessible name; the artwork itself stays purely visual. Availability follows the server projection, with unavailable cards darkened and disabled. There is no selected-card state, `aria-pressed`, added rank badge or confirmation button. The illustrated Schellen six remains an ordinary six despite its printed WELI markings.

**The Hausdepp Public Hand Rule.** Render exactly the opponent’s projected public count as backs. The visual fan is `aria-hidden`; the seat’s translated accessible label, visible name and visible count convey the public information once. Turn and refill-debt cues stay on the avatar above the fan. Hidden opponent faces and card identifiers never enter this markup or private transfer ghosts.

**The Hausdepp Transfer Rule.** Every new accepted transfer explains where cards leave and where they arrive, using the measured source before removal and destination after rendering. Keep the transfer nonblocking, bounded and private; reduced motion acknowledges the same receiving destination without travel.

**The Hausdepp Direct Play Rule.** A tap or keyboard activation immediately sends one legal hand card as play or afterthrow. Quick taps on further cards of the same rank join a queue; each is sent only after the previous command is acknowledged and its accepted snapshot is present, then checked against the current legal actions.

Before dealing, the player immediately before the dealer must inspect the bottom card by tapping the face-down stock. Each tap inspects exactly one card. A 10 succeeds immediately and must be taken. An ace requires another tap and extends the private chain; a following 10 ends the peek, transfers all inspected aces plus that 10 and briefly exposes them to everyone. Any other rank ends inspection without taking cards or exposing the private chain. The viewer’s disclosure opens when new known cards arrive, stays available for the next mandatory tap during peeking, and collapses after (4.5s) outside that phase. Public piles show only their visible cards.

**The Hausdepp Pile Action Rule.** After a play leaves a hand below three while stock remains, refilling becomes a FIFO stock obligation. Only the first debtor may tap the face-down stock to draw all missing cards up to three or the remaining stock. Outstanding debts lock only stock access: others cannot draw or take a chance, but legal hand play and pickup can continue. The face-up pile is the pickup control.

The next player may play from their hand before the previous player refills. A player who clears the pile may lead again from their remaining hand before their own refill. A delayed refill never rewinds the current turn or restores an expired afterthrow opportunity. The next player’s first accepted play, pickup or chance closes that opportunity; taking a chance is offered only when the refill queue is empty. Refilling remains an explicit player tap, and an exhausted stock cannot draw.

The first debtor sees a soft red stock frame with “Du musst ziehen” / “You must draw”; other viewers see “Warte auf {name}” / “Waiting for {name}” while stock is reserved. Opponent avatar outlines distinguish outstanding debts, with the first debtor pulsing softly. The frame is static under reduced motion. Stock captions and the turn sentence explain the available action. A face-up pile can be taken only when pickup is legal and never acts as an empty-pile pass. Commands are serialized; while one card command is pending, further same-rank taps may queue and other gameplay controls wait. Pause or lost connection disables gameplay controls, with status and error text retaining the reason. The completed table names the last player and offers a new round; this first increment does not display an invented points system.

The shared chat and labelled emoji reactions keep their established behavior. Desktop chat uses the rail; smaller screens use the closeable sheet. Rulebook and result surfaces reuse the same paper, headings and primary action.

## Do's and Don'ts

### Do:
- Do scope every NEXUS override to the dashboard theme and preserve the two incumbent theme owners.
- Do use inline SVG for the reusable instrument and star icons.
- Do retain German and English labels, native selects, visible keyboard focus and chart table alternatives.
- Do keep favorites local to the verified viewer and show the browser-storage limitation.
- Do preserve independent chart selection, measurement definitions, loading, empty, stale and access-loss states.

### Don't:
- Don't promote this dashboard’s palette, rail or component composition into a global game design system.
- Don't replace or renumber live instrument IDs when moving favorites.
- Don't shrink a dense fixed-width SVG until its labels become unreadable on a phone.
- Don't invent zeroes, unique-player totals, conversion claims or source coverage from missing telemetry.
- Don't make motion necessary for understanding a selected state or reaching a focused control.

Not canonized: inherited glyph-based decoration and incumbent eyebrow/scan treatments are not reusable NEXUS patterns. Existing theme ownership is preserved; no unrelated legacy cleanup or drift repair is implied by this record.

### Hausdepp Do:

- Do keep the Hausdepp walnut, ivory, oxblood and brass world scoped to its own pages.
- Do preserve German and English copy, labelled controls, visible focus and the real card names.
- Do keep the compact hand fan sorted from low left to 10 right, readable and horizontally reachable when many cards are held.
- Do show one back per public opponent card, including zero, without changing the own hand’s fan.
- Do preserve the measured rounded paper frame, original Tell motifs and explicit source credits when adjusting card rendering.
- Do show the actual source and receiving destination for every accepted card transfer, with a stationary reduced-motion receipt.
- Do use the server-projected legal actions and acknowledged command queue for card, stock and face-up-pile availability.
- Do retain the raster provenance and attribution recorded in docs/HAUSDEPP_ASSETS.md.

### Hausdepp Don't:

- Don't replace the Tell-pattern artwork with invented suit icons or a generic 32-card deck.
- Don't expose opponent card faces or identifiers, replace their count with a fixed decorative fan, or animate missed history after reconnecting.
- Don't ship crude rectangular photographic cuts, stretch card proportions or alter the source rasters to manufacture artwork.
- Don't use Hausdepp Sign for paragraphs, action labels, player names or card counts.
- Don't refill automatically, draw only one refill card per tap, or let a later debtor bypass the FIFO stock reservation.
- Don't add a hand-selection or confirmation step, overlay rank badges, or offer taking a chance while any refill debt remains.
- Don't block legal hand play with another player’s refill debt or let a delayed refill rewind the turn or afterthrow window.
- Don't invent points or achievement conditions beyond the approved 100-entry
  catalogue and 24-rank ladder. Keep experience separate from the round outcome.

### Hausdepp account progress increment

The approved achievement catalogue lives in `docs/HAUSDEPP_ACHIEVEMENTS.md`.
The private account combines a readable current-rank and experience summary,
the next threshold, a collapsible full ladder, and a searchable, filterable
collection. Locked entries explain their real conditions and recorded progress.
Rank notices combine new awards and skipped levels, preserve acknowledgement
across reloads and use original bilingual jokes rather than attributed quotes.
Keep the existing walnut, ivory, oxblood and brass palette, keyboard access,
44px controls and reduced motion. Technical evidence is recorded in
`.impeccable/review/hausdepp-achievements-validation.md`; owner UI/UX acceptance
remains open. No new raster assets or typography worlds are introduced.
