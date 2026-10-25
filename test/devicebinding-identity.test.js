const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('binding stores only device metadata and never interprets the response as a token', async () => {
  const calls = [];
  const bound = [];
  const app = {
    globalData: { pendingSN: 'SN001', loginToken: 'one-user-token' },
    getLoginToken() { return this.globalData.loginToken; },
    bindDevice(...args) { bound.push(args); }
  };
  const source = fs.readFileSync(path.join(__dirname, '../pages/devicebinding/devicebinding.js'), 'utf8')
    .replace("import http from '../../utils/http';", 'const http = __http;')
    .replace("import { isValidSN } from '../../utils/validators';", 'const isValidSN = value => /^[A-Z0-9_-]+$/.test(value);')
    .replace("import logger from '../../utils/logger';", 'const logger = { warn() {}, error() {} };');
  let page;
  vm.runInNewContext(source, {
    __http: { async post(...args) { calls.push(args); return { code: 1, data: args[1].deviceId }; } },
    getApp: () => app,
    Page(definition) { page = { ...definition, data: { ...definition.data }, setData(values) { Object.assign(this.data, values); } }; },
    wx: { showLoading() {}, hideLoading() {}, toast() {}, switchTab() {} },
    setTimeout() {}
  });
  assert.equal(await page.bindDevice('sn001'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/user/bind/device');
  assert.equal(calls[0][1].deviceId, 'SN001');
  assert.equal(calls[0][2].credential, 'one-user-token');
  assert.deepEqual(bound, [['SN001', 'SN001']]);
  assert.equal(app.globalData.loginToken, 'one-user-token');
});
