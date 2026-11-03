const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

const FRIENDS = Array.from({ length: 22 }, (_value, index) => `PaFriend${String(index + 1).padStart(2, "0")}`);
const onlyList = /Nur Spielern aus deiner Liste/;

async function signIn(page) {
  const admin = await page.request.post("/api/auth/login", { data: { username: "Admin", password: "temporary-password-123" } });
  expect(admin.ok()).toBeTruthy();
  const adminUser = (await admin.json()).user;
  for (const [username, role] of [["Mani", "admin"], ...FRIENDS.map(name => [name, "user"])]) {
    const result = await page.request.post("/api/admin/users", {
      headers: { "X-CSRF-Token": adminUser.csrf_token },
      data: { username, temporary_password: "mani-preview-password-123", role },
    });
    expect([201, 400]).toContain(result.status());
  }
  await page.request.post("/api/auth/logout", { headers: { "X-CSRF-Token": adminUser.csrf_token } });
  const login = await page.request.post("/api/auth/login", { data: { username: "Mani", password: "mani-preview-password-123" } });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user;
  const current = await (await page.request.get("/api/web-push/allowlist")).json();
  for (const player of current.players) await page.request.delete(`/api/web-push/allowlist/${player.id}`, {
    headers: { "X-CSRF-Token": user.csrf_token }, data: { viewer_id: user.id },
  });
  await page.request.put("/api/web-push/allowlist", { headers: { "X-CSRF-Token": user.csrf_token }, data: { viewer_id: user.id, audience: "all" } });
  return user;
}

