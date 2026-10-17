import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const localPython = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const python = process.env.ROLLTHEDICE_TEST_PYTHON
  || (existsSync(localPython) ? localPython : process.platform === "win32" ? "python" : "python3");
const result = spawnSync(python, ["-m", "pytest", ...process.argv.slice(2)], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
if (result.error) console.error(`Cannot start backend tests with ${python}: ${result.error.message}`);
process.exit(result.status ?? (result.signal === "SIGINT" ? 130 : 1));
