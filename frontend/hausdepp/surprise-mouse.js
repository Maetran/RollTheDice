// Side view of the magical mouse that fetches the pocket watch. Faces right;
// both legs are separate groups so the caller can animate a little trot.
export function magicalMouseArt(id = "hd-mouse") {
  const leg = (name, x) => `<g class="${name}"><path d="M${x} 72c0 6-1 10 0 14" fill="none" stroke="#5e4f45" stroke-width="5.5" stroke-linecap="round"/>`
    + `<ellipse cx="${x + 2.5}" cy="88" rx="6" ry="2.6" fill="#e3a79e" stroke="#9c6b63" stroke-width=".6"/></g>`;
  return `<svg viewBox="0 0 120 100" aria-hidden="true" focusable="false"><defs>`
    + `<linearGradient id="${id}-fur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ab9888"/><stop offset=".6" stop-color="#8a786b"/><stop offset="1" stop-color="#65564c"/></linearGradient>`
    + `<linearGradient id="${id}-hat" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3b3540"/><stop offset=".45" stop-color="#1f1b22"/><stop offset="1" stop-color="#0f0d11"/></linearGradient>`
    + `<linearGradient id="${id}-brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset=".45" stop-color="#d9a83f"/><stop offset="1" stop-color="#8a5a1c"/></linearGradient></defs>`
    // Long tail curling up behind the mouse.
    + `<path d="M30 72c-12 4-23 0-23-10s11-12 9-22c-1-5-5-8-10-8" fill="none" stroke="#7a5e56" stroke-width="3.2" stroke-linecap="round"/>`
    + `<path d="M30 72c-12 4-23 0-23-10s11-12 9-22c-1-5-5-8-10-8" fill="none" stroke="#c99d93" stroke-width="1.8" stroke-linecap="round"/>`
    + leg("hd-mouse-leg-a", 42) + leg("hd-mouse-leg-b", 72)
    // Back ear, body with lighter belly, then head and front ear.
    + `<circle cx="70" cy="41" r="9" fill="#7d6c60"/><circle cx="70" cy="41" r="5.5" fill="#d69a92"/>`
    + `<path d="M26 66c0-15 14-24 32-24 16 0 27 9 27 21 0 10-8 16-20 16H35c-6 0-9-5-9-13z" fill="url(#${id}-fur)" stroke="#4a3c33" stroke-width="1.2"/>`
    + `<path d="M36 76c8 2 20 2 30 0" fill="none" stroke="#d8c7b4" stroke-width="3" stroke-linecap="round" opacity=".7"/>`
    + `<path d="M76 48c7-6 19-5 25 3l6 8c1 2 0 4-2 4H90c-10 0-17-5-14-15z" fill="url(#${id}-fur)" stroke="#4a3c33" stroke-width="1.2" stroke-linejoin="round"/>`
    + `<circle cx="79" cy="40" r="11" fill="url(#${id}-fur)" stroke="#4a3c33" stroke-width="1.2"/><circle cx="79.5" cy="40.5" r="7" fill="#e9b2a8"/>`
    + `<circle cx="94.5" cy="54" r="2.4" fill="#1d1612"/><circle cx="95.3" cy="53.2" r=".8" fill="#fff"/>`
    + `<ellipse cx="97" cy="60" rx="3" ry="1.8" fill="#e58d8f" opacity=".35"/><circle cx="107" cy="61.5" r="2.3" fill="#e58d8f" stroke="#9c5a5c" stroke-width=".5"/>`
    + `<path d="M103 62.5l14-5M103 63.5h15M103 64.5l13 5" stroke="#efe4d6" stroke-width=".8" stroke-linecap="round" opacity=".85"/>`
    // Dark top hat with a brass band, tipped jauntily forward, and two sparks.
    + `<g transform="rotate(12 91 37)"><path d="M84 36.5 85.5 16h11L98 36.5z" fill="url(#${id}-hat)" stroke="#0b090c" stroke-width=".8"/>`
    + `<path d="M84.5 30h13l.3 3.6h-13.6z" fill="url(#${id}-brass)" stroke="#5a3a12" stroke-width=".5"/>`
    + `<ellipse cx="91" cy="16" rx="5.5" ry="1.3" fill="#3a343d"/><path d="M87.5 19v9" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity=".18"/>`
    + `<ellipse cx="91" cy="37" rx="12.5" ry="2.8" fill="#2a252c" stroke="#0b090c" stroke-width=".8"/></g>`
    + `<g fill="#f0cf7a"><path d="M106 18l1.2 3.3 3.3 1.2-3.3 1.2-1.2 3.3-1.2-3.3-3.3-1.2 3.3-1.2z"/><path d="M113 30l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" opacity=".8"/></g>`
    + `</svg>`;
}
