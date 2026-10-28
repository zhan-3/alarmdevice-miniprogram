const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSettingPage({ http, logger, wx, app, storage = {} }) {
  const pagePath = path.join(__dirname, '../pages/setting/setting.js');
  const source = fs.readFileSync(pagePath, 'utf8')
    .replace("import { loadDeviceData, buildMarkers } from '../../utils/deviceService';", 'const { loadDeviceData, buildMarkers } = globalThis.__deps;')
    .replace("import http from '../../utils/http';", 'const http = globalThis.__deps.http;')
    .replace("import { getStorage, setStorage } from '../../utils/storage';", 'const { getStorage, setStorage } = globalThis.__deps;')
    .replace("import logger from '../../utils/logger';", 'const logger = globalThis.__deps.logger;');

  let definition;
  vm.runInNewContext(source, {
    __deps: {
      http,
      logger,
      loadDeviceData: async () => null,
      buildMarkers: () => [],
      getStorage: key => storage[key] || null,
      setStorage: (key, value) => { storage[key] = value; }
    },
    Page(value) { definition = value; },
    wx,
    getApp() { return app; },
    require(request) {
      if (request.endsWith('/localSettings')) return require('../utils/localSettings');
      throw new Error(`Unexpected require: ${request}`);
    },
    console,
    Promise,
    String,
    Boolean,
    Number,
    Date,
    Set,
    encodeURIComponent
  }, { filename: pagePath });
  return definition;
}

function createPage(definition, data) {
  return {
    ...definition,
    data: { ...definition.data, ...data },
    setData(update) {
      for (const [key, value] of Object.entries(update)) {
        const parts = key.split('.');
        let target = this.data;
        while (parts.length > 1) {
          const part = parts.shift();
          target = target[part];
        }
        target[parts[0]] = value;
      }
    }
  };
}

test('optional nickname saving preserves the latest avatar and refreshes profile without replacing login identity', async () => {
  for (const input of ['  值班负责人  ', '   ']) {
    const requests = [];
    const storage = {};
    const app = { globalData: {}, getLoginToken: () => 'same-user-jwt' };
    let saved = false;
    const definition = loadSettingPage({
      app, storage, logger: { error() {} }, wx: { toast() {} },
      http: {
        async get(url, data, options) {
          requests.push({ method: 'GET', url, options });
          return { data: { nickName: saved ? input.trim() : '原昵称', avatarUrl: 'https://example.test/current-avatar.png', phone: '13800000003' } };
        },
        async post(url, data, options) {
          requests.push({ method: 'POST', url, data, options });
          saved = true;
          return { code: 1 };
        }
      }
    });
    const page = createPage(definition, {});
    await page.onShow();
    page.editNickname();
    page.onNicknameInput({ detail: { value: input } });
    await page.saveNickname();
    const update = requests.find(request => request.method === 'POST');
    assert.equal(update.url, '/user/getMessage');
    assert.equal(update.data.nickName, input.trim());
    assert.equal(update.data.avatarUrl, 'https://example.test/current-avatar.png');
    assert.equal(update.options.credential, 'same-user-jwt');
    assert.equal(requests.filter(request => request.method === 'GET').length, 3);
    assert.equal(storage.userInfo.nickName, input.trim());
    assert.equal(app.globalData.userInfo.nickName, input.trim());
    assert.equal(page.data.showNicknameModal, false);
    assert.equal(app.getLoginToken(), 'same-user-jwt');
  }
});

test('nickname failures preserve the cached profile and draft and never save without a readable current profile', async () => {
  const storage = {};
  const app = { globalData: {}, getLoginToken: () => 'same-user-jwt' };
  let rejectGet = false;
  let posts = 0;
  const definition = loadSettingPage({
    app, storage, logger: { error() {} }, wx: {},
    http: {
      async get() {
        if (rejectGet) throw { msg: '无法读取头像资料' };
        return { data: { nickName: '原昵称', avatarUrl: 'https://example.test/kept.png' } };
      },
      async post() { posts += 1; throw { code: 0, msg: '保存被拒绝', userNotified: true }; }
    }
  });
  const page = createPage(definition, {});
  await page.onShow();
  page.editNickname();
  page.onNicknameInput({ detail: { value: '新昵称' } });
  await page.saveNickname();
  assert.equal(page.data.nicknameError, '保存被拒绝');
  assert.equal(storage.userInfo.nickName, '原昵称');
  assert.equal(page.data.tempNickname, '新昵称');
  assert.equal(page.data.savingNickname, false);
  rejectGet = true;
  await page.saveNickname();
  assert.equal(posts, 1);
  assert.equal(page.data.nicknameError, '无法读取头像资料');
  assert.equal(page.data.showNicknameModal, true);
});

