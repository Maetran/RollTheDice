const { test, expect } = require('@playwright/test');
const { mkdir } = require('node:fs/promises');

test.use({ serviceWorkers: 'block' });

async function table(page, viewport) {
  await page.setViewportSize(viewport);
  const signedIn = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(signedIn.ok()).toBeTruthy();
  const user = (await signedIn.json()).user;
  const created = await page.request.post('/api/games', {
    headers: { 'X-CSRF-Token': user.csrf_token },
    data: { name: 'Dekoration · sechs Plätze', mode: '6', game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 5 },
  });
  expect(created.ok()).toBeTruthy();
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  await page.goto(`/hausdepp/spiel/${(await created.json()).game_id}`);
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'peeking');
  await expect(page.locator('.hd-seat')).toHaveCount(5);
}

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1024, height: 768 }, { width: 1600, height: 1000 }]) {
  test(`six-seat table decoration respects play areas at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await table(page, viewport);
    const visibleProps = page.locator('.hd-table-prop:visible');
    if (viewport.width < 768) await expect.poll(() => visibleProps.count()).toBeLessThanOrEqual(1);
    else if (viewport.height < 600) await expect.poll(() => visibleProps.count()).toBeLessThanOrEqual(2);
    else await expect.poll(() => visibleProps.count()).toBeGreaterThan(0);
    const geometry = await page.evaluate(() => {
      const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      return {
        props: [...document.querySelectorAll('.hd-table-prop:not([hidden])')].map(element => ({ ...rect(element), pointerEvents: getComputedStyle(element).pointerEvents })),
        controls: [...document.querySelectorAll('.hd-seat, #hausdeppStock, #hausdeppPile, #hausdeppHand button, .hd-room-heading, .hd-hand-heading, #hausdeppStatus, #hausdeppEvent')]
          .filter(element => element.getClientRects().length).map(rect),
      };
    });
    for (const prop of geometry.props) {
      expect(prop.pointerEvents).toBe('none');
      for (const control of geometry.controls) {
        expect(prop.left < control.right && prop.right > control.left && prop.top < control.bottom && prop.bottom > control.top).toBe(false);
      }
    }
    await expect(page.locator('#hausdeppStock')).toBeEnabled();
  });
}

test('table props retain their nodes across updates and respect reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await table(page, { width: 1600, height: 1000 });
  const props = page.locator('.hd-table-prop:visible');
  await expect.poll(() => props.count()).toBeGreaterThan(0);
  const before = await props.evaluateAll(elements => {
    window.hausdeppDecorQaNodes = elements;
    return elements.map(element => ({ className: element.className, animations: [null, '::before', '::after']
      .map(pseudo => getComputedStyle(element, pseudo).animationName) }));
  });
  expect(before.every(prop => prop.animations.every(animation => animation === 'none'))).toBe(true);
  // A reaction causes real server traffic without changing the round or cards.
  await page.locator('[data-hausdepp-reaction]').first().click();
  await expect(props).toHaveCount(before.length);
  expect(await props.evaluateAll(elements => elements.every((element, index) => element === window.hausdeppDecorQaNodes[index]))).toBe(true);
  expect(await props.evaluateAll(elements => elements.map(element => element.className))).toEqual(before.map(prop => prop.className));
  if (process.env.HAUSDEPP_CAPTURE === '1') {
    await mkdir('.impeccable/review', { recursive: true });
    await page.screenshot({ path: '.impeccable/review/hausdepp-table-decor-desktop.png', fullPage: true });
  }
});
