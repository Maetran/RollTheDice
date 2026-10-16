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
  expect(hausdeppAppEntryUrl({ hostname: "localhost" }, browser)).toBe("/hausdepp");

  for (const hostname of ["zockdiewandan.online", "www.zockdiewandan.online", "zdwa.zockdiewandan.online"]) {
    const location = { hostname, pathname: "/hausdepp/konto" };
    expect(zilchAppEntryUrl("/", location, browser)).toBe("https://zilch.zockdiewandan.online/");
    expect(zdwaAppEntryUrl(location, browser)).toBe("https://zockdiewandan.online/");
    expect(hausdeppAppEntryUrl(location, browser)).toBe("https://hausdepp.zockdiewandan.online/hausdepp");
    for (const installed of [iosPwa, otherPwa]) {
      expect(zilchAppEntryUrl("/", location, installed)).toBe("/zilch");
      expect(hausdeppAppEntryUrl(location, installed)).toBe("/hausdepp");
    }
  }

  for (const pathname of ["/", "/zdwa", "/zdwa/konto", "/hausdepp", "/hausdepp/regeln"]) {
    const location = { hostname: "zilch.zockdiewandan.online", pathname };
    expect(zilchAppEntryUrl("/", location, browser)).toBe("/");
    expect(zdwaAppEntryUrl(location, browser)).toBe("https://zockdiewandan.online/");
    expect(hausdeppAppEntryUrl(location, browser)).toBe("https://hausdepp.zockdiewandan.online/hausdepp");
    for (const installed of [iosPwa, otherPwa]) {
      expect(zilchAppEntryUrl("/", location, installed)).toBe("/");
      expect(hausdeppAppEntryUrl(location, installed)).toBe("/hausdepp");
      expect(zdwaAppEntryUrl(location, installed)).toBe("/zdwa");
    }
  }

  const houseLocation = { hostname: "hausdepp.zockdiewandan.online", pathname: "/hausdepp/konto" };
  expect(hausdeppAppEntryUrl(houseLocation, browser)).toBe("https://hausdepp.zockdiewandan.online/hausdepp");
  expect(zilchAppEntryUrl("/", houseLocation, browser)).toBe("https://zilch.zockdiewandan.online/");
  for (const installed of [iosPwa, otherPwa]) {
    expect(hausdeppAppEntryUrl(houseLocation, installed)).toBe("/hausdepp");
    expect(zilchAppEntryUrl("/", houseLocation, installed)).toBe("/zilch");
    expect(zdwaAppEntryUrl(houseLocation, installed)).toBe("/zdwa");
  }

  for (const hostname of ["localhost", "127.0.0.1", "preview.example.test"]) {
    for (const environment of [browser, iosPwa, otherPwa]) {
      const location = { hostname, pathname: "/hausdepp" };
      expect(zilchAppEntryUrl("/", location, environment)).toBe("/zilch");
      expect(zdwaAppEntryUrl(location, environment)).toBe("/");
      expect(hausdeppAppEntryUrl(location, environment)).toBe("/hausdepp");
    }
  }
});

test("Hausdepp sign-in stays relative and preserves only allowlisted page paths and queries", async () => {
  const { hausdeppSignInUrl, normalizeHausdeppPageUrl } = await import(routesModule);
  const destination = '/hausdepp/spiel/table_123?code=ABC';
  expect(normalizeHausdeppPageUrl(destination)).toBe(destination);
  for (const origin of ['https://hausdepp.zockdiewandan.online', 'https://zockdiewandan.online', 'http://localhost:8050']) {
    const login = new URL(hausdeppSignInUrl(destination), origin);
    expect(login.origin).toBe(origin);
    expect(login.pathname).toBe('/hausdepp/anmelden');
    expect(login.searchParams.get('return_to')).toBe(destination);
    expect(new URL(hausdeppSignInUrl(destination, { register: true }), origin).hash).toBe('#zilchRegistrationForm');
  }
  for (const invalid of ['https://evil.example/hausdepp', '//evil.example/hausdepp', '/api/auth/me', '/hausdepp/../konto', '/hausdepp/spiel/a/b', '/hausdepp#fake', '/hausdepp?code=ABC\n', `/hausdepp?${'a'.repeat(2048)}`]) {
    expect(normalizeHausdeppPageUrl(invalid), invalid).toBeNull();
  }
  expect(hausdeppSignInUrl('https://evil.example/')).toBe('/hausdepp/anmelden?return_to=%2Fhausdepp');
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
