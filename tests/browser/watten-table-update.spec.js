const { test, expect } = require('@playwright/test');
const { player, create } = require('./helpers/watten-journey.cjs');

const VIEWPORTS = [{ width: 440, height: 956 }, { width: 568, height: 320 }];

async function installWorkerProbe(page) {
  await page.addInitScript(() => {
    const events = new EventTarget();
    const registration = new EventTarget();
    const worker = new EventTarget();
    const probe = {
      boot: crypto.randomUUID(), registrations: [], messages: [], updateChecks: 0,
      offer() {
        registration.waiting = worker;
        registration.installing = worker;
        registration.dispatchEvent(new Event('updatefound'));
        worker.dispatchEvent(new Event('statechange'));
      },
      controllerChange() { events.dispatchEvent(new Event('controllerchange')); },
    };
    Object.assign(worker, {
      state: 'installed', scriptURL: new URL('/watten-sw.js?waiting-test', location.href).href,
      postMessage: message => probe.messages.push(structuredClone(message)),
    });
    Object.assign(registration, {
      scope: new URL('/watten', location.href).href, waiting: null, installing: null,
      update: async () => { probe.updateChecks += 1; },
    });
    Object.assign(events, {
      controller: { scriptURL: new URL('/watten-sw.js', location.href).href },
      ready: Promise.resolve(registration),
      register: async (path, options) => {
        probe.registrations.push({ path, options: structuredClone(options) });
        return registration;
      },
      getRegistration: async () => registration,
      getRegistrations: async () => [registration],
    });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: events });
    window.__wattenWorkerProbe = probe;
  });
  // The main suite keeps production rollout gates off. Exercise the public
  // table bootstrap locally with a worker double, retaining real accounts,
  // table creation, socket ownership and rendering throughout this journey.
  await page.route(/\/watten\/spiel\/[0-9a-f]{16}(?:\?.*)?$/, async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const html = await response.text();
    const body = html.includes('data-watten-public-beta="true"') ? html
      : html.replace(/<html\b/, '<html data-watten-public-beta="true"');
    await route.fulfill({ response, body });
  });
}

async function afterPaint(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

for (const language of ['de', 'en']) {
  test(`${language}: a waiting table update stays reachable in both mobile orientations and activates only on request`, async ({ browser, baseURL }, info) => {
    const players = [];
    try {
      const wrapped = { newContext: options => browser.newContext({ ...options,
        viewport: VIEWPORTS[0], serviceWorkers: 'block' }) };
      for (let seat = 0; seat < 2; seat++) players.push(await player(wrapped, baseURL, language));
      const host = players[0];
      await installWorkerProbe(host.page);
      const tablePath = await create(players, { count: 2, target: 11 });
      await host.page.evaluate(() => window.WATTEN_PWA.ready);
      await expect(host.page.locator('html')).toHaveAttribute('data-watten-active', 'true');
      const firstBoot = await host.page.evaluate(() => window.__wattenWorkerProbe.boot);
      expect(await host.page.evaluate(() => window.__wattenWorkerProbe.registrations)).toEqual([
        { path: '/watten-sw.js', options: { scope: '/watten', updateViaCache: 'none' } },
      ]);
      const notice = host.page.locator('[data-watten-install]');
      const update = host.page.locator('[data-watten-update]');
      await expect(update).toBeHidden();
      // Active table documents pass installControls=false. A browser install
      // event must not add an installation action alongside the update button.
      expect(await host.page.evaluate(() => {
        const event = new Event('beforeinstallprompt', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      })).toBe(false);
      await host.page.evaluate(() => window.__wattenWorkerProbe.offer());
      await expect(notice).toContainText(language === 'de' ? 'Eine neue Version ist verfügbar.' : 'A new version is available.');
      await expect(update).toHaveText(language === 'de' ? 'Watten aktualisieren' : 'Update Watten');
      await expect(notice.locator('button')).toHaveCount(1);
      for (const viewport of VIEWPORTS) {
        await host.page.setViewportSize(viewport);
        await afterPaint(host.page);
        await expect(update).toBeVisible();
        expect(await update.evaluate(button => {
          const rect = button.getBoundingClientRect();
          return { inside: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
            target: rect.width >= 44 && rect.height >= 44,
            reachable: button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
        })).toEqual({ inside: true, target: true, reachable: true });
        await host.page.screenshot({ path: info.outputPath(`table-update-${language}-${viewport.width}x${viewport.height}.png`) });
      }
      await host.page.evaluate(() => window.__wattenWorkerProbe.controllerChange());
      await afterPaint(host.page);
      expect(await host.page.evaluate(() => ({ boot: window.__wattenWorkerProbe.boot,
        messages: window.__wattenWorkerProbe.messages }))).toEqual({ boot: firstBoot, messages: [] });
      await expect(host.page).toHaveURL(new RegExp(`${tablePath}$`));
      await update.click();
      await update.click();
      expect(await host.page.evaluate(() => ({ boot: window.__wattenWorkerProbe.boot,
        messages: window.__wattenWorkerProbe.messages }))).toEqual({ boot: firstBoot, messages: [{ type: 'SKIP_WAITING' }] });
      // Only the requested worker's subsequent activation reloads the real
      // table. Repeated clicks above still posted a single activation message.
      const reloaded = host.page.waitForEvent('domcontentloaded');
      await host.page.evaluate(() => window.__wattenWorkerProbe.controllerChange());
      await reloaded;
      await expect(host.page.locator('html')).toHaveAttribute('data-watten-active', 'true');
      expect(await host.page.evaluate(() => window.__wattenWorkerProbe.boot)).not.toBe(firstBoot);
      await expect(host.page).toHaveURL(new RegExp(`${tablePath}$`));
      expect(host.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}
