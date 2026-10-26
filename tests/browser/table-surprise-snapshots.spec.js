const { test, expect } = require('@playwright/test');
const { build } = require('esbuild');
const path = require('node:path');
const { player, create, normalCall, playOne } = require('./helpers/watten-journey.cjs');

test('Watten optical effects copy the native cards and sibling props while preserving hand neighbours and controls', async ({ browser, baseURL }, info) => {
  test.setTimeout(90_000);
  const players = [];
  try {
    for (let seat = 0; seat < 4; seat++) players.push(await player(browser, baseURL, 'de', { role: seat === 0 ? 'admin' : 'user' }));
    await create(players, { count: 4, target: 15, reference: true, determination: 'normal' });
    await normalCall(players);
    // A genuine completed trick supplies captured packets, rather than a DOM
    // lookalike asserting selectors invented by the implementation.
    for (let card = 0; card < 4; card++) await playOne(players);
    const page = players[0].page;
    await expect(page.locator('.wt-taken:not([hidden]) .wt-taken-packet')).toHaveCount(1);
    const bundle = await build({ entryPoints: [path.resolve('frontend/hausdepp/surprise-snapshots.js')], bundle: true,
      write: false, format: 'esm', platform: 'browser', target: 'es2020', logLevel: 'silent' });
    await page.evaluate(async code => {
      window.surpriseSnapshots = await import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(code)))}`);
    }, bundle.outputFiles[0].text);

    for (const viewport of [{ width: 320, height: 568 }, { width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('[data-wt-hand] > .wt-hand-card')).toHaveCount(4);
      await expect(page.locator('[data-watten-decor-item]')).toHaveCount(3);
      const result = await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const api = window.surpriseSnapshots, table = document.querySelector('[data-wt-table]');
        const live = [...table.querySelectorAll('[data-wt-hand] > *, .wt-backs, .wt-trick-card, .wt-seat-badge, .wt-stock, .wt-taken')];
        const before = live.map(node => ({ node, markup: node.outerHTML, box: node.getBoundingClientRect().toJSON() }));
        const layer = document.createElement('div'); layer.className = 'hd-surprise-layer'; layer.inert = true;
        layer.setAttribute('aria-hidden', 'true'); table.append(layer);
        const screen = document.createElement('div'); screen.className = 'hd-surprise-screen'; layer.append(screen);
        const shadows = new Map();
        const fx = { table, box: layer.getBoundingClientRect(), add(kind, width, height = width) {
          const node = document.createElement('div'); node.className = `hd-surprise-node hd-surprise-${kind}`;
          Object.assign(node.style, { width: `${width}px`, height: `${height}px` }); screen.append(node);
          // Keep a test handle to the closed tree; no production shadow mode
          // or accessibility/interaction guarantees are weakened for testing.
          const attach = node.attachShadow.bind(node);
          node.attachShadow = options => { const shadow = attach(options); shadows.set(node, shadow); return shadow; };
          return node;
        } };
        const targets = api.snapshotTargets(table);
        const targetNodes = targets.map(target => target.node);
        const visible = node => {
          const r = node.getBoundingClientRect(), s = getComputedStyle(node), box = fx.box;
          return !node.closest('[hidden]') && s.display !== 'none' && s.visibility !== 'hidden'
            && Math.min(r.right, box.right) - Math.max(r.left, box.left) > 2
            && Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top) > 2;
        };
        const expected = [...table.querySelectorAll('[data-wt-hand] > .wt-hand-card,.wt-trick-card,.wt-backs,.wt-stock,.wt-taken-packet,[data-wt-reference] .wt-card'),
          ...document.querySelectorAll('#wattenApp [data-watten-decor-item]')].filter(visible);
        // Another mounted table or decoration outside this game's root cannot
        // enter its snapshot, even if it shares native presentation classes.
        const foreign = document.createElement('button'); foreign.className = 'wt-decor-prop';
        Object.assign(foreign.style, { position: 'fixed', left: '100px', top: '100px', width: '40px', height: '40px' });
        document.body.append(foreign);
        const foreignSelected = api.snapshotTargets(table).some(target => target.node === foreign); foreign.remove();
        api.woodenStage(fx);
        const paint = screen.querySelector('.hd-surprise-wood-paint'), carving = getComputedStyle(table, '::before');
        const painted = getComputedStyle(paint), tableBox = table.getBoundingClientRect(), paintBox = paint.getBoundingClientRect();
        const wood = { actual: painted.borderImageSource, expected: carving.borderImageSource,
          slice: painted.borderImageSlice, expectedSlice: carving.borderImageSlice,
          width: paintBox.width, expectedWidth: parseFloat(carving.width) + (carving.boxSizing === 'border-box' ? 0 : parseFloat(carving.borderLeftWidth) + parseFloat(carving.borderRightWidth)),
          height: paintBox.height, expectedHeight: parseFloat(carving.height) + (carving.boxSizing === 'border-box' ? 0 : parseFloat(carving.borderTopWidth) + parseFloat(carving.borderBottomWidth)),
          top: paintBox.top, expectedTop: tableBox.top + parseFloat(carving.top) };
        const differences = [], unsafe = [];
        for (const target of targets) {
          const copy = api.drawSnapshot(fx, target), shadow = shadows.get(copy.host), root = shadow.firstElementChild;
          const original = target.node.getBoundingClientRect(), clone = root.getBoundingClientRect();
          differences.push(...['left', 'top', 'width', 'height'].map(key => Math.abs(original[key] - clone[key])));
          if (target.node.matches('.wt-backs')) {
            const originals = [...target.node.children], copies = [...root.children];
            for (const [index, node] of originals.entries()) if (!node.hidden) {
              const a = node.getBoundingClientRect(), b = copies[index].getBoundingClientRect();
              differences.push(...['left', 'top', 'width', 'height'].map(key => Math.abs(a[key] - b[key])));
            }
          }
          unsafe.push(...[root, ...root.querySelectorAll('*')].flatMap(node => [...node.attributes]
            .filter(attr => /^(?:on|aria-|data-)/i.test(attr.name) || ['name', 'value', 'title', 'role', 'tabindex', 'autofocus'].includes(attr.name))));
        }
        const own = targets.filter(target => target.node.matches('.wt-hand-card'));
        const moving = [own[0], own[own.length - 1]];
        const cluster = api.handTransferCluster(table, moving);
        const rest = api.drawSnapshot(fx, cluster.target, { omitNodes: cluster.movingNodes });
        const restored = shadows.get(rest.host).firstElementChild;
        const remaining = [...restored.children].map(node => getComputedStyle(node).opacity);
        const neighbourDifference = [];
        [...table.querySelector('[data-wt-hand]').children].forEach((node, index) => {
          if (cluster.movingNodes.includes(node)) return;
          const a = node.getBoundingClientRect(), b = restored.children[index].getBoundingClientRect();
          neighbourDifference.push(...['left', 'top', 'width', 'height'].map(key => Math.abs(a[key] - b[key])));
        });
        api.protectControls(screen, table, fx.box);
        const clipping = getComputedStyle(screen).clipPath;
        const match = clipping.match(/^path\((?:(evenodd|nonzero),\s*)?["']([\s\S]*)["']\)$/);
        const mask = new Path2D(match[2]), context = document.createElement('canvas').getContext('2d');
        const covered = node => {
          const r = node.getBoundingClientRect();
          return context.isPointInPath(mask, r.left + r.width / 2 - fx.box.left, r.top + r.height / 2 - fx.box.top, match[1] || 'nonzero');
        };
        const controlsCovered = [...table.querySelectorAll('.wt-seat-name,.wt-avatar,.wt-topbar,[data-wt-stake] button, .wt-reference figcaption')]
          .filter(visible).filter(covered).map(node => node.className);
        const handCovered = own.every(target => covered(target.node));
        const unchanged = before.every(({ node, markup, box }) => node.isConnected && node.outerHTML === markup
          && ['left', 'top', 'width', 'height'].every(key => Math.abs(node.getBoundingClientRect()[key] - box[key]) < .01));
        const summary = { missing: expected.filter(node => !targetNodes.includes(node)).map(node => node.className),
          own: own.length, fans: targets.filter(target => target.node.matches('.wt-backs')).length,
          props: targets.filter(target => target.kind === 'prop').map(target => target.prop),
          packets: targets.filter(target => target.node.matches('.wt-taken-packet')).length,
          foreignSelected, wood, difference: Math.max(...differences), neighbourDifference: Math.max(...neighbourDifference),
          unsafe: unsafe.length, remaining, clusterMoving: cluster.movingNodes.length, controlsCovered, handCovered, unchanged };
        layer.remove(); return summary;
      });
      expect(result, JSON.stringify({ viewport, result })).toMatchObject({ missing: [], own: 4, fans: 3, packets: 1,
        foreignSelected: false, unsafe: 0, clusterMoving: 2, controlsCovered: [], handCovered: true, unchanged: true });
      expect(result.props.length).toBeGreaterThan(0);
      expect(result.props.every(Boolean)).toBe(true);
      expect(result.difference).toBeLessThan(1);
      expect(result.neighbourDifference).toBeLessThan(1);
      expect(result.remaining).toEqual(['0', '1', '1', '0']);
      expect(result.wood.actual).toContain('/static/watten/table-schnitzstube.jpg');
      expect(result.wood.actual).toBe(result.wood.expected);
      expect(result.wood.slice).toBe(result.wood.expectedSlice);
      for (const key of ['width', 'height', 'top']) expect(Math.abs(result.wood[key] - result.wood[`expected${key[0].toUpperCase()}${key.slice(1)}`])).toBeLessThan(1);
      await page.screenshot({ path: info.outputPath(`native-watten-${viewport.width}x${viewport.height}.png`) });
    }
    expect(players.flatMap(peer => peer.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
});
