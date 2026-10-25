const { test, expect } = require('@playwright/test');
const { player, create, normalCall, playOne, action } = require('./helpers/watten-journey.cjs');
const { installMedia } = require('./voice-media-fixture.js');

test.use({ serviceWorkers: 'block' });

// Keep actual account, seat, start, match, rematch and leave authorization. Only
// the external SFU/media boundary is simulated, as in hausdepp-voice.spec.js.
async function voiceTransport(item, language) {
  await installMedia(item.page, language);
  let board = null, audio = false, microphone = false;
  const operations = [], roomId = `voice-test-${item.user.id}`;
  await item.page.routeWebSocket(/\/ws\/[a-f0-9]{16}$/, route => {
    const server = route.connectToServer();
    const state = () => ({ event: 'state', available: true, room_id: roomId,
      members: board?.viewer?.participant_id ? [{ user_id: item.user.id, player_id: board.viewer.participant_id,
        audio, microphone, speaking: false }] : [], publications: [] });
    const broadcast = () => route.send(JSON.stringify({ watten_voice: state() }));
    server.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.scoreboard) board = message.scoreboard;
      if (!message.watten_voice) route.send(raw);
      if (message.scoreboard) broadcast();
    });
    route.onClose(() => { server.close(); });
    server.onClose((code, reason) => route.close({ code, reason }));
    route.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.action !== 'watten_voice') return server.send(raw);
      operations.push(message);
      const reply = { request_id: message.request_id, ok: true };
      if (['join', 'resume'].includes(message.operation)) {
        audio = true;
        Object.assign(reply, { member_token: 'test-member', session_id: 'test-session', room_id: roomId,
          ice_servers: [], state: state() });
      } else if (['state', 'heartbeat'].includes(message.operation)) reply.state = state();
      else if (message.operation === 'publish') Object.assign(reply, {
        tracks: [{ mid: '0' }], sessionDescription: { type: 'answer', sdp: 'test-answer' },
      });
      else if (message.operation === 'subscribe') reply.tracks = [];
      else if (message.operation === 'microphone') microphone = message.enabled;
      else if (message.operation === 'leave') audio = microphone = false;
      route.send(JSON.stringify({ watten_voice: reply }));
      if (['join', 'microphone', 'leave'].includes(message.operation)) broadcast();
    });
  });
  return operations;
}

for (const language of ['de', 'en']) {
  test(`${language}: waiting-room voice survives start and listening survives rematch with a fresh microphone`, async ({ browser, baseURL }) => {
    const players = [await player(browser, baseURL, language), await player(browser, baseURL, language)];
    const host = players[0], output = host.page.locator('[data-voice-audio]'), mic = host.page.locator('[data-voice-microphone]');
    try {
      const operations = await voiceTransport(host, language);
      const source = await create(players, { start: false });
      await host.page.locator('.wt-voice-details > summary').click();
      await expect(output).toHaveAttribute('aria-pressed', 'false');
      expect(await host.page.evaluate(() => window.__voiceHarness.captures)).toBe(0);
      await output.click(); await expect(output).toHaveAttribute('aria-pressed', 'true');
      await mic.click(); await expect(mic).toHaveAttribute('aria-pressed', 'true');
      await host.page.locator('[data-watten-command=start]').click();
      await expect.poll(() => host.traffic.snapshot.started).toBe(true);
      await expect(mic).toHaveAttribute('aria-pressed', 'true');
      expect(await host.page.evaluate(() => window.__voiceHarness.tracks[0].readyState)).toBe('live');
      await normalCall(players); await playOne(players); await action(players, 'bid'); await action(players, 'respond_hold', 'hold');
      for (let count = 0; count < players.length * 5 && host.traffic.snapshot.engine.phase === 'play'; count++) await playOne(players);
      expect(players.every(item => item.traffic.errors.length === 0)).toBe(true);
      // Use the journey helper's result deadline: collection and the native
      // three-second review intentionally precede the final match controls.
      await expect(host.page.locator('[data-watten-match-result]')).toBeVisible({ timeout: 10000 });
      await host.page.locator('[data-watten-rematch-action=create]').click();
      await expect.poll(() => new URL(host.page.url()).pathname).not.toBe(source);
      await expect(host.page.locator('[data-watten-command=waiting-back]')).toBeVisible();
      await host.page.locator('.wt-voice-details > summary').click();
      await expect(output).toHaveAttribute('aria-pressed', 'true');
      await expect(mic).toHaveAttribute('aria-pressed', 'false');
      expect(await host.page.evaluate(() => window.__voiceHarness.captures)).toBe(0);
      expect(operations.filter(message => message.operation === 'join')).toHaveLength(2);
      await output.click();
      await expect(host.page.locator('.wt-voice-exit-notice')).toContainText(language === 'de' ? 'Voicechat inaktiv' : 'Voice chat inactive');
      await host.page.reload();
      await host.page.locator('.wt-voice-details > summary').click();
      await expect(output).toHaveAttribute('aria-pressed', 'false');
      expect(operations.filter(message => message.operation === 'join')).toHaveLength(2);
      await host.page.locator('[data-watten-command=waiting-back]').click();
      await expect(host.page).toHaveURL(/\/watten$/);
      const notice = host.page.locator('.wt-voice-exit-notice');
      await expect(notice).toContainText(language === 'de' ? 'Tisch verlassen – Voicechat inaktiv' : 'Table left – voice chat inactive');
      const bounds = await notice.boundingBox();
      expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeLessThan(40);
      expect(players.every(item => item.traffic.errors.length === 0)).toBe(true);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}
