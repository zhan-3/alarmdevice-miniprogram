const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function loadContactsService(http, app) {
  const filename = path.join(__dirname, '../utils/deviceService.js');
  const source = fs.readFileSync(filename, 'utf8')
    .replace("import http from './http';", 'const http = __http;')
    .replace("import { DEVICE_STATUS_MAP } from './constants';", 'const DEVICE_STATUS_MAP = {};')
    .replace("import logger from './logger';", 'const logger = { error() {}, debug() {} };')
    .replace(/^export /gm, '');
  const context = {
    __http: http, module: { exports: {} }, getApp: () => app,
    // Deliberately poisoned legacy cache: it must never participate in names.
    getStorage() { throw new Error('legacy contact cache read'); },
    require: () => require('../utils/deviceDetailsLoader')
  };
  vm.runInNewContext(`${source}\nmodule.exports = { loadDeviceContacts };`, context, { filename });
  return context.module.exports.loadDeviceContacts;
}

function harness(handlers = {}) {
  const calls = [], toasts = [], invalidations = [], storage = {};
  let token = 'user-A-jwt';
  const app = {
    globalData: { userInfo: { phone: '13800000001' } },
    getLoginToken: () => token,
    authNavigation: { invalidate(scope) { invalidations.push(scope); } },
    renameDevice() {}
  };
  const http = Object.fromEntries(['get', 'post', 'delete'].map(method => [method, async (...args) => {
    calls.push({ method, url: args[0], data: args[1], options: args[2] });
    if (handlers[method]) return handlers[method](...args);
    return { code: 1, data: method === 'get' ? [] : null };
  }]));
  const loadDeviceContacts = loadContactsService(http, app);
  const filename = path.join(__dirname, '../pages/device-detail/device-detail.js');
  const source = fs.readFileSync(filename, 'utf8')
    .replace("import http from '../../utils/http';", 'const http = __http;')
    .replace("import { getStorage } from '../../utils/storage';", 'const getStorage = key => __storage[key];')
    .replace("import { loadDeviceDetails, loadDeviceContacts } from '../../utils/deviceService';", 'const { loadDeviceDetails, loadDeviceContacts } = __service;')
    .replace("import { DEVICE_STATUS_MAP } from '../../utils/constants';", 'const DEVICE_STATUS_MAP = {};')
    .replace("import logger from '../../utils/logger';", 'const logger = { error() {} };');
  let page;
  vm.runInNewContext(source, {
    __http: http, __storage: storage,
    __service: {
      loadDeviceContacts,
      loadDeviceDetails: handlers.details || (async () => ({ device: { id: 'SN-A', sn: 'SN-A', contacts: [] }, markers: [] }))
    },
    getApp: () => app,
    require: () => require('../utils/requestVersion'),
    Page(definition) {
      page = {
        ...definition,
        data: { ...definition.data, currentSn: 'SN-A', isLoading: false, device: { id: 'SN-A', sn: 'SN-A', contacts: [] }, showAddContactModal: true },
        setData(values) {
          for (const [key, value] of Object.entries(values)) {
            if (key === 'device.contacts') this.data.device.contacts = value;
            else this.data[key] = value;
          }
        }
      };
    },
    wx: { toast(options) { toasts.push(options); }, modal: async () => true },
    console
  }, { filename });
  return { page, calls, toasts, invalidations, storage, app, setToken(value) { token = value; } };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('self-bound and added contacts render the authoritative name, never the phone-only cache', async () => {
  const responses = [
    { code: 1, data: [{ name: '本人设置的昵称', phone: '13900000002' }] },
    { code: 1, data: [{ name: '本人设置的昵称', phone: '13900000002' }] },
    { code: 1, data: [{ name: '夜班值守', phone: '13700000003' }, { name: '136****0004', phone: '13600000004' }] }
  ];
  const h = harness({ get: async () => responses.shift() });
  h.storage.contactNameCache = { '13900000002': '另一个设备的旧称呼', '13700000003': '另一个账号的旧称呼' };
  await h.page.refreshContacts();
  assert.equal(h.page.data.device.contacts[0].name, '本人设置的昵称');
  await h.page.refreshContacts();
  assert.equal(h.page.data.device.contacts[0].name, '本人设置的昵称');
  await h.page.refreshContacts();
  assert.equal(h.page.data.device.contacts[0].name, '夜班值守');
  assert.equal(h.page.data.device.contacts[1].name, '136****0004');
  assert.equal(h.page.data.device.contacts[1].phone, '13600000004');
});

test('optional or trimmed shared appellation is posted, then GET rather than the draft supplies the displayed name', async () => {
  for (const input of ['', '   ', '  王师傅  ']) {
    const h = harness({ get: async () => ({ code: 1, data: [{ name: '账号昵称优先', phone: '13900000002' }] }) });
    h.page.setData({ tempContactName: input, tempContactPhone: '13900000002' });
    await h.page.saveContact();
    assert.deepEqual(h.calls.map(call => call.method), ['post', 'get']);
    const url = new URL(h.calls[0].url, 'https://example.test');
    assert.equal(url.searchParams.get('name'), input.trim());
    assert.equal(url.searchParams.get('deviceId'), 'SN-A');
    assert.equal(url.searchParams.get('number'), '13900000002');
    assert.equal(h.calls[1].url, '/user/userGetPhone');
    assert.equal(h.calls[1].data.deviceId, 'SN-A');
    for (const call of h.calls) {
      assert.equal(call.options.credential, 'user-A-jwt');
      assert.equal(call.options.invalidateOn401, false);
    }
    assert.equal(h.page.data.device.contacts[0].name, '账号昵称优先');
    assert.equal(h.page.data.showAddContactModal, false);
    assert.equal(h.storage.contactNameCache, undefined);
    assert.equal(h.app.getLoginToken(), 'user-A-jwt');
  }
});

test('an added contact with a failed refresh is explicit, blocks another POST, and retries GET only', async () => {
  let reads = 0;
  const h = harness({
    get: async () => {
      if (++reads === 1) throw { msg: '网络失败' };
      return { code: 1, data: [{ name: '权威称呼', phone: '13900000002' }] };
    }
  });
  h.page.setData({ tempContactName: '输入称呼', tempContactPhone: '13900000002' });
  await h.page.saveContact();
  assert.match(h.page.data.contactRefreshError, /联系人已添加.*列表刷新失败/);
  assert.equal(h.page.data.contactSaveError, '');
  assert.equal(h.page.data.device.contacts.length, 0);
  assert.equal(h.page.data.savingContact, false);
  h.page.setData({ tempContactPhone: '13700000003' });
  await h.page.saveContact();
  await h.page.retryContacts();
  assert.deepEqual(h.calls.map(call => call.method), ['post', 'get', 'get']);
  assert.equal(h.page.data.contactRefreshError, '');
  assert.equal(h.page.data.device.contacts[0].name, '权威称呼');
});

test('own number, duplicate number, and an overlong appellation are rejected before any request', async () => {
  for (const scenario of ['own', 'duplicate', 'too-long']) {
    const h = harness();
    h.page.setData({ tempContactPhone: scenario === 'own' ? '13800000001' : '13900000002' });
    if (scenario === 'duplicate') h.page.data.device.contacts = [{ id: 'c0', name: '原称呼', phone: '13900000002' }];
    if (scenario === 'too-long') h.page.setData({ tempContactName: '称'.repeat(21) });
    await h.page.saveContact();
    assert.equal(h.calls.length, 0);
    assert.ok(h.page.data.contactPhoneError || h.page.data.contactSaveError);
  }
});

test('duplicate submits and late POST responses cannot refresh another device, account, or hidden page', async () => {
  for (const transition of ['device', 'account', 'hide']) {
    const pending = deferred();
    const h = harness({ post: () => pending.promise });
    h.page.setData({ tempContactPhone: '13900000002' });
    const saving = h.page.saveContact();
    await h.page.saveContact();
    assert.equal(h.calls.length, 1);
    if (transition === 'device') h.page.setData({ currentSn: 'SN-B' });
    if (transition === 'account') h.setToken('user-B-jwt');
    if (transition === 'hide') h.page.onHide();
    pending.resolve({ code: 1 });
    await saving;
    assert.equal(h.calls.length, 1);
    assert.equal(h.toasts.length, 0);
    assert.equal(h.invalidations.length, 0);
    assert.equal(h.storage.contactNameCache, undefined);
  }
});

test('late contact GET results or authorization errors cannot mutate a new session or unloaded page', async () => {
  for (const transition of ['account-success', 'account-401', 'unload']) {
    const pending = deferred();
    const h = harness({ get: () => pending.promise });
    h.page.setData({ tempContactPhone: '13900000002' });
    const saving = h.page.saveContact();
    await tick();
    assert.deepEqual(h.calls.map(call => call.method), ['post', 'get']);
    if (transition === 'unload') h.page.onUnload();
    else h.setToken('new-user-jwt');
    h.page.data.device.contacts = [{ name: '新会话联系人', phone: '13700000003' }];
    if (transition === 'account-401') pending.reject({ code: 401 });
    else pending.resolve({ code: 1, data: [{ name: '旧会话联系人', phone: '13900000002' }] });
    await saving;
    assert.equal(h.page.data.device.contacts[0].name, '新会话联系人');
    assert.equal(h.invalidations.length, 0);
    assert.equal(h.toasts.length, 0);
  }
});

test('a full detail request started before adding cannot overwrite the authoritative contact refresh', async () => {
  const oldDetails = deferred();
  const h = harness({
    details: () => oldDetails.promise,
    get: async () => ({ code: 1, data: [{ name: '最新账号昵称', phone: '13900000002' }] })
  });
  const loading = h.page.loadDeviceFromAPI();
  h.page.setData({ tempContactPhone: '13900000002' });
  await h.page.saveContact();
  oldDetails.resolve({ device: { contacts: [{ name: '旧称呼', phone: '13900000002' }] }, markers: [] });
  await loading;
  assert.equal(h.page.data.device.contacts[0].name, '最新账号昵称');
  assert.equal(h.page.data.isLoading, false);
});
