#!/usr/bin/env node

import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const targets = [
  { source: "frontend/shared/auth.js", output: "app/static/auth.js", format: "esm" },
  { source: "frontend/shared/emoji.js", output: "app/static/emoji.js", format: "iife" },
  {
    sources: [
      "frontend/scoreboard/core.js",
      "frontend/scoreboard/live-renderer.js",
      "frontend/scoreboard/replay-renderer.js",
    ],
    output: "app/static/scoreboard.js",
    format: "iife",
  },
  { source: "frontend/lobby/index.js", output: "app/static/lobby.js", format: "esm" },
  { source: "frontend/zilch/index.js", output: "app/static/zilch.js", format: "esm" },
  { source: "frontend/zilch/login.js", output: "app/static/zilch-login.js", format: "esm" },
  {
    sources: [
      "frontend/room/helpers.js",
      "frontend/room/state.js",
      "frontend/room/room-ui.js",
      "frontend/room/dialogs.js",
      "frontend/room/gameplay.js",
      "frontend/room/socket.js",
      "frontend/room/snapshot-renderer.js",
      "frontend/room/board-navigation.js",
      "frontend/room/suggestions.js",
      "frontend/room/dice-ui.js",
      "frontend/room/interactions.js",
      "frontend/room/admin.js",
      "frontend/room/hotkeys.js",
    ],
    output: "app/static/room.js",
    format: "esm",
  },
  { source: "frontend/shell/index.js", output: "app/static/shell.js", format: "iife" },
  { source: "frontend/styles/lobby-entry.css", output: "app/static/lobby.css" },
  { source: "frontend/styles/zilch.css", output: "app/static/zilch.css" },
  { source: "frontend/styles/index.css", output: "app/static/style.css" },
];

const stale = [];
for (const target of targets) {
  const outfile = resolve(root, target.output);
  const source = target.source
    ? { entryPoints: [resolve(root, target.source)] }
    : {
      stdin: {
        contents: (await Promise.all(target.sources.map((path) => readFile(resolve(root, path), "utf8")))).join("\n"),
        resolveDir: dirname(resolve(root, target.sources[0])),
        sourcefile: "room-client.js",
        loader: "js",
      },
    };
  const result = await build({
    ...source,
    outfile,
    bundle: true,
    minify: true,
    write: !check,
    format: target.format,
    platform: "browser",
    target: ["es2020"],
    external: ["/static/*"],
    charset: "utf8",
    legalComments: "none",
    logLevel: "silent",
  });
  if (!check) continue;

  const generated = result.outputFiles?.[0]?.contents;
  let committed;
  try {
    committed = await readFile(outfile);
  } catch {
    committed = null;
  }
  if (!generated || !committed || !Buffer.from(generated).equals(committed)) {
    stale.push(target.output);
  }
}

if (stale.length) {
  console.error(`Stale generated assets: ${stale.join(", ")}. Run npm run build:static.`);
  process.exitCode = 1;
} else if (check) {
  console.log("Generated static assets are synchronized.");
}
