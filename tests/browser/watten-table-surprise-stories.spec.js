const { test, expect } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');
const { player, create, normalCall, action } = require('./helpers/watten-journey.cjs');
const EFFECTS = ['star', 'hammer', 'ufo', 'portal', 'dragon', 'kraken', 'clock', 'blackhole'];

for (const viewport of [{ width: 320, height: 568 }, { width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
  test(`native Watten rare stories use decoded art and survive repeated taps/bidding at ${viewport.width}x${viewport.height}`, async ({ browser, baseURL }, info) => {
    test.setTimeout(90_000);
    const peers = [];
    try {
      for (let seat = 0; seat < 2; seat++) {
        const peer = await player(browser, baseURL);
        await peer.page.setViewportSize(viewport);
        // Only the cosmetic event is synthetic; native rendering, navigation,
        // bidding commands and accepted server phases stay on the real server.
        await peer.page.routeWebSocket('**/ws/*', socket => {
          peer.inject = message => socket.send(JSON.stringify(message));
          socket.connectToServer();
        });
        peers.push(peer);
      }
      await create(peers, { target: 11 }); await normalCall(peers);
      const peer = peers[0], page = peer.page;
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      if (process.env.RARE_CPU_PROFILE === '1' && viewport.width === 320) {
        const cdp = await peer.context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      }
      await page.evaluate(() => {
        const animate = Element.prototype.animate;
        const records = new WeakMap();
        Element.prototype.animate = function (...args) {
          const animation = animate.apply(this, args);
          const layer = this.closest('.hd-surprise-layer');
          if (layer) {
            animation.pause();
            const times = window.__rareTimings ||= [];
            const stamp = performance.now();
            if (!records.has(layer)) {
              const record = { effect: layer.dataset.effect, first: stamp, last: stamp, animations: 0 };
              records.set(layer, record); times.push(record);
            }
            const record = records.get(layer);
            record.last = stamp; record.animations += 1;
          }
          return animation;
        };
      });
      for (const effect of EFFECTS) {
        peer.inject({ watten_table_surprise: { id: `native-${viewport.width}-${effect}`, game_id: peer.traffic.snapshot.id, deal_id: peer.traffic.snapshot.engine.deal_id, effect } });
        const layer = page.locator('.hd-surprise-layer');
        await expect(layer).toHaveAttribute('data-effect', effect);
        const art = layer.locator(`.hd-art[data-art="${effect}"] img`);
        await expect(art).toHaveCount(effect === 'portal' ? 2 : 1);
        expect(await art.evaluateAll(nodes => nodes.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
        if (effect === 'star') {
          // The optical stage must paint above Watten's sibling prop layer;
          // otherwise abduction/occlusion would leave the live prop visible.
          const stacking = await layer.evaluate(node => {
            const prop = node.closest('#wattenApp').querySelector('[data-watten-decor-layer] .wt-decor-prop:not(.wt-decor-prop--rare)');
            const bounds = prop.getBoundingClientRect(), style = node.style.cssText, inert = node.inert;
            try {
              // No input is dispatched. Hit testing provides the native paint
              // order; restore the inert, pointer-transparent stage immediately.
              node.inert = false;
              node.style.setProperty('pointer-events', 'auto', 'important');
              const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
              return { above: hit === node, hit: hit?.className };
            } finally { node.style.cssText = style; node.inert = inert; }
          });
          expect(stacking.above, `the optical stage must cover the real sibling prop, found ${stacking.hit}`).toBe(true);
        }
        const cards = await page.locator('[data-wt-hand] .wt-hand-card').evaluateAll(nodes => nodes.map(node => node.outerHTML));
        await page.evaluate(effect => {
          const layer = document.querySelector('.hd-surprise-layer');
          // The singularity is visible before its deliberate blackout. Other
          // stories are captured while their subject is fully on the wood.
          const time = effect === 'blackhole' ? 900 : 1600;
          for (const animation of layer.getAnimations({ subtree: true })) animation.currentTime = time;
          window.__nativeRare = layer;
        }, effect);
        const wood = await page.locator('[data-wt-table]').boundingBox();
        await page.mouse.click(wood.x + wood.width / 2, wood.y + wood.height * .36);
        await page.mouse.click(wood.x + wood.width / 2, wood.y + wood.height * .36);
        expect(await layer.evaluate(node => node === window.__nativeRare)).toBe(true);
        expect(await page.locator('[data-wt-hand] .wt-hand-card').evaluateAll(nodes => nodes.map(node => node.outerHTML))).toEqual(cards);
        const geometry = await layer.evaluate((node, effect) => {
          const stage = node.querySelector(`[data-stage="${effect === 'blackhole' ? 'hole' : effect}"]`);
          const screen = node.querySelector('.hd-surprise-screen');
          const bounds = stage.getBoundingClientRect(), frame = screen.getBoundingClientRect();
          const clip = getComputedStyle(screen).clipPath;
          const match = clip.match(/^path\((?:(evenodd|nonzero),\s*)?["']([\s\S]*)["']\)$/);
          const context = document.createElement('canvas').getContext('2d');
          const visible = !match || context.isPointInPath(new Path2D(match[2]),
            bounds.left + bounds.width / 2 - frame.left, bounds.top + bounds.height / 2 - frame.top, match[1] || 'nonzero');
          return { effect, visible, opacity: getComputedStyle(stage).opacity, bounds: bounds.toJSON(),
            liveRevealed: node.dataset.liveRevealed || null, clip };
        }, effect);
        const geometryPath = info.outputPath(`native-${effect}-geometry.json`);
        await writeFile(geometryPath, JSON.stringify(geometry));
        await info.attach(`native-${effect}-geometry.json`, { contentType: 'application/json', path: geometryPath });
        expect(Number(geometry.opacity), `${effect}: the character is opaque at the capture peak`).toBeGreaterThan(.5);
        expect(geometry.visible, `${effect}: the character's centre lies outside protected-control cutouts`).toBe(true);
        await page.screenshot({ path: info.outputPath(`${effect}-${viewport.width}x${viewport.height}.png`) });
        if (effect === 'star') {
          // The SFU is external to this layout check; expose its native opt-in
          // toolbar without joining or capturing a microphone.
          peer.inject({ watten_voice: { event: 'state', available: true,
            room_id: 'native-rare-layout', members: [], publications: [] } });
          for (const [toggle, panel] of [
            ['[data-watten-social-action="toggle"]', '[data-watten-social-drawer]'],
            ['.wt-voice-details > summary', '.wt-voice-panel'],
          ]) {
            await page.locator(toggle).click();
            await expect(page.locator(panel)).toBeVisible();
            const above = await page.locator(panel).evaluate(panel => {
              const node = document.querySelector('.hd-surprise-layer');
              const bounds = panel.getBoundingClientRect(), style = node.style.cssText, inert = node.inert;
              try {
                node.inert = false;
                node.style.setProperty('pointer-events', 'auto', 'important');
                return panel.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
              } finally { node.style.cssText = style; node.inert = inert; }
            });
            expect(above, `${panel} paints above an already running optical stage`).toBe(true);
            if (panel.includes('social')) await page.locator('[data-watten-social-action="close"]').click();
            else await page.locator(toggle).click();
          }
        }
        await layer.evaluate(node => node.getAnimations({ subtree: true }).forEach(animation => animation.finish()));
        await expect(layer).toHaveCount(0);
      }
      peer.inject({ watten_table_surprise: { id: 'native-clock-across-bid', game_id: peer.traffic.snapshot.id, deal_id: peer.traffic.snapshot.engine.deal_id, effect: 'clock' } });
      const layer = page.locator('.hd-surprise-layer');
      await expect(layer.locator('[data-stage="clock"] img')).toBeVisible();
      await action(peers, 'bid');
      await expect.poll(() => peers.every(item => item.traffic.snapshot.engine.phase === 'bid_response')).toBe(true);
      await expect(layer).toHaveCount(1);
      await action(peers, 'respond_hold');
      await expect.poll(() => peers.every(item => item.traffic.snapshot.engine.phase === 'play')).toBe(true);
      await expect(layer).toHaveCount(1);
      await layer.evaluate(node => node.getAnimations({ subtree: true }).forEach(animation => animation.currentTime = 2650));
      await expect(layer.locator('[data-stage="mouse"] img')).toBeVisible();
      await layer.evaluate(node => node.getAnimations({ subtree: true }).forEach(animation => animation.finish()));
      await expect(layer).toHaveCount(0);
      const timingsPath = info.outputPath('native-story-construction-timings.json');
      await writeFile(timingsPath, JSON.stringify(await page.evaluate(() => window.__rareTimings)));
      await info.attach('native-story-construction-timings.json', { contentType: 'application/json', path: timingsPath });
      expect(peers.flatMap(item => item.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled(peers.map(peer => peer.context.close())); }
  });
}

test('a foreign error cannot reopen a pending rare request; its real rejected response can', async ({ browser, baseURL }) => {
  const peers = [];
  try {
    for (let seat = 0; seat < 2; seat++) {
      const peer = await player(browser, baseURL);
      await peer.page.routeWebSocket('**/ws/*', socket => {
        const server = socket.connectToServer();
        peer.inject = message => socket.send(JSON.stringify(message));
        server.onMessage(raw => {
          const message = JSON.parse(String(raw));
          if (message.action === 'watten_table_surprise' && message.error_code) peer.rareRejection = message;
          else socket.send(raw);
        });
      });
      peers.push(peer);
    }
    await create(peers, { target: 11 }); await normalCall(peers);
    const peer = peers[0], page = peer.page;
    const original = peer.traffic.snapshot;
    // A different effect is deliberately unavailable: the real server must
    // reject it. Hold exactly that reply to test concurrent UI response order.
    const effect = original.table_surprise_offer?.effect === 'star' ? 'hammer' : 'star';
    peer.inject({ scoreboard: { ...original, table_surprise_offer: { deal_id: original.engine.deal_id, effect } } });
    const prop = page.locator('.wt-decor-prop--rare');
    await expect(prop).toBeVisible();
    await prop.click();
    await expect.poll(() => peer.rareRejection?.action).toBe('watten_table_surprise');
    await expect(prop).toBeHidden();
    peer.inject({ error: 'watten_action_unavailable', error_code: 'watten_action_unavailable', fatal: false, action: 'watten_command' });
    await expect(prop).toBeHidden();
    peer.inject(peer.rareRejection);
    await expect(prop).toBeVisible();
    expect(peer.traffic.commands.filter(command => command.action === 'watten_table_surprise')).toHaveLength(1);
    expect(peers.flatMap(item => item.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled(peers.map(peer => peer.context.close())); }
});


test('Watten bids stay silent on the first blind tap through both blackout fades and accept the next visible tap', async ({ browser, baseURL }) => {
  const peers = [];
  try {
    for (let seat = 0; seat < 2; seat++) {
      const peer = await player(browser, baseURL);
      await peer.page.setViewportSize({ width: 390, height: 844 });
      await peer.page.routeWebSocket('**/ws/*', socket => {
        peer.inject = message => socket.send(JSON.stringify(message)); socket.connectToServer();
      });
      peers.push(peer);
    }
    await create(peers, { target: 11 }); await normalCall(peers);
    const actor = peers.find(peer => peer.traffic.snapshot.engine.actions.includes('bid')), page = actor.page;
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      const animate = Element.prototype.animate, send = WebSocket.prototype.send;
      window.__nativeBids = [];
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (this.closest('.hd-surprise-layer')) animation.pause();
        return animation;
      };
      WebSocket.prototype.send = function (raw) {
        try { const message = JSON.parse(raw); if (message.action === 'watten_command' && message.kind === 'bid') window.__nativeBids.push(message); } catch {}
        return send.call(this, raw);
      };
    });
    for (const time of [1250, 1900, 2700]) {
      actor.inject({ watten_table_surprise: { id: `native-blind-bid-${time}`, game_id: actor.traffic.snapshot.id,
        deal_id: actor.traffic.snapshot.engine.deal_id, effect: 'blackhole' } });
      const layer = page.locator('.hd-surprise-layer'), blackout = layer.locator('[data-stage="blackout"]');
      await expect(blackout).toHaveCount(1);
      await layer.evaluate((node, time) => node.getAnimations({ subtree: true }).forEach(animation => { animation.currentTime = time; }), time);
      expect(Number(await blackout.evaluate(node => getComputedStyle(node).opacity))).toBeGreaterThan(.2);
      await page.locator('[data-watten-action="bid"]').click();
      await expect(layer).toHaveAttribute('data-live-revealed', 'true');
      await expect(blackout).toBeHidden();
      expect(await page.evaluate(() => window.__nativeBids)).toEqual([]);
      if (time === 2700) {
        await page.locator('[data-watten-action="bid"]').click();
        await expect.poll(() => actor.traffic.snapshot.engine.phase).toBe('bid_response');
        expect(await page.evaluate(() => window.__nativeBids.length)).toBe(1);
        await expect(layer).toHaveCount(1);
      }
      await layer.evaluate(node => node.getAnimations({ subtree: true }).forEach(animation => animation.finish()));
      await expect(layer).toHaveCount(0);
    }
    expect(peers.flatMap(peer => peer.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled(peers.map(peer => peer.context.close())); }
});
