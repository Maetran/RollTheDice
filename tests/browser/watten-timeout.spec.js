const { test, expect } = require('@playwright/test');
const { player, create } = require('./helpers/watten-journey.cjs');

for (const [language, leaving] of [['de', false], ['en', true]]) {
  test(`${language}: terminal inactivity notice survives socket close without reconnecting${leaving ? ' during departure' : ''}`, async ({ browser, baseURL }) => {
    const players = [await player(browser, baseURL, language), await player(browser, baseURL, language)];
    const host = players[0];
    try {
      await host.page.addInitScript(() => {
        const Native = window.WebSocket;
        window.timeoutPresentationSockets = [];
        window.WebSocket = class extends Native {
          constructor(...args) {
            super(...args);
            if (/\/ws\/[0-9a-f]{16}$/.test(String(args[0]))) window.timeoutPresentationSockets.push(this);
          }
          send(message) {
            if (window.holdTimeoutDeparture && JSON.parse(message).action === 'watten_leave') return;
            return super.send(message);
          }
        };
      });
      await create(players, { target: 15 });
      if (leaving) {
        await host.page.evaluate(() => { window.holdTimeoutDeparture = true; });
        await host.page.locator('[data-watten-command=leave-match]').click();
        await host.page.locator('[data-watten-command=leave-confirm]').click();
      }
      // Backend tests exercise the real deadline/commit/retirement. This
      // presentation test supplies the exact allowed terminal DTO and close
      // to cover the browser's competing departure/reconnect lifecycle.
      const terminal = { ...host.traffic.snapshot, aborted: true, finished: true, started: false,
        abort_reason: 'inactivity_timeout', engine: null, round_review: null, score_history: [],
        paused: false, can_resume: false, awaited_participant_ids: [], pending_call_events: [] };
      terminal.room = { ...terminal.room, status: 'closed' };
      await host.page.evaluate(snapshot => {
        const socket = window.timeoutPresentationSockets.at(-1);
        socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ scoreboard: snapshot }) }));
        socket.close(1000);
      }, terminal);
      const message = language === 'de' ? 'Nach einer Stunde ohne Spielaktivität' : 'After one hour without game activity';
      await expect(host.page.locator('#wattenApp')).toContainText(message);
      await expect(host.page.locator('[data-wt-table]')).toHaveCount(0);
      await host.page.waitForTimeout(1800);
      expect(await host.page.evaluate(() => window.timeoutPresentationSockets.length)).toBe(1);
      await expect(host.page.locator('#wattenApp')).toContainText(message);
      await expect(host.page.locator('[data-watten-command=reconnect]')).toHaveCount(0);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}
