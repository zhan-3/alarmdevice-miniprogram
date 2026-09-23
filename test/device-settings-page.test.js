const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSettingPage({ http, logger, wx, app }) {
  const pagePath = path.join(__dirname, '../pages/setting/setting.js');
  const source = fs.readFileSync(pagePath, 'utf8')
    .replace("import { loadDeviceData, buildMarkers } from '../../utils/deviceService';", 'const { loadDeviceData, buildMarkers } = globalThis.__deps;')
    .replace("import http from '../../utils/http';", 'const http = globalThis.__deps.http;')
    .replace("import { getStorage } from '../../utils/storage';", 'const { getStorage } = globalThis.__deps;')
    .replace("import logger from '../../utils/logger';", 'const logger = globalThis.__deps.logger;');

  let definition;
  vm.runInNewContext(source, {
    __deps: {
      http,
      logger,
      loadDeviceData: async () => null,
      buildMarkers: () => [],
      getStorage: () => null
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

test('device name changes only after the server accepts it', async () => {
  const toasts = [];
  const renamed = [];
  const definition = loadSettingPage({
    http: { async post() { throw { code: -1, msg: 'offline' }; } },
    logger: { error() {}, warn() {} },
    wx: { toast(options) { toasts.push(options); } },
    app: {
      getDeviceAccessToken: () => 'device-token',
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
    app: { getDeviceAccessToken: () => 'device-token' }
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
