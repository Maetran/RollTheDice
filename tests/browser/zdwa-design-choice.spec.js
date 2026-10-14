const { test, expect } = require("@playwright/test");

// ZDWA design choice: the 2026 design is the default for everyone; accounts
// switch back in the settings (stored on the server), guests at the end of the
// lobby (stored in this browser). Accounts from before the release are asked
// once. New test accounts never existed before the release, so the one-time
// question is driven by a stubbed `prompt_pending` flag and claim endpoint;
// saving the choice always uses the real server.

test.use({ serviceWorkers: "block" });

const PASSWORD = "design-choice-password-123";
const DIALOG_TITLE = "Neues Design für ZDWA";
// Longer than the prompt's start delay (1.2 s) plus one retry.
const PROMPT_SETTLE_MS = 2_600;

async function createAccount(context, name) {
  const administrator = await context.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(administrator.ok()).toBeTruthy();
  const admin = (await administrator.json()).user;
  const created = await context.request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": admin.csrf_token },
    data: { username: name, temporary_password: "design-choice-temporary-123", role: "user" },
  });
  expect(created.status()).toBe(201);
  await signIn(context, name, "design-choice-temporary-123");
  const user = await currentUser(context);
  const changed = await context.request.post("/api/auth/change-password", {
    headers: { "X-CSRF-Token": user.csrf_token },
    data: { current_password: "design-choice-temporary-123", new_password: PASSWORD },
  });
  expect(changed.ok()).toBeTruthy();
  return signIn(context, name);
}

async function signIn(context, name, password = PASSWORD) {
  const response = await context.request.post("/api/auth/login", { data: { username: name, password } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).user;
}

async function currentUser(context) {
  const response = await context.request.get("/api/auth/me");
  expect(response.ok()).toBeTruthy();
  return (await response.json()).user;
}

async function quietReleases(context, viewerId = null) {
  await context.route("**/api/releases**", route => route.fulfill({
    json: { viewer_id: viewerId, current_version: null, releases: [], can_prompt: false },
  }));
}

/** Make the server report the one-time question as pending until it is claimed once. */
async function pendingPrompt(context, server) {
  await context.route("**/api/auth/me", async route => {
    const response = await route.fetch();
    const data = await response.json();
    if (data.user?.design) data.user.design.prompt_pending = server.claims === 0 && server.available !== false;
    if (server.available === false) {
      data.design = { zdwa_2026_available: false };
      if (data.user?.design) data.user.design.zdwa_2026_available = false;
    }
    await route.fulfill({ response, json: data });
  });
  await context.route("**/api/auth/design-prompt", async route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-csrf-token"]).toBeTruthy();
    server.claims += 1;
    await route.fulfill({ json: { show: server.claims === 1 && server.grant !== false } });
  });
}

function designOf(page) {
  return page.evaluate(() => document.documentElement.dataset.design || "");
}

/** The design after only the inline head script ran (before any bundle). */
async function recordFirstPaintDesign(page) {
  await page.addInitScript(() => {
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive") {
        window.__firstPaintDesign = document.documentElement.dataset.design || "";
      }
    }, { once: true });
  });
  return () => page.evaluate(() => window.__firstPaintDesign);
}

async function openDesignSettings(page) {
  await page.goto("/konto#settings");
  const play = page.locator('details[data-account-section="play"]');
  if (await play.getAttribute("open") === null) await play.locator(":scope > summary").click();
  const block = page.locator("#designSettings");
  await expect(block).toBeVisible();
  return block;
}

