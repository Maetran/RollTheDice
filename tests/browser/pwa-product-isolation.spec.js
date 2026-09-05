const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const pwaSource = fs.readFileSync(
  path.join(__dirname, "../../frontend/shell/pwa.js"),
  "utf8",
);
const routesSource = fs.readFileSync(
  path.join(__dirname, "../../frontend/multigame/routes.js"),
  "utf8",
);

async function loadRoutes() {
  return import(`data:text/javascript;base64,${Buffer.from(routesSource).toString("base64")}`);
}

async function openPwaHarness(page, {
  origin,
  game,
  version = "unversioned",
  language = "de",
  bridge = false,
}) {
  await page.addInitScript(({ language: initialLanguage }) => {
    const state = {
      registerCalls: [],
      unregisterCalls: 0,
      cacheDeletes: [],
      toasts: [],
      dismissInstall: null,
    };
    globalThis.__pwaHarness = state;
    globalThis.ZDWA_UI = {
      toast: (message, options = {}) => {
        state.toasts.push({ message, actionLabel: options.actionLabel || "" });
        state.dismissInstall = options.onDismiss || null;
        return document.createElement("div");
      },
    };
    if (initialLanguage === "en") {
      globalThis.ZDWA_I18N = { getLanguage: () => "en" };
    }

    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(Navigator.prototype, "serviceWorker", {
      configurable: true,
      get: () => ({
        controller: null,
        addEventListener: () => {},
        getRegistrations: async () => [{
          active: { scriptURL: new URL("/sw.js", location.href).href },
          unregister: async () => {
            state.unregisterCalls += 1;
            return true;
          },
        }],
        register: async url => {
          state.registerCalls.push(url);
          return {
            waiting: null,
            addEventListener: () => {},
            update: async () => {},
          };
        },
      }),
    });
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: {
        keys: async () => ["precache-assets-old", "runtime-assets-old", "unrelated-cache"],
        delete: async key => {
          state.cacheDeletes.push(key);
          return true;
        },
      },
    });
  }, { language });

  await page.route(`${origin}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/static/pwa.js") {
      await route.fulfill({ contentType: "application/javascript", body: pwaSource });
      return;
    }
    const pageVersion = url.searchParams.get("pwaVersion") || version;
    const versionQuery = pageVersion === "unversioned"
      ? ""
      : `?v=${encodeURIComponent(pageVersion)}`;
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html data-game="${game}"${bridge ? ' data-zdwa-pwa-bridge="true"' : ""}><head><script src="/static/pwa.js${versionQuery}"></script></head><body></body></html>`,
    });
  });

  await page.goto(`${origin}/`);
  await page.waitForLoadState("load");
}

async function dispatchInstallPrompt(page) {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperty(event, "prompt", { value: async () => {} });
    window.dispatchEvent(event);
  });
}

test("the isolated Zilch origin registers its own worker and removes stale ZDWA state", async ({ page }) => {
  await openPwaHarness(page, {
    origin: "https://zilch.zockdiewandan.online",
    game: "zilch",
  });

  await expect.poll(() => page.evaluate(() => globalThis.__pwaHarness.unregisterCalls)).toBe(1);
  const state = await page.evaluate(() => globalThis.__pwaHarness);
  expect(state.registerCalls).toEqual(["/zilch-sw.js"]);
  expect(state.cacheDeletes.sort()).toEqual(["precache-assets-old", "runtime-assets-old"]);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "https://zilch.zockdiewandan.online/zilch-manifest.webmanifest",
  );
});

test("legacy Zilch on the Apex leaves the established Apex PWA untouched", async ({ page }) => {
  await openPwaHarness(page, {
    origin: "https://zockdiewandan.online",
    game: "zilch",
  });

  const state = await page.evaluate(() => globalThis.__pwaHarness);
  expect(state.registerCalls).toEqual([]);
  expect(state.unregisterCalls).toBe(0);
  expect(state.cacheDeletes).toEqual([]);
});

