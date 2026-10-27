import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../frontend/multigame/routes.js", import.meta.url), "utf8");
const { applyZdwaBridgeLinks, suiteManagementUrl } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const browser = { navigator: {}, matchMedia: () => ({ matches: false }) };
const standalone = { navigator: { standalone: true } };
const mediaStandalone = { matchMedia: () => ({ matches: true }) };
const destinations = ["/admin", "/admin/dashboard"];
const canonical = "https://zockdiewandan.online";
const productHosts = ["zilch", "hausdepp", "watten"].map((product) => `${product}.zockdiewandan.online`);
const dashboardSource = await readFile(new URL("../frontend/dashboard.js", import.meta.url), "utf8");
const loginSource = await readFile(new URL("../frontend/zilch/login.js", import.meta.url), "utf8");

test("shared management tools keep local and preview navigation local", () => {
  for (const hostname of ["localhost", "127.0.0.1", "preview.invalid"]) {
    for (const environment of [browser, standalone, mediaStandalone]) {
      for (const destination of destinations) {
        assert.equal(suiteManagementUrl(destination, new URL(`http://${hostname}/watten`), environment), destination);
      }
    }
  }
});

test("ordinary production browsers use the canonical shared tools from every game", () => {
  for (const hostname of ["zockdiewandan.online", "www.zockdiewandan.online", "zdwa.zockdiewandan.online", ...productHosts]) {
    for (const destination of destinations) {
      assert.equal(suiteManagementUrl(destination, new URL(`https://${hostname}/`), browser), `${canonical}${destination}`);
    }
  }
});

test("installed product apps keep shared tools on their same-origin bridge", () => {
  for (const hostname of productHosts) {
    for (const pathname of ["/", "/hausdepp", "/watten", "/zdwa/konto"]) {
      for (const environment of [standalone, mediaStandalone]) {
        for (const destination of destinations) {
          assert.equal(suiteManagementUrl(destination, new URL(`https://${hostname}${pathname}`), environment), `/zdwa${destination}`);
        }
      }
    }
  }
  for (const destination of destinations) {
    assert.equal(suiteManagementUrl(destination, new URL(canonical), standalone), `${canonical}${destination}`);
  }
});

test("management destinations are finite and never accept user-controlled URLs", () => {
  for (const destination of ["/", "/konto", "/admin/", "/admin/dashboard?next=bad", "/admin#users", "//evil.invalid/admin", "https://evil.invalid/admin", undefined]) {
    assert.throws(() => suiteManagementUrl(destination, new URL(canonical), browser), TypeError);
  }
});

test("bridge links recognize the guarded dashboard without rewriting resolved utility entries", () => {
  const link = (href, attributes = {}) => ({
    attributes: { href, ...attributes },
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = value; },
  });
  const links = [
    link("/admin/dashboard?design=lcars#games"),
    link("/admin", { "data-suite-utility-entry": "admin" }),
    link("/admin/dashboard", { "data-suite-utility-entry": "dashboard" }),
    link("/api/analytics/overview"), link("/static/dashboard.js"),
  ];
  applyZdwaBridgeLinks({ querySelectorAll: () => links }, new URL("https://hausdepp.zockdiewandan.online/zdwa/konto"));
  assert.deepEqual(links.map((item) => item.attributes.href), [
    "/zdwa/admin/dashboard?design=lcars#games", "/admin", "/admin/dashboard", "/api/analytics/overview", "/static/dashboard.js",
  ]);
});

test("dashboard session expiry returns to its exact guarded route in the same installed app", () => {
  const deniedSource = dashboardSource.slice(dashboardSource.indexOf("function denied(status)"), dashboardSource.indexOf("// shared/auth.js"));
  for (const bridge of [undefined, "false", "true"]) {
    const nodes = Object.fromEntries(["dashboardData", "dashboardFilters", "dashboardLogin"].map((id) => [id, {}]));
    const messages = [];
    const denied = runInNewContext(`${deniedSource}\ndenied;`, {
      document: { documentElement: { dataset: { zdwaPwaBridge: bridge } } },
      byId: id => nodes[id], connection() {}, message: (...args) => messages.push(args),
    });
    denied(401);
    assert.equal(nodes.dashboardLogin.href, bridge === "true"
      ? "/zdwa/anmelden?return_to=%2Fzdwa%2Fadmin%2Fdashboard" : "/zilch/anmelden?return_to=%2Fadmin%2Fdashboard");
    assert.equal(nodes.dashboardData.hidden, true);
    assert.equal(nodes.dashboardFilters.hidden, true);
    assert.equal(messages.at(-1)[1].login, true);
    denied(403);
    assert.equal(messages.at(-1)[1].login, false);
  }
});

test("shared login accepts both fixed dashboard returns but no similar arbitrary destination", () => {
  const start = loginSource.indexOf("function returnPath()");
  const end = loginSource.indexOf("\nfunction ", start + 1);
  const constant = loginSource.match(/^const DASHBOARD_RETURN_PATHS = .*;$/m)[0];
  for (const candidate of ["/admin/dashboard", "/zdwa/admin/dashboard", "/zdwa/admin", "/zdwa/admin/dashboard?next=/admin", "//evil.invalid/admin/dashboard"]) {
    const returnPath = runInNewContext(`${constant}\n${loginSource.slice(start, end)}\nreturnPath;`, {
      document: { documentElement: { dataset: {} } },
      window: { location: { search: `?return_to=${encodeURIComponent(candidate)}`, origin: canonical } },
      URL, URLSearchParams, zilchPath: () => "/zilch", normalizeHausdeppPageUrl: () => null, normalizeZilchPageUrl: () => null,
    });
    assert.equal(returnPath(), destinations.includes(candidate) || candidate === "/zdwa/admin/dashboard" ? candidate : "/zilch");
  }
});

test("dashboard sign-in continuation needs an authenticated account and no Zilch preview grant", async () => {
  const refreshSource = loginSource.slice(loginSource.indexOf("async function refresh("), loginSource.indexOf('form.addEventListener("submit"'));
  const constant = loginSource.match(/^const DASHBOARD_RETURN_PATHS = .*;$/m)[0];
  for (const authenticated of [false, true]) {
    for (const destination of ["/admin/dashboard", "/zdwa/admin/dashboard", "/zdwa/admin"]) {
      const redirects = [];
      const auth = { authenticated, user: authenticated ? { game_access: { zilch_preview: false } } : null };
      const refresh = runInNewContext(`${constant}\n${refreshSource}\nrefresh;`, {
        document: { documentElement: { lang: "de" } }, window: { location: { assign: path => redirects.push(path) } },
        loadAuth: async () => auth, render() {}, returnPath: () => destination, isHausdeppDestination: () => false,
      });
      await refresh({ redirect: true });
      assert.deepEqual(redirects, authenticated && destination !== "/zdwa/admin" ? [destination] : []);
    }
  }
});