test("guests start with the new design and can switch back at the end of the lobby", async ({ page }) => {
  await quietReleases(page.context());
  const firstPaint = await recordFirstPaintDesign(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  expect(await firstPaint()).toBe("2026");

  const line = page.locator("[data-design-guest]");
  await expect(line).toBeVisible();
  await expect(line).toContainText("Du siehst das neue Design.");
  const toggle = line.getByRole("button", { name: "Zum bisherigen Design wechseln" });
  expect((await toggle.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(page.locator("html")).not.toHaveAttribute("data-design", /.*/);
  await expect(line).toContainText("Du siehst das bisherige Design.");
  await expect(line.getByRole("button", { name: "Neues Design ansehen" })).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("zdwa_design"))).toBe("old");

  // The head script reads the remembered choice: no flash of the new design.
  await page.reload();
  expect(await firstPaint()).toBe("");
  await expect(line).toContainText("Du siehst das bisherige Design.");
  await page.goto("/regeln");
  expect(await firstPaint()).toBe("");
  expect(await designOf(page)).toBe("");
  // Account action pages have no shell: their head script combines the
  // server's data-design-available with the choice in this browser.
  await page.goto("/passwort-vergessen");
  await expect(page.getByRole("heading", { name: "Passwort vergessen" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-design-available", "true");
  expect(await firstPaint()).toBe("");
  expect(await designOf(page)).toBe("");

  await page.goto("/");
  await line.getByRole("button", { name: "Neues Design ansehen" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  expect(await page.evaluate(() => localStorage.getItem("zdwa_design"))).toBe("new");
  await page.goto("/passwort-vergessen");
  expect(await firstPaint()).toBe("2026");
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
});

test("new accounts get the new design without the one-time question", async ({ page }) => {
  const user = await createAccount(page.context(), `DesignNew${Date.now().toString(36).slice(-6)}`);
  expect(user.design).toEqual({ zdwa_2026_available: true, zdwa: "new", prompt_pending: false });
  await quietReleases(page.context(), user.id);
  const claims = [];
  page.on("request", request => {
    if (request.url().includes("/api/auth/design-prompt")) claims.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator("#authBadge")).toContainText(user.username);
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  await page.waitForTimeout(PROMPT_SETTLE_MS);
  await expect(page.getByRole("dialog", { name: DIALOG_TITLE })).toHaveCount(0);
  await expect(page.locator("[data-design-guest]")).toBeHidden();
  expect(claims).toEqual([]);
});

test("account settings save the design, apply it at once and keep it on reload and other devices", async ({ page, browser, baseURL }) => {
  const name = `DesignSet${Date.now().toString(36).slice(-6)}`;
  const user = await createAccount(page.context(), name);
  await quietReleases(page.context(), user.id);
  const block = await openDesignSettings(page);
  await expect(block.getByRole("heading", { name: "Aussehen" })).toBeVisible();
  // The one-time question names this path; the group says it holds the design.
  const group = page.locator('details[data-account-section="play"] > summary');
  await expect(group).toContainText("Sprache & Spiel");
  await expect(group).toContainText("Sprache, Design und persönliche Spielbedienung");
  await expect(block.getByRole("radio", { name: /^Neues Design/ })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");

  await block.getByRole("radio", { name: "Bisheriges Design" }).check();
  await block.getByRole("button", { name: "Design speichern" }).click();
  await expect(page.locator("#designPreferencesMessage")).toHaveText("Design gespeichert.");
  await expect(page.locator("html")).not.toHaveAttribute("data-design", /.*/);
  expect((await currentUser(page.context())).design.zdwa).toBe("old");

  const firstPaint = await recordFirstPaintDesign(page);
  await page.reload();
  expect(await firstPaint()).toBe("");
  await openDesignSettings(page);
  await expect(block.getByRole("radio", { name: "Bisheriges Design" })).toBeChecked();
  expect(await designOf(page)).toBe("");

  // Another device without any remembered value follows the account.
  const device = await browser.newContext({ baseURL, serviceWorkers: "block" });
  try {
    await quietReleases(device, user.id);
    await signIn(device, name);
    const other = await device.newPage();
    await other.goto("/");
    await expect(other.locator("#authBadge")).toContainText(name);
    await expect(other.locator("html")).not.toHaveAttribute("data-design", /.*/);
    await other.waitForTimeout(PROMPT_SETTLE_MS);
    await expect(other.getByRole("dialog", { name: DIALOG_TITLE })).toHaveCount(0);
  } finally {
    await device.close();
  }

  await block.getByRole("radio", { name: /^Neues Design/ }).check();
  await block.getByRole("button", { name: "Design speichern" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  expect((await currentUser(page.context())).design.zdwa).toBe("new");
});

test("?design=classic keeps the old design in this browser until ?design=2026", async ({ page }) => {
  await quietReleases(page.context());
  await page.goto("/?design=classic");
  await expect(page.locator("html")).not.toHaveAttribute("data-design", /.*/);
  // The override is a browser setting; the guest switch would not change anything.
  await expect(page.locator("[data-design-guest]")).toBeHidden();
  const firstPaint = await recordFirstPaintDesign(page);
  await page.goto("/spieler");
  expect(await firstPaint()).toBe("");
  expect(await designOf(page)).toBe("");
  await page.goto("/?design=2026");
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  await expect(page.locator("[data-design-guest]")).toBeVisible();
  await page.goto("/regeln");
  expect(await firstPaint()).toBe("2026");
});

test("accounts from before the release are asked once and can preview and keep the old design", async ({ page, browser, baseURL }) => {
  const name = `DesignAsk${Date.now().toString(36).slice(-6)}`;
  const user = await createAccount(page.context(), name);
  const server = { claims: 0 };
  await quietReleases(page.context(), user.id);
  await pendingPrompt(page.context(), server);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const dialog = page.getByRole("dialog", { name: DIALOG_TITLE });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Lieber das gewohnte Aussehen?");
  await expect(dialog).toContainText("im Konto unter Einstellungen → Sprache & Spiel → Aussehen");
  const toggle = dialog.getByRole("switch", { name: "Neues Design verwenden" });
  await expect(toggle).toBeChecked();
  const row = page.locator(".design-choice-switch");
  expect((await row.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  // Toggling previews at once. The question is spent once shown, so closing
  // with ×, Escape or a tap outside keeps the design the switch shows.
  await row.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("html")).not.toHaveAttribute("data-design", /.*/);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  await page.keyboard.press("Space");
  await expect(page.locator("html")).not.toHaveAttribute("data-design", /.*/);
  // Returning to the tab refreshes the identity; that must not undo the preview.
  await Promise.all([
    page.waitForResponse(response => response.url().includes("/api/auth/me")),
    page.evaluate(() => window.dispatchEvent(new Event("focus"))),
  ]);
  await page.waitForTimeout(200);
  await expect(page.locator("html")).not.toHaveAttribute("data-design", /.*/);
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator(".design-choice-switch")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-design", /.*/);
  await expect.poll(async () => (await currentUser(page.context())).design.zdwa).toBe("old");
  expect(server.claims).toBe(1);

  // The question is spent: not again after a reload or on another device.
  await page.reload();
  await expect(page.locator("#authBadge")).toContainText(name);
  await page.waitForTimeout(PROMPT_SETTLE_MS);
  await expect(dialog).toHaveCount(0);
  expect(await designOf(page)).toBe("");
  expect(server.claims).toBe(1);

  const device = await browser.newContext({ baseURL, serviceWorkers: "block" });
  try {
    await quietReleases(device, user.id);
    await pendingPrompt(device, server);
    await signIn(device, name);
    const other = await device.newPage();
    await other.goto("/");
    await expect(other.locator("#authBadge")).toContainText(name);
    await other.waitForTimeout(PROMPT_SETTLE_MS);
    await expect(other.getByRole("dialog", { name: DIALOG_TITLE })).toHaveCount(0);
    expect(server.claims).toBe(1);
  } finally {
    await device.close();
  }
});

test("choosing the old design in the one-time question is saved to the account", async ({ page, browser, baseURL }) => {
  const name = `DesignOld${Date.now().toString(36).slice(-6)}`;
  const user = await createAccount(page.context(), name);
  const server = { claims: 0 };
  await quietReleases(page.context(), user.id);
  await pendingPrompt(page.context(), server);
  await page.goto("/");

  const dialog = page.getByRole("dialog", { name: DIALOG_TITLE });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("switch", { name: "Neues Design verwenden" }).uncheck();
  await expect(page.locator("html")).not.toHaveAttribute("data-design", /.*/);

  // A failed save keeps the dialog open, explains it and keeps the preview.
  await page.route("**/api/auth/preferences/design", route => route.fulfill({ status: 503, json: { detail: "unavailable" } }));
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toContainText("Das Design konnte nicht gespeichert werden.");
  await expect(dialog).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-design", /.*/);
  expect((await currentUser(page.context())).design.zdwa).toBe("new");
  await page.unroute("**/api/auth/preferences/design");

  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("html")).not.toHaveAttribute("data-design", /.*/);
  expect((await currentUser(page.context())).design.zdwa).toBe("old");
  expect(await page.evaluate(() => localStorage.getItem("zdwa_design"))).toBe("old");

  // No flash of the new design on the next page load.
  const firstPaint = await recordFirstPaintDesign(page);
  await page.reload();
  expect(await firstPaint()).toBe("");
  await expect(page.locator("#authBadge")).toContainText(name);
  expect(await designOf(page)).toBe("");

  // The game room applies the account choice through its own sign-in, even
  // when this browser has forgotten the remembered value.
  await Promise.all([
    page.waitForURL(/\/spiel\/[^/?]+$/),
    page.locator("#createBtn").click(),
  ]);
  await expect(page.locator(".player-card.me")).toContainText(name);
  expect(await designOf(page)).toBe("");
  await page.evaluate(() => localStorage.removeItem("zdwa_design"));
  await page.reload();
  await expect(page.locator(".player-card.me")).toContainText(name);
  await expect(page.locator("html")).not.toHaveAttribute("data-design", /.*/);

  const device = await browser.newContext({ baseURL, serviceWorkers: "block" });
  try {
    await quietReleases(device, user.id);
    await signIn(device, name);
    const other = await device.newPage();
    await openDesignSettings(other);
    await expect(other.getByRole("radio", { name: "Bisheriges Design" })).toBeChecked();
    expect(await designOf(other)).toBe("");
  } finally {
    await device.close();
  }
});

test("closing the question while the save is still running keeps the saved design", async ({ page }) => {
  const name = `DesignEsc${Date.now().toString(36).slice(-6)}`;
  const user = await createAccount(page.context(), name);
  const server = { claims: 0 };
  await quietReleases(page.context(), user.id);
  await pendingPrompt(page.context(), server);
  await page.goto("/");

  const dialog = page.getByRole("dialog", { name: DIALOG_TITLE });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("switch", { name: "Neues Design verwenden" }).uncheck();
  let failSave;
  const saveHeld = new Promise(resolve => { failSave = resolve; });
  await page.route("**/api/auth/preferences/design", async route => {
    await saveHeld;
    await route.fulfill({ status: 503, json: { detail: "unavailable" } });
  });
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  failSave();

  // The question is spent: say where to change the design and show the saved
  // one again instead of an unsaved preview.
  const alert = page.getByRole("alert").filter({ hasText: "Das Design konnte nicht gespeichert werden." });
  await expect(alert).toContainText("Einstellungen → Sprache & Spiel → Aussehen");
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  expect(await page.evaluate(() => window.ZDWA_DESIGN.state()))
    .toMatchObject({ choice: "new", shown: "new", previewing: false });
  expect((await currentUser(page.context())).design.zdwa).toBe("new");
  expect(server.claims).toBe(1);
});

test("a tap outside or leaving the page keeps the design the switch shows", async ({ page }) => {
  const name = `DesignOut${Date.now().toString(36).slice(-6)}`;
  const user = await createAccount(page.context(), name);
  const server = { claims: 0 };
  await quietReleases(page.context(), user.id);
  await pendingPrompt(page.context(), server);
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/");

  const dialog = page.getByRole("dialog", { name: DIALOG_TITLE });
  const toggle = dialog.getByRole("switch", { name: "Neues Design verwenden" });
  await expect(dialog).toBeVisible();
  await toggle.uncheck();
  await page.mouse.click(8, 8);
  await expect(dialog).toBeHidden();
  await expect(page.locator("html")).not.toHaveAttribute("data-design", /.*/);
  await expect.poll(async () => (await currentUser(page.context())).design.zdwa).toBe("old");

  // Asked again (stubbed): the switch starts from the saved choice, and a
  // reload with the dialog open still saves the changed switch.
  server.claims = 0;
  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  await page.reload();
  await expect.poll(async () => (await currentUser(page.context())).design.zdwa).toBe("new");
  expect(server.claims).toBe(1);
});

test("offline play follows the design chosen online", async ({ page }) => {
  const firstPaint = await recordFirstPaintDesign(page);
  await page.goto("/offline-spielen");
  await expect(page.getByRole("heading", { name: "Einfach für dich würfeln" })).toBeVisible();
  expect(await firstPaint()).toBe("2026");
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  await page.evaluate(() => localStorage.setItem("zdwa_design", "old"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Einfach für dich würfeln" })).toBeVisible();
  expect(await firstPaint()).toBe("");
  expect(await designOf(page)).toBe("");
});

test("a guest who switched back keeps the previous design when creating an account", async ({ page }) => {
  await quietReleases(page.context());
  await page.goto("/");
  await page.locator("[data-design-guest]").getByRole("button", { name: "Zum bisherigen Design wechseln" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-design", /.*/);
  // The lobby form calls this same registration helper.
  const name = `DesignGuest${Date.now().toString(36).slice(-6)}`;
  const design = await page.evaluate(async username => {
    const auth = await import("/static/auth.js");
    const data = await auth.register(username, null, null, "design-guest-password-123");
    return data.user.design;
  }, name);
  expect(design).toMatchObject({ zdwa: "old", prompt_pending: false });
  expect((await currentUser(page.context())).design.zdwa).toBe("old");
  await page.reload();
  await expect(page.locator("#authBadge")).toContainText(name);
  expect(await designOf(page)).toBe("");
});

test("the one-time question waits for a release announcement and never stacks on it", async ({ page }) => {
  const name = `DesignRel${Date.now().toString(36).slice(-6)}`;
  const user = await createAccount(page.context(), name);
  const server = { claims: 0 };
  await pendingPrompt(page.context(), server);
  const release = {
    revision: "d".repeat(40), version: "9.9.9", published_at: new Date().toISOString(),
    title: "Neues Design", changes: ["ZDWA hat ein neues Design."], acknowledged: false, can_announce: true,
  };
  await page.context().route("**/api/releases**", async route => {
    if (route.request().method() === "POST") {
      release.acknowledged = true;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { viewer_id: user.id, current_version: "9.9.9", releases: [release], can_prompt: true } });
  });
  await page.goto("/");

  const announcement = page.locator(".release-notes-dialog");
  await expect(announcement).toBeVisible();
  await page.waitForTimeout(PROMPT_SETTLE_MS);
  await expect(page.locator("#appDialog")).toBeHidden();
  expect(server.claims).toBe(0);
  await announcement.getByRole("button", { name: "Verstanden" }).click();
  await expect(announcement).toHaveCount(0);
  const dialog = page.getByRole("dialog", { name: DIALOG_TITLE });
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  expect(server.claims).toBe(1);
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
});

test("a question claimed on another device is not shown here", async ({ page }) => {
  const user = await createAccount(page.context(), `DesignLost${Date.now().toString(36).slice(-6)}`);
  const server = { claims: 0, grant: false };
  await quietReleases(page.context(), user.id);
  await pendingPrompt(page.context(), server);
  await page.goto("/");
  await expect.poll(() => server.claims).toBe(1);
  await page.waitForTimeout(800);
  await expect(page.getByRole("dialog", { name: DIALOG_TITLE })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
});

test("with the server switch off nobody sees the new design, the question or the setting", async ({ page }) => {
  const user = await createAccount(page.context(), `DesignOff${Date.now().toString(36).slice(-6)}`);
  const server = { claims: 0, available: false };
  await quietReleases(page.context(), user.id);
  await pendingPrompt(page.context(), server);
  await page.goto("/");
  await expect(page.locator("#authBadge")).toContainText(user.username);
  await expect(page.locator("html")).not.toHaveAttribute("data-design", /.*/);
  expect(await page.evaluate(() => localStorage.getItem("zdwa_design_off"))).toBe("1");
  await page.waitForTimeout(PROMPT_SETTLE_MS);
  await expect(page.getByRole("dialog", { name: DIALOG_TITLE })).toHaveCount(0);
  expect(server.claims).toBe(0);

  const firstPaint = await recordFirstPaintDesign(page);
  await page.goto("/regeln");
  expect(await firstPaint()).toBe("");
  await page.goto("/konto#settings");
  await expect(page.locator('details[data-account-section="play"]')).toBeAttached();
  await expect(page.locator("#designSettings")).toBeHidden();
  expect(await designOf(page)).toBe("");

  // Switching the server back on restores the default for everyone.
  server.available = true;
  server.claims = 1;
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  expect(await page.evaluate(() => localStorage.getItem("zdwa_design_off"))).toBeNull();
});
