// Static account/feed artwork only. No table player, effects or browser state.
const effects = ["star", "hammer", "ufo", "portal", "dragon", "kraken", "clock", "blackhole"];
const art = {
  star: '<path d="m12 2 2.8 6.8L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-3.2Z"/><path d="m5 3 .8 2M20 3l-.8 2M3 20l2-.8"/>',
  hammer: '<path d="M4 3h15v8H4zM9 11v11h5V11M7 4v6m9-6v6M10 6l3 2-3 1"/>',
  ufo: '<ellipse cx="12" cy="14" rx="10" ry="3"/><path d="M6 12c0-10 12-10 12 0M12 3V1M6 19l-2 3m8-3v3m6-3 2 3"/><path d="M6 14h.1M12 15h.1M18 14h.1" stroke-width="2.6"/>',
  portal: '<circle cx="12" cy="12" r="10"/><path d="M12 12c-1-4 5-6 7-2s-2 10-8 9S2 12 6 7s13-4 15 3M12 12c1 3-3 4-5 2"/>',
  dragon: '<path d="M3 21c7 2 14-2 11-8s2-10 7-8l-2 3h-4M16 5l-1-4 4 3M13 13 5 3l1 8-4 1 10 4M14 12l6-3-1 6-5 2"/><path d="M18 5h.1" stroke-width="2.5"/>',
  kraken: '<path d="M5 13c0-15 14-15 14 0 0 6-14 6-14 0ZM5 14c-7 2-1 10 2 5m2-2c-4 7 2 8 3 3m3-3c4 7-2 8-3 3m7-6c7 2 1 10-2 5"/><circle cx="9" cy="11" r="1.7"/><circle cx="15" cy="11" r="1.7"/>',
  clock: '<circle cx="12" cy="14" r="8"/><path d="M9 5V3a3 3 0 0 1 6 0v2M12 9v5l4 2M6 8 4 6m14 2 2-2"/>',
  blackhole: '<ellipse cx="12" cy="12" rx="11" ry="4" transform="rotate(-30 12 12)"/><circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M3 5h2m15 14h2M5 20v2m15-20v2"/>',
};

function collectionArt(count) {
  const dots = Array.from({ length: 8 }, (_, index) => {
    const angle = index * Math.PI / 4;
    return `<circle cx="${(12 + Math.sin(angle) * 9).toFixed(2)}" cy="${(12 - Math.cos(angle) * 9).toFixed(2)}" r="1.5"${index < count ? ' fill="currentColor"' : ' opacity=".3"'}/>`;
  }).join("");
  const numeral = count === 4 ? 'M13 7v10M10 7l-3 6h9' : 'M12 7c-5 0-5 5 0 5s5-5 0-5Zm0 5c-6 0-6 6 0 6s6-6 0-6Z';
  return `${dots}<path d="${numeral}"/>`;
}

export function surpriseAchievementBadge(id) {
  const match = /^hausdepp_(\d{3})$/.exec(String(id));
  const number = match ? Number(match[1]) : 0;
  if (number < 116 || number > 135) return "";
  const witnessed = number >= 126, index = number - (witnessed ? 126 : 116);
  const effect = effects[index] || (index === 8 ? "four" : "all");
  const accent = witnessed
    ? '<path d="M19 25q5-6 10 0-5 6-10 0Z"/><circle cx="24" cy="25" r="1.6" fill="currentColor"/>'
    : '<path d="M21 28v-5a1 1 0 0 1 2 0v2-5a1 1 0 0 1 2 0v5l1-2q2 0 1 2l-1 4h-5l-2-3q-1-2 1-2l1 2"/>';
  return `<svg class="hd-surprise-badge" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-surprise-badge="${effect}" data-surprise-track="${witnessed ? "witnessed" : "activated"}"><g transform="translate(2 2)">${art[effect] || collectionArt(index === 8 ? 4 : 8)}</g><circle class="hd-badge-track-disc" cx="24" cy="25" r="6.2" stroke-width="1"/>${accent}</svg>`;
}
