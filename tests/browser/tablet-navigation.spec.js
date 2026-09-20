const { test, expect } = require("@playwright/test");

const tabletQuery = "(any-pointer: coarse) and (min-width: 768px) and (min-height: 600px) and (max-width: 1600px)";
const tablets = [
  { width: 768, height: 1024 },
  { width: 1024, height: 1366 },
  { width: 1366, height: 1024 },
];
const otherDevices = [
  { width: 390, height: 844, touch: true },
  { width: 956, height: 440, touch: true },
  { width: 1366, height: 1024, touch: false },
];
const games = [
  { game: "zdwa", themes: ["light", "dark", "classic"], paths: ["/", "/spieler", "/regeln", "/konto", "/spieler/Admin", "/rangabzeichen", "/admin", "/ergebnis/tablet-navigation-missing"] },
  { game: "zilch", themes: ["light", "lcars"], paths: ["/zilch", "/zilch/bestenlisten", "/zilch/regeln", "/zilch/konto", "/zilch/historie", "/zilch/spieler/Admin"] },
];

async function navigationContext(browser, baseURL, { game, theme, language = "de", viewport = tablets[0], touch = true, disableTabletStyles = false }) {
  const context = await browser.newContext({ baseURL, viewport, hasTouch: touch, isMobile: touch, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.addInitScript(({ game, theme, language }) => {
    localStorage.setItem(game === "zilch" ? "zilch_theme" : "wuerfler_theme", theme);
    localStorage.setItem("zdwa_language", language);
  }, { game, theme, language });
  const login = await context.request.post("/api/auth/login", { data: { username: "Admin", password: "temporary-password-123" } });
  expect(login.ok()).toBe(true);
  if (game === "zilch") {
    // The shared browser server deliberately keeps Zilch behind its preview
    // allowlist. Use its established preview identity, not a mocked page.
    const auth = await context.request.get("/api/auth/me").then(response => response.json());
    const created = await context.request.post("/api/admin/users", {
      headers: { "X-CSRF-Token": auth.user.csrf_token },
      data: { username: "Mani", temporary_password: "mani-preview-password-123", role: "admin" },
    });
    expect([201, 400]).toContain(created.status());
    const previewLogin = await context.request.post("/api/auth/login", { data: { username: "Mani", password: "mani-preview-password-123" } });
    expect(previewLogin.ok()).toBe(true);
  }
  // Navigation should also be checked on established private account pages,
  // independently of the disposable admin account's first-login prompt.
  await context.route("**/api/auth/me", async route => {
    const response = await route.fetch();
    const auth = await response.json();
    await route.fulfill({ response, json: {
      ...auth,
      user: { ...auth.user, must_change_password: false, preferences: { ...auth.user.preferences, preferred_language: language } },
    } });
  });
  await context.route(/\/static\/[^?]+\.css(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    // Both boundary comparison contexts must render the same font metrics.
    let body = (await response.text()).replace(/font-display:\s*optional/g, "font-display:block");
    if (disableTabletStyles) {
      body = body.replace(/@media\s*([^{}]+)\{/g, (rule, condition) => (
        condition.includes("any-pointer") && condition.includes("768px") && condition.includes("600px")
          ? "@media not all{" : rule
      ));
    }
    await route.fulfill({ response, body });
  });
  return context;
}

async function navigationGeometry(page, game) {
  return page.evaluate(game => {
    const header = document.querySelector(game === "zilch" ? ".zilch-header" : ".app-nav");
    const selector = game === "zilch" ? ".zilch-nav-list a" : ".app-nav-link";
    const box = element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const style = getComputedStyle(header);
    const rect = box(header);
    const contentLeft = rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const contentRight = rect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
    return {
      center: (contentLeft + contentRight) / 2,
      header: rect,
      brand: box(header.querySelector(game === "zilch" ? ".zilch-brand" : ".app-nav-brand")),
      tools: box(header.querySelector(game === "zilch" ? ".zilch-header-tools" : ".app-nav-tools")),
      links: [...header.querySelectorAll(selector)].map(link => ({
        ...box(link), text: link.textContent, scrollWidth: link.scrollWidth, clientWidth: link.clientWidth,
        reachable: link.contains(document.elementFromPoint((box(link).left + box(link).right) / 2, (box(link).top + box(link).bottom) / 2)),
      })),
    };
  }, game);
}

async function settleNavigation(page, game) {
  await expect(page.locator(game === "zilch" ? ".zilch-nav-list a" : ".app-nav-link").first()).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

for (const { game, themes, paths } of games) {
  for (const theme of themes) {
    test(`${game} ${theme}: tablet main navigation is centered and reachable throughout DE/EN pages`, async ({ browser, baseURL }, testInfo) => {
      test.setTimeout(120000);
      for (const language of ["de", "en"]) {
        const context = await navigationContext(browser, baseURL, { game, theme, language });
        try {
          const page = await context.newPage();
          for (const path of paths) {
            await page.goto(path);
            await settleNavigation(page, game);
            await expect(page.locator("html")).toHaveAttribute("lang", language);
            for (const viewport of tablets) {
              await page.setViewportSize(viewport);
              await expect(async () => {
                expect(await page.evaluate(query => matchMedia(query).matches, tabletQuery)).toBe(true);
                const geometry = await navigationGeometry(page, game);
                expect(geometry.links.length).toBeGreaterThanOrEqual(4);
                const first = geometry.links[0];
                const last = geometry.links.at(-1);
                expect(Math.abs((first.left + last.right) / 2 - geometry.center), `${path}: centered navigation`).toBeLessThanOrEqual(1);
                expect(first.top, `${path}: a separate row below branding and tools`).toBeGreaterThanOrEqual(Math.max(geometry.brand.bottom, geometry.tools.bottom));
                for (const link of geometry.links) {
                  expect(link.height, link.text).toBeGreaterThanOrEqual(44);
                  expect(link.width, link.text).toBeGreaterThanOrEqual(44);
                  expect(link.scrollWidth, link.text).toBeLessThanOrEqual(link.clientWidth + 1);
                  expect(link.left, link.text).toBeGreaterThanOrEqual(geometry.header.left);
                  expect(link.right, link.text).toBeLessThanOrEqual(geometry.header.right + 1);
                  expect(link.reachable, link.text).toBe(true);
                }
              }).toPass({ timeout: 5000 });
              if (path === paths[0] && language === "de") await page.screenshot({ path: testInfo.outputPath(`navigation-${viewport.width}x${viewport.height}.png`) });
            }
          }
        } finally { await context.close(); }
      }
    });

    test(`${game} ${theme}: tablet navigation keeps phone and mouse desktop geometry unchanged`, async ({ browser, baseURL }) => {
      test.setTimeout(120000);
      for (const { touch, ...viewport } of otherDevices) {
        const baseline = await navigationContext(browser, baseURL, { game, theme, viewport, touch, disableTabletStyles: true });
        const current = await navigationContext(browser, baseURL, { game, theme, viewport, touch });
        try {
          const before = await baseline.newPage();
          const after = await current.newPage();
          for (const path of [paths[0], paths[2]]) {
            await before.goto(path);
            await after.goto(path);
            await settleNavigation(before, game);
            await settleNavigation(after, game);
            expect(await after.evaluate(query => matchMedia(query).matches, tabletQuery)).toBe(false);
            await expect(async () => {
              expect(await navigationGeometry(after, game)).toEqual(await navigationGeometry(before, game));
            }).toPass({ timeout: 5000 });
          }
        } finally {
          await baseline.close();
          await current.close();
        }
      }
    });
  }
}
