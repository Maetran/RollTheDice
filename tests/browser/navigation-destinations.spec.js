const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

const zdwaOrigin = "https://zockdiewandan.online";
const zilchOrigin = "https://zilch.zockdiewandan.online";
const staticDirectory = path.join(__dirname, "../../app/static");

async function serveStaticAsset(route) {
  const pathname = new URL(route.request().url()).pathname;
  if (!pathname.startsWith("/static/")) return false;
  const filename = path.join(staticDirectory, pathname.slice("/static/".length));
  if (!filename.startsWith(`${staticDirectory}${path.sep}`) || !fs.existsSync(filename)) {
    await route.fulfill({ status: 404, body: "" });
    return true;
  }
  const types = { ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
  await route.fulfill({ contentType: types[path.extname(filename)] || "application/octet-stream", body: fs.readFileSync(filename) });
  return true;
}

const replay = {
  game_id: "navigation-replay", gamename: "Unsere fertige Partie", mode: "2", hardcore: false,
  finished_at: "2026-09-11T12:00:00Z",
  players: [{ id: "p1", name: "Ada" }, { id: "p2", name: "Ben" }],
  scoreboards: {
    p1: { reihen: [{ index: 1, rows: { "1": 1 } }] },
    p2: { reihen: [{ index: 1, rows: { "1": 2 } }] },
  },
  chat_history: [], admin_edits: {},
};

test("forgotten password remains reachable from the ZDWA PWA bridge", async ({ page }) => {
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (await serveStaticAsset(route)) return;
    if (url.pathname.startsWith("/api/")) {
      await route.fulfill({ json: { authenticated: false } });
      return;
    }
    const html = fs.readFileSync(path.join(staticDirectory, "index.html"), "utf8")
      .replace("<html ", '<html data-zdwa-pwa-bridge="true" ');
    await route.fulfill({ contentType: "text/html", body: html });
  });
  await page.goto(`${zilchOrigin}/zdwa`);
  await expect(page.locator('a[href*="passwort-vergessen"]')).toHaveAttribute("href", `${zdwaOrigin}/passwort-vergessen`);
});

for (const { origin, prefix } of [{ origin: zdwaOrigin, prefix: "" }, { origin: zilchOrigin, prefix: "/zdwa" }]) {
  for (const legacyQuery of [false, true]) {
    test(`completed ZDWA result stays useful at ${prefix || "apex"} (${legacyQuery ? "query link" : "path link"})`, async ({ page }) => {
      const requests = [];
      await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (await serveStaticAsset(route)) return;
        if (url.pathname === `/api/game_from_leaderboard/${replay.game_id}`) {
          requests.push(url.pathname);
          await route.fulfill({ json: replay });
          return;
        }
        if (url.pathname.startsWith("/api/")) {
          await route.fulfill({ json: { authenticated: false } });
          return;
        }
        let html = fs.readFileSync(path.join(staticDirectory, "game_view.html"), "utf8");
        if (prefix) html = html.replace("<html ", '<html data-zdwa-pwa-bridge="true" ');
        await route.fulfill({ contentType: "text/html", body: html });
      });
      const suffix = legacyQuery ? `?id=${replay.game_id}` : `/${replay.game_id}`;
      await page.goto(`${origin}${prefix}/ergebnis${suffix}`);
      await expect(page.locator("#roomGameName")).toContainText(replay.gamename);
      await expect(page.locator("#contentMount .player-name-label").filter({ hasText: "Ada" }).first()).toBeVisible();
      await expect(page.locator("#contentMount")).not.toContainText("Kein Spiel angegeben");
      await expect(page).toHaveURL(`${origin}${prefix}/ergebnis/${replay.game_id}`);
      expect(requests).toEqual([`/api/game_from_leaderboard/${replay.game_id}`]);
      await expect(page.getByRole("link", { name: "Lobby", exact: true })).toHaveAttribute("href", prefix || "/");
    });
  }
}

const activityCases = [
  { name: "Zilch browser to ZDWA", origin: zilchOrigin, start: "/", game: "zdwa", expected: `${zdwaOrigin}/spiel/friend-game/zuschauen` },
  { name: "Zilch installed app to ZDWA bridge", origin: zilchOrigin, start: "/", game: "zdwa", standalone: true, expected: `${zilchOrigin}/zdwa/spiel/friend-game/zuschauen` },
  { name: "ZDWA bridge stays inside its app", origin: zilchOrigin, start: "/zdwa", game: "zdwa", standalone: true, expected: `${zilchOrigin}/zdwa/spiel/friend-game/zuschauen` },
  { name: "Zilch opens its own spectator table", origin: zilchOrigin, start: "/", game: "zilch", expected: `${zilchOrigin}/spiel/friend-game/zuschauen` },
  { name: "ZDWA opens its own spectator table", origin: zdwaOrigin, start: "/", game: "zdwa", expected: `${zdwaOrigin}/spiel/friend-game/zuschauen` },
  { name: "installed ZDWA opens Zilch without leaving its origin", origin: zdwaOrigin, start: "/", game: "zilch", standalone: true, expected: `${zdwaOrigin}/zilch/spiel/friend-game/zuschauen` },
];

for (const scenario of activityCases) {
  test(`friend activity: ${scenario.name}`, async ({ page }) => {
    await page.addInitScript(standalone => {
      Object.defineProperty(navigator, "standalone", { configurable: true, value: standalone });
    }, Boolean(scenario.standalone));
    let activitySocket;
    await page.routeWebSocket("**/ws/friend-activity", socket => { activitySocket = socket; });
    const startUrl = `${scenario.origin}${scenario.start}`;
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (await serveStaticAsset(route)) return;
      if (url.pathname === "/api/auth/me") {
        await route.fulfill({ json: { authenticated: true, user: { id: 81, username: "Viewer", preferences: { friend_activity_enabled: true } } } });
        return;
      }
      if (route.request().url() !== startUrl) {
        await route.fulfill({ contentType: "text/html", body: "<h1>Zuschauen</h1>" });
        return;
      }
      await route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>
        <h1>Lobby</h1><div id="notices"></div>
        <script type="module">
          import { initializeFriendActivity } from "/static/friend-activity.js";
          window.ZDWA_UI = { toast(message, options) {
            const notice = document.createElement("p"); notice.textContent = message;
            if (options.actionLabel) {
              const action = document.createElement("button"); action.textContent = options.actionLabel;
              action.addEventListener("click", options.onAction); notice.append(action);
            }
            document.getElementById("notices").append(notice);
          } };
          initializeFriendActivity();
        </script></body></html>` });
    });
    await page.goto(startUrl);
    await expect.poll(() => Boolean(activitySocket)).toBe(true);
    activitySocket.send(JSON.stringify({ friend_activity_ready: { enabled: true } }));
    activitySocket.send(JSON.stringify({ friend_activity: {
      id: "fresh-notice", game_id: "friend-game", game_type: scenario.game,
      expires_at: new Date(Date.now() + 45_000).toISOString(), player_count: 2,
      players: [{ id: 82, username: "Ada" }],
    } }));
    await expect(page.locator("#notices")).toContainText("Ada");
    await page.getByRole("button", { name: "Zuschauen" }).click();
    await expect(page).toHaveURL(scenario.expected);
  });
}
