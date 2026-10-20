const ENTRY_KEY = 'rollthedice:pwa-entry:v1';
const WINDOW_ENTRY_PREFIX = `${ENTRY_KEY}:`;
const products = {
  zdwa: { prefix: '', name: 'ZDWA', apple: '/static/icons/apple-touch-icon-180.png', icon: '/static/favicon.png' },
  zilch: { prefix: 'zilch-', name: 'Zilch', apple: '/static/icons/zilch-apple-touch-icon-180.png', icon: '/static/icons/zilch-icon-32.png' },
  hausdepp: { prefix: 'hausdepp-', name: 'Hausdepp', apple: '/static/icons/hausdepp-apple-touch-icon-180-v2.png', icon: '/static/icons/hausdepp-icon-32.png' },
  watten: { prefix: 'watten-', name: 'Watten', apple: '/static/watten/icons/watten-icon-180.png', icon: '/static/watten/icons/watten-icon-32.png' },
};

export function localPwaHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function wattenInstalledEntry({ standalone, saved, launched, workerPath }) {
  if (!standalone) return null;
  if (launched === 'watten') return 'watten';
  if (Object.hasOwn(products, saved)) return saved;
  if (workerPath === '/hausdepp-sw.js') return 'hausdepp';
  if (workerPath === '/zilch-sw.js') return 'zilch';
  if (workerPath === '/sw.js') return 'zdwa';
  return 'watten';
}

function metadata(product) {
  const details = products[product];
  const language = window.ZDWA_I18N?.getLanguage?.() === 'en' ? 'en' : 'de';
  const previous = document.querySelector('link[rel=manifest]');
  const version = previous ? new URL(previous.href).search : '';
  const link = previous || document.head.appendChild(document.createElement('link'));
  link.rel = 'manifest';
  link.href = `/${details.prefix}manifest${language === 'en' ? '-en' : ''}.webmanifest${version}`;
  link.dataset.pwaProduct = product;
  if (['hausdepp', 'watten'].includes(product)) link.crossOrigin = 'use-credentials';
  else link.removeAttribute('crossorigin');
  for (const [rel, href] of [['icon', details.icon], ['apple-touch-icon', details.apple]]) {
    const icon = document.querySelector(`link[rel="${rel}"]`) || document.head.appendChild(document.createElement('link'));
    icon.rel = rel;
    icon.type = 'image/png';
    icon.href = href + version;
    if (rel === 'apple-touch-icon') icon.sizes = '180x180';
  }
  const title = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (title) title.content = details.name;
}

/** Keep the installed product owner while Watten adds its own network-only worker. */
export function initializeWattenPwa({ registerWorker = true, installControls = true } = {}) {
  const publicBeta = document.documentElement.dataset.wattenPublicBeta === 'true';
  if (!publicBeta && (document.documentElement.dataset.wattenPwaPreview !== 'true' || !localPwaHostname(location.hostname))) return;
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  let saved = null;
  try { saved = sessionStorage.getItem(ENTRY_KEY); } catch (_) {
    // This product-only marker survives same-origin navigation when storage is
    // disabled, including the narrow worker claiming a parent-installed view.
    if (window.name.startsWith(WINDOW_ENTRY_PREFIX)) saved = window.name.slice(WINDOW_ENTRY_PREFIX.length);
  }
  let workerPath = '';
  try { workerPath = new URL(navigator.serviceWorker?.controller?.scriptURL || '', location.href).pathname; } catch (_) {}
  const entry = wattenInstalledEntry({ standalone, saved, launched: new URL(location.href).searchParams.get('pwa'), workerPath });
  if (entry) {
    try { sessionStorage.setItem(ENTRY_KEY, entry); } catch (_) {}
    window.name = WINDOW_ENTRY_PREFIX + entry;
  }
  metadata(entry || 'watten');
  // Recovery documents only retain metadata; they never register a worker.
  if (!registerWorker || !('serviceWorker' in navigator)) return;

  const t = value => window.ZDWA_I18N?.t?.(value) || value;
  let prompt = null;
  let waiting = null;
  let updateRequested = false;
  let install;
  let update;
  let aside;
  const syncControls = () => { if (aside) aside.hidden = Boolean(install?.hidden && update?.hidden); };
  if (installControls) {
    aside = document.createElement('aside');
    aside.hidden = true;
    aside.className = 'watten-install';
    aside.dataset.wattenInstall = '';
    install = document.createElement('button');
    install.type = 'button';
    install.textContent = t('Watten installieren');
    install.hidden = true;
    install.addEventListener('click', async () => {
      const current = prompt;
      prompt = null;
      install.hidden = true;
      syncControls();
      if (current) await current.prompt();
    });
    update = document.createElement('button');
    update.type = 'button';
    update.textContent = t('Watten aktualisieren');
    update.hidden = true;
    update.addEventListener('click', () => {
      updateRequested = true;
      waiting?.postMessage({ type: 'SKIP_WAITING' });
    });
    aside.append(install, update);
    document.body.append(aside);
    window.addEventListener('beforeinstallprompt', event => {
      if (standalone) return;
      event.preventDefault();
      prompt = event;
      install.hidden = false;
      syncControls();
    });
    window.addEventListener('appinstalled', () => { prompt = null; install.hidden = true; syncControls(); });
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested) return;
    updateRequested = false;
    location.reload();
  });
  const observeWaiting = registration => {
    waiting = registration.waiting;
    if (update) update.hidden = !waiting || !navigator.serviceWorker.controller;
    syncControls();
  };
  const ready = navigator.serviceWorker.register('/watten-sw.js', { scope: location.hostname === 'watten.zockdiewandan.online' ? '/' : '/watten', updateViaCache: 'none' }).then(registration => {
    observeWaiting(registration);
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', () => observeWaiting(registration));
    });
    return registration;
  }).catch(() => null);
  window.WATTEN_PWA = { ready, product: entry || 'watten' };
}
