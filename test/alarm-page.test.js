const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAlarmPage({ http, logger, wx, app = {}, subscriptionDecision = 'reject' }) {
  const pagePath = path.join(__dirname, '../pages/alarms/alarms.js');
  const source = fs.readFileSync(pagePath, 'utf8')
    .replace("import http from '../../utils/http';", 'const http = globalThis.__deps.http;')
    .replace("import logger from '../../utils/logger';", 'const logger = globalThis.__deps.logger;');

  let definition;
  vm.runInNewContext(source, {
    __deps: { http, logger },
    Page(value) { definition = value; },
    wx,
    getApp() { return app; },
    require(request) {
      if (request.endsWith('/alarmInbox')) return require('../utils/alarmInbox');
      if (request.endsWith('/alarmSubscription')) {
        return { requestAlarmSubscription: async () => subscriptionDecision };
      }
      throw new Error(`Unexpected require: ${request}`);
    },
    console,
    Promise,
    String,
    Boolean,
    Number,
    Date,
    Set
  }, { filename: pagePath });
  return definition;
}

function createPage(definition, overrides = {}) {
  return {
    ...definition,
    data: { ...definition.data },
    setData(update) { Object.assign(this.data, update); },
    async loadAlarms() {},
    ...overrides
  };
}

test('accepted alarm subscription updates and disables the button state', async () => {
  const toasts = [];
  const definition = loadAlarmPage({
    subscriptionDecision: 'accept',
    wx: { showToast(options) { toasts.push(options); } },
    http: {},
    logger: { error() {} }
  });
  const page = createPage(definition);

  await page.subscribeAlarmNotifications();

  assert.equal(page.data.subscriptionAccepted, true);
  assert.equal(page.data.subscribing, false);
  assert.equal(toasts.at(-1).title, '已订阅下一次报警提醒');
});

test('the alarm inbox opens the independent handling history page', () => {
  const navigations = [];
  const definition = loadAlarmPage({
    wx: { navigateTo(options) { navigations.push(options.url); } },
    http: {},
    logger: { error() {} }
  });
  const page = createPage(definition);

  page.goHistory();

  assert.deepEqual(navigations, ['/pages/alarm-history/alarm-history']);
});

test('tapping a pending alarm opens a valid modal and sends the handle request', async () => {
  const requests = [];
  const errors = [];
  const modalCalls = [];
  const wx = {
    showModal(options) {
      modalCalls.push(options);
      if (Array.from(options.confirmText || '').length > 4) {
        options.fail(new Error('showModal:fail confirmText length should not be larger than 4'));
        return;
      }
      options.success({ confirm: true, cancel: false });
    },
    showToast() {}
  };
  const definition = loadAlarmPage({
    wx,
    http: {
      async post(url, data, options) { requests.push({ url, data, options }); }
    },
    logger: {
      error(message, context) { errors.push({ message, context }); }
    }
  });
  let reloads = 0;
  const page = createPage(definition, {
    data: {
      ...definition.data,
      alarms: [{ alarmId: '42', status: 'pending', canHandle: true }]
    },
    async loadAlarms() { reloads += 1; }
  });

  await page.handleAlarm({ currentTarget: { dataset: { id: '42' } } });

  assert.equal(modalCalls.length, 1);
  assert.ok(Array.from(modalCalls[0].confirmText).length <= 4);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/user/alarms/handle');
  assert.equal(requests[0].data.alarmId, '42');
  assert.equal(requests[0].options.credentialScope, 'login');
  assert.equal(errors.length, 0);
  assert.equal(reloads, 0);
  assert.equal(page.data.alarms.length, 0);
  assert.equal(page.data.handlingId, '');
});

test('shows a visible error when the confirmation modal cannot open', async () => {
  const toasts = [];
  const errors = [];
  const definition = loadAlarmPage({
    wx: {
      showModal(options) { options.fail(new Error('showModal failed')); },
      showToast(options) { toasts.push(options); }
    },
    http: { async post() { throw new Error('request should not run'); } },
    logger: { error(message, context) { errors.push({ message, context }); } }
  });
  const page = createPage(definition);

  await page.handleAlarm({ currentTarget: { dataset: { id: '42' } } });

  assert.equal(errors.length, 1);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].title, '处理失败，请重试');
  assert.equal(page.data.handlingId, '');
});