test("installed PWAs keep both game handoffs inside their current origin", async () => {
  const { zdwaAppEntryUrl, zdwaPath, zdwaRoutePath, zilchAppEntryUrl } = await loadRoutes();
  const zdwaLocation = { hostname: "zockdiewandan.online" };
  const zilchLocation = { hostname: "zilch.zockdiewandan.online", pathname: "/" };
  const zilchBridgeLocation = { hostname: "zilch.zockdiewandan.online", pathname: "/zdwa/spiel/room-123" };
  const standalone = {
    navigator: { standalone: true },
    matchMedia: () => ({ matches: true }),
  };
  const browser = {
    navigator: { standalone: false },
    matchMedia: () => ({ matches: false }),
  };

  expect(zilchAppEntryUrl("/", zdwaLocation, standalone)).toBe("/zilch");
  expect(zilchAppEntryUrl("/regeln", zdwaLocation, standalone)).toBe("/zilch/regeln");
  expect(zilchAppEntryUrl("/", zdwaLocation, browser)).toBe("https://zilch.zockdiewandan.online/");
  expect(zdwaAppEntryUrl(zilchLocation, standalone)).toBe("/zdwa");
  expect(zdwaAppEntryUrl(zilchLocation, browser)).toBe("https://zockdiewandan.online/");
  expect(zdwaPath("/spiel/room-456", zilchBridgeLocation)).toBe("/zdwa/spiel/room-456");
  expect(zdwaRoutePath("/zdwa/spiel/room-456", zilchBridgeLocation)).toBe("/spiel/room-456");
  expect(zdwaRoutePath("/", zilchLocation)).toBeNull();
});

test("the ZDWA bridge keeps the installed Zilch worker and manifest", async ({ page }) => {
  await openPwaHarness(page, {
    origin: "https://zilch.zockdiewandan.online",
    game: "zdwa",
    bridge: true,
  });

  await expect.poll(() => page.evaluate(() => globalThis.__pwaHarness.unregisterCalls)).toBe(1);
  const state = await page.evaluate(() => globalThis.__pwaHarness);
  expect(state.registerCalls).toEqual(["/zilch-sw.js"]);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "https://zilch.zockdiewandan.online/zilch-manifest.webmanifest",
  );
});

test("ZDWA still registers its established root-scoped worker", async ({ page }) => {
  await openPwaHarness(page, {
    origin: "https://zockdiewandan.online",
    game: "zdwa",
  });

  await expect.poll(() => page.evaluate(() => globalThis.__pwaHarness.registerCalls)).toEqual(["/sw.js"]);
  expect(await page.evaluate(() => globalThis.__pwaHarness.unregisterCalls)).toBe(0);
});

test("the Zilch install hint is snoozed for seven days, except after a new version", async ({ page }) => {
  const origin = "https://zilch.zockdiewandan.online";
  await openPwaHarness(page, { origin, game: "zilch", version: "version-one" });

  await dispatchInstallPrompt(page);
  await expect.poll(() => page.evaluate(() => globalThis.__pwaHarness.toasts)).toEqual([
    { message: "Die App kann installiert werden.", actionLabel: "Installieren" },
  ]);
  await page.evaluate(() => globalThis.__pwaHarness.dismissInstall());
  await expect.poll(() => page.evaluate(() => localStorage.getItem("zilch_install_prompt_dismissed"))).not.toBeNull();

  await dispatchInstallPrompt(page);
  expect(await page.evaluate(() => globalThis.__pwaHarness.toasts)).toHaveLength(1);

  await page.goto(`${origin}/?pwaVersion=version-two`);
  await page.waitForLoadState("load");
  await dispatchInstallPrompt(page);
  await expect.poll(() => page.evaluate(() => globalThis.__pwaHarness.toasts)).toEqual([
    { message: "Die App kann installiert werden.", actionLabel: "Installieren" },
  ]);

  await page.evaluate(() => globalThis.__pwaHarness.dismissInstall());
  await page.evaluate(() => {
    localStorage.setItem("zilch_install_prompt_dismissed", JSON.stringify({
      version: "version-two",
      dismissedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    }));
  });
  await page.reload();
  await page.waitForLoadState("load");
  await dispatchInstallPrompt(page);
  await expect.poll(() => page.evaluate(() => globalThis.__pwaHarness.toasts)).toEqual([
    { message: "Die App kann installiert werden.", actionLabel: "Installieren" },
  ]);
});

test("Zilch selects its English manifest for an English app session", async ({ page }) => {
  await openPwaHarness(page, {
    origin: "https://zilch.zockdiewandan.online",
    game: "zilch",
    language: "en",
  });

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "https://zilch.zockdiewandan.online/zilch-manifest-en.webmanifest",
  );
});
