const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createAuthNavigation } = require('../utils/authNavigation');
const { createAuthTransport } = require('../utils/authTransport');

function harness(initialToken = '') {
  const values = new Map(initialToken ? [['loginToken', initialToken]] : []);
  const requests = [];
  const routes = [];
  let publishedToken = '';
  const app = { getLoginToken: () => publishedToken };
  const source = fs.readFileSync(path.join(__dirname, '../utils/http.js'), 'utf8')
    .replace("import { env } from './env'", "const env = { baseURL: 'https://example.test' }")
    .replace("import logger from './logger'", 'const logger = { info() {}, warn() {}, error() {} }')
    .replace('export default {', 'module.exports = {');
  const context = {
    module: { exports: {} },
    require(name) { assert.equal(name, './httpPolicy'); return require('../utils/httpPolicy'); },
    getApp: () => app,
    wx: { request: options => requests.push(options), toast() {} },
    setTimeout
  };
  vm.runInNewContext(source, context);
  const auth = createAuthNavigation({
    storage: {
      get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
      set: (key, value) => values.set(key, value),
      remove: key => values.delete(key)
    },
    transport: createAuthTransport(context.module.exports),
    navigation: { reLaunch: url => routes.push(url) },
    onStateChange: state => { publishedToken = state.loginToken; }
  });
  app.authNavigation = auth;
  return { auth, http: context.module.exports, requests, routes, getPublishedToken: () => publishedToken };
}

function respond(request, data) {
  request.success({ statusCode: 200, data: { code: 1, data } });
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('first login validates a newly stored credential before publishing it to App global state', async () => {
  const h = harness();
  const pending = h.auth.establish('new-login');
  assert.equal(h.getPublishedToken(), '');
  assert.match(h.requests[0].url, /\/user\/getMainMessage$/);
  respond(h.requests[0], { nickName: 'test', phone: '13900000000' });
  await flush();
  assert.equal(h.requests.length, 2);
  assert.match(h.requests[1].url, /\/user\/bind\/status$/);
  respond(h.requests[1], []);
  assert.equal((await pending).type, 'ready');
  assert.equal(h.getPublishedToken(), 'new-login');
});

test('cold start restores a saved credential even while App global token is empty', async () => {
  const h = harness('saved-login');
  const pending = h.auth.restore();
  respond(h.requests[0], { nickName: 'test', phone: '' });
  assert.equal((await pending).type, 'phone-required');
  assert.equal(h.getPublishedToken(), 'saved-login');
});

test('ordinary page requests remain protected after account changes, including reuse of the same JWT', async () => {
  for (const nextToken of ['different-login', 'same-login']) {
    const h = harness();
    const firstLogin = h.auth.establish('same-login');
    respond(h.requests[0], { phone: '' });
    await firstLogin;
    const oldRequest = h.http.get('/user/alarms', {}, { credentialScope: 'login' });
    const nextLogin = h.auth.establish(nextToken);
    respond(h.requests[2], { phone: '' });
    await nextLogin;
    respond(h.requests[1], { privateValue: 'old-user-data' });
    await assert.rejects(oldRequest, error => error.code === 'STALE_AUTH_REQUEST');
    assert.equal(h.getPublishedToken(), nextToken);
  }
});

test('a late successful response cannot resurrect an account after logout', async () => {
  const h = harness();
  const pending = h.auth.establish('old-login');
  h.auth.logout();
  respond(h.requests[0], { nickName: 'old', phone: '13900000000' });
  assert.equal((await pending).type, 'superseded');
  assert.equal(h.getPublishedToken(), '');
  assert.equal(h.requests.length, 1);
});
