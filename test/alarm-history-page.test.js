const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadHistoryPage({ http, logger = { error() {} }, wx = {}, app = {} }) {
  const pagePath = path.join(__dirname, '../pages/alarm-history/alarm-history.js');
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
      if (request.endsWith('/alarmHistory')) return require('../utils/alarmHistory');
      throw new Error(`Unexpected require: ${request}`);
    },
    console,
    Promise,
    String,
    Boolean,
    Number,
    Date,
    Set,
    Map,
    Array,
    encodeURIComponent
  }, { filename: pagePath });
  return definition;
}

function createPage(definition, data = {}) {
  return {
    ...definition,
    data: { ...definition.data, isLogin: true, ...data },
    setData(update) { Object.assign(this.data, update); }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('loads history with an opaque cursor and merges the next page without duplicates', async () => {
  const requests = [];
  const responses = [
    { data: { items: [{ alarmId: 1, deviceName: '一号桥' }], nextCursor: 'opaque:2', hasMore: true } },
    { data: { items: [{ alarmId: 1, handlerName: '更新' }, { alarmId: 2 }], nextCursor: null, hasMore: false } }
  ];
  const definition = loadHistoryPage({
    http: {
      async get(url, data, options) {
        requests.push({ url, data, options });
        return responses.shift();
      }
    }
  });
  const page = createPage(definition);

  await page.loadHistory(true);
  await page.loadHistory(false);

  assert.equal(requests[0].url, '/user/alarms/history');
  assert.equal('cursor' in requests[0].data, false);
  assert.equal(requests[1].data.cursor, 'opaque:2');
  assert.equal(requests[1].options.credentialScope, 'login');
  assert.deepEqual(page.data.items.map(item => item.alarmId), ['1', '2']);
  assert.equal(page.data.items[0].handlerName, '更新');
  assert.equal(page.data.hasMore, false);
});

test('applies handler, keyword, and inclusive date filters as left-closed right-open timestamps', async () => {
  const requests = [];
  const definition = loadHistoryPage({
    http: {
      async get(_url, data) {
        requests.push(data);
        return { data: { items: [], nextCursor: null, hasMore: false } };
      }
    }
  });
  const page = createPage(definition, {
    keywordInput: ' SN-9 ',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    selectedHandlerId: '123'
  });

  page.applyFilters();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].keyword, 'SN-9');
  assert.equal(requests[0].handlerId, '123');
  assert.equal(requests[0].startTime, '2026-10-01T00:00:00');
  assert.equal(requests[0].endTime, '2026-11-01T00:00:00');
  assert.equal(page.data.hasActiveFilters, true);
});

test('invalidates an in-flight response immediately when filters change and then runs the queued query', async () => {
  const first = deferred();
  const second = deferred();
  const requests = [];
  const definition = loadHistoryPage({
    http: {
      get(_url, data) {
        requests.push(data);
        return requests.length === 1 ? first.promise : second.promise;
      }
    }
  });
  const page = createPage(definition);

  const oldLoad = page.loadHistory(true);
  page.setData({ keywordInput: '新筛选' });
  page.applyFilters();
  first.resolve({ data: { items: [{ alarmId: 'old' }], nextCursor: null, hasMore: false } });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(page.data.items.length, 0);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].keyword, '新筛选');
  assert.equal(page.data.loading, true);

  second.resolve({ data: { items: [{ alarmId: 'new' }], nextCursor: null, hasMore: false } });
  await oldLoad;
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(page.data.items.map(item => item.alarmId), ['new']);
  assert.equal(page.data.loading, false);
});

test('revalidates history on every show and hides the previous list while permission is checked', async () => {
  const second = deferred();
  const staleHandlers = deferred();
  let restores = 0;
  let requests = 0;
  const definition = loadHistoryPage({
    app: {
      authNavigation: {
        async restore() { restores += 1; return { type: 'ready' }; }
      }
    },
    http: {
      get(url) {
        if (url === '/user/alarms/history/handlers') return staleHandlers.promise;
        requests += 1;
        if (requests === 1) {
          return Promise.resolve({ data: { items: [{ alarmId: 'visible' }], nextCursor: null, hasMore: false } });
        }
        return second.promise;
      }
    }
  });
  const page = createPage(definition, { isLogin: false });

  await page.onShow();
  assert.deepEqual(page.data.items.map(item => item.alarmId), ['visible']);
  const oldHandlerLoad = page.loadHandlers('旧处理人');

  const showingAgain = page.onShow();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.items.length, 0);
  assert.equal(page.data.loading, true);
  assert.equal(page.data.handlers.length, 0);
  assert.equal(page.data.handlersLoading, false);

  staleHandlers.resolve({ data: [{ id: 'old', name: '旧处理人' }] });
  second.resolve({ data: { items: [], nextCursor: null, hasMore: false } });
  await Promise.all([oldHandlerLoad, showingAgain]);
  assert.equal(restores, 2);
  assert.equal(requests, 2);
  assert.equal(page.data.items.length, 0);
  assert.equal(page.data.handlers.length, 0);
});

test('clears existing history when a refresh reports an invalid login credential', async () => {
  const definition = loadHistoryPage({
    http: { async get() { throw { code: 401 }; } }
  });
  const page = createPage(definition, {
    items: [{ alarmId: 'private' }],
    nextCursor: 'secret-cursor',
    hasMore: true
  });

  await page.loadHistory(true);

  assert.equal(page.data.items.length, 0);
  assert.equal(page.data.nextCursor, '');
  assert.equal(page.data.isLogin, false);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.authRetryNeeded, true);
  assert.equal(page.data.loadError, true);
});
