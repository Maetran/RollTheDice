const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

async function preparePreviewLogin(page) {
  const adminLogin = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(adminLogin.ok()).toBeTruthy();
  const admin = (await adminLogin.json()).user;
  const created = await page.request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": admin.csrf_token },
    data: { username: "PreviewFriend", temporary_password: "preview-friend-password-123", role: "user" },
  });
  expect([201, 400]).toContain(created.status());
  const login = password => page.request.post("/api/auth/login", { data: { username: "PreviewFriend", password } });
  let response = await login("preview-friend-password-123");
  expect(response.ok()).toBeTruthy();
  let player = (await response.json()).user;
  if (player.must_change_password) {
    // Complete the real password-change requirement, retaining the shared
    // fixture's established password for other browser specs afterwards.
    for (const [current, next] of [
      ["preview-friend-password-123", "navigation-intermediate-password"],
      ["navigation-intermediate-password", "preview-friend-password-123"],
    ]) {
      const changed = await page.request.post("/api/auth/change-password", {
        headers: { "X-CSRF-Token": player.csrf_token },
        data: { current_password: current, new_password: next },
      });
      expect(changed.ok()).toBeTruthy();
      response = await login(next);
      expect(response.ok()).toBeTruthy();
      player = (await response.json()).user;
    }
  }
  expect(player.must_change_password).toBe(false);
  await page.context().clearCookies();
}

for (const [path, heading] of [
  ["/registrierung/bestaetigen", "Konto bestätigen"],
  ["/email-bestaetigen", "E-Mail-Adresse bestätigen"],
]) {
  test(`${path} missing-token error provides a working return to sign in`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("link", { name: "Zur Anmeldung", exact: true }).click();
    await expect(page).toHaveURL(/\/\?lang=de#accountLogin$/);
    await expect(page.locator("#accountLogin")).toBeVisible();
  });
}

