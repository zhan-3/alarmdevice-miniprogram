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
    getApp() { return { getLoginToken: () => 'session-A', ...app }; },
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

test('revalidates history on every show without hiding the previous list', async () => {
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
  assert.equal(page.data.items[0].alarmId, 'visible');
  assert.equal(page.data.loading, true);
  assert.equal(page.data.refreshing, true);
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

test('returning refresh rebuilds loaded pages without discarding pagination or filters', async () => {
  const requests = [];
  const definition = loadHistoryPage({
    app: { authNavigation: { async restore() { return { type: 'ready' }; } } },
    http: { async get(_url, data) {
      requests.push(data);
      return data.cursor
        ? { data: { items: [{ alarmId: 'second' }], nextCursor: 'next-3', hasMore: true } }
        : { data: { items: [{ alarmId: 'first' }], nextCursor: 'next-2', hasMore: true } };
    } }
  });
  const page = createPage(definition, { keywordInput: 'SN-A', hasActiveFilters: true });
  page.historyToken = 'session-A';
  page.appliedFilters = { keyword: 'SN-A' };
  await page.onShow();
  await page.loadHistory(false);
  page.onHide();
  assert.equal(page.data.items.length, 2);
  await page.onShow();
  assert.equal(page.data.items.length, 2);
  assert.equal(page.data.nextCursor, 'next-3');
  assert.equal(requests.length, 4);
  assert.ok(requests.every(item => item.keyword === 'SN-A'));
});

test('changing account clears history before auth completes and ignores the old response', async () => {
  let token = 'account-A';
  const old = deferred();
  const auth = deferred();
  const definition = loadHistoryPage({
    app: { getLoginToken: () => token, authNavigation: { restore: () => auth.promise } },
    http: { get: () => old.promise }
  });
  const page = createPage(definition, { items: [{ alarmId: 'A' }], hasLoaded: true });
  page.historyToken = token;
  const loading = page.loadHistory(true);
  token = 'account-B';
  const showing = page.onShow();
  assert.equal(page.data.items.length, 0);
  old.resolve({ data: { items: [{ alarmId: 'late-A' }] } });
  await loading;
  assert.equal(page.data.items.length, 0);
  auth.resolve({ type: 'login-required' });
  await showing;
});

test('background refresh is atomic across pages and transient failures preserve the loaded window', async () => {
  const second = deferred();
  const definition = loadHistoryPage({
    http: { get(_url, data) {
      return data.cursor ? second.promise : Promise.resolve({ data: {
        items: [{ alarmId: 'new-first' }], nextCursor: 'new-cursor', hasMore: true
      } });
    } }
  });
  const page = createPage(definition, {
    items: [{ alarmId: 'old-first' }, { alarmId: 'old-second' }],
    nextCursor: 'old-cursor', hasMore: true, hasLoaded: true
  });
  page.historyPageCount = 2;
  const loading = page.loadHistory(true, true, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(page.data.items.map(item => item.alarmId), ['old-first', 'old-second']);
  second.reject({ code: -1 });
  await loading;
  assert.deepEqual(page.data.items.map(item => item.alarmId), ['old-first', 'old-second']);
  assert.equal(page.data.nextCursor, 'old-cursor');
  assert.equal(page.data.refreshError, true);
  assert.equal(page.data.loading, false);
});

test('hiding history invalidates pending list and auth requests without clearing its view', async () => {
  const pending = deferred();
  const auth = deferred();
  let reads = 0;
  const definition = loadHistoryPage({
    app: { authNavigation: { restore: () => auth.promise } },
    http: { get() { reads += 1; return pending.promise; } }
  });
  const page = createPage(definition, { items: [{ alarmId: 'old' }], hasLoaded: true });
  const loading = page.loadHistory(true);
  page.onHide();
  pending.resolve({ data: { items: [{ alarmId: 'late' }] } });
  await loading;
  assert.equal(page.data.items[0].alarmId, 'old');
  assert.equal(page.data.loading, false);
  const showing = page.onShow();
  page.onHide();
  auth.resolve({ type: 'ready' });
  await showing;
  assert.equal(reads, 1);
  assert.equal(page.data.items[0].alarmId, 'old');
});

test('an explicit permission failure removes cached history and handler names', async () => {
  const definition = loadHistoryPage({ http: { async get() { throw { code: 403 }; } } });
  const page = createPage(definition, {
    items: [{ alarmId: 'private' }], handlers: [{ id: '1', name: 'private-name' }],
    hasLoaded: true, nextCursor: 'private-cursor'
  });
  await page.loadHistory(true);
  assert.equal(page.data.items.length, 0);
  assert.equal(page.data.handlers.length, 0);
  assert.equal(page.data.nextCursor, '');
});

test('history template keeps successful empty states and suppresses background loading footers', () => {
  const template = fs.readFileSync(path.join(__dirname, '../pages/alarm-history/alarm-history.wxml'), 'utf8');
  assert.match(template, /loading && !hasLoaded && items.length === 0/);
  assert.match(template, /\(!loading \|\| hasLoaded\) && items.length === 0/);
  assert.match(template, /loading && !refreshing/);
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
