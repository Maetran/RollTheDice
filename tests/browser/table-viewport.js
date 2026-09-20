const { expect } = require("@playwright/test");

async function expectFixedTable(page, selectors) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const boxes = () => page.evaluate(values => values.map(selector => {
    const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
    return { selector, x, y, width, height };
  }), selectors);
  const before = await boxes();
  await page.evaluate(() => window.scrollTo(0, 500));
  // Playwright's mobile WebKit has no wheel API. Chromium exercises native
  // wheel/touch input; both engines check scrolling, hit targets and layout.
  if (page.context().browser().browserType().name() !== "webkit") {
    await page.mouse.move(before[0].x + 10, before[0].y + 10);
    await page.mouse.wheel(0, 500);
  }
  if (page.context().browser().browserType().name() === "chromium") {
    const session = await page.context().newCDPSession(page);
    const x = Math.round(before[0].x + 20);
    const y = Math.round(before[0].y + 28);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 110 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const after = await boxes();
  for (let index = 0; index < before.length; index += 1) {
    expect(after[index].y, `${before[index].selector} stays on the table`).toBeCloseTo(before[index].y, 0);
    expect(after[index].height).toBeGreaterThan(0);
  }
  const pageSize = await page.evaluate(() => ({
    scroll: window.scrollY,
    bodyScroll: document.body.scrollTop,
    height: document.documentElement.scrollHeight,
    width: document.documentElement.scrollWidth,
    viewportHeight: innerHeight,
    viewportWidth: innerWidth,
  }));
  expect(pageSize.scroll).toBe(0);
  expect(pageSize.bodyScroll).toBe(0);
  expect(pageSize.height).toBeLessThanOrEqual(pageSize.viewportHeight + 1);
  expect(pageSize.width).toBeLessThanOrEqual(pageSize.viewportWidth + 1);
}

async function expectReachable(page, selector) {
  await expect(page.locator(selector)).toBeVisible();
  await expect.poll(() => page.locator(selector).evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { top: rect.top >= -1, bottom: rect.bottom <= innerHeight + 1, hit: element.contains(hit) };
  }), { message: `${selector} remains inside the visible viewport and accepts taps` }).toEqual({ top: true, bottom: true, hit: true });
}

module.exports = { expectFixedTable, expectReachable };
