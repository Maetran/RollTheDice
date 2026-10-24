const { test, expect } = require('@playwright/test');
const { player, create } = require('./helpers/watten-journey.cjs');

test.setTimeout(60_000);

// Only voice availability is synthetic. Seats, room snapshots and departure
// acknowledgements use the real server; no microphone/SFU session is started.
async function voiceAvailable(page) {
  const operations = [];
  const state = { event: 'state', available: true, room_id: 'waiting-header-test', members: [], publications: [] };
  await page.routeWebSocket(/\/ws\/[a-f0-9]{16}$/, route => {
    const server = route.connectToServer();
    server.onMessage(raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { /* Forward unrelated frames. */ }
      if (!message?.watten_voice) route.send(raw);
      if (message?.scoreboard) route.send(JSON.stringify({ watten_voice: state }));
    });
    route.onMessage(raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return server.send(raw); }
      if (message.action !== 'watten_voice') return server.send(raw);
      operations.push(message.operation);
      route.send(JSON.stringify({ watten_voice: { request_id: message.request_id, ok: true, state } }));
    });
    route.onClose(() => server.close());
    server.onClose((code, reason) => route.close({ code, reason }));
  });
  return operations;
}

const screens = [
  { width: 320, height: 568, language: 'de' },
  { width: 393, height: 852, language: 'en' },
  { width: 852, height: 393, language: 'en' },
  { width: 1280, height: 900, language: 'de' },
];

