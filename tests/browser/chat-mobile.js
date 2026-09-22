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

async function expectCollapsedChatDock(page, {
  panel, bar, content, toggle, reactionHost, bottomInset = 0, safePadCap = 0, minReactionTarget = 0,
}) {
  await expect(page.locator(toggle)).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(content)).toBeHidden();
  await expect.poll(() => page.evaluate(({
    panel, bar, content, toggle, reactionHost, bottomInset, safePadCap, minReactionTarget,
  }) => {
    const shell = document.querySelector(panel);
    const rail = document.querySelector(bar);
    const body = document.querySelector(content);
    const shellBox = shell.getBoundingClientRect();
    const barBox = rail.getBoundingClientRect();
    const visibleBottom = visualViewport.height + visualViewport.offsetTop;
    const control = document.querySelector(toggle);
    const controlBox = control.getBoundingClientRect();
    const text = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
    const textBoxes = [];
    while (text.nextNode()) {
      if (!text.currentNode.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(text.currentNode);
      textBoxes.push(...range.getClientRects());
    }
    const painted = element => {
      const style = getComputedStyle(element);
      return style.backgroundImage !== "none" || !["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor);
    };
    const reaction = document.querySelector(reactionHost);
    const reactionBox = reaction.getBoundingClientRect();
    const emojiBox = reaction.querySelector(".emoji-fab").getBoundingClientRect();
    const controlStyle = getComputedStyle(control);
    const emojiStyle = getComputedStyle(reaction.querySelector(".emoji-fab"));
    const safePad = Math.min(bottomInset, safePadCap);
    return {
      // No offscreen drawer content may peek through a PWA safe area.
      contentHasNoLayout: body.getClientRects().length === 0,
      barEndsAtPanelBottom: Math.abs(barBox.bottom - shellBox.bottom) <= 1,
      panelIsAtViewportBottom: Math.abs(shellBox.bottom - visibleBottom) <= 1,
      onlyBarAndBorder: Math.abs(shellBox.height - barBox.height - parseFloat(getComputedStyle(shell).borderTopWidth)) <= 1,
      compactPanel: shellBox.height <= 50,
      compactBar: barBox.height <= 50,
      bottomPixelBelongsToBar: shell.contains(document.elementFromPoint(barBox.left + barBox.width / 2, visibleBottom - 1)),
      safeAreaIsPainted: painted(shell) || painted(rail),
      usableToggle: controlBox.height >= 44 && controlBox.top >= barBox.top - 1 && controlBox.bottom <= barBox.bottom + 1,
      toggleTextVisible: textBoxes.length > 0 && textBoxes.every(box => (
        box.top >= barBox.top - 1 && box.bottom <= barBox.bottom + 1 && box.width > 0 && box.height > 0
      )) && controlStyle.visibility === "visible" && Number(controlStyle.opacity) > 0,
      reactionVisible: emojiBox.top >= barBox.top - 1 && emojiBox.bottom <= barBox.bottom + 1
        && emojiBox.width > 0 && emojiBox.height > 0 && emojiStyle.visibility === "visible" && Number(emojiStyle.opacity) > 0,
      reactionTargetLargeEnough: emojiBox.width >= minReactionTarget && emojiBox.height >= minReactionTarget,
      toggleTextClearsCappedInset: textBoxes.every(box => box.bottom <= visibleBottom - safePad + 1),
      reactionClearsCappedInset: emojiBox.bottom <= visibleBottom - safePad + 1,
      // ZDWA renders reactions as a separate painted half of its bottom bar.
      reactionHalfReachesBottom: reactionHost !== "#chatReactionsBar" || Math.abs(reactionBox.bottom - visibleBottom) <= 1,
      reactionHalfIsPainted: reactionHost !== "#chatReactionsBar" || painted(reaction),
    };
  }, { panel, bar, content, toggle, reactionHost, bottomInset, safePadCap, minReactionTarget })).toEqual({
    contentHasNoLayout: true, barEndsAtPanelBottom: true,
    panelIsAtViewportBottom: true, onlyBarAndBorder: true,
    compactPanel: true, compactBar: true,
    bottomPixelBelongsToBar: true, safeAreaIsPainted: true,
    usableToggle: true, toggleTextVisible: true,
    reactionVisible: true, reactionTargetLargeEnough: true,
    toggleTextClearsCappedInset: true, reactionClearsCappedInset: true,
    reactionHalfReachesBottom: true, reactionHalfIsPainted: true,
  });
  await expectReachable(page, toggle);
  await expectReachable(page, `${reactionHost} .emoji-fab`);
  expect(await page.locator(toggle).evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
}

async function exerciseCollapsedChatDock(page, game, testInfo) {
  const zdwa = game === "zdwa";
  const selectors = zdwa
    ? { panel:"#chatPanel", bar:"#chatToggle", content:"#chatContent", toggle:"#chatToggle", input:"#chatInput", reactionHost:"#chatReactionsBar", send:"#chatSend" }
    : { panel:".zilch-chat", bar:".zilch-chat__bar", content:"#zilchChatContent", toggle:"[data-zilch-chat-toggle]", input:"#zilchChatInput", reactionHost:"#zilchChatReactionsBar", send:"#zilchChatForm button[type='submit']" };
  await page.emulateMedia({ reducedMotion:"reduce" });
  const viewports = [
    { width:320, height:568 }, { width:367, height:703 },
    { width:390, height:844 }, { width:440, height:956 }, { width:600, height:960 },
    { width:956, height:440 }, { width:820, height:1180 },
    { width:768, height:600 }, { width:1024, height:1366 }, { width:1366, height:1024 },
  ];
  for (const standalone of [false, true]) {
    if (standalone) await page.evaluate(() => {
      const visit = rules => {
        for (const rule of rules) {
          if (rule instanceof CSSMediaRule && rule.conditionText.includes("display-mode: standalone")) rule.media.mediaText = "all";
          if (rule.cssRules) visit(rule.cssRules);
        }
      };
      for (const sheet of document.styleSheets) visit(sheet.cssRules);
    });
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      // Browser tabs exercise the normal viewport; standalone PWA mode adds
      // the largest iPhone home-indicator inset. Together these scenarios
      // ensure that neither environment makes the collapsed bar taller.
      for (const inset of [standalone ? 34 : 0]) {
        await page.evaluate(({ zdwa, inset }) => {
          const host = zdwa ? document.body : document.documentElement;
          host.style.setProperty(zdwa ? "--room-safe-bottom" : "--zilch-room-safe-bottom", `${inset}px`);
        }, { zdwa, inset });
        const tablet = viewport.width >= 768 && viewport.height >= 600;
        const safePadCap = tablet ? 4 : (zdwa ? 14 : 9.6);
        const minReactionTarget = tablet ? 44 : 0;
        await expectCollapsedChatDock(page, { ...selectors, bottomInset:inset, safePadCap, minReactionTarget });
        await page.evaluate(() => window.scrollTo(0, 400));
        await expectCollapsedChatDock(page, { ...selectors, bottomInset:inset, safePadCap, minReactionTarget });
        await openChatWithKeyboardFocus(page, selectors.toggle, selectors.input);
        await page.locator(selectors.input).fill("Mein Entwurf bleibt beim Einklappen erhalten");
        await page.locator(selectors.toggle).tap();
        await expect(page.locator(selectors.input)).not.toBeFocused();
        await expectCollapsedChatDock(page, { ...selectors, bottomInset:inset, safePadCap, minReactionTarget });
        await openChatWithKeyboardFocus(page, selectors.toggle, selectors.input);
        await expect(page.locator(selectors.input)).toHaveValue("Mein Entwurf bleibt beim Einklappen erhalten");
        // Keep layout/dvh tall while iOS's visible viewport moves and shrinks.
        // An inset subtracted twice or an ignored offset leaves a visible gap.
        await page.evaluate(() => {
          Object.defineProperty(visualViewport, "height", { configurable:true, value:Math.min(380, innerHeight - 160) });
          Object.defineProperty(visualViewport, "offsetTop", { configurable:true, value:24 });
          visualViewport.dispatchEvent(new Event("resize"));
          visualViewport.dispatchEvent(new Event("scroll"));
        });
        for (const control of [selectors.input, selectors.send]) {
          await expectReachable(page, control);
          await expect.poll(() => page.locator(control).evaluate((element, inset) => (
            element.getBoundingClientRect().bottom <= visualViewport.offsetTop + visualViewport.height - inset + 1
          ), inset)).toBe(true);
        }
        await expect.poll(() => page.locator(selectors.panel).evaluate(element => (
          Math.abs(element.getBoundingClientRect().bottom - visualViewport.offsetTop - visualViewport.height)
        ))).toBeLessThanOrEqual(1);
        await expect(page.locator(selectors.input)).toHaveValue("Mein Entwurf bleibt beim Einklappen erhalten");
        await page.locator(selectors.toggle).tap();
        await expectCollapsedChatDock(page, { ...selectors, bottomInset:inset, safePadCap, minReactionTarget });
        await page.evaluate(() => {
          delete visualViewport.height;
          delete visualViewport.offsetTop;
          visualViewport.dispatchEvent(new Event("resize"));
          visualViewport.dispatchEvent(new Event("scroll"));
        });
        await expectCollapsedChatDock(page, { ...selectors, bottomInset:inset, safePadCap, minReactionTarget });
        if (testInfo && inset === 34 && standalone && [440, 1024].includes(viewport.width)) {
          await page.evaluate(async () => {
            await document.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
          });
          await page.screenshot({ path:testInfo.outputPath(`chat-edge-${game}-${viewport.width}x${viewport.height}-safe34-standalone.png`) });
        }
      }
    }
  }
  await page.locator(selectors.input).evaluate(input => { input.value = ""; });
  await page.setViewportSize({ width:440, height:956 });
}

module.exports = { openChatWithKeyboardFocus, expectChatAboveKeyboard, expectCollapsedChatDock, exerciseCollapsedChatDock };
