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

test('profile entry is a fixed settings icon button independent of user avatars', () => {
  const template = fs.readFileSync(path.join(__dirname, '../pages/alarms/alarms.wxml'), 'utf8');
  assert.match(template, /<view class="profile-entry" bindtap="goProfile" aria-role="button"/);
  assert.match(template, /class="profile-icon" src="\/images\/icons\/settings-2\.svg" mode="aspectFit"/);
  assert.doesNotMatch(template, /userInfo\.avatarUrl|profile-avatar|name="user-round"/);
});

test('fixed settings icon preserves the original entry layout', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../pages/alarms/alarms.wxss'), 'utf8');
  const entry = styles.match(/\.profile-entry\s*\{([^}]+)\}/)[1];
  assert.match(entry, /margin-left:\s*12px\s*;/);
  assert.match(entry, /padding:\s*3px\s*;/);
  assert.doesNotMatch(entry, /align-self|margin:\s*0 0 0 auto/);
});

function createLoadingPage(items = [], hasLoaded = false) {
  let resolveRequest;
  const definition = loadAlarmPage({
    http: { get() { return new Promise(resolve => { resolveRequest = resolve; }); } },
    logger: { error() {} },
    wx: { showToast() {} },
    app: { listBoundDevices() { return []; } }
  });
  const page = createPage(definition, {
    data: { ...definition.data, isLogin: true, alarms: items, hasLoaded },
    loadAlarms: definition.loadAlarms
  });
  return { page, resolve(items = []) { resolveRequest({ data: { items, hasMore: false } }); } };
}

test('initial alarm request shows loading until the first successful result', async () => {
  const { page, resolve } = createLoadingPage();
  const request = page.loadAlarms(true);
  assert.equal(page.data.loading, true);
  assert.equal(page.data.refreshing, false);
  assert.equal(page.data.hasLoaded, false);
  resolve();
  await request;
  assert.equal(page.data.hasLoaded, true);
  assert.equal(page.data.loading, false);
});

for (const items of [[], [{ alarmId: '42' }]]) {
  test(`refresh preserves the ${items.length ? 'existing list' : 'successful empty state'} without foreground loading`, async () => {
    const { page, resolve } = createLoadingPage(items, true);
    const request = page.loadAlarms(true);
    assert.equal(page.data.loading, true);
    assert.equal(page.data.refreshing, true);
    assert.equal(page.data.alarms, items);
    assert.equal(page.data.hasLoaded, true);
    resolve();
    await request;
    assert.equal(page.data.loading, false);
    assert.equal(page.data.refreshing, false);
  });
}

test('pagination keeps its loading feedback after initial results', async () => {
  const { page, resolve } = createLoadingPage([{ alarmId: '42' }], true);
  const request = page.loadAlarms(false);
  assert.equal(page.data.loading, true);
  assert.equal(page.data.refreshing, false);
  resolve();
  await request;
  assert.equal(page.data.loading, false);
});

test('alarm template retains empty content during refresh and hides refresh footer loading', () => {
  const template = fs.readFileSync(path.join(__dirname, '../pages/alarms/alarms.wxml'), 'utf8');
  assert.match(template, /loading && !hasLoaded && alarms.length === 0/);
  assert.match(template, /\(!loading \|\| hasLoaded\) && alarms.length === 0/);
  assert.match(template, /wx:if="\{\{loading && !refreshing\}\}" class="list-footer"/);
});

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

test('alarm page opens only backend display coordinates, not raw GPS or event coordinate attributes', async () => {
  const opened = [];
  const definition = loadAlarmPage({
    http: { async get() { return { data: { items: [{
      alarmId: '42', deviceSn: 'SN001', gpsLng: 116.404, gpsLat: 39.915, coordinateSystem: 'wgs84',
      displayLocation: { longitude: 116.4102445, latitude: 39.9164043, coordinateSystem: 'gcj02' }
    }], hasMore: false } }; } },
    logger: { error() {} }, wx: { openLocation(options) { opened.push(options); } },
    app: { listBoundDevices() { return []; } }
  });
  const page = createPage(definition, { data: { ...definition.data, isLogin: true }, loadAlarms: definition.loadAlarms });
  await page.loadAlarms(true);
  page.openAlarmLocation({ currentTarget: { dataset: { id: '42', lat: 39.915, lng: 116.404 } } });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].latitude, 39.9164043);
  assert.equal(opened[0].longitude, 116.4102445);
  assert.equal(page.data.alarms[0].gpsLng, 116.404);
});

test('alarm navigation fails closed for missing display coordinates and unknown records', () => {
  const toasts = [], opened = [];
  const definition = loadAlarmPage({
    http: {}, logger: { error() {} },
    wx: { openLocation(options) { opened.push(options); }, showToast(options) { toasts.push(options); } }
  });
  const page = createPage(definition, { data: { ...definition.data, alarms: [{ alarmId: '42', gpsLng: 116.404, gpsLat: 39.915 }] } });
  for (const id of ['42', 'unknown', '']) page.openAlarmLocation({ currentTarget: { dataset: { id, lat: null, lng: null } } });
  assert.equal(opened.length, 0);
  assert.equal(toasts.length, 3);
  const template = fs.readFileSync(path.join(__dirname, '../pages/alarms/alarms.wxml'), 'utf8');
  assert.match(template, /wx:if="\{\{item\.hasLocation\}\}"/);
  assert.doesNotMatch(template, /data-lat=|data-lng=/);
});
