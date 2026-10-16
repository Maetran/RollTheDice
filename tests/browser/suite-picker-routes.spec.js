const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const routesSource = fs.readFileSync(
  path.join(__dirname, "../../frontend/multigame/routes.js"),
  "utf8",
);
const routesModule = `data:text/javascript;base64,${Buffer.from(routesSource).toString("base64")}`;

test("suite entries use canonical browser hosts and keep installed apps inside their origin", async () => {
  const { hausdeppAppEntryUrl, zdwaAppEntryUrl, zilchAppEntryUrl } = await import(routesModule);
  const browser = { navigator: {}, matchMedia: () => ({ matches: false }) };
  const iosPwa = { navigator: { standalone: true } };
  const otherPwa = { navigator: {}, matchMedia: () => ({ matches: true }) };
  expect(hausdeppAppEntryUrl()).toBe("/hausdepp");

  for (const hostname of ["zockdiewandan.online", "www.zockdiewandan.online", "zdwa.zockdiewandan.online"]) {
    const location = { hostname, pathname: "/hausdepp/konto" };
    expect(zilchAppEntryUrl("/", location, browser)).toBe("https://zilch.zockdiewandan.online/");
    expect(zdwaAppEntryUrl(location, browser)).toBe("https://zockdiewandan.online/");
    for (const installed of [iosPwa, otherPwa]) {
      expect(zilchAppEntryUrl("/", location, installed)).toBe("/zilch");
    }
  }

  for (const pathname of ["/", "/zdwa", "/zdwa/konto", "/hausdepp", "/hausdepp/regeln"]) {
    const location = { hostname: "zilch.zockdiewandan.online", pathname };
    expect(zilchAppEntryUrl("/", location, browser)).toBe("/");
    expect(zdwaAppEntryUrl(location, browser)).toBe("https://zockdiewandan.online/");
    for (const installed of [iosPwa, otherPwa]) {
      expect(zilchAppEntryUrl("/", location, installed)).toBe("/");
      expect(zdwaAppEntryUrl(location, installed)).toBe("/zdwa");
    }
  }

  for (const hostname of ["localhost", "127.0.0.1", "preview.example.test"]) {
    for (const environment of [browser, iosPwa, otherPwa]) {
      const location = { hostname, pathname: "/hausdepp" };
      expect(zilchAppEntryUrl("/", location, environment)).toBe("/zilch");
      expect(zdwaAppEntryUrl(location, environment)).toBe("/");
    }
  }
});

test("the Zilch PWA bridge preserves picker destinations while adapting ordinary ZDWA links", async ({ page }) => {
  await page.setContent(`
    <nav id="picker">
      <a id="zilch-entry" data-game-entry="zilch" href="/?game_switch_from=zdwa">Zilch</a>
      <a id="zdwa-entry" data-game-entry="zdwa" href="/zdwa?game_switch_from=zdwa">ZDWA</a>
      <a id="hausdepp-entry" data-game-entry="hausdepp" href="/hausdepp?game_switch_from=zdwa">Hausdepp</a>
    </nav>
    <a id="account" href="/konto?passkey=1#settings">Konto</a>
    <a id="rules" href="/regeln#ablauf">Regeln</a>
    <a id="api" href="/api/games">API</a>
    <a id="asset" href="/static/rules.html">Dokument</a>
    <a id="password" href="/passwort-vergessen?from=account">Passwort</a>
  `);
  const bridgeLocation = {
    hostname: "zilch.zockdiewandan.online",
    pathname: "/zdwa/konto",
    href: "https://zilch.zockdiewandan.online/zdwa/konto",
    origin: "https://zilch.zockdiewandan.online",
  };
  await page.evaluate(async ({ source, location }) => {
    const { applyZdwaBridgeLinks } = await import(source);
    applyZdwaBridgeLinks(document, location);
    // MutationObserver attribute updates pass the anchor itself as the scope.
    applyZdwaBridgeLinks(document.getElementById("zilch-entry"), location);
  }, { source: routesModule, location: bridgeLocation });

  await expect(page.locator("#zilch-entry")).toHaveAttribute("href", "/?game_switch_from=zdwa");
  await expect(page.locator("#zdwa-entry")).toHaveAttribute("href", "/zdwa?game_switch_from=zdwa");
  await expect(page.locator("#hausdepp-entry")).toHaveAttribute("href", "/hausdepp?game_switch_from=zdwa");
  await expect(page.locator("#account")).toHaveAttribute("href", "/zdwa/konto?passkey=1#settings");
  await expect(page.locator("#rules")).toHaveAttribute("href", "/zdwa/regeln#ablauf");
  await expect(page.locator("#api")).toHaveAttribute("href", "/api/games");
  await expect(page.locator("#asset")).toHaveAttribute("href", "/static/rules.html");
  await expect(page.locator("#password")).toHaveAttribute("href", "https://zockdiewandan.online/passwort-vergessen?from=account");
});
