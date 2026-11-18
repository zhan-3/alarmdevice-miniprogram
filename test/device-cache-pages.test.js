const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDeviceRepository } = require('../utils/deviceRepository');
const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  let token = 'user-A';
  let statusRead;
  const devices = new Map([['SN-A', { sn: 'SN-A', name: '旧名称' }]]);
  const repository = createDeviceRepository();
  const storage = {};
  const calls = [];
  const invalidations = [];
  const server = { deviceIds: ['SN-A'], name: '东桥', gpsLat: 31.2, gpsLng: 121.5, address: '桥南', contacts: [] };
  repository.syncSession(token, [...devices.values()]);
  const app = {
    globalData: { selectedDeviceSn: 'SN-A', userInfo: { phone: '13800000001' } },
    getLoginToken: () => token,
    listBoundDevices: () => [...devices.values()],
    getDevice: id => devices.get(id),
    async refreshBoundDevices() {
      const res = await http.get('/user/bind/status', {}, { credentialScope: 'login', credential: token, invalidateOn401: false });
      const allowed = new Set(res.data);
      for (const id of devices.keys()) if (!allowed.has(id)) devices.delete(id);
      for (const id of allowed) if (!devices.has(id)) devices.set(id, { sn: id, name: id });
      repository.syncSession(token, [...devices.values()]);
      return [...devices.values()];
    },
    selectDevice() {},
    renameDevice(id, name) {
      if (!devices.has(id)) return;
      devices.get(id).name = name;
      const cached = repository.peek(token, id, 'status');
      if (cached && cached.value.name !== name) repository.patch(token, id, 'status', { name });
    },
    authNavigation: {
      async restore() { return { type: 'ready' }; },
      invalidate(scope) {
        invalidations.push(scope);
        if (scope === 'login') { token = ''; repository.clear(); }
        else { devices.delete(scope.sn); repository.syncSession(token, [...devices.values()]); }
      }
    }
  };
  const http = {
    async get(url, data, options) {
      calls.push({ method: 'get', url, data, options });
      if (url === '/user/bind/status') {
        if (!data.deviceId) return { code: 1, data: server.deviceIds.slice() };
        if (statusRead) return statusRead();
        return { code: 1, data: { name: server.name, status: 'normal' } };
      }
      if (url === '/user/getMainMessage') return { code: 1, data: { phone: '13800000001' } };
      if (url === '/user/getInstallLocation') return { code: 1, data: { ...server } };
      if (url === '/user/userGetPhone') return { code: 1, data: server.contacts };
      throw new Error(`Unexpected GET ${url}`);
    },
    async post(url, data) {
      calls.push({ method: 'post', url, data });
      if (url === '/device/updateName') server.name = data.name;
      else if (url === '/device/updateLocation') Object.assign(server, { gpsLat: data.latitude, gpsLng: data.longitude, address: data.address });
      else if (url.startsWith('/user/addPhoneNumber?')) {
        const query = new URL(url, 'https://example.test').searchParams;
        server.contacts.push({ phone: query.get('number'), name: query.get('name') || '测试联系人' });
      } else throw new Error(`Unexpected POST ${url}`);
      return { code: 1 };
    }
  };
  const logger = { error() {}, debug() {}, warn() {} };
  const constants = { DEVICE_STATUS_MAP: { normal: '正常', alarm: '报警中', unknown: '数据不可用' } };
  const storageApi = { getStorage: key => storage[key], setStorage: (key, value) => { storage[key] = value; } };
  const wx = { toast() {}, showToast() {}, navigateTo() {}, setNavigationBarTitle() {}, modal: async () => true };
  const imports = { http, logger, constants, storage: storageApi };
  function transform(source) {
    return source.replace(/^import (.+) from '(.+)';$/gm, (_line, binding, request) => {
      const name = request.split('/').at(-1);
      return `const ${binding} = __imports.${name === 'deviceService' ? 'deviceService' : name};`;
    });
  }
  const serviceFile = path.join(__dirname, '../utils/deviceService.js');
  const serviceContext = {
    __imports: imports, getApp: () => app, module: { exports: {} },
    require(request) {
      if (request.endsWith('/deviceRepository')) return { deviceRepository: repository };
      return require('../utils/deviceDetailsLoader');
    }
  };
  vm.runInNewContext(transform(fs.readFileSync(serviceFile, 'utf8')).replace(/^export /gm, '') +
    '\nmodule.exports = { loadDeviceData, loadDeviceDetails, loadDeviceContacts, loadDeviceSummary, getCachedDeviceSummary, getCachedDeviceDetails, buildMarkers };', serviceContext);
  const service = serviceContext.module.exports;
  imports.deviceService = service;
  function page(name) {
    const filename = path.join(__dirname, `../pages/${name}/${name}.js`);
    let result;
    vm.runInNewContext(transform(fs.readFileSync(filename, 'utf8')), {
      __imports: imports, getApp: () => app, wx,
      require(request) {
        if (request.endsWith('/deviceRepository')) return { deviceRepository: repository };
        if (request.endsWith('/requestVersion')) return require('../utils/requestVersion');
        if (request.endsWith('/localSettings')) return require('../utils/localSettings');
        throw new Error(request);
      },
      setInterval: () => 1, clearInterval() {}, setTimeout: () => 1,
      Page(definition) {
        result = { ...definition, data: { ...definition.data }, setData(update) {
          for (const [key, value] of Object.entries(update)) {
            const parts = key.split('.');
            if (parts.length === 2) this.data[parts[0]][parts[1]] = value;
            else this.data[key] = value;
          }
        } };
      }
    }, { filename });
    return result;
  }
  return { app, repository, calls, invalidations, service, page, wx, server,
    setLocalDeviceIds(ids) {
      devices.clear();
      for (const id of ids) devices.set(id, { sn: id, name: id });
      repository.syncSession(token, [...devices.values()]);
    },
    setStatusRead(value) { statusRead = value; },
    setToken(value) { token = value; repository.syncSession(value, [...devices.values()]); } };
}

