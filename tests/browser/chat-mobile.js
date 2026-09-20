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

module.exports = { openChatWithKeyboardFocus, expectChatAboveKeyboard };
