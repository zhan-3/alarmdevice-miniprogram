const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadEnvironment(version) {
  const source = fs.readFileSync(path.join(__dirname, '../utils/env.js'), 'utf8')
    .replace('export { env }', 'module.exports = { env }');
  const context = {
    module: { exports: {} },
    wx: { getAccountInfoSync: () => ({ miniProgram: { envVersion: version } }) }
  };
  vm.runInNewContext(source, context);
  return context.module.exports.env;
}

test('developer tools use the explicitly approved production HTTPS endpoint for this trial', () => {
  const env = loadEnvironment('develop');
  assert.equal(env.version, 'develop');
  assert.equal(env.baseURL, 'https://bridgemonitor.xyz');
  assert.equal(Object.isFrozen(env), true);
});

test('trial and release retain their explicit HTTPS API contract', () => {
  for (const version of ['trial', 'release']) {
    assert.equal(loadEnvironment(version).baseURL, 'https://bridgemonitor.xyz');
  }
});

test('unknown environment fails closed instead of silently choosing production', () => {
  assert.throws(() => loadEnvironment('unknown'), /未配置/);
});
