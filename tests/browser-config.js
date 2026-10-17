const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pythonExecutable = process.env.PLAYWRIGHT_PYTHON
  || [path.join(root, '.venv/bin/python'), path.join(root, '.venv/Scripts/python.exe')].find(fs.existsSync)
  || 'python3';
const workerMemory = 2 * 1024 ** 3;
let detectedResources;

function testResources() {
  if (!detectedResources) {
    const probe = spawnSync(pythonExecutable, [path.join(root, 'scripts/test_resources.py')], {
      cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    if (probe.error || probe.status !== 0) {
      throw new Error(`Cannot detect test resources with ${pythonExecutable}; set PLAYWRIGHT_PYTHON to the project interpreter. ${probe.error?.message || probe.stderr}`);
    }
    try { detectedResources = JSON.parse(probe.stdout); }
    catch { throw new Error('scripts/test_resources.py returned invalid JSON; check the project Python interpreter'); }
  }
  return detectedResources;
}

function browserWorkers({ externalBaseURL = false, resources } = {}) {
  const configured = process.env.PLAYWRIGHT_WORKERS;
  if (configured !== undefined && !/^[1-9]\d*$/.test(configured)) {
    throw new Error('PLAYWRIGHT_WORKERS must be a positive integer');
  }
  const workers = configured === undefined ? undefined : Number(configured);
  if (workers !== undefined && !Number.isSafeInteger(workers)) throw new Error('PLAYWRIGHT_WORKERS is too large');
  if (externalBaseURL && configured !== undefined && workers !== 1) {
    throw new Error('PLAYWRIGHT_BASE_URL shares an existing server and requires PLAYWRIGHT_WORKERS=1');
  }
  if (externalBaseURL) return 1;
  if (workers !== undefined) return workers;
  const { cpus, memory } = resources || testResources();
  if (!Number.isInteger(cpus) || cpus < 1 || (memory !== null && (!Number.isFinite(memory) || memory < 0))) {
    throw new Error('scripts/test_resources.py returned invalid CPU or memory limits');
  }
  const cpuWorkers = Math.max(1, Math.floor(cpus / 2));
  const memoryWorkers = memory === null ? cpuWorkers : Math.max(1, Math.floor(memory / workerMemory));
  return Math.min(cpuWorkers, memoryWorkers);
}

module.exports = { browserWorkers, pythonExecutable };
