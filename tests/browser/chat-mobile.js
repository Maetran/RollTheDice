const { expect } = require("@playwright/test");
const { expectReachable } = require("./table-viewport");

async function openChatWithKeyboardFocus(page, toggleSelector, inputSelector) {
  await page.evaluate(({ toggleSelector, inputSelector }) => {
    document.addEventListener("click", event => {
      if (event.target.closest(toggleSelector)) {
        window.__chatFocusedDuringTap = document.activeElement === document.querySelector(inputSelector);
      }
    });
  }, { toggleSelector, inputSelector });
  await page.locator(toggleSelector).tap();
  expect(await page.evaluate(() => window.__chatFocusedDuringTap), "focus stays in the initiating tap for the iOS keyboard").toBe(true);
  await expect(page.locator(inputSelector)).toBeFocused();
}

async function expectChatAboveKeyboard(page, inputSelector, sendSelector) {
  // iOS reduces the visual viewport, while the layout viewport and its dvh
  // can remain tall. Resizing the whole page does not reproduce this state.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable:true, value:380 });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  for (const selector of [inputSelector, sendSelector]) {
    await expectReachable(page, selector);
    await expect.poll(() => page.locator(selector).evaluate(element => (
      element.getBoundingClientRect().bottom <= window.visualViewport.height + window.visualViewport.offsetTop + 1
    )), { message:`${selector} stays above the software keyboard` }).toBe(true);
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

async function expectCollapsedChatDock(page, { panel, bar, content, toggle, bottomInset = 0 }) {
  await expect(page.locator(toggle)).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(content)).toBeHidden();
  await expect.poll(() => page.evaluate(({ panel, bar, content, bottomInset }) => {
    const shell = document.querySelector(panel);
    const rail = document.querySelector(bar);
    const body = document.querySelector(content);
    const shellBox = shell.getBoundingClientRect();
    const barBox = rail.getBoundingClientRect();
    const visibleBottom = visualViewport.height + visualViewport.offsetTop;
    return {
      // No offscreen drawer content may peek through a PWA safe area.
      contentHasNoLayout: body.getClientRects().length === 0,
      barEndsAtPanelBottom: Math.abs(barBox.bottom - shellBox.bottom) <= 1,
      panelIsAtViewportBottom: Math.abs(shellBox.bottom - (visibleBottom - bottomInset)) <= 1,
      onlyBarAndBorder: Math.abs(shellBox.height - barBox.height - parseFloat(getComputedStyle(shell).borderTopWidth)) <= 1,
    };
  }, { panel, bar, content, bottomInset })).toEqual({
    contentHasNoLayout: true, barEndsAtPanelBottom: true,
    panelIsAtViewportBottom: true, onlyBarAndBorder: true,
  });
  await expectReachable(page, toggle);
  expect(await page.locator(toggle).evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
}

async function exerciseCollapsedChatDock(page, game, testInfo) {
  const zdwa = game === "zdwa";
  const selectors = zdwa
    ? { panel:"#chatPanel", bar:"#chatToggle", content:"#chatContent", toggle:"#chatToggle", input:"#chatInput" }
    : { panel:".zilch-chat", bar:".zilch-chat__bar", content:"#zilchChatContent", toggle:"[data-zilch-chat-toggle]", input:"#zilchChatInput" };
  for (const viewport of [{ width:440, height:956 }, { width:820, height:1180 }, { width:1024, height:1366 }, { width:1366, height:1024 }]) {
    await page.setViewportSize(viewport);
    for (const inset of [0, 34]) {
      await page.evaluate(({ zdwa, inset }) => {
        const host = zdwa ? document.body : document.documentElement;
        host.style.setProperty(zdwa ? "--room-safe-bottom" : "--zilch-room-safe-bottom", `${inset}px`);
      }, { zdwa, inset });
      await expectCollapsedChatDock(page, { ...selectors, bottomInset: inset });
      await page.evaluate(() => window.scrollTo(0, 400));
      await expectCollapsedChatDock(page, { ...selectors, bottomInset: inset });
      await openChatWithKeyboardFocus(page, selectors.toggle, selectors.input);
      await page.locator(selectors.input).fill("Mein Entwurf bleibt beim Einklappen erhalten");
      await page.locator(selectors.toggle).tap();
      await expect(page.locator(selectors.input)).not.toBeFocused();
      await expectCollapsedChatDock(page, { ...selectors, bottomInset: inset });
      await openChatWithKeyboardFocus(page, selectors.toggle, selectors.input);
      await expect(page.locator(selectors.input)).toHaveValue("Mein Entwurf bleibt beim Einklappen erhalten");
      await page.locator(selectors.toggle).tap();
    }
    if (testInfo) await page.screenshot({ path:testInfo.outputPath(`chat-dock-${game}-${viewport.width}x${viewport.height}.png`) });
  }
  await page.locator(selectors.input).evaluate(input => { input.value = ""; });
  await page.setViewportSize({ width:440, height:956 });
}

module.exports = { openChatWithKeyboardFocus, expectChatAboveKeyboard, expectCollapsedChatDock, exerciseCollapsedChatDock };
