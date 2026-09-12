const { expect } = require("@playwright/test");

async function openPasswordLogin(page, zilch = false) {
  const section = page.locator(zilch ? "#zilchPasswordLogin" : "#passwordLogin");
  await expect(section.locator(":scope > summary")).toBeVisible();
  if (await section.getAttribute("open") === null) await section.locator(":scope > summary").click();
  await expect(section.locator("form")).toBeVisible();
}

async function expectPasswordLoginClosed(page, zilch = false) {
  const section = page.locator(zilch ? "#zilchPasswordLogin" : "#passwordLogin");
  await expect(section.locator(":scope > summary")).toBeVisible();
  await expect(section).not.toHaveAttribute("open", "");
  await expect(section.locator("form")).toBeHidden();
}

module.exports = { openPasswordLogin, expectPasswordLoginClosed };
