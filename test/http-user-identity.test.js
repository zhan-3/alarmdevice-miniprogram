const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const requests = [];
  const invalidations = [];
  const source = fs.readFileSync(path.join(__dirname, '../utils/http.js'), 'utf8')
    .replace("import { env } from './env'", "const env = { baseURL: 'https://example.test' }")
    .replace("import logger from './logger'", 'const logger = { info() {}, warn() {}, error() {} }')
    .replace('export default {', 'module.exports = {');
  const context = {
    module: { exports: {} },
    require(name) { assert.equal(name, './httpPolicy'); return require('../utils/httpPolicy'); },
    getApp: () => ({ getLoginToken: () => 'one-user-token', authNavigation: { invalidate: scope => invalidations.push(scope) } }),
    wx: { request: options => requests.push(options), toast() {} },
    setTimeout
  };
  vm.runInNewContext(source, context);
  return { http: context.module.exports, requests, invalidations };
}

test('device A and B use identical Authorization with independent explicit request scope', async () => {
  const { http, requests } = harness();
  const a = http.get('/user/bind/status', { deviceId: 'A' }, { credentialScope: 'login', deviceId: 'A' });
  const b = http.post('/device/updateName', { deviceId: 'B', name: '桥 B' }, { credentialScope: 'login', deviceId: 'B' });
  assert.equal(requests[0].header.Authorization, 'Bearer one-user-token');
  assert.equal(requests[1].header.Authorization, requests[0].header.Authorization);
  assert.equal(requests[0].data.deviceId, 'A');
  assert.equal(requests[1].data.deviceId, 'B');
  requests.forEach(request => request.success({ statusCode: 200, data: { code: 1 } }));
  await Promise.all([a, b]);
});

test('401 from any device invalidates the user login, not just that device', async () => {
  const { http, requests, invalidations } = harness();
  const pending = http.get('/user/bind/status', { deviceId: 'A' }, { credentialScope: 'login', deviceId: 'A' });
  requests[0].success({ statusCode: 401, data: {} });
  await assert.rejects(pending, error => error.code === 401);
  assert.deepEqual(invalidations, ['login']);
});

test('403 revokes only the explicitly scoped local device, retaining login identity', async () => {
  const { http, requests, invalidations } = harness();
  const pending = http.get('/user/bind/status', { deviceId: 'A' }, { credentialScope: 'login', deviceId: 'A' });
  requests[0].success({ statusCode: 403, data: { msg: '设备不存在或无权访问' } });
  await assert.rejects(pending, error => error.code === 403 && error.msg === '设备不存在或无权访问');
  assert.equal(invalidations.length, 1);
  assert.equal(invalidations[0].type, 'device');
  assert.equal(invalidations[0].sn, 'A');
});

test('restoration can classify invalid login without request-layer navigation side effects', async () => {
  const { http, requests, invalidations } = harness();
  const pending = http.get('/user/bind/status', { deviceId: 'A' }, {
    credentialScope: 'login', deviceId: 'A', invalidateOn401: false
  });
  requests[0].success({ statusCode: 401, data: {} });
  await assert.rejects(pending, error => error.code === 401);
  assert.deepEqual(invalidations, []);
});
