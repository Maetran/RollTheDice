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

async function signOutViaAccount(page) {
  const lobbyPath = new URL(page.url()).pathname;
  await page.locator("#headerAccountLink").click();
  await expect(page.locator("#accountLogout")).toBeVisible();
  const [response] = await Promise.all([
    page.waitForResponse(candidate => new URL(candidate.url()).pathname === "/api/auth/logout"
      && candidate.request().method() === "POST"),
    page.locator("#accountLogout").click(),
  ]);
  expect(response.ok()).toBeTruthy();
  await expect(page).toHaveURL(url => url.pathname === lobbyPath);
  await expectPasswordLoginClosed(page);
}

module.exports = { openPasswordLogin, expectPasswordLoginClosed, signOutViaAccount };