test('nickname requests do not overwrite another account or an unloaded page and duplicate saves are suppressed', async () => {
  for (const leave of ['account-switch', 'page-unload']) {
    let token = 'old-session';
    let finish;
    let writes = 0;
    const storage = {};
    const app = { globalData: {}, getLoginToken: () => token };
    const definition = loadSettingPage({
      app, storage, logger: { error() {} }, wx: { toast() { throw new Error('stale success'); } },
      http: {
        async get() { return { data: { nickName: '原昵称', avatarUrl: 'https://example.test/kept.png' } }; },
        post() { writes += 1; return new Promise(resolve => { finish = resolve; }); }
      }
    });
    const page = createPage(definition, {});
    await page.onShow();
    page.editNickname();
    page.onNicknameInput({ detail: { value: '迟到昵称' } });
    const saving = page.saveNickname();
    await Promise.resolve();
    await page.saveNickname();
    assert.equal(writes, 1);
    if (leave === 'account-switch') token = 'new-session';
    else page.onUnload();
    storage.userInfo = { nickName: '当前账号' };
    app.globalData.userInfo = { nickName: '当前账号' };
    finish({ code: 1 });
    await saving;
    assert.equal(storage.userInfo.nickName, '当前账号');
    assert.equal(app.globalData.userInfo.nickName, '当前账号');
  }
});

test('device name request carries deviceId and uses only user login authentication', async () => {
  const calls = [];
  const definition = loadSettingPage({
    http: { async post(...args) { calls.push(args); return { code: 1 }; } },
    logger: { error() {}, warn() {} }, wx: { toast() {} },
    app: { renameDevice() {} }
  });
  const page = createPage(definition, { device: { sn: 'DEVICE-A', name: '旧名称' }, tempName: '新名称' });
  await page.saveName();
  assert.equal(calls[0][0], '/device/updateName');
  assert.equal(calls[0][1].deviceId, 'DEVICE-A');
  assert.equal(calls[0][2].credentialScope, 'login');
  assert.equal(calls[0][2].deviceId, 'DEVICE-A');
  assert.equal(page.data.device.name, '新名称');
});

test('device name changes only after the server accepts it', async () => {
  const toasts = [];
  const renamed = [];
  const definition = loadSettingPage({
    http: { async post() { throw { code: -1, msg: 'offline' }; } },
    logger: { error() {}, warn() {} },
    wx: { toast(options) { toasts.push(options); } },
    app: {
      renameDevice: (...args) => renamed.push(args)
    }
  });
  const page = createPage(definition, {
    device: { sn: 'DEVICE-A', name: '旧名称' },
    tempName: '新名称'
  });

  await page.saveName();

  assert.equal(page.data.device.name, '旧名称');
  assert.deepEqual(renamed, []);
  assert.equal(toasts.at(-1).title, '名称保存失败，请重试');
  assert.equal(page.data.savingName, false);
});

test('installation location remains unchanged when the server save fails', async () => {
  const toasts = [];
  let picker;
  const definition = loadSettingPage({
    http: { async post() { throw { code: -1, msg: 'offline' }; } },
    logger: { error() {}, warn() {} },
    wx: {
      modal: async () => true,
      getSetting(options) { options.success({ authSetting: { 'scope.userLocation': true } }); },
      chooseLocation(options) { picker = options; },
      toast(options) { toasts.push(options); }
    },
    app: {}
  });
  const page = createPage(definition, {
    device: {
      sn: 'DEVICE-A',
      name: '东桥烟感',
      latitude: 39.9,
      longitude: 116.4,
      address: '旧安装位置'
    }
  });

  await page.chooseLocation();
  await picker.success({ latitude: 31.2, longitude: 121.5, address: '新安装位置' });

  assert.equal(page.data.device.latitude, 39.9);
  assert.equal(page.data.device.longitude, 116.4);
  assert.equal(page.data.device.address, '旧安装位置');
  assert.equal(toasts.at(-1).title, '位置保存失败，请重试');
  assert.equal(page.data.savingLocation, false);
});
