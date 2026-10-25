import { escapeHtml } from './auth.js';

const text = value => escapeHtml(window.ZDWA_I18N?.t?.(value) || value);
const labels = { statistics: 'Statistik', achievements: 'Erfolge', settings: 'Einstellungen' };

// These are document links, not ARIA tabs: existing private routes and deep links
// keep their native navigation, history and authentication lifecycles.
export function accountNavigationMarkup({ statistics, achievements, settings, current }) {
  return `<nav class="account-navigation" data-account-navigation aria-label="${text('Kontobereiche')}">${Object.entries({ statistics, achievements, settings }).map(([key, href]) =>
    `<a href="${escapeHtml(href)}" data-account-destination="${key}"${key === current ? ' aria-current="page"' : ''}>${text(labels[key])}</a>`).join('')}</nav>`;
}

export function accountSectionMarkup(key, title, description, body, { id = key, open = false } = {}) {
  return `<details id="${escapeHtml(id)}" class="account-settings-group" data-account-section="${key}"${open ? ' open' : ''}><summary><h2 class="account-settings-group__heading"><span class="account-settings-group__title">${text(title)}</span><span class="account-settings-group__description">${text(description)}</span></h2></summary><div class="account-settings-group__body">${body}</div></details>`;
}

export function openAccountSettingTarget(root, hash = location.hash) {
  if (hash.length < 2) return;
  let id;
  try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
  const target = root.querySelector(`[id="${CSS.escape(id)}"]`);
  if (!target) return;
  let ancestor = target;
  while (ancestor && root.contains(ancestor)) {
    if (ancestor.matches('details')) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  target.scrollIntoView?.({ block: 'start' });
}
