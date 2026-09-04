const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const pwaSource = fs.readFileSync(
  path.join(__dirname, "../../frontend/shell/pwa.js"),
  "utf8",
);

async function openPwaHarness(page, { origin, game }) {
  await page.addInitScript(() => {
    const state = {
      registerCalls: [],
      unregisterCalls: 0,
      cacheDeletes: [],
    };
    globalThis.__pwaHarness = state;

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
  });

  await page.route(`${origin}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/static/pwa.js") {
      await route.fulfill({ contentType: "application/javascript", body: pwaSource });
      return;
    }
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html data-game="${game}"><head><script src="/static/pwa.js"></script></head><body></body></html>`,
    });
  });

  await page.goto(`${origin}/`);
  await page.waitForLoadState("load");
}

test("the isolated Zilch origin never registers the ZDWA worker and removes stale caches", async ({ page }) => {
  await openPwaHarness(page, {
    origin: "https://zilch.zockdiewandan.online",
    game: "zilch",
  });

  await expect.poll(() => page.evaluate(() => globalThis.__pwaHarness.unregisterCalls)).toBe(1);
  const state = await page.evaluate(() => globalThis.__pwaHarness);
  expect(state.registerCalls).toEqual([]);
  expect(state.cacheDeletes.sort()).toEqual(["precache-assets-old", "runtime-assets-old"]);
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

test("ZDWA still registers its established root-scoped worker", async ({ page }) => {
  await openPwaHarness(page, {
    origin: "https://zockdiewandan.online",
    game: "zdwa",
  });

  await expect.poll(() => page.evaluate(() => globalThis.__pwaHarness.registerCalls)).toEqual(["/sw.js"]);
  expect(await page.evaluate(() => globalThis.__pwaHarness.unregisterCalls)).toBe(0);
});
