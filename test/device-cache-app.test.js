const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDeviceRepository } = require('../utils/deviceRepository');
const { createBoundDeviceSet } = require('../utils/boundDeviceSet');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function loadApp(get = async () => ({ code: 1, data: ['SN-A'] })) {
  const repository = createDeviceRepository();
  const values = { boundDevices: [{ sn: 'SN-A', name: 'old' }] };
  const storage = {
    get: (key, fallback) => values[key] ?? fallback,
    set: (key, value) => { values[key] = value; },
    remove: key => { delete values[key]; }
  };
  const requests = [];
  const invalidations = [];
  let stateChange;
  let app;
  const filename = path.join(__dirname, '../app.js');
  const source = fs.readFileSync(filename, 'utf8').replace(/^import .+$/gm, '');
  vm.runInNewContext(source, {
    http: { get(...args) { requests.push(args); return get(...args); } },
    isValidSN: sn => /^[A-Z0-9_-]{1,32}$/.test(sn),
    logger: { info() {}, warn() {}, error() {}, configure() {} },
    wx: { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }) },
    getCurrentPages: () => [],
    require(request) {
      if (request.endsWith('/deviceRepository')) return { deviceRepository: repository };
      if (request.endsWith('/boundDeviceSet')) return { createBoundDeviceSet };
      if (request.endsWith('/authTransport')) return { createAuthTransport: () => ({}) };
      if (request.endsWith('/authAdapters')) return {
        createWxStorageAdapter: () => storage,
        createWxNavigationAdapter: () => ({})
      };
      if (request.endsWith('/authNavigation')) return { createAuthNavigation(options) {
        stateChange = options.onStateChange;
        return { invalidate(scope) {
          invalidations.push(scope);
          if (scope === 'login') app.boundDeviceSet.clear();
          stateChange({ loginToken: '', devices: [], profile: null });
        } };
      } };
      throw new Error(request);
    },
    App(definition) { app = definition; }
  }, { filename });
  app.onLaunch({});
  return { app, repository, values, requests, invalidations, stateChange: state => stateChange(state),
    login(token) { stateChange({ loginToken: token, devices: app.listBoundDevices(), isLoggedIn: true }); } };
}

test('App synchronizes cache identity, local removal, names and logout with bound-device state', () => {
  const { app, repository, login } = loadApp();
  login('A');
  repository.replace('A', 'SN-A', 'status', { name: 'old', status: 'normal' });
  app.renameDevice('SN-A', 'new');
  assert.equal(repository.peek('A', 'SN-A', 'status').value.name, 'new');
  app.removeLocalDevice('SN-A');
  assert.equal(repository.peek('A', 'SN-A', 'status'), null);
  app.bindDevice('SN-A');
  repository.replace('A', 'SN-A', 'contacts', [{ name: 'private-A' }]);
  login('B');
  assert.equal(repository.peek('A', 'SN-A', 'contacts'), null);
  assert.equal(repository.peek('B', 'SN-A', 'contacts'), null);
  repository.replace('B', 'SN-A', 'contacts', [{ name: 'private-B' }]);
  app.clearAuthState();
  assert.equal(repository.peek('B', 'SN-A', 'contacts'), null);
});

test('authoritative membership refresh adds and removes devices while retaining names, selection and current caches', async () => {
  const pending = deferred();
  const h = loadApp(() => pending.promise);
  h.login('A');
  h.app.bindDevice('SN-B', '桥B');
  h.repository.replace('A', 'SN-A', 'contacts', [{ name: 'removed' }]);
  h.repository.replace('A', 'SN-B', 'status', { name: '桥B', status: 'normal' });
  const first = h.app.refreshBoundDevices();
  assert.equal(first, h.app.refreshBoundDevices());
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0][0], '/user/bind/status');
  assert.deepEqual(Object.keys(h.requests[0][1]), []);
  assert.equal(h.requests[0][2].credential, 'A');
  assert.equal(h.requests[0][2].invalidateOn401, false);
  pending.resolve({ code: 1, data: ['SN-B', 'SN-C', 'SN-C'] });
  await first;
  assert.deepEqual(h.app.listBoundDevices(), [{ sn: 'SN-B', name: '桥B' }, { sn: 'SN-C', name: 'SN-C' }]);
  assert.equal(h.app.globalData.selectedDeviceSn, 'SN-B');
  assert.equal(h.repository.peek('A', 'SN-A', 'contacts'), null);
  assert.equal(h.repository.peek('A', 'SN-B', 'status').value.status, 'normal');
});

test('a successful empty list clears removed devices and their cached resources', async () => {
  const h = loadApp(async () => ({ code: 1, data: [] }));
  h.login('A');
  h.repository.replace('A', 'SN-A', 'status', { status: 'normal' });
  await h.app.refreshBoundDevices();
  assert.equal(h.app.listBoundDevices().length, 0);
  assert.equal(h.app.globalData.selectedDeviceSn, '');
  assert.equal(h.repository.peek('A', 'SN-A', 'status'), null);
});

test('network failures and malformed membership responses never replace existing bindings with empty data', async () => {
  for (const data of [null, {}, [''], [123]]) {
    const h = loadApp(async () => ({ code: 1, data }));
    h.login('A');
    await assert.rejects(h.app.refreshBoundDevices(), { msg: '关联设备列表返回异常，请重试' });
    assert.equal(h.app.listBoundDevices()[0].sn, 'SN-A');
  }
  const h = loadApp(async () => { throw { code: -1 }; });
  h.login('A');
  await assert.rejects(h.app.refreshBoundDevices(), { code: -1 });
  assert.equal(h.app.listBoundDevices()[0].sn, 'SN-A');
});

test('membership results and 401s from an earlier session cannot change a newer login', async () => {
  for (const failure of [false, true]) {
    const pending = deferred();
    const h = loadApp(() => pending.promise);
    h.login('A');
    const refresh = h.app.refreshBoundDevices();
    h.login('B');
    h.repository.replace('B', 'SN-A', 'status', { name: 'B' });
    if (failure) pending.reject({ code: 401 });
    else pending.resolve({ code: 1, data: ['OLD-A'] });
    await assert.rejects(refresh, { code: 'STALE_DEVICE_REQUEST' });
    assert.equal(h.app.getLoginToken(), 'B');
    assert.equal(h.repository.peek('B', 'SN-A', 'status').value.name, 'B');
    assert.equal(h.invalidations.length, 0);
  }
});

test('a current-session membership 401 clears login while a completed local bind supersedes an older list', async () => {
  const h = loadApp(async () => { throw { code: 401 }; });
  h.login('A');
  await assert.rejects(h.app.refreshBoundDevices(), { code: 401 });
  assert.equal(h.app.getLoginToken(), '');
  assert.deepEqual(h.invalidations, ['login']);
  const pending = deferred();
  const next = loadApp(() => pending.promise);
  next.login('A');
  const refresh = next.app.refreshBoundDevices();
  next.app.bindDevice('SN-NEW');
  pending.resolve({ code: 1, data: ['SN-A'] });
  await assert.rejects(refresh, { code: 'STALE_DEVICE_REQUEST' });
  assert.ok(next.app.getDevice('SN-NEW'));
});
