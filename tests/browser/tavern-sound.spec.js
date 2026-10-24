const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { player, create, normalCall } = require('./helpers/watten-journey.cjs');
const { expectReachable, expectFixedTable } = require('./table-viewport');
const { expectTableHeaderReachable } = require('./helpers/watten-header.cjs');

const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const shared = name => readFileSync(path.resolve(__dirname, '../../frontend/shared', name), 'utf8');
const nativeEngine = dataURL(shared('tavern-sound.js')
  .replace('"./tavern-catalog.js"', JSON.stringify(dataURL(shared('tavern-catalog.js'))))
  .replace('"./tavern-shuffle.js"', JSON.stringify(dataURL(shared('tavern-shuffle.js')))));

test('real Web Audio accepts the production 20-second fade and releases both sources on off', async ({ page }) => {
  test.setTimeout(45_000);
  await page.setContent('<button id="start">Start local ambience</button>');
  await page.evaluate(async engine => {
    const { createTavernSound } = await import(engine);
    const timers = new Map(), sources = [], curves = [];
    let clockBump = 0, timerId = 0;
    class Context extends AudioContext {
      get currentTime() { return super.currentTime + clockBump; }
      createBufferSource() { const source = super.createBufferSource(); sources.push(source); return source; }
      createGain() {
        const gain = super.createGain(), nativeCurve = gain.gain.setValueCurveAtTime.bind(gain.gain);
        gain.gain.setValueCurveAtTime = (values, at, duration) => {
          nativeCurve(values, at, duration); // Native validation, including automation overlap.
          curves.push({ at, duration });
        };
        return gain;
      }
    }
    // Silent PCM is only a fixture; this case checks Web Audio scheduling, not
    // the sound quality/licensing of recordings or real speakers/microphones.
    const wav = new ArrayBuffer(44 + 16000), view = new DataView(wav);
    const word = (offset, text) => [...text].forEach((value, index) => view.setUint8(offset + index, value.charCodeAt(0)));
    word(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    word(36, 'data'); view.setUint32(40, 16000, true);
    const controller = createTavernSound({ AudioContext: Context, random: () => 0,
      storage: { getItem() { return null; }, setItem() {} },
      families: ['first', 'second'].map(id => ({ id, details: false, variants: [{ id, url: `/${id}.wav`, gain: .065 }] })),
      fetch: async () => ({ ok: true, arrayBuffer: async () => wav.slice(0) }),
      setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
      clearTimeout(id) { timers.delete(id); },
    });
    window.__nativeAmbience = { controller, sources, curves, timers, rotate() {
      const [id, timer] = [...timers].find(([, item]) => item.ms >= 180000);
      timers.delete(id);
      // Advance only the timer's deadline check. The asynchronous decode/fade
      // then uses the real native clock and lasts the production 20 seconds.
      clockBump = 181; timer.callback(); clockBump = 0;
    } };
    document.querySelector('#start').onclick = () => controller.setEnabled(true);
  }, nativeEngine);
  await page.locator('#start').click();
  await expect.poll(() => page.evaluate(() => window.__nativeAmbience.controller.snapshot().status)).toBe('playing');
  await page.evaluate(() => window.__nativeAmbience.rotate());
  await expect.poll(() => page.evaluate(() => window.__nativeAmbience.sources.filter(source => source.buffer).length)).toBe(2);
  expect(await page.evaluate(() => window.__nativeAmbience.curves.map(curve => curve.duration))).toEqual([20, 20]);
  await expect.poll(() => page.evaluate(() => window.__nativeAmbience.sources[0].buffer === null), { timeout: 25_000 }).toBe(true);
  expect(await page.evaluate(() => window.__nativeAmbience.sources.filter(source => source.buffer).length)).toBe(1);
  await page.evaluate(() => window.__nativeAmbience.controller.setEnabled(false));
  expect(await page.evaluate(() => window.__nativeAmbience.sources.every(source => source.buffer === null))).toBe(true);
  await page.evaluate(() => window.__nativeAmbience.controller.destroy());
  expect(await page.evaluate(() => window.__nativeAmbience.timers.size)).toBe(0);
});

for (const language of ['de', 'en']) {
  test(`${language}: Watten ambience stays opt-in through waiting-room moves, both orientations and reload`, async ({ browser, baseURL }, info) => {
    test.setTimeout(90_000);
    const mobile = { newContext: options => browser.newContext({ ...options, viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) };
    const players = [];
    try {
      for (let seat = 0; seat < 2; seat++) players.push(await player(mobile, baseURL, language));
      const page = players[0].page, requests = [];
      // Keep the actual game socket and voice UI, but expose provider
      // availability locally so geometry includes BOTH sound controls.
      // No external voice session or microphone is opened by this fixture.
      await page.routeWebSocket(/\/ws\/[a-f0-9]{16}$/, route => {
        const server = route.connectToServer();
        route.onMessage(raw => server.send(raw));
        server.onMessage(raw => {
          let message;
          try { message = JSON.parse(String(raw)); } catch { route.send(raw); return; }
          if (message.watten_voice?.event === 'state') {
            message.watten_voice = { ...message.watten_voice, available: true,
              room_id: 'local-geometry-only', members: [], publications: [] };
            route.send(JSON.stringify(message));
          } else {
            route.send(raw);
            if (message.scoreboard) route.send(JSON.stringify({ watten_voice: {
              event: 'state', available: true, room_id: 'local-geometry-only',
              members: [], publications: [],
            } }));
          }
        });
        route.onClose(() => server.close());
        server.onClose((code, reason) => route.close({ code, reason }));
      });
      page.on('request', request => { if (/\/static\/audio\/.+\.mp3/.test(request.url())) requests.push(request.url()); });
      await page.addInitScript(() => {
        window.__ambienceCaptureCount = 0;
        const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (...args) => { window.__ambienceCaptureCount++; return capture(...args); };
      });
      await create(players, { count: 2, target: 11, determination: 'normal', start: false });
      const sound = page.locator('#wattenSound');
      await expect(page.locator('.wt-voice-details > summary')).toBeVisible();
      await expect(page.locator('.wt-waiting-tools #wattenSound')).toBeVisible();
      await expect(sound).toHaveText(language === 'de' ? '♩Kulisse' : '♩Ambience');
      await expect(sound).toHaveAccessibleName(language === 'de' ? 'Wirtshaus-Sound einschalten' : 'Turn tavern sound on');
      await expect(sound).toHaveAttribute('aria-pressed', 'false'); expect(requests).toEqual([]);
      await sound.click();
      await expect(page.locator('.wt-sound')).toHaveAttribute('data-status', 'playing');
      for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
        await page.setViewportSize(viewport); await expectReachable(page, '#wattenSound');
        await expect(sound).toHaveAttribute('aria-pressed', 'true');
        await page.screenshot({ path: info.outputPath(`watten-ambience-waiting-${language}-${viewport.width}x${viewport.height}.png`) });
      }
      const requestCount = requests.length;
      await page.locator('[data-watten-command=start]').click(); await normalCall(players);
      await expect(page.locator('.wt-waiting-tools')).toHaveCount(0);
      await expect(sound).toHaveAttribute('aria-pressed', 'true');
      for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
        await page.setViewportSize(viewport);
        await expectReachable(page, '#wattenSound'); await expectTableHeaderReachable(page);
        await expectFixedTable(page, ['[data-wt-felt]', '[data-wt-hand-area]']);
        await page.screenshot({ path: info.outputPath(`watten-ambience-active-${language}-${viewport.width}x${viewport.height}.png`) });
      }
      expect(requests.length).toBe(requestCount, 'starting a game must not restart or reload ambience');
      expect(await page.evaluate(() => window.__ambienceCaptureCount)).toBe(0);
      const originalRoom = requests.find(url => !/\/(glasses|dishwasher|laughter)\.mp3/.test(url));
      await page.reload(); await expect(sound).toHaveAttribute('aria-pressed', 'false');
      expect(requests.length).toBe(requestCount, 'reload must never persist enabled sound');
      await sound.click(); await expect(page.locator('.wt-sound')).toHaveAttribute('data-status', 'playing');
      const nextRoom = requests.slice(requestCount).find(url => !/\/(glasses|dishwasher|laughter)\.mp3/.test(url));
      expect(nextRoom).toBeTruthy(); expect(nextRoom).not.toBe(originalRoom);
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await expect(sound).toHaveCount(0);
      for (const peer of players) expect(peer.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}
