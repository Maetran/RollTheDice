const { test, expect } = require("@playwright/test");

test("explicit public Zilch login opens the apex login form and preserves its destination", async ({ page, baseURL }) => {
  const zilchOrigin = new URL(baseURL);
  zilchOrigin.hostname = `zilch.${zilchOrigin.hostname}`;
  const login = new URL("/anmelden", zilchOrigin);
  login.searchParams.set("return_to", "/statistiken?scope=mine");
  await page.goto(login.href);
  await expect(page.locator("#zilchLoginForm")).toBeHidden();
  await expect(page.locator("#zilchPasswordLogin > summary")).toBeVisible();
  await expect(page.locator("#zilchPasskeyLoginButton")).toBeVisible();
  const destination = new URL(page.url());
  expect(destination.origin).toBe(new URL(baseURL).origin);
  expect(destination.pathname).toBe("/zilch/anmelden");
  const continuation = new URL(destination.searchParams.get("return_to"), baseURL);
  expect(continuation.pathname).toBe("/auth/continue");
  expect(continuation.searchParams.get("app")).toBe("zilch");
  expect(continuation.searchParams.get("path")).toBe("/statistiken?scope=mine");
});

test("native passkey created on the apex origin signs into the allowed Zilch subdomain", async ({ page, context, baseURL }) => {
  const password = "cross-origin-passkey-password-123";
  const username = "CrossOrigin_Passkey";
  const zilchOrigin = new URL(baseURL);
  zilchOrigin.hostname = `zilch.${zilchOrigin.hostname}`;
  const created = await page.request.post("/api/auth/register", {
    data: { username, password, preferred_language: "en" },
  });
  expect(created.status()).toBe(201);
  const account = (await created.json()).user;
  await context.addInitScript(() => localStorage.setItem("zdwa_language", "en"));
  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal",
      hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  try {
    await page.goto("/konto#settings");
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
    const settings = page.locator("[data-passkey-settings]");
    await settings.locator('[name="current_password"]').fill(password);
    await settings.locator('[name="label"]').fill("Shared ZDWA and Zilch passkey");
    await settings.getByRole("button", { name: "Add passkey" }).click();
    await expect(settings.locator("[data-passkey-list]")).toContainText("Shared ZDWA and Zilch passkey");
    const enrolled = (await client.send("WebAuthn.getCredentials", { authenticatorId })).credentials;
    expect(enrolled).toHaveLength(1);
    expect(enrolled[0].rpId).toBe(new URL(baseURL).hostname);
    expect(enrolled[0].isResidentCredential).toBe(true);

    // Remove every session cookie, keeping only the same virtual authenticator.
    // The account must be recovered by a real assertion on the other origin.
    await context.clearCookies();
    await page.goto(new URL("/", zilchOrigin).href);
    expect(await page.evaluate(() => location.origin)).toBe(zilchOrigin.origin);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
    const guest = await page.evaluate(async () => (await fetch("/api/auth/me")).json());
    expect(guest.authenticated).toBe(false);

    let verification;
    page.on("request", request => {
      if (request.url() === `${zilchOrigin.origin}/api/auth/passkeys/authentication/verify`) verification = request;
    });
    const authenticated = await page.evaluate(async () => {
      const { loginWithPasskey } = await import("/static/auth.js");
      return loginWithPasskey();
    });
    const request = verification;
    expect(request).toBeTruthy();
    expect((await request.allHeaders()).origin).toBe(zilchOrigin.origin);
    const clientData = JSON.parse(Buffer.from(request.postDataJSON().credential.response.clientDataJSON, "base64url").toString("utf8"));
    expect(clientData.origin).toBe(zilchOrigin.origin);
    expect(clientData.type).toBe("webauthn.get");
    expect(authenticated.authenticated).toBe(true);
    expect(authenticated.user.id).toBe(account.id);
    expect(authenticated.user.username).toBe(username);
    const session = await page.evaluate(async () => (await fetch("/api/auth/me")).json());
    expect(session.user.id).toBe(account.id);
    const used = (await client.send("WebAuthn.getCredentials", { authenticatorId })).credentials;
    expect(used).toHaveLength(1);
    expect(used[0].credentialId).toBe(enrolled[0].credentialId);
    expect(used[0].signCount).toBeGreaterThan(enrolled[0].signCount);
  } finally {
    await client.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await client.detach();
  }
});
