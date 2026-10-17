const assert = require('node:assert/strict');
const test = require('node:test');
const { browserWorkers } = require('./browser-config');

const GiB = 1024 ** 3;

function withWorkers(value, check) {
  const previous = process.env.PLAYWRIGHT_WORKERS;
  try {
    if (value === undefined) delete process.env.PLAYWRIGHT_WORKERS;
    else process.env.PLAYWRIGHT_WORKERS = value;
    check();
  } finally {
    if (previous === undefined) delete process.env.PLAYWRIGHT_WORKERS;
    else process.env.PLAYWRIGHT_WORKERS = previous;
  }
}

test('browser workers follow available CPU and container memory limits', () => {
  withWorkers(undefined, () => {
    assert.equal(browserWorkers({ resources: { cpus: 18, memory: 48 * GiB } }), 9);
    assert.equal(browserWorkers({ resources: { cpus: 18, memory: 4 * GiB } }), 2);
    assert.equal(browserWorkers({ resources: { cpus: 2, memory: 8 * GiB } }), 1);
    assert.equal(browserWorkers({ resources: { cpus: 1, memory: GiB } }), 1);
    assert.equal(browserWorkers({ resources: { cpus: 18, memory: 0 } }), 1);
    assert.equal(browserWorkers({ resources: { cpus: 18, memory: null } }), 9);
  });
});

test('an explicit worker count overrides automatic resource caps', () => {
  withWorkers('12', () => assert.equal(browserWorkers({ resources: { cpus: 2, memory: GiB } }), 12));
});

test('shared external servers stay serial without launching a resource probe', () => {
  withWorkers(undefined, () => assert.equal(browserWorkers({ externalBaseURL: 'http://localhost:8010' }), 1));
  withWorkers('1', () => assert.equal(browserWorkers({ externalBaseURL: true }), 1));
  withWorkers('2', () => assert.throws(() => browserWorkers({ externalBaseURL: true }), /requires PLAYWRIGHT_WORKERS=1/));
});

test('invalid worker overrides fail instead of silently changing concurrency', () => {
  for (const value of ['0', '-1', '1.5', '50%', '', '9007199254740992']) {
    withWorkers(value, () => assert.throws(() => browserWorkers(), /PLAYWRIGHT_WORKERS/));
  }
});
