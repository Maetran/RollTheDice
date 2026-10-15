---
version: 1
slug: "app-static-dashboard-html"
primary_target: "app/static/dashboard.html"
related_targets: ["frontend/dashboard.js","frontend/styles/dashboard-nexus.css"]
---

# Mission Control / NEXUS

Mode: Operate. Scope: the new `nexus` option on `/admin/dashboard`; existing
Mission Control and LCARS remain intact. The user delegated art direction and
selected direct implementation in code.

## Direction contract

THESIS: A modular field engineering console for two live dice games. A viewer
first sees the monitoring scope, their starred instruments and the measured
activity, then investigates the real telemetry.

OWN-WORLD: Ink-black and mineral-green instrument surfaces, acid-lime selection,
ice-blue comparative data, warm amber cautions. Heavy Bricolage headings, plain
UI labels, tabular data, restrained squared controls and ruled instrument bays.
The physical scene is an operator checking a persistent monitor in a dim room.

STORY: Confirm the source and period, inspect the six factual KPIs, star the
instruments that matter and continue through geography, traffic, games, design
usage and the machine room. Never imply visits equal people.

FIRST VIEWPORT: Desktop has a fixed navigation rail and a wide operational
header, compact live readouts, filter bar, reserved favorites bay and a ruled
six-instrument KPI deck. Tablet uses horizontal navigation and three columns;
phone has wrapping navigation, stacked tools and two KPI columns. The signature
interaction is the star: the original live instrument relocates into the top
bay with its controls intact. Focus follows that instrument. A short border
and surface transition acknowledges selection; reduced motion is instant.

FORM: Grounded candidate 7, modular field engineering workstation; seed
8eca2d08. Other grounded candidates: orbital telemetry, scorekeeping desk,
debug profiler, observatory spectrogram, traffic radar and avionics MFD.
The user delegated selection instead of requesting a concept decision round.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Calibration

Split-flap concourse: competitive on scanability, weaker on exploratory charts;
keep fixed label/value alignment. Botanical folio: declined on audience and
clarity; keep consistent comparative scales. Japanese dense web: competitive on
information access, weaker on touch clarity; keep density without tiny type.
Character catalog: declined on both axes; keep recognizability of each module.
Factory records: competitive on audience, weaker on labels; keep decisive
negative space around actual data. Ticket wallet: declined on both axes; keep
explicit scope and state on each instrument. No catalog costume is adopted.

No raster artwork is required: charts and globe are real data-driven media.
