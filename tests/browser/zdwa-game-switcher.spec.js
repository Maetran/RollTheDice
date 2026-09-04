const { test, expect } = require("@playwright/test");

async function signIn(page, username, password) {
  await page.fill("#loginUsername", username);
  await page.fill("#loginPassword", password);
  await page.click("#loginForm button[type=submit]");
}

async function createUser(page, username, password, role = "user") {
  return page.evaluate(async ({ name, secret, userRole }) => {
    const me = await fetch("/api/auth/me", { cache: "no-store" }).then(response => response.json());
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.user.csrf_token },
      body: JSON.stringify({ username: name, temporary_password: secret, role: userRole }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, { name: username, secret: password, userRole: role });
}

async function signInAsPreviewMani(page) {
  await page.goto("/");
  await signIn(page, "Admin", "temporary-password-123");
  await expect(page.locator("#authBadge")).toContainText("Admin");
  const mani = await createUser(page, "Mani", "mani-preview-password-123", "admin");
  expect([201, 400]).toContain(mani.status);
  await page.click("#logoutBtn");
  await expect(page.locator("#loginForm")).toBeVisible();
  await signIn(page, "Mani", "mani-preview-password-123");
  await expect(page.locator("#authBadge")).toContainText("Mani");
}

test("the permission-gated game switch is available across ZDWA and in its active room", async ({ page }) => {
  await page.goto("/regeln");
  const anonymousSwitch = page.locator("[data-game-switch]");
  await expect(anonymousSwitch).toBeHidden();
  await expect(anonymousSwitch).toBeDisabled();
  await expect(anonymousSwitch).toHaveAttribute("aria-hidden", "true");

  await signInAsPreviewMani(page);

  const destinations = [
    "/",
    "/spieler",
    "/spieler/Mani",
    "/regeln",
    "/rangabzeichen",
    "/konto",
    "/admin",
    "/ergebnis/not-present",
  ];
  for (const destination of destinations) {
    await page.goto(destination);
    await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
    const switchButton = page.locator("[data-game-switch]");
    await expect(switchButton).toBeVisible();
    await expect(switchButton).toBeEnabled();
    await expect(switchButton).toHaveAttribute("aria-hidden", "false");
    await expect(switchButton).toHaveAttribute("aria-label", /^(?:Zilch öffnen|Open Zilch) \(Alt\+Shift\+Z\)$/);
  }

  await page.goto("/");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator("[data-language-switcher]").selectOption("en"),
  ]);
  await page.goto("/regeln");
  await expect(page.locator("[data-game-switch]")).toHaveAttribute("aria-label", "Open Zilch (Alt+Shift+Z)");
  await page.goto("/");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator("[data-language-switcher]").selectOption("de"),
  ]);
  await expect(page.locator("#authBadge")).toContainText("Mani");
  await Promise.all([
    page.waitForURL(/\/spiel\/[^/?]+$/),
    page.click("#createBtn"),
  ]);
  await expect(page.locator("#diceBar")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const roomSwitch = page.locator(".room-header [data-game-switch]");
  await expect(roomSwitch).toBeVisible();
  await expect(roomSwitch).toBeEnabled();
  const geometry = await roomSwitch.evaluate(element => {
    const button = element.getBoundingClientRect();
    const header = element.closest(".room-header").getBoundingClientRect();
    return {
      buttonLeft: button.left,
      buttonRight: button.right,
      buttonHeight: button.height,
      headerLeft: header.left,
      headerRight: header.right,
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(geometry.buttonHeight).toBeGreaterThanOrEqual(28);
  expect(geometry.buttonLeft).toBeGreaterThanOrEqual(geometry.headerLeft);
  expect(geometry.buttonRight).toBeLessThanOrEqual(geometry.headerRight);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);

  await Promise.all([
    page.waitForURL(/\/zilch$/),
    roomSwitch.click(),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zilch");
});