test('list and detail share status requests; a recreated detail paints complete cached data before the fresh request', async () => {
  const h = harness();
  const first = deferred();
  h.setStatusRead(() => first.promise);
  const list = h.page('home');
  const showing = list.onShow();
  await tick();
  const detail = h.page('device-detail');
  detail.onLoad({ id: 'SN-A' });
  detail.onShow();
  assert.equal(h.calls.filter(call => call.url === '/user/bind/status' && call.data.deviceId).length, 1);
  first.resolve({ code: 1, data: { name: '东桥', status: 'normal' } });
  await showing;
  await tick();
  assert.equal(detail.data.device.name, '东桥');
  detail.onUnload();
  const second = deferred();
  h.setStatusRead(() => second.promise);
  const reopened = h.page('device-detail');
  reopened.onLoad({ id: 'SN-A' });
  reopened.onShow();
  assert.equal(reopened.data.device.name, '东桥');
  assert.equal(reopened.data.device.address, '桥南');
  assert.equal(reopened.data.deviceCached, true);
  assert.equal(reopened.data.isLoading, true);
  assert.equal(h.calls.filter(call => call.url === '/user/bind/status' && call.data.deviceId).length, 2);
  second.resolve({ code: 1, data: { name: '东桥新名称', status: 'alarm' } });
  await tick();
  assert.equal(reopened.data.device.name, '东桥新名称');
  assert.equal(reopened.data.deviceCached, false);
});

test('device list status text does not change merely because a cached result becomes fresh', () => {
  const template = fs.readFileSync(path.join(__dirname, '../pages/home/home.wxml'), 'utf8');
  assert.match(template, /aria-label="最近查询状态：\{\{item.statusText\}\}">\{\{item.statusText\}\}<\/view>/);
  assert.doesNotMatch(template, /statusCached|上次·/);
});

test('a recreated list renders cached rows immediately and keeps them on a transient status failure', async () => {
  const h = harness();
  await h.service.loadDeviceSummary('SN-A', 'user-A');
  const pending = deferred();
  h.setStatusRead(() => pending.promise);
  const page = h.page('home');
  const showing = page.onShow();
  assert.equal(page.data.pageLoading, false);
  assert.equal(page.data.devices[0].name, '东桥');
  assert.equal(page.data.devices[0].statusCached, true);
  await tick();
  pending.reject({ code: -1 });
  await showing;
  assert.equal(page.data.devices[0].status, 'normal');
  assert.equal(page.data.devices[0].statusCached, true);
  assert.equal(page.data.loadError, true);
});

test('settings saves update the shared name and location before a new detail page is created', async () => {
  const h = harness();
  await h.service.loadDeviceDetails('SN-A', 'user-A');
  const setting = h.page('setting');
  setting.onLoad({ id: 'SN-A' });
  setting.onShow();
  await tick();
  setting.setData({ tempName: '北桥' });
  await setting.saveName();
  let picker;
  h.wx.getSetting = options => options.success({ authSetting: { 'scope.userLocation': true } });
  h.wx.chooseLocation = options => { picker = options; };
  await setting.chooseLocation();
  await picker.success({ latitude: 32, longitude: 122, address: '桥北' });
  const pending = deferred();
  h.setStatusRead(() => pending.promise);
  const detail = h.page('device-detail');
  detail.onLoad({ id: 'SN-A' });
  assert.equal(detail.data.device.name, '北桥');
  assert.equal(detail.data.device.address, '桥北');
  assert.equal(detail.data.device.latitude, 32);
  pending.resolve({ code: 1, data: { name: '北桥', status: 'normal' } });
  await tick();
});

