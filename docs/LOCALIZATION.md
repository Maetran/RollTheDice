# Localization

ZDWA supports German (`de`) and English (`en`). German is the canonical source
language. The authored browser catalog lives in `frontend/i18n/catalog.js` and
is delivered to every user-facing page inside the generated `shell.js` bundle.

## Adding user-facing text

1. Write the German source text in the relevant HTML or JavaScript file.
2. Add a natural English translation to the `EN` catalog in
   `frontend/i18n/catalog.js`.
3. For text containing live values, add a narrowly scoped expression to
   `DYNAMIC`, or render the text through `window.ZDWA_I18N.t(...)`.
4. Verify both languages, including placeholders, tooltips, accessible labels,
   alerts, confirmations, and mobile layouts.
5. Extend the localization browser test whenever a new screen or interaction is
   introduced.
6. Run `npm run build:static` to regenerate and version the browser bundle.

Server-provided catalog values are user-facing text too. For example, every
achievement name and description in `app/achievements.py` must have an entry in
the browser catalog. `npm run lint` enforces this through the product delivery
check.

Do not create a separate English copy of a page. Keeping one DOM and one game
implementation prevents the languages from drifting apart.

## Zilch preview

The private Zilch views use the same catalog and language switcher as ZDWA.
Their authored German text lives in `frontend/zilch/` (and the small protected
shell in `app/static/zilch.html`), with the matching English text in `EN`.

Zilch gameplay payloads must remain semantic and server-owned: the browser uses
the server-provided scoring options to validate a direct dice selection locally;
only the server accepts the final selection. Events and machine-readable errors use stable keys such as
`zilch.option.*`, `zilch.event.*`, and `zilch.error.*`, plus parameters. The
matching templates live in `DE_MESSAGES` and `EN_MESSAGES`. The browser may
format those templates, but it must never reconstruct a scoring combination or
calculate its points. Protected rule facts are likewise localized in the
client presentation; the server remains authoritative for the ruleset and its
numeric values.

## Terminology

- ZDWA / Zock die Wand an: brand name, never translated.
- Ansage: announcement.
- Freireihe: free column.
- Kenter: retained game term, explained as five different die values.
- Full / F: Full House / FH in English.
- ZTO / ZTU: upper total (UT) / lower total (LT) in English.
- Poker: retained game term.
- Zockerregel: Zocker rule, followed by a descriptive explanation.

Guest language selection is stored in `localStorage` under `zdwa_language`.
For authenticated users, `users.preferred_language` is authoritative and is
synchronized across devices.
