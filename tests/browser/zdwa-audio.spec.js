const { test, expect } = require('@playwright/test');
const { player } = require('./helpers/watten-journey.cjs');
const { installMedia } = require('./voice-media-fixture.js');

test.use({ serviceWorkers: 'block' });

// Accounts, membership, waiting/start, reload and leave are real. Only external
// SFU signalling and device capture are simulated; no acoustic claim is made.
async function media(item, language, design) {
  await installMedia(item.page, language);
  await item.page.addInitScript(({ language, design }) => {
    localStorage.setItem('zdwa_language', language); localStorage.setItem('zdwa_design', design === 'old' ? 'old' : 'new');
    localStorage.setItem('wuerfler_theme', design === 'old' ? 'classic' : 'light');
  }, { language, design });
  let board = null, audio = false, microphone = false;
  const operations = [];
  await item.page.routeWebSocket(/\/ws\/[a-f0-9]{8}$/, route => {
    const server = route.connectToServer();
    const state = () => ({ event: 'state', available: true, room_id: `test-${board?._voice_group_id || 'room'}`,
      members: (board?._players || []).filter(p => p.user_id === item.user.id).map(p => ({ user_id: item.user.id,
        player_id: p.id, audio, microphone, speaking: false })), publications: [] });
    const broadcast = () => route.send(JSON.stringify({ zdwa_voice: state() }));
    server.onMessage(raw => {
      const value = JSON.parse(String(raw));
      if (value.scoreboard) board = value.scoreboard;
      if (!value.zdwa_voice) route.send(raw);
      if (value.scoreboard) broadcast();
    });
    route.onClose(() => server.close());
    server.onClose((code, reason) => route.close({ code, reason }));
    route.onMessage(raw => {
      const value = JSON.parse(String(raw));
      if (value.action !== 'zdwa_voice') return server.send(raw);
      operations.push(value);
      const reply = { request_id: value.request_id, ok: true };
      if (['join', 'resume'].includes(value.operation)) {
        audio = true; Object.assign(reply, { room_id: state().room_id, member_token: 'test-member', session_id: 'test-session',
          ice_servers: [], state: state() });
      } else if (['state', 'heartbeat'].includes(value.operation)) reply.state = state();
      else if (value.operation === 'publish') Object.assign(reply, { tracks: [{ mid: '0' }], sessionDescription: { type: 'answer', sdp: 'test-answer' } });
      else if (value.operation === 'subscribe') reply.tracks = [];
      else if (value.operation === 'microphone') microphone = value.enabled;
      else if (value.operation === 'leave') audio = microphone = false;
      route.send(JSON.stringify({ zdwa_voice: reply }));
      if (['join', 'microphone', 'leave'].includes(value.operation)) broadcast();
    });
  });
  return operations;
}

async function painted(page, selector, minSize = 44) {
  const result = await page.locator(selector).evaluate(element => {
    const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { width: r.width, height: r.height, x: r.x, right: r.right, y: r.y, bottom: r.bottom,
      reachable: element === hit || element.contains(hit), viewport: innerWidth };
  });
  expect(result.width).toBeGreaterThanOrEqual(minSize); expect(result.height).toBeGreaterThanOrEqual(minSize);
  expect(result.x).toBeGreaterThanOrEqual(0); expect(result.right).toBeLessThanOrEqual(result.viewport);
  expect(result.reachable).toBe(true);
  return result;
}

