const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

const products = [
  { name: "zdwa", path: "/konto", passwordForm: "#passwordForm", passwordHint: "#passwordHint" },
  { name: "zilch", path: "/zilch/konto", passwordForm: "#zilchPasswordForm", passwordHint: "#zilchPasswordHint" },
];
const sectionNames = {
  de: ["Profil & Zugang", "Sprache & Spiel", "Mitspieler & Hinweise", "Hilfe & Neuigkeiten"],
  en: ["Profile & sign-in", "Language & play", "Players & notifications", "Help & updates"],
};

async function createAccount(page, name, language = "de", forcedPassword = false) {
  const password = "account-settings-password-123";
  const administrator = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(administrator.ok()).toBeTruthy();
  const admin = (await administrator.json()).user;
  const created = await page.request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": admin.csrf_token },
    data: { username: name, temporary_password: password, role: "admin" },
  });
  expect(created.status()).toBe(201);
  const signedIn = await page.request.post("/api/auth/login", { data: { username: name, password } });
  expect(signedIn.ok()).toBeTruthy();
  const user = (await signedIn.json()).user;
  const headers = { "X-CSRF-Token": user.csrf_token };
  const saved = await page.request.put("/api/auth/preferences/language", {
    headers, data: { preferred_language: language },
  });
  expect(saved.ok()).toBeTruthy();
  if (!forcedPassword) {
    const changed = await page.request.post("/api/auth/change-password", {
      headers, data: { current_password: password, new_password: "account-settings-final-password-123" },
    });
    expect(changed.ok()).toBeTruthy();
    const signedInAgain = await page.request.post("/api/auth/login", {
      data: { username: name, password: "account-settings-final-password-123" },
    });
    expect(signedInAgain.ok()).toBeTruthy();
  }
  await page.route("**/api/releases**", route => route.fulfill({
    json: { viewer_id: user.id, releases: [], can_prompt: false },
  }));
}

async function openSection(page, name) {
  const section = page.locator(`details[data-account-section="${name}"]`);
  if (await section.getAttribute("open") === null) await section.locator(":scope > summary").click();
  return section;
}

