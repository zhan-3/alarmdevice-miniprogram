const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const requests = [];
  const invalidations = [];
  const timers = [];
  let token = 'one-user-token';
  let sessionVersion = 0;
  const source = fs.readFileSync(path.join(__dirname, '../utils/http.js'), 'utf8')
    .replace("import { env } from './env'", "const env = { baseURL: 'https://example.test' }")
    .replace("import logger from './logger'", 'const logger = { info() {}, warn() {}, error() {} }')
    .replace('export default {', 'module.exports = {');
  const context = {
    module: { exports: {} },
    require(name) { assert.equal(name, './httpPolicy'); return require('../utils/httpPolicy'); },
    getApp: () => ({ getLoginToken: () => token, authNavigation: {
      getSessionVersion: () => sessionVersion,
      invalidate: scope => invalidations.push(scope)
    } }),
    wx: { request: options => requests.push(options), toast() {} },
    setTimeout(callback) { timers.push(callback); }
  };
  vm.runInNewContext(source, context);
  return { http: context.module.exports, requests, invalidations, timers,
    setToken(value) { token = value; sessionVersion += 1; } };
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

test('late 401 and 403 responses cannot invalidate a newer login or its device bindings', async () => {
  for (const code of [401, 403]) {
    const h = harness();
    const pending = h.http.get('/user/bind/status', { deviceId: 'A' }, { credentialScope: 'login', deviceId: 'A' });
    h.setToken('new-user-token');
    h.requests[0].success({ statusCode: code, data: {} });
    await assert.rejects(pending, error => error.code === code);
    assert.deepEqual(h.invalidations, []);
  }
});

test('a newer session is protected even when it uses the same JWT value', async () => {
  const h = harness();
  const pending = h.http.get('/user/alarms', {}, { credentialScope: 'login' });
  h.setToken('one-user-token');
  h.requests[0].success({ statusCode: 401, data: {} });
  await assert.rejects(pending, error => error.code === 401);
  assert.deepEqual(h.invalidations, []);
});

test('GET retries retain the initiating credential and session rather than adopting the new login', async () => {
  const h = harness();
  const pending = h.http.get('/user/alarms', {}, { credentialScope: 'login' });
  h.requests[0].fail({ errMsg: 'request:fail network' });
  h.setToken('new-user-token');
  h.timers.shift()();
  assert.equal(h.requests[1].header.Authorization, 'Bearer one-user-token');
  h.requests[1].success({ statusCode: 401, data: {} });
  await assert.rejects(pending, error => error.code === 401);
  assert.deepEqual(h.invalidations, []);
});

test('a malformed explicitly supplied old credential does not clear the valid current login', async () => {
  const h = harness();
  await assert.rejects(h.http.get('/user/alarms', {}, {
    credentialScope: 'login', credential: '无效旧凭证'
  }), error => error.code === 401);
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.invalidations, []);
});

test('successful responses from an older session cannot publish private data into the new session', async () => {
  for (const nextToken of ['new-user-token', 'one-user-token']) {
    const h = harness();
    const pending = h.http.get('/user/alarms', {}, { credentialScope: 'login' });
    h.setToken(nextToken);
    h.requests[0].success({ statusCode: 200, data: { code: 1, data: { privateValue: 'old-user-data' } } });
    await assert.rejects(pending, error => error.code === 'STALE_AUTH_REQUEST');
    assert.deepEqual(h.invalidations, []);
  }
});

test('network failures never automatically retry POST or DELETE writes', async () => {
  for (const method of ['post', 'delete']) {
    const h = harness();
    const pending = h.http[method]('/user/alarms/handle', { alarmId: '9007199254740993' }, { credentialScope: 'login' });
    h.requests[0].fail({ errMsg: 'request:fail network' });
    await assert.rejects(pending, error => error.code === -1);
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.length, 0);
  }
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
