const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

const noticeSelector = "[data-deployment-notice]";
const products = [
  { game: "zdwa", path: "/regeln" },
  { game: "zilch", path: "/zilch/anmelden" },
  { game: "hausdepp", path: "/hausdepp/regeln" },
  { game: "watten", path: "/watten/regeln" },
];
const announcement = id => ({ id, restart_at: new Date(Date.now() + 30000).toISOString(), expires_at: new Date(Date.now() + 330000).toISOString() });

async function mockNotice(context, initial = null) {
  const state = { notice: initial, requests: 0 };
  await context.route("**/api/deployment-notice", route => {
    state.requests++;
    return route.fulfill({ json: { notice: state.notice }, headers: { "Cache-Control": "no-store" } });
  });
  return state;
}

for (const language of ["de", "en"]) {
  for (const product of products) {
    test(`${product.game} ${language}: mobile rollout notice is readable, preserves focus and remembers OK across navigation`, async ({ page, context }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await context.addInitScript(value => localStorage.setItem("zdwa_language", value), language);
      const state = await mockNotice(context);
      await page.goto(product.path + (product.game === "watten" && language === "en" ? "?lang=en" : ""));
      await expect.poll(() => state.requests).toBeGreaterThan(0);
      await page.evaluate(() => {
        const input = document.createElement("input");
        input.id = "rollout-focus-fixture";
        input.setAttribute("aria-label", "Focus fixture");
        document.body.append(input); input.focus();
      });
      state.notice = announcement(`release-${product.game}-${language}`);
      const notice = page.locator(noticeSelector);
      await expect(notice).toBeVisible({ timeout: 8000 });
      await expect(page.locator("#rollout-focus-fixture")).toBeFocused();
      await expect(notice.getByRole("status")).toContainText(language === "en" ? "Your games stay saved" : "Eure Spielstände bleiben gespeichert");
      await expect(notice.locator(".deployment-notice__title")).toHaveText(language === "en" ? "An update is coming" : "Gleich kommt ein Update");
      const bounds = await notice.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThan(280);
      const button = notice.getByRole("button", { name: "OK", exact: true });
      expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await button.click();
      await expect(notice).toHaveCount(0);
      await page.reload();
      const previousRequests = state.requests;
      await expect.poll(() => state.requests).toBeGreaterThan(previousRequests);
      await expect(notice).toHaveCount(0);
      // A later deployment has its own acknowledgement, even on the same page.
      state.notice = announcement(`release-next-${product.game}-${language}`);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(notice).toBeVisible();
    });
  }
}

test("OK propagates to another tab and server clear removes a subsequent notice", async ({ page, context }) => {
  const state = await mockNotice(context, announcement("cross-tab-release"));
  await page.goto("/hausdepp/regeln");
  const second = await context.newPage();
  await second.goto("/watten/regeln");
  await expect(page.locator(noticeSelector)).toBeVisible();
  await expect(second.locator(noticeSelector)).toBeVisible();
  await page.locator(noticeSelector).getByRole("button", { name: "OK", exact: true }).click();
  await expect(second.locator(noticeSelector)).toHaveCount(0);
  state.notice = announcement("next-cross-tab-release");
  await second.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(second.locator(noticeSelector)).toBeVisible();
  state.notice = null;
  await second.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(second.locator(noticeSelector)).toHaveCount(0);
});

test("rollout remains visible and OK operable above an open modal without changing its input focus", async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const state = await mockNotice(context);
  await page.goto("/watten/regeln");
  await expect.poll(() => state.requests).toBeGreaterThan(0);
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "rollout-modal-fixture";
    dialog.innerHTML = '<label>Chat <input id="rollout-modal-input"></label><button id="rollout-modal-close">Close</button>';
    document.body.append(dialog); dialog.showModal();
    dialog.querySelector("input").focus();
  });
  state.notice = announcement("modal-release");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const notice = page.locator(noticeSelector);
  await expect(notice).toBeVisible();
  await expect(page.locator("#rollout-modal-input")).toBeFocused();
  expect(await notice.evaluate(element => element.closest("dialog")?.id)).toBe("rollout-modal-fixture");
  await notice.getByRole("button", { name: "OK", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.locator("#rollout-modal-fixture")).toBeVisible();
  state.notice = announcement("modal-next-release");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(notice).toBeVisible();
  await page.evaluate(() => document.querySelector("#rollout-modal-fixture").close());
  await expect(notice).toBeVisible();
  expect(await notice.evaluate(element => element.parentElement.tagName)).toBe("BODY");
  // Opening help after the warning is already visible must also keep OK above
  // the new modal, rather than leaving an inert notice underneath it.
  await page.evaluate(() => {
    document.querySelector("#rollout-modal-fixture").showModal();
    document.querySelector("#rollout-modal-input").focus();
  });
  await expect(page.locator("#rollout-modal-input")).toBeFocused();
  await expect.poll(() => notice.evaluate(element => element.closest("dialog")?.id)).toBe("rollout-modal-fixture");
  await notice.getByRole("button", { name: "OK", exact: true }).click();
});