test("expired reset link reaches a fresh request and keeps Zilch and English context", async ({ page }) => {
  await page.route("**/api/auth/password-reset/inspect", route => route.fulfill({ json: { valid: false } }));
  const requests = [];
  await page.route("**/api/auth/password-reset", async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/passwort-zuruecksetzen?app=zilch&lang=en#token=expired-test-token");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).not.toHaveURL(/token=/);
  await page.getByRole("link", { name: "Request a new password reset link", exact: true }).click();
  await expect(page).toHaveURL(/\/passwort-vergessen\?lang=en&app=zilch$/);
  await page.getByLabel("Email address", { exact: true }).fill("navigation@example.test");
  await page.getByRole("button", { name: "Send reset link", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("If the address belongs to a confirmed account");
  expect(requests).toEqual([{ email: "navigation@example.test", preferred_language: "en" }]);
  await page.getByRole("link", { name: "Go to sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/zilch\/anmelden\?lang=en&app=zilch$/);
  await expect(page.getByRole("heading", { name: "Sign in to Zilch", exact: true })).toBeVisible();
  await page.locator("#zilchPasswordLogin > summary").click();
  await expect(page.locator("#zilchLoginForm")).toBeVisible();
});

test("reset inspection failure has recovery links and does not leak its token", async ({ page }) => {
  await page.route("**/api/auth/password-reset/inspect", route => route.fulfill({ status: 503, json: { detail: "unavailable" } }));
  await page.goto("/passwort-zuruecksetzen#token=offline-test-token");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("link", { name: "Neuen Passwort-Link anfordern", exact: true })).toHaveAttribute("href", "/passwort-vergessen?lang=de");
  await expect(page.getByRole("link", { name: "Zur Anmeldung", exact: true })).toHaveAttribute("href", "/?lang=de#accountLogin");
  await expect(page).not.toHaveURL(/token=/);
  await expect(page.locator('a[href*="token"]')).toHaveCount(0);
});

test("a successful password reset returns to the requested app sign in", async ({ page }) => {
  await page.route("**/api/auth/password-reset/inspect", route => route.fulfill({ json: { valid: true } }));
  await page.route("**/api/auth/password-reset/complete", route => route.fulfill({ json: { ok: true } }));
  await page.goto("/passwort-zuruecksetzen?app=zilch#token=valid-test-token");
  await page.getByLabel("Neues Passwort", { exact: true }).fill("navigation-reset-password");
  await page.getByLabel("Neues Passwort wiederholen", { exact: true }).fill("navigation-reset-password");
  await page.getByRole("button", { name: "Passwort speichern", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dein Passwort wurde geändert.", exact: true })).toBeVisible();
  const login = page.getByRole("link", { name: "Zur Anmeldung", exact: true });
  await expect(login).toHaveAttribute("href", "/zilch/anmelden?lang=de&app=zilch");
  await login.click();
  await page.locator("#zilchPasswordLogin > summary").click();
  await expect(page.locator("#zilchLoginForm")).toBeVisible();
});

test("Zilch password help returns to Zilch sign in without trapping the user", async ({ page }) => {
  const returnTo = "/auth/continue?app=zilch&path=%2Fkonto";
  await page.goto(`/zilch/anmelden?return_to=${encodeURIComponent(returnTo)}`);
  await page.locator("#zilchPasswordLogin > summary").click();
  const forgot = page.locator("#zilchForgotPassword");
  await expect(forgot).toHaveAttribute("href", /\/passwort-vergessen\?app=zilch&lang=de&return_to=/);
  await forgot.click();
  await expect(page.getByRole("heading", { name: "Passwort vergessen", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Zur Anmeldung", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("return_to")).toBe(returnTo);
  await page.locator("#zilchPasswordLogin > summary").click();
  await expect(page.locator("#zilchLoginForm")).toBeVisible();
});

test("Zilch standalone login uses the fixed apex for password help", async ({ page }, testInfo) => {
  const origin = "https://zilch.zockdiewandan.online";
  const localOrigin = testInfo.project.use.baseURL;
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
  // Serve the local login document at the production host without contacting
  // a live app or account. This exercises the browser's real host/PWA branch.
  await page.route(`${origin}/**`, async route => {
    const request = new URL(route.request().url());
    const response = await page.request.get(`${localOrigin}${request.pathname}${request.search}`, { maxRedirects: 0 });
    await route.fulfill({ response });
  });
  await page.goto(`${origin}/zilch/anmelden`);
  await expect(page.locator("#zilchForgotPassword")).toHaveAttribute("href", "https://zockdiewandan.online/passwort-vergessen?app=zilch&lang=de");
});

for (const handoff of [false, true]) {
  for (const tab of ["settings", "achievements"]) {
    test(`guest account link keeps ${tab} after ${handoff ? "product handoff" : "direct"} sign in`, async ({ page, baseURL, browserName }) => {
      await preparePreviewLogin(page);
      if (handoff) {
        // Exercise the real handoff, but keep its final product navigation on
        // the isolated local server. WebKit cannot fulfill a mocked 303, so
        // this local document models its preserved fragment explicitly.
        await page.route("**/auth/continue?**", async route => {
          const response = await route.fetch({ maxRedirects: 0 });
          expect(response.status()).toBe(303);
          const target = new URL(response.headers().location);
          expect(target.origin).toBe("https://zilch.zockdiewandan.online");
          expect(target.pathname).toBe("/konto");
          const destination = `/zilch${target.pathname}${target.search}`;
          if (browserName === "webkit") {
            await route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><script>location.replace(${JSON.stringify(destination)} + location.hash)</script>` });
          } else {
            await route.fulfill({ status: 303, headers: { location: `${baseURL}${destination}` }, body: "" });
          }
        });
        const returnTo = "/auth/continue?app=zilch&path=%2Fkonto";
        await page.goto(`/zilch/anmelden?return_to=${encodeURIComponent(returnTo)}#${tab}`);
      } else {
        await page.goto(`/zilch/konto#${tab}`);
        await expect(page).toHaveURL(new RegExp(`/zilch/anmelden\\?return_to=.*#${tab}$`));
      }
      await page.locator("#zilchPasswordLogin > summary").click();
      await page.locator("#zilchLoginUsername").fill("PreviewFriend");
      await page.locator("#zilchLoginPassword").fill("preview-friend-password-123");
      await page.locator('#zilchLoginForm button[type="submit"]').click();
      await expect(page).toHaveURL(`${baseURL}/zilch/konto#${tab}`);
      await expect(page.locator(`#zilchAccountTab-${tab}`)).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(`#zilchAccountPanel-${tab}`)).toBeVisible();
    });
  }
}

test("account login ignores an unknown inherited tab", async ({ page }) => {
  await preparePreviewLogin(page);
  await page.goto("/zilch/konto#unknown-tab");
  await page.locator("#zilchPasswordLogin > summary").click();
  await page.locator("#zilchLoginUsername").fill("PreviewFriend");
  await page.locator("#zilchLoginPassword").fill("preview-friend-password-123");
  await page.locator('#zilchLoginForm button[type="submit"]').click();
  await expect(page).toHaveURL(/\/zilch\/konto$/);
  await expect(page.locator("#zilchAccountTab-statistics")).toHaveAttribute("aria-selected", "true");
});
