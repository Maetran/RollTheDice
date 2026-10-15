---
name: RollTheDice — dashboard themes
description: Recorded dashboard themes with the additional, explicitly scoped NEXUS field engineering console.
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
rounded:
  nexus-tag: 4px
  nexus-small: 5px
  nexus-control: 6px
  nexus-stage: 8px
  nexus-panel: 12px
spacing:
  nexus-tight: 4px
  nexus-small: 8px
  nexus-control: 12px
  nexus-grid: 16px
  nexus-compact-panel: 20px
  nexus-panel: 24px
  nexus-section: 46px
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
---

# Design System: RollTheDice dashboard themes

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

## Elevation & Depth

NEXUS is flat and layered by tone and rules. Panels and the globe stage explicitly remove box shadows. The theme hides the incumbent scan/grid pseudo-elements, radar, decorative panel symbols and metric sparks rather than turning them into a new visual motif. Chart filters that add glows are removed for the selected NEXUS instruments. This does not prohibit or rewrite effects owned by Mission Control or LCARS.

**The Ruled Bay Rule.** Separate NEXUS instruments with tonal surfaces and fine borders; panel and geography-stage shadows are explicitly removed.

State motion is brief: the star changes color, background and border over (180ms ease-out); panels retain the shared border transition (250ms). The explicit animation pause and system reduced-motion preference preserve stable information. Reduced motion removes NEXUS transitions and smooth scrolling; the shared dashboard also suppresses chart/metric entrance animation and gauge transitions.

## Shapes

Fine one-pixel rules and restrained corners define the instrument bays. Native controls and stars use (6px) corners, instrument panels and the enclosing KPI deck (12px), the globe stage (8px), and compact country tags (4px). Individual KPI cells have square corners inside their enclosing deck; favored metrics receive their own rounded outline. A country-code tag and selected geographic row are existing dashboard patterns, not a new all-purpose badge system. LCARS retains its distinct pill and elbow geometry in its own theme.

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