test('contact changes update the next detail instance and permission rejection removes every cached part', async () => {
  const h = harness();
  const detail = h.page('device-detail');
  detail.onLoad({ id: 'SN-A' });
  await tick();
  detail.setData({ tempContactPhone: '13900000002', tempContactName: '测试联系人' });
  await detail.saveContact();
  assert.equal(h.service.getCachedDeviceDetails('SN-A', 'user-A').device.contacts.length, 1);
  h.setStatusRead(async () => { throw { code: 403 }; });
  const reopened = h.page('device-detail');
  reopened.onLoad({ id: 'SN-A' });
  assert.equal(reopened.data.device.contacts.length, 1);
  await tick();
  assert.equal(reopened.data.device, null);
  assert.equal(h.service.getCachedDeviceDetails('SN-A', 'user-A'), null);
});

test('pull refresh discovers a server-added device even when the current session cached an empty list', async () => {
  const h = harness();
  h.setLocalDeviceIds([]);
  h.server.deviceIds = [];
  h.wx.stopPullDownRefresh = () => {};
  const list = h.page('home');
  await list.onShow();
  assert.equal(list.data.devices.length, 0);
  h.server.deviceIds = ['SN001'];
  await list.onPullDownRefresh();
  await tick();
  assert.equal(list.data.devices.length, 1);
  assert.equal(list.data.devices[0].sn, 'SN001');
  const discovery = h.calls.filter(call => call.url === '/user/bind/status' && !call.data.deviceId);
  assert.ok(discovery.length >= 2);
  assert.ok(h.calls.some(call => call.url === '/user/bind/status' && call.data.deviceId === 'SN001'));
});

test('pull refresh during an earlier polling cycle waits and then discovers new server associations', async () => {
  const h = harness();
  const pending = deferred();
  h.setStatusRead(() => pending.promise);
  let stopped = false;
  h.wx.stopPullDownRefresh = () => { stopped = true; };
  const list = h.page('home');
  const showing = list.onShow();
  await tick();
  h.server.deviceIds.push('SN001');
  const pulling = list.onPullDownRefresh();
  await tick();
  assert.equal(stopped, false);
  pending.resolve({ code: 1, data: { name: '测试设备', status: 'normal' } });
  await Promise.all([showing, pulling]);
  assert.ok(list.data.devices.some(device => device.sn === 'SN001'));
  assert.equal(stopped, true);
  assert.ok(h.calls.filter(call => call.url === '/user/bind/status' && !call.data.deviceId).length >= 2);
});

test('failed membership refresh retains the current device list and successful removal prunes its cache', async () => {
  const h = harness();
  h.wx.stopPullDownRefresh = () => {};
  const list = h.page('home');
  await list.onShow();
  const refresh = h.app.refreshBoundDevices;
  h.app.refreshBoundDevices = async () => { throw { code: -1 }; };
  await list.onPullDownRefresh();
  assert.equal(list.data.devices[0].sn, 'SN-A');
  assert.equal(list.data.loadError, true);
  h.app.refreshBoundDevices = refresh;
  h.server.deviceIds = [];
  await list.onPullDownRefresh();
  assert.equal(list.data.devices.length, 0);
  assert.equal(h.repository.peek('user-A', 'SN-A', 'status'), null);
});

test('cold authentication restoration can establish the first session before loading the list', async () => {
  const h = harness();
  h.setToken('');
  h.app.authNavigation.restore = async () => { h.setToken('user-A'); return { type: 'ready' }; };
  const list = h.page('home');
  await list.onShow();
  assert.equal(list.data.isLogin, true);
  assert.equal(list.data.devices[0].name, '东桥');
  assert.equal(list.data.pageLoading, false);
});

test('hidden list requests never overwrite a new account and duplicate foreground refreshes share a task', async () => {
  const h = harness();
  const pending = deferred();
  h.setStatusRead(() => pending.promise);
  const list = h.page('home');
  const showing = list.onShow();
  await tick();
  const first = list.loadAllDevices();
  assert.equal(first, list.loadAllDevices());
  list.onHide();
  h.setToken('user-B');
  pending.resolve({ code: 1, data: { name: 'private-A', status: 'normal' } });
  await showing;
  assert.equal(h.repository.peek('user-B', 'SN-A', 'status'), null);
  assert.equal(h.invalidations.length, 0);
});