for (const screen of screens) {
  test(`${screen.language}: waiting room owns controls without a suite header at ${screen.width}x${screen.height}`, async ({ browser, baseURL }, info) => {
    const wrapped = { newContext: options => browser.newContext({ ...options,
      viewport: { width: screen.width, height: screen.height }, serviceWorkers: 'block' }) };
    const players = [await player(wrapped, baseURL, screen.language), await player(wrapped, baseURL, screen.language)];
    const [host, guest] = players;
    try {
      const operations = await voiceAvailable(host.page);
      await host.page.goto('/watten');
      await expect(host.page.locator('.suite-header')).toBeVisible();
      const path = await create([host], { count: 2, start: false });
      const room = host.page.locator('.wt-waiting');
      await expect(room).toBeVisible();
      await expect(host.page.locator('.suite-header')).toBeHidden();
      await expect(room.locator('[data-language-switcher]')).toHaveValue(screen.language);
      const voice = room.locator('.wt-voice-details');
      await expect(voice.locator('summary')).toBeVisible();
      await expect(host.page.locator('[data-watten-voice]')).toHaveCount(1);
      await expect.poll(() => host.page.evaluate(() => {
        const room = document.querySelector('.wt-waiting').getBoundingClientRect();
        const nodes = [...document.querySelectorAll('.wt-waiting-back:not([hidden]), .wt-waiting-rules, .wt-waiting-tools .wt-language select, .wt-waiting-tools .wt-voice-details > summary, .wt-waiting-tools #wattenSound')];
        return nodes.every(node => {
          const rect = node.getBoundingClientRect();
          return rect.width >= 44 && rect.height >= 44 && rect.left >= room.left && rect.right <= room.right
            && node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }) && document.documentElement.scrollWidth <= innerWidth;
      }), { message: 'all local controls fit inside the waiting room and have clear touch targets' }).toBe(true);
      await host.page.screenshot({ path: info.outputPath(`waiting-${screen.width}x${screen.height}.png`) });
      await voice.locator('summary').click();
      await expect(voice.locator('.wt-voice-panel')).toBeVisible();
      const panel = await voice.locator('.wt-voice-panel').boundingBox();
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(screen.width);
      expect(panel.y).toBeGreaterThanOrEqual(0);
      expect(panel.y + panel.height).toBeLessThanOrEqual(screen.height);
      await host.page.screenshot({ path: info.outputPath(`waiting-voice-open-${screen.width}x${screen.height}.png`) });
      await host.page.evaluate(() => {
        window.waitingControls = { voice: document.querySelector('[data-watten-voice]'), language: document.querySelector('[data-language-switcher]') };
      });
      await voice.locator('summary').focus();

      await guest.page.goto(path);
      await expect(guest.page.locator('.wt-waiting')).toBeVisible();
      await expect(guest.page.locator('.suite-header')).toBeHidden();
      const rules = guest.page.locator('.wt-waiting-rules');
      await expect(rules).toHaveText(screen.language === 'en' ? 'Rules' : 'Regeln');
      await expect(rules).toHaveAttribute('href', `/watten/regeln${screen.language === 'en' ? '?lang=en' : ''}`);
      if (screen.width === 320) {
        await rules.click();
        await expect(guest.page.locator('.wt-rules')).toBeVisible();
        await expect(guest.page.locator('.suite-header')).toBeVisible();
        await guest.page.goto(path);
        await expect(guest.page.locator('.suite-header')).toBeHidden();
      }
      await guest.page.locator('[data-watten-join] button[type=submit]').click();
      await expect.poll(() => guest.traffic.snapshot?.viewer?.participant_id).toBeTruthy();
      await expect(room).toContainText(guest.user.username);
      await expect(voice).toHaveAttribute('open', '');
      await expect(voice.locator('summary')).toBeFocused();
      await guest.page.locator('[data-watten-command=take-seat][data-seat="1"]').click();
      await expect.poll(() => guest.traffic.snapshot?.viewer?.seat).toBe(1);
      await expect(host.page.locator('[data-watten-command=start]')).toBeEnabled();
      await host.page.locator('[data-watten-command=start]').click();
      await expect(host.page.locator('html')).toHaveAttribute('data-watten-active', 'true');
      await expect(host.page.locator('.suite-header')).toBeVisible();
      await expect(host.page.locator('.wt-waiting')).toHaveCount(0);
      expect(await host.page.evaluate(() => {
        const { voice, language } = window.waitingControls;
        return voice === document.querySelector('[data-watten-voice]') && voice.parentElement === document.querySelector('#wattenApp')
          && language === document.querySelector('[data-language-switcher]') && Boolean(language.closest('.suite-header'));
      })).toBe(true);
      expect(operations.some(operation => ['join', 'leave', 'publish'].includes(operation))).toBe(false);
      expect(host.traffic.errors).toEqual([]); expect(guest.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}

test('waiting-room back commits departure, restores the lobby header, and a missing table keeps navigation', async ({ browser, baseURL }) => {
  const players = [await player(browser, baseURL), await player(browser, baseURL)];
  try {
    const [host, guest] = players, path = await create(players, { start: false });
    const participant = guest.traffic.snapshot.viewer.participant_id;
    await guest.page.locator('.wt-waiting-tools [data-watten-command=waiting-back]').click();
    await expect(guest.page).toHaveURL(/\/watten$/);
    await expect(guest.page.locator('.suite-header')).toBeVisible();
    await expect.poll(() => host.traffic.snapshot.room.members.some(member => member.participant_id === participant)).toBe(false);
    expect(guest.traffic.commands.some(command => command.action === 'leave_waiting_game')).toBe(true);
    await expect(host.page.locator('.suite-header')).toBeHidden();
    const gameId = path.split('/').pop();
    await host.page.route(`**/api/games/${gameId}`, route => route.fulfill({ status: 404, json: { exists: false } }));
    await host.page.reload();
    await expect(host.page.locator('.wt-message')).toBeVisible();
    await expect(host.page.locator('.suite-header')).toBeVisible();
    await expect(host.page.locator('.wt-message a[href="/watten"]')).toBeVisible();
    expect(host.traffic.errors).toEqual([]); expect(guest.traffic.errors).toEqual([]);
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});

for (const screen of [{ width: 320, height: 568, language: 'de' }, { width: 393, height: 852, language: 'en' }]) {
  test(`${screen.language}: waiting voice status stays inside the open panel and survives keyboard closing at ${screen.width}px`, async ({ browser, baseURL }, info) => {
    const wrapped = { newContext: options => browser.newContext({ ...options, viewport: { width: screen.width, height: screen.height }, serviceWorkers: 'block' }) };
    const host = await player(wrapped, baseURL, screen.language);
    try {
      const operations = await voiceAvailable(host.page);
      await host.page.goto('/watten');
      await create([host], { count: 2, start: false });
      const details = host.page.locator('.wt-waiting .wt-voice-details');
      await expect(details.locator('summary')).toBeVisible();
      // A geometry fixture for the existing playback-blocked notice. No
      // microphone, SFU connection or external audio session is started.
      await host.page.evaluate(language => {
        const notice = document.querySelector('.wt-voice-notice');
        const label = document.createElement('span'), retry = document.createElement('button');
        label.textContent = language === 'de' ? 'Der Browser hält die Wiedergabe an. Tippe auf Erneut verbinden.' : 'The browser paused playback. Tap Reconnect.';
        retry.type = 'button'; retry.textContent = language === 'de' ? 'Erneut verbinden' : 'Reconnect';
        notice.replaceChildren(label, retry); notice.hidden = false;
        window.waitingVoiceStatus = { notice, retry };
      }, screen.language);
      await details.locator('summary').click();
      const notice = details.locator('.wt-voice-panel > .wt-voice-notice');
      await expect(notice).toBeVisible();
      await expect.poll(() => details.locator('.wt-voice-panel').evaluate(node => node.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
      const geometry = await notice.evaluate(node => {
        const box = node.getBoundingClientRect(), panel = node.closest('.wt-voice-panel').getBoundingClientRect();
        const button = node.querySelector('button'), target = button.getBoundingClientRect();
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom,
          panel: { x: panel.x, y: panel.y, right: panel.right, bottom: panel.bottom },
          panelStyle: { inline: node.closest('.wt-voice-panel').getAttribute('style'), maxHeight: getComputedStyle(node.closest('.wt-voice-panel')).maxHeight, minHeight: getComputedStyle(node.closest('.wt-voice-panel')).minHeight, boxSizing: getComputedStyle(node.closest('.wt-voice-panel')).boxSizing, viewportHeight: innerHeight },
          retryReachable: button.contains(document.elementFromPoint(target.x + target.width / 2, target.y + target.height / 2)),
          sameNode: node === window.waitingVoiceStatus.notice && button === window.waitingVoiceStatus.retry };
      });
      await info.attach('voice-status-geometry.json', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
      expect(geometry.x).toBeGreaterThanOrEqual(0); expect(geometry.y).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(screen.width); expect(geometry.bottom).toBeLessThanOrEqual(screen.height);
      expect(geometry.panel.y).toBeGreaterThanOrEqual(0); expect(geometry.panel.bottom).toBeLessThanOrEqual(screen.height);
      expect(geometry.retryReachable).toBe(true); expect(geometry.sameNode).toBe(true);
      await host.page.screenshot({ path: info.outputPath(`voice-status-open-${screen.width}.png`) });
      await host.page.setViewportSize({ width: 568, height: 320 });
      await expect.poll(() => notice.evaluate(node => {
        const panel = node.closest('.wt-voice-panel').getBoundingClientRect(), button = node.querySelector('button'), box = button.getBoundingClientRect();
        return panel.top >= 0 && panel.bottom <= innerHeight && box.bottom <= innerHeight
          && button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
      await host.page.setViewportSize({ width: screen.width, height: screen.height });
      await details.locator('summary').focus();
      await host.page.keyboard.press('Enter');
      await expect(details).not.toHaveAttribute('open', '');
      await expect(details.locator('summary')).toBeFocused();
      await expect(host.page.locator('.wt-voice > .wt-voice-notice')).toBeVisible();
      expect(await host.page.evaluate(() => {
        const { notice, retry } = window.waitingVoiceStatus, box = retry.getBoundingClientRect();
        return document.querySelector('.wt-voice > .wt-voice-notice') === notice && notice.querySelector('button') === retry
          && box.x >= 0 && box.right <= innerWidth && box.y >= 0 && box.bottom <= innerHeight
          && retry.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
      await host.page.screenshot({ path: info.outputPath(`voice-status-closed-${screen.width}.png`) });
      await host.page.keyboard.press('Enter');
      await expect(notice).toBeVisible();
      expect(operations.some(operation => ['join', 'leave', 'publish'].includes(operation))).toBe(false);
      expect(host.traffic.errors).toEqual([]);
    } finally { await host.context.close(); }
  });
}