for (const product of products) {
  for (const language of ["de", "en"]) {
    test(`${product.name} settings share a compact accessible structure on mobile (${language})`, async ({ page }, testInfo) => {
      await createAccount(page, `Settings_${product.name}_${language}`, language);
      await page.setViewportSize({ width: 320, height: 844 });
      await page.goto(`${product.path}#settings`);
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      const sections = page.locator("details[data-account-section]");
      await expect(sections).toHaveCount(4);
      expect(await sections.evaluateAll(nodes => nodes.map(node => node.dataset.accountSection))).toEqual(["access", "play", "social", "help"]);
      for (let index = 0; index < 4; index += 1) {
        await expect(sections.nth(index).locator(":scope > summary")).toContainText(sectionNames[language][index]);
        if (index === 0) await expect(sections.nth(index)).toHaveAttribute("open", "");
        else await expect(sections.nth(index)).not.toHaveAttribute("open", "");
      }
      await expect(page.locator("[data-email-settings]")).toBeHidden();
      await expect(page.locator("#emailSettingsTitle")).toBeHidden();
      await expect(page.locator("[data-passkey-settings]")).toBeHidden();
      // Feature flags must hide their own card, never the surrounding profile section.
      const profile = page.locator("details[data-account-action=profile]");
      const password = page.locator("details[data-account-action=password]");
      await expect(profile.locator(":scope > summary")).toBeVisible();
      await expect(password.locator(":scope > summary")).toBeVisible();
      await expect(profile).not.toHaveAttribute("open", "");
      await expect(password).not.toHaveAttribute("open", "");
      await expect(page.locator(product.passwordForm)).toBeHidden();
      await profile.locator(":scope > summary").click();
      await expect(page.locator("[data-username-settings]")).toBeVisible();
      await expect(page.locator("[data-avatar-upload]")).toBeVisible();
      await profile.locator(":scope > summary").click();
      await password.locator(":scope > summary").click();
      await expect(page.locator(product.passwordForm)).toBeVisible();
      await password.locator(":scope > summary").click();

      const tablist = page.locator(".account-tabs, .zilch-account-tabs");
      const tabs = tablist.getByRole("tab");
      await tabs.nth(2).focus();
      await page.keyboard.press("Home");
      await expect(tabs.nth(0)).toBeFocused();
      await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("ArrowRight");
      await expect(tabs.nth(1)).toBeFocused();
      await page.keyboard.press("End");
      await expect(tabs.nth(2)).toBeFocused();
      await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
      await expect(tablist.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
      const play = sections.nth(1);
      await play.locator(":scope > summary").focus();
      await page.keyboard.press("Enter");
      await expect(play).toHaveAttribute("open", "");
      await page.keyboard.press("Space");
      await expect(play).not.toHaveAttribute("open", "");

      for (const section of ["play", "social", "help"]) await openSection(page, section);
      for (const width of [320, 375]) {
        await page.setViewportSize({ width, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const boxes = await sections.evaluateAll(nodes => nodes.map(node => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, width: rect.width };
        }));
        expect(Math.max(...boxes.map(box => box.left)) - Math.min(...boxes.map(box => box.left))).toBeLessThanOrEqual(1);
        expect(Math.max(...boxes.map(box => box.width)) - Math.min(...boxes.map(box => box.width))).toBeLessThanOrEqual(1);
      }
      await testInfo.attach(`${product.name}-settings-${language}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    });
  }

  test(`${product.name} a required password change opens the relevant section and action`, async ({ page }) => {
    await createAccount(page, `ForcedSettings_${product.name}`, "de", true);
    for (const suffix of ["#statistics", "?push=1#settings"]) {
      await page.goto(`${product.path}${suffix}`);
      await expect(page.locator('details[data-account-section="access"]')).toHaveAttribute("open", "");
      await expect(page.locator('details[data-account-action="password"]')).toHaveAttribute("open", "");
      await expect(page.locator(product.passwordForm)).toBeVisible();
      await expect(page.locator(product.passwordHint)).toContainText("temporäre Passwort muss jetzt geändert werden");
      await expect(page.getByRole("tab").nth(2)).toHaveAttribute("aria-selected", "true");
      await expect(page.locator('details[data-account-section="social"]')).not.toHaveAttribute("open", "");
    }
  });
}

test("separate language, chat and ZDWA gameplay saves preserve each other's choices across games", async ({ page }) => {
  await createAccount(page, "Settings_SavedChoices");
  await page.goto("/konto#settings");
  await openSection(page, "play");
  await openSection(page, "social");
  await page.locator('input[name="lobbyChatPopups"]').uncheck();
  await page.locator("#lobbyChatPreferencesForm button[type=submit]").click();
  await expect(page.locator("#lobbyChatPreferencesMessage")).toHaveText("Lobby-Chat-Einstellung gespeichert.");
  await page.locator('input[name="preferredLanguage"][value="en"]').check();
  await Promise.all([
    page.waitForEvent("load"),
    page.locator("#languagePreferencesForm button[type=submit]").click(),
  ]);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await openSection(page, "play");
  await page.locator('input[name="hapticFeedback"]').check();
  const gameplaySave = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/preferences" && response.request().method() === "PUT");
  await page.locator("#preferencesForm").getByRole("button").click();
  const gameplayPayload = (await gameplaySave).request().postDataJSON();
  expect(gameplayPayload).not.toHaveProperty("preferred_language");
  expect(gameplayPayload).not.toHaveProperty("lobby_chat_enabled");
  expect(gameplayPayload).not.toHaveProperty("lobby_chat_popups");
  await expect(page.locator("#preferencesMessage")).toHaveText("Game settings saved.");

  await page.goto("/zilch/konto#settings");
  await openSection(page, "play");
  await openSection(page, "social");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('input[name="zilchLobbyChatPopups"]')).not.toBeChecked();
  await page.locator('input[name="zilchLobbyChatEnabled"]').uncheck();
  await page.locator("#zilchLobbyChatPreferencesForm button[type=submit]").click();
  await expect(page.locator("#zilchLobbyChatPreferencesMessage")).toHaveText("Lobby chat setting saved.");

  await page.goto("/konto#settings");
  await openSection(page, "play");
  await openSection(page, "social");
  await expect(page.locator('input[name="hapticFeedback"]')).toBeChecked();
  await expect(page.locator('input[name="preferredLanguage"][value="en"]')).toBeChecked();
  await expect(page.locator('input[name="lobbyChatEnabled"]')).not.toBeChecked();
  await expect(page.locator('input[name="lobbyChatPopups"]')).not.toBeChecked();
});