for (const [language, design, defaultListening] of [['de', 'old', false], ['en', '2026', true]]) {
  test(`${language}/${design}: room audio fits both designs and keeps listening separate from microphone and ambience`, async ({ browser, baseURL }, info) => {
    test.setTimeout(60000);
    const owner = await player(browser, baseURL, language), partner = await player(browser, baseURL, language);
    try {
      const operations = await media(owner, language, design);
      const preference = await owner.context.request.put('/api/auth/preferences/voice', {
        headers: { 'X-CSRF-Token': owner.user.csrf_token }, data: { voice_listening_default: defaultListening },
      });
      expect(preference.ok()).toBeTruthy();
      const response = await owner.context.request.post('/api/games', { data: { name: 'ZDWA audio', mode: '2', voice_enabled: true } });
      expect(response.ok()).toBeTruthy(); const gameId = (await response.json()).game_id;
      const path = `/spiel/${gameId}?design=${design === 'old' ? 'classic' : '2026'}`;
      await owner.page.goto(path); await expect(owner.page.locator('#roomAudioButton')).toBeVisible();
      const output = owner.page.locator('[data-room-listening]'), mic = owner.page.locator('[data-room-microphone]');
      for (const [width, height] of [[320, 740], [390, 844], [844, 390], [768, 1024], [1440, 900]]) {
        await owner.page.setViewportSize({ width, height });
        await owner.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const audio = await painted(owner.page, '#roomAudioButton');
        const menu = await painted(owner.page, '#roomHeaderMenuToggle', 28);
        const leave = await painted(owner.page, '#backToLobbyBtn', 28);
        expect(audio.right).toBeLessThanOrEqual(menu.x); expect(menu.right).toBeLessThanOrEqual(leave.x);
        await owner.page.locator('#roomHeaderMenuToggle').click();
        await expect(owner.page.locator('#roomHeaderMenuPanel')).toBeVisible();
        await owner.page.screenshot({ path: info.outputPath(`menu-${width}x${height}.png`) });
        await owner.page.locator('#roomAudioButton').click();
        await expect(owner.page.locator('#roomHeaderMenuPanel')).toBeHidden();
        await expect(owner.page.locator('#roomAudioPanel')).toBeVisible();
        const box = await owner.page.locator('#roomAudioPanel').boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(height);
        await owner.page.screenshot({ path: info.outputPath(`audio-${width}x${height}.png`) });
        const before = owner.traffic.commands.filter(command => command.action === 'roll_dice').length;
        await owner.page.keyboard.press('r');
        for (let index = 0; index < 8; index++) {
          await owner.page.keyboard.press('Tab');
          expect(await owner.page.evaluate(() => document.getElementById('roomAudioPanel').contains(document.activeElement))).toBe(true);
        }
        expect(owner.traffic.commands.filter(command => command.action === 'roll_dice').length).toBe(before);
        await owner.page.keyboard.press('Escape'); await expect(owner.page.locator('#roomAudioPanel')).not.toBeVisible();
        await expect(owner.page.locator('#roomAudioButton')).toBeFocused();
      }
      await owner.page.locator('#roomAudioButton').click();
      await expect(output).toHaveAttribute('aria-pressed', String(defaultListening));
      expect(await owner.page.evaluate(() => window.__voiceHarness.captures)).toBe(0);
      if (!defaultListening) await output.click();
      await expect(output).toHaveAttribute('aria-pressed', 'true');
      await mic.click(); await expect(mic).toHaveAttribute('aria-pressed', 'true');
      const ambience = owner.page.locator('[data-room-ambience]');
      await ambience.click(); await expect(owner.page.locator('[data-room-sound-status]')).toHaveText(language === 'de' ? 'Wirtshaus-Sound an' : 'Tavern sound on');
      await ambience.click(); await owner.page.keyboard.press('Escape');
      await partner.page.goto(`/spiel/${gameId}`);
      await expect.poll(() => owner.traffic.snapshot?._started).toBe(true);
      await owner.page.locator('#roomAudioButton').click();
      await expect(mic).toHaveAttribute('aria-pressed', 'true');
      expect(await owner.page.evaluate(() => window.__voiceHarness.tracks[0].readyState)).toBe('live');
      await output.click(); await expect(mic).toHaveAttribute('aria-pressed', 'false');
      const joins = operations.filter(operation => operation.operation === 'join').length;
      await owner.page.reload(); await owner.page.locator('#roomAudioButton').click();
      await expect(output).toHaveAttribute('aria-pressed', 'false');
      expect(operations.filter(operation => operation.operation === 'join')).toHaveLength(joins);
      await owner.page.keyboard.press('Escape'); await owner.page.locator('#backToLobbyBtn').click();
      await owner.page.locator('#leaveAbortBtn').click();
      await owner.page.getByRole('button', { name: /Lobby/i }).click();
      await expect(owner.page).toHaveURL(url => ['/', '/zdwa'].includes(url.pathname));
      await expect(owner.page.locator('.app-toast')).toContainText(language === 'de' ? 'Tisch verlassen – Voicechat inaktiv' : 'Table left – voice chat inactive');
      expect(owner.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled([owner.context.close(), partner.context.close()]); }
  });
}

test('guests and spectators can use ambience while voice stays inaccessible', async ({ page, request }) => {
  await installMedia(page, 'de');
  const created = await request.post('/api/games', { data: { name: 'Guest ambience', mode: '1', voice_enabled: false } });
  const id = (await created.json()).game_id;
  for (const suffix of ['?name=Guest', '/zuschauen']) {
    await page.goto(`/spiel/${id}${suffix}`); await page.locator('#roomAudioButton').click();
    await expect(page.locator('[data-room-voice]')).toBeHidden();
    await page.locator('[data-room-ambience]').click();
    await expect(page.locator('[data-room-sound-status]')).toHaveText('Wirtshaus-Sound an');
    expect(await page.evaluate(() => window.__voiceHarness.captures)).toBe(0);
  }
});
