# Localization

ZDWA supports German (`de`) and English (`en`). German is the canonical source
language. The shared browser catalog lives in `app/static/i18n.js` and is loaded
by every user-facing page.

## Adding user-facing text

1. Write the German source text in the relevant HTML or JavaScript file.
2. Add a natural English translation to the `EN` catalog in `i18n.js`.
3. For text containing live values, add a narrowly scoped expression to
   `DYNAMIC`, or render the text through `window.ZDWA_I18N.t(...)`.
4. Verify both languages, including placeholders, tooltips, accessible labels,
   alerts, confirmations, and mobile layouts.
5. Extend the localization browser test whenever a new screen or interaction is
   introduced.

Do not create a separate English copy of a page. Keeping one DOM and one game
implementation prevents the languages from drifting apart.

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