async function openSettings(page, product) {
  await page.goto(product.account);
  if (product.section) {
    const details = page.locator(`details[data-account-section="${product.section}"]`);
    if (await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
  }
  const settings = page.locator("[data-allowlist-settings]");
  await expect(settings.getByRole("heading", { name: "Spieler hinzufügen", exact: true })).toBeVisible();
  return settings;
}

const searchRow = (settings, name) => settings.locator(".player-allowlist-results li").filter({ has: settings.page().getByRole("link", { name, exact: true }) });
const memberRow = (settings, name) => settings.locator(".player-allowlist-members-list li").filter({ hasText: name });

for (const product of [
  { name: "ZDWA", account: "/konto#settings", section: "social", profile: "/spieler/" },
  { name: "Zilch", account: "/zilch/konto#settings", section: "social", profile: "/zilch/spieler/" },
  { name: "Hausdepp", account: "/hausdepp/konto/einstellungen?allowlist=1#spielerauswahl", profile: "/spieler/" },
]) {
  test(`${product.name} account manages the private cross-game list with search, filter and removal on mobile`, async ({ page }, testInfo) => {
    const user = await signIn(page);
    const pushBefore = await (await page.request.get("/api/web-push/subscription")).json();
    await page.setViewportSize({ width: 390, height: 844 });
    const settings = await openSettings(page, product);
    await expect(settings.locator(".player-allowlist-empty")).toBeVisible();
    await expect(settings).toContainText("ohne Freundschaftsanfrage");

    // The filter is a draft until saved; an empty list warns that it blocks every invitation.
    await settings.getByRole("radio", { name: onlyList }).check();
    await expect(settings.getByText("Noch nicht gespeichert.")).toBeVisible();
    const warning = settings.getByText("Deine Liste ist leer: Mit diesem Filter erreicht dich gerade keine Mitspieler-Einladung.");
    await expect(warning).toBeVisible();
    await settings.getByRole("button", { name: "Einladungsauswahl speichern" }).click();
    await expect(settings.locator(".player-allowlist-message")).toHaveText("Spielerauswahl gespeichert.");
    await expect(settings.getByText("Noch nicht gespeichert.")).toBeHidden();

    const search = settings.getByLabel("Spielername suchen");
    await search.fill("PaFriend");
    await expect(settings.locator(".player-allowlist-results li")).toHaveCount(20);
    await expect(settings.getByText("20 Treffer angezeigt, weitere verfügbar.")).toBeVisible();
    const more = settings.getByRole("button", { name: "Weitere Treffer laden" });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(settings.locator(".player-allowlist-results li")).toHaveCount(22);
    await expect(more).toBeHidden();
    // Keyboard focus continues at the first newly loaded hit, not the page start.
    await expect(searchRow(settings, "PaFriend21").getByRole("link")).toBeFocused();

    await search.fill("Mani");
    await expect(searchRow(settings, "Mani").getByText("Dein Konto", { exact: true })).toBeVisible();
    await expect(searchRow(settings, "Mani").getByRole("button")).toHaveCount(0);

    await search.fill("PaFriend0");
    const add = settings.getByRole("button", { name: "PaFriend01 zur Spielerauswahl hinzufügen", exact: true });
    await add.click();
    const added = settings.getByRole("button", { name: "PaFriend01 ist schon in deiner Liste", exact: true });
    await expect(added).toHaveAttribute("aria-disabled", "true");
    await expect(added).toBeFocused();
    await expect(settings.locator(".player-allowlist-message")).toHaveText("PaFriend01 ist jetzt in deiner Liste.");
    await expect(search).toHaveValue("PaFriend0");
    await expect(warning).toBeHidden();
    await settings.getByRole("button", { name: "PaFriend02 zur Spielerauswahl hinzufügen", exact: true }).click();
    await expect(memberRow(settings, "PaFriend02")).toBeVisible();
    await expect(settings.getByText("2 von 100 Spielern in deiner Liste")).toBeVisible();
    await expect(memberRow(settings, "PaFriend01").getByRole("link", { name: "PaFriend01", exact: true })).toHaveAttribute("href", `${product.profile}PaFriend01`);

    const filter = settings.getByLabel("In deiner Liste filtern");
    await filter.fill("02");
    await expect(memberRow(settings, "PaFriend01")).toBeHidden();
    await expect(settings.getByText("1 von 2 Spielern angezeigt.")).toBeVisible();
    await settings.getByRole("button", { name: "PaFriend02 aus Spielerauswahl entfernen", exact: true }).click();
    await expect(settings.locator(".player-allowlist-message")).toHaveText("PaFriend02 wurde aus deiner Liste entfernt.");
    // No remaining visible row: focus lands on the filter, whose text survives the save.
    await expect(filter).toBeFocused();
    await expect(filter).toHaveValue("02");
    await expect(settings.getByText("Niemand in deiner Liste passt zu „02“.")).toBeVisible();
    await expect(settings.getByRole("button", { name: "PaFriend02 zur Spielerauswahl hinzufügen", exact: true })).toHaveAttribute("aria-disabled", "false");

    const selection = await (await page.request.get("/api/web-push/allowlist")).json();
    expect(selection.viewer_id).toBe(user.id);
    expect(selection.audience).toBe("allowlist");
    expect(selection.players.map(player => player.username)).toEqual(["PaFriend01"]);
    const pushAfter = await (await page.request.get("/api/web-push/subscription")).json();
    for (const key of ["subscribed", "game_invites_enabled", "daily_reminder_enabled", "release_notifications_enabled"]) expect(pushAfter[key]).toBe(pushBefore[key]);

    await filter.fill("");
    for (const control of await settings.locator("button:visible, input[type=search]:visible, .player-allowlist-choice:visible").all()) {
      expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => document.activeElement?.blur());
    await settings.screenshot({ path: testInfo.outputPath("allowlist-settings-mobile.png") });
  });
}

test("typing a new search retires load-more and never mixes pages of the older query", async ({ page }) => {
  await signIn(page);
  const searches = [];
  page.on("request", request => { if (request.url().includes("/api/players/search")) searches.push(new URL(request.url()).searchParams); });
  const settings = await openSettings(page, { account: "/konto#settings", section: "social" });
  const search = settings.getByLabel("Spielername suchen");
  await search.fill("PaFriend");
  const more = settings.getByRole("button", { name: "Weitere Treffer laden" });
  await expect(more).toBeVisible();
  await search.fill("PaFriend1");
  // Within the debounce window the old generation's "load more" is already gone.
  await expect(more).toBeHidden();
  await expect(settings.locator(".player-allowlist-results li")).toHaveCount(10);
  for (const name of await settings.locator(".player-allowlist-results .player-allowlist-name").allTextContents()) expect(name).toMatch(/^PaFriend1/);
  expect(searches.filter(params => params.get("query") === "PaFriend1").map(params => params.get("offset"))).toEqual(["0"]);
});

test("search results respect a running save and a list save keeps a failed search retryable", async ({ page }) => {
  const user = await signIn(page);
  const friend = (await (await page.request.get("/api/players/PaFriend03")).json()).player;
  await page.request.put(`/api/web-push/allowlist/${friend.id}`, { headers: { "X-CSRF-Token": user.csrf_token }, data: { viewer_id: user.id } });
  const settings = await openSettings(page, { account: "/konto#settings", section: "social" });
  const search = settings.getByLabel("Spielername suchen");

  let release;
  await page.route("**/api/web-push/allowlist/*", async route => {
    if (route.request().method() !== "PUT") return route.continue();
    await new Promise(resolve => { release = resolve; });
    return route.continue();
  });
  await search.fill("PaFriend0");
  await settings.getByRole("button", { name: "PaFriend01 zur Spielerauswahl hinzufügen", exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  // Results painted during the save must not look clickable while writes are blocked.
  await search.fill("PaFriend1");
  const pending = settings.getByRole("button", { name: "PaFriend10 zur Spielerauswahl hinzufügen", exact: true });
  await expect(pending).toHaveAttribute("aria-disabled", "true");
  release();
  await expect(settings.locator(".player-allowlist-message")).toHaveText("PaFriend01 ist jetzt in deiner Liste.");
  await expect(pending).toHaveAttribute("aria-disabled", "false");
  await page.unroute("**/api/web-push/allowlist/*");

  await page.route("**/api/players/search*", route => route.fulfill({ status: 500, json: { detail: "unavailable" } }));
  await search.fill("PaFriend");
  const status = settings.getByText("Die Spielersuche ist gerade nicht erreichbar.");
  const retry = settings.getByRole("button", { name: "Suche erneut versuchen" });
  await expect(status).toBeVisible();
  await expect(retry).toBeVisible();
  await settings.getByRole("button", { name: "PaFriend03 aus Spielerauswahl entfernen", exact: true }).click();
  await expect(settings.locator(".player-allowlist-message")).toHaveText("PaFriend03 wurde aus deiner Liste entfernt.");
  await expect(status).toBeVisible();
  await expect(retry).toBeVisible();
  await page.unroute("**/api/players/search*");
  await retry.click();
  await expect(settings.locator(".player-allowlist-results li")).toHaveCount(20);
  await expect(retry).toBeHidden();
});

test("deactivated accounts stay removable without a profile link and names are shown literally", async ({ page }) => {
  const user = await signIn(page);
  await page.route("**/api/web-push/allowlist", route => route.fulfill({ json: { viewer_id: user.id, audience: "allowlist", limit: 100, players: [
    { id: 999001, username: "<img src=x onerror=alert(1)>", active: true },
    { id: 999002, username: "Spieler", active: false },
  ] } }));
  const settings = await openSettings(page, { account: "/konto#settings", section: "social" });
  await expect(settings.getByRole("link", { name: "<img src=x onerror=alert(1)>", exact: true })).toBeVisible();
  await expect(settings.locator(".player-allowlist-members-list img")).toHaveCount(0);
  const inactive = memberRow(settings, "Spieler");
  await expect(inactive.getByText("Konto deaktiviert")).toBeVisible();
  await expect(inactive.getByRole("link")).toHaveCount(0);
  await expect(inactive.getByRole("button", { name: "Spieler aus Spielerauswahl entfernen", exact: true })).toBeVisible();
});

test("account management is fully translated into English and keeps literal player names", async ({ page }) => {
  await signIn(page);
  const auth = await (await page.request.get("/api/auth/me")).json();
  await page.route("**/api/auth/me", route => route.fulfill({ json: { ...auth,
    user: { ...auth.user, preferences: { ...auth.user.preferences, preferred_language: "en" } },
  } }));
  await page.goto("/konto#settings");
  const details = page.locator('details[data-account-section="social"]');
  if (await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
  const settings = page.locator("[data-allowlist-settings]");
  await expect(settings.getByText("Your list is still empty.", { exact: false })).toBeVisible();
  await settings.getByRole("radio", { name: /Only players on your list/ }).check();
  await expect(settings.getByText("Your list is empty: with this filter, no player invitations reach you right now.")).toBeVisible();
  await settings.getByLabel("Search player name").fill("PaFriend0");
  await settings.getByRole("button", { name: "Add PaFriend01 to player selection", exact: true }).click();
  await expect(settings.locator(".player-allowlist-message")).toHaveText("PaFriend01 is now on your list.");
  await expect(settings.getByRole("button", { name: "PaFriend01 is already on your list", exact: true })).toHaveText("Already on your list");
  await expect(settings.getByText("1 of 100 players on your list")).toBeVisible();
  await expect(settings.getByRole("button", { name: "Remove PaFriend01 from player selection", exact: true })).toBeVisible();
  await expect(settings.getByLabel("Filter your list")).toBeVisible();
  await expect(settings.getByText("9 results.")).toBeVisible();
});
