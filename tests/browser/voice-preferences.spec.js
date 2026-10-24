const { test, expect } = require("@playwright/test");
const { build } = require("esbuild");
const path = require("node:path");
const version = require("../../app/version.json").version;

test.use({ serviceWorkers: "block" });
const products = [
  { name: "hausdepp", page: "/hausdepp/konto/einstellungen", peer: "/watten/konto/einstellungen" },
  { name: "watten", page: "/watten/konto/einstellungen", peer: "/hausdepp/konto/einstellungen" },
];
const bundles = {};
test.beforeAll(async () => {
  // Test current source without writing generated release assets. The real
  // account document, shared auth and server persistence remain in the flow.
  for (const [name, source] of [["hausdepp", "frontend/hausdepp/index.js"], ["watten-account", "frontend/watten/account.js"]]) {
    const result = await build({ entryPoints: [path.resolve(source)], bundle: true, write: false,
      format: "esm", platform: "browser", target: "es2020", external: ["/static/*"],
      define: { __ROLLTHEDICE_PRODUCT_VERSION__: JSON.stringify(version) }, logLevel: "silent" });
    bundles[name] = result.outputFiles[0].text;
  }
});

async function createAccount(page, username, language) {
  const password = "voice-preference-fixture-password";
  const admin = await page.request.post("/api/auth/login", { data: { username: "Admin", password: "temporary-password-123" } });
  expect(admin.ok()).toBe(true);
  const created = await page.request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": (await admin.json()).user.csrf_token },
    data: { username, temporary_password: password, role: "user" },
  });
  expect(created.status()).toBe(201);
  const signed = await page.request.post("/api/auth/login", { data: { username, password } });
  expect(signed.ok()).toBe(true);
  const csrf = (await signed.json()).user.csrf_token;
  expect((await page.request.put("/api/auth/preferences/language", {
    headers: { "X-CSRF-Token": csrf }, data: { preferred_language: language },
  })).ok()).toBe(true);
  expect((await page.request.post("/api/auth/change-password", {
    headers: { "X-CSRF-Token": csrf }, data: { current_password: password, new_password: `${password}-final` },
  })).ok()).toBe(true);
  expect((await page.request.post("/api/auth/login", { data: { username, password: `${password}-final` } })).ok()).toBe(true);
}

async function openVoice(page, destination, language, enabled) {
  await page.goto(destination);
  await expect(page.locator("html")).toHaveAttribute("lang", language);
  const form = page.locator("[data-voice-preferences]");
  await expect(form).toHaveCount(1);
  const details = form.locator("xpath=ancestor::details[1]");
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator(":scope > summary").click();
  await expect(form.locator("select")).toHaveValue(String(enabled));
  await expect(form.locator("option")).toHaveText(language === "de" ? ["Ein", "Aus"] : ["On", "Off"]);
  await expect(form).toContainText(language === "de" ? "Mikrofon bleibt aus" : "microphone stays off");
  return form;
}

for (const product of products) for (const language of ["de", "en"]) {
  test(`${product.name} profile listening default is opt-in and shared across card games (${language})`, async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/\/static\/(hausdepp|watten-account)\.js(?:\?|$)/, route => {
      const name = new URL(route.request().url()).pathname.split("/").pop().replace(".js", "");
      return route.fulfill({ contentType: "application/javascript", body: bundles[name] });
    });
    await page.addInitScript(() => {
      window.__voiceMicrophoneRequests = 0;
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
        window.__voiceMicrophoneRequests += 1; throw new Error("Unexpected microphone request in account settings");
      };
    });
    await createAccount(page, `Voice_${product.name}_${language}`, language);
    await page.setViewportSize({ width: 320, height: 844 });
    let form = await openVoice(page, product.page, language, false);
    await form.locator("select").selectOption("true");
    const save = page.waitForRequest(request => new URL(request.url()).pathname === "/api/auth/preferences/voice");
    await form.getByRole("button").click();
    expect((await save).postDataJSON()).toEqual({ voice_listening_default: true });
    await expect(form.getByRole("status")).toHaveText(language === "de" ? "Hörvorgabe gespeichert." : "Listening default saved.");
    expect((await page.request.get("/api/auth/me").then(response => response.json())).user.preferences.voice_listening_default).toBe(true);
    expect(await page.evaluate(() => window.__voiceMicrophoneRequests)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await testInfo.attach(`voice-${product.name}-${language}`, { body: await form.screenshot(), contentType: "image/png" });
    form = await openVoice(page, product.peer, language, true);
    await form.locator("select").selectOption("false");
    await form.getByRole("button").click();
    await expect(form.getByRole("status")).toHaveText(language === "de" ? "Hörvorgabe gespeichert." : "Listening default saved.");
    await openVoice(page, product.page, language, false);
    expect(await page.evaluate(() => window.__voiceMicrophoneRequests)).toBe(0);
    expect(errors).toEqual([]);
  });
}
