const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthNavigation } = require('../utils/authNavigation');

function memoryStorage(initial = {}) {
  const values = { ...initial };
  return {
    get(key, fallback = '') {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
    },
    set(key, value) { values[key] = value; },
    remove(key) { delete values[key]; },
    snapshot() { return structuredClone(values); }
  };
}

function memoryNavigation(currentUrl = '/pages/login/login') {
  const calls = [];
  return {
    reLaunch(url) {
      if (url.split('?')[0] !== currentUrl.split('?')[0]) calls.push(['reLaunch', url]);
      currentUrl = url;
    },
    calls() { return calls.slice(); }
  };
}

function transport(overrides = {}) {
  const calls = [];
  const implementation = {
    async validateLogin(credential) {
      calls.push(['validateLogin', credential]);
      return { nickName: '用户', avatarUrl: 'avatar', phone: '13800000000' };
    },
    async listBoundDevices(credential) {
      calls.push(['listBoundDevices', credential]);
      return [];
    },
    async validateDevice(credential, sn) {
      calls.push(['validateDevice', credential, sn]);
      return {};
    },
    ...overrides
  };
  implementation.calls = calls;
  return implementation;
}

function createHarness({ stored = {}, transport: suppliedTransport, currentUrl } = {}) {
  const storage = memoryStorage(stored);
  const navigation = memoryNavigation(currentUrl);
  const authTransport = suppliedTransport || transport();
  const stateChanges = [];
  const auth = createAuthNavigation({
    storage,
    transport: authTransport,
    navigation,
    onStateChange: state => stateChanges.push(state)
  });
  return { auth, storage, navigation, transport: authTransport, stateChanges };
}

test('legacy token migration removes legacy token and isLogin before validation', async () => {
  const harness = createHarness({ stored: { token: 'legacy-login', isLogin: true } });

  const outcome = await harness.auth.restore({ target: '/pages/alarms/alarms' });

  assert.equal(outcome.type, 'ready');
  assert.equal(harness.storage.snapshot().loginToken, 'legacy-login');
  assert.equal('token' in harness.storage.snapshot(), false);
  assert.equal('isLogin' in harness.storage.snapshot(), false);
  assert.deepEqual(harness.transport.calls[0], ['validateLogin', 'legacy-login']);
});

test('valid cached login restores profile, phone eligibility, valid devices, and safe target', async () => {
  const authTransport = transport({
    async listBoundDevices(credential) {
      this.calls.push(['listBoundDevices', credential]);
      return ['A', 'B'];
    },
    async validateDevice(credential, sn) {
      this.calls.push(['validateDevice', credential, sn]);
      return { name: sn === 'A' ? '服务端桥 A' : '服务端桥 B' };
    }
  });
  const harness = createHarness({
    stored: {
      loginToken: 'login-user',
      userInfo: { nickName: '旧名称' },
      boundDevices: [{ sn: 'A', name: '桥 A', deviceAccessToken: 'old-A' }],
      selectedDeviceSn: 'A'
    },
    transport: authTransport
  });

  const outcome = await harness.auth.restore({
    target: encodeURIComponent('/pages/home/home?from=login'),
    pendingDevice: 'IGNORED'
  });

  assert.deepEqual(outcome, {
    type: 'ready',
    profile: { nickName: '用户', avatarUrl: 'avatar', phone: '13800000000' },
    target: '/pages/home/home?from=login',
    restorationIncomplete: false
  });
  assert.deepEqual(harness.storage.snapshot().boundDevices, [
    { sn: 'A', name: '服务端桥 A' },
    { sn: 'B', name: '服务端桥 B' }
  ]);
  assert.equal(harness.storage.snapshot().selectedDeviceSn, 'A');
  assert.deepEqual(harness.navigation.calls(), [['reLaunch', '/pages/home/home?from=login']]);
});

test('missing phone returns phone-required before target selection and preserves the intended target', async () => {
  const authTransport = transport({
    async validateLogin(credential) {
      this.calls.push(['validateLogin', credential]);
      return { nickName: '用户', phone: '' };
    }
  });
  const harness = createHarness({ stored: { loginToken: 'login-user' }, transport: authTransport });

  const outcome = await harness.auth.restore({
    target: encodeURIComponent('/pages/home/home?source=scan'),
    pendingDevice: 'A001'
  });

  assert.equal(outcome.type, 'phone-required');
  assert.equal(outcome.target, '/pages/home/home?source=scan');
  assert.deepEqual(harness.navigation.calls(), []);
  assert.equal(authTransport.calls.some(call => call[0] === 'listBoundDevices'), false);
});

test('login validation network failure is retryable and preserves all local auth data', async () => {
  const authTransport = transport({
    async validateLogin() { throw { code: -1, msg: 'network' }; }
  });
  const stored = {
    loginToken: 'login-user',
    userInfo: { phone: '13800000000' },
    phone: '13800000000',
    boundDevices: [{ sn: 'A', name: '桥 A', deviceAccessToken: 'old-A' }],
    selectedDeviceSn: 'A'
  };
  const harness = createHarness({ stored, transport: authTransport });

  const outcome = await harness.auth.restore({ target: '/pages/home/home' });

  assert.equal(outcome.type, 'retryable-error');
  assert.deepEqual(harness.storage.snapshot(), { ...stored, boundDevices: [{ sn: 'A', name: '桥 A' }] });
  assert.deepEqual(harness.navigation.calls(), []);
});

test('login credential 401 clears login state, profile, and the complete bound-device set', async () => {
  const authTransport = transport({
    async validateLogin() { throw { code: 401 }; }
  });
  const harness = createHarness({
    stored: {
      loginToken: 'expired',
      userInfo: { phone: '13800000000' },
      phone: '13800000000',
      boundDevices: [{ sn: 'A', name: '桥 A', deviceAccessToken: 'old-A' }],
      selectedDeviceSn: 'A',
      deviceTokens: [{ sn: 'LEGACY', token: 'legacy-device' }],
      currentSn: 'LEGACY'
    },
    transport: authTransport,
    currentUrl: '/pages/home/home'
  });

  const outcome = await harness.auth.restore({ target: '/pages/home/home' });

  assert.equal(outcome.type, 'login-required');
  assert.deepEqual(harness.storage.snapshot().boundDevices, []);
  assert.equal(harness.storage.snapshot().selectedDeviceSn, '');
  assert.equal('loginToken' in harness.storage.snapshot(), false);
  assert.equal('userInfo' in harness.storage.snapshot(), false);
  assert.equal('deviceTokens' in harness.storage.snapshot(), false);
  assert.equal('currentSn' in harness.storage.snapshot(), false);
  assert.deepEqual(harness.navigation.calls(), [[
    'reLaunch',
    `/pages/login/login?redirect=${encodeURIComponent('/pages/home/home')}`
  ]]);
});

test('device authorization 403 removes only that device and preserves login plus other devices', async () => {
  const authTransport = transport({
    async listBoundDevices(credential) {
      this.calls.push(['listBoundDevices', credential]);
      return ['A', 'B'];
    },
    async validateDevice(credential, sn) {
      this.calls.push(['validateDevice', credential, sn]);
      if (sn === 'A') throw { code: 403 };
      return {};
    }
  });
  const harness = createHarness({
    stored: {
      loginToken: 'login-user',
      boundDevices: [
        { sn: 'A', name: '桥 A', deviceAccessToken: 'old-A' },
        { sn: 'B', name: '桥 B', deviceAccessToken: 'old-B' }
      ],
      selectedDeviceSn: 'A'
    },
    transport: authTransport
  });

  const outcome = await harness.auth.restore({ target: '/pages/alarms/alarms' });

  assert.equal(outcome.type, 'ready');
  assert.equal(harness.storage.snapshot().loginToken, 'login-user');
  assert.deepEqual(harness.storage.snapshot().boundDevices, [
    { sn: 'B', name: '桥 B' }
  ]);
  assert.equal(authTransport.calls.some(call => call[0] === 'refreshDevice'), false);
});

test('device network failure preserves that device and reports incomplete restoration', async () => {
  const authTransport = transport({
    async listBoundDevices(credential) {
      this.calls.push(['listBoundDevices', credential]);
      return ['A'];
    },
    async validateDevice(credential, sn) {
      this.calls.push(['validateDevice', credential, sn]);
      throw { code: -1, msg: 'timeout' };
    }
  });
  const harness = createHarness({
    stored: {
      loginToken: 'login-user',
      boundDevices: [{ sn: 'A', name: '桥 A', deviceAccessToken: 'old-A' }],
      selectedDeviceSn: 'A'
    },
    transport: authTransport
  });

  const outcome = await harness.auth.restore({ target: '/pages/alarms/alarms' });

  assert.equal(outcome.type, 'ready');
  assert.equal(outcome.restorationIncomplete, true);
  assert.deepEqual(harness.storage.snapshot().boundDevices, [{ sn: 'A', name: '桥 A' }]);
});

test('concurrent restore calls share one login validation and bound-device restoration operation', async () => {
  let finishValidation;
  const validation = new Promise(resolve => { finishValidation = resolve; });
  const authTransport = transport({
    async validateLogin(credential) {
      this.calls.push(['validateLogin', credential]);
      return validation;
    }
  });
  const harness = createHarness({ stored: { loginToken: 'login-user' }, transport: authTransport });

  const first = harness.auth.restore({ target: '/pages/alarms/alarms' });
  const second = harness.auth.restore({ target: '/pages/home/home' });
  assert.equal(authTransport.calls.filter(call => call[0] === 'validateLogin').length, 1);

  finishValidation({ nickName: '用户', phone: '13800000000' });
  const outcomes = await Promise.all([first, second]);

  assert.deepEqual(outcomes.map(outcome => outcome.type), ['ready', 'ready']);
  assert.equal(authTransport.calls.filter(call => call[0] === 'listBoundDevices').length, 1);
});

test('establish uses the same restoration path and reLaunch navigation policy', async () => {
  const harness = createHarness({ currentUrl: '/pages/login/login' });

  const outcome = await harness.auth.establish('new-login', {
    target: encodeURIComponent('/pages/devicebinding/devicebinding?sn=A001')
  });

  assert.equal(outcome.type, 'ready');
  assert.equal(harness.storage.snapshot().loginToken, 'new-login');
  assert.deepEqual(harness.transport.calls.slice(0, 2), [
    ['validateLogin', 'new-login'],
    ['listBoundDevices', 'new-login']
  ]);
  assert.deepEqual(harness.navigation.calls(), [[
    'reLaunch', '/pages/devicebinding/devicebinding?sn=A001'
  ]]);
});

test('logout clears auth data and reaches login', async () => {
  const harness = createHarness({
    stored: {
      loginToken: 'login-user',
      userInfo: { phone: '13800000000' },
      phone: '13800000000',
      boundDevices: [{ sn: 'A', name: 'A', deviceAccessToken: 'access-A' }],
      selectedDeviceSn: 'A'
    },
    currentUrl: '/pages/home/home'
  });

  const outcome = harness.auth.logout();

  assert.deepEqual(outcome, { type: 'login-required', target: '/pages/login/login' });
  assert.equal('loginToken' in harness.storage.snapshot(), false);
  assert.deepEqual(harness.storage.snapshot().boundDevices, []);
  assert.deepEqual(harness.navigation.calls(), [['reLaunch', '/pages/login/login']]);
});

test('safe explicit target beats pending binding, unsafe target falls back to pending then alarm inbox', async () => {
  const explicit = createHarness({ stored: { loginToken: 'login-user' } });
  const pending = createHarness({ stored: { loginToken: 'login-user' } });
  const fallback = createHarness({ stored: { loginToken: 'login-user' } });

  const explicitOutcome = await explicit.auth.restore({
    target: encodeURIComponent('/pages/home/home'),
    pendingDevice: 'A 001'
  });
  const pendingOutcome = await pending.auth.restore({
    target: 'https://evil.example',
    pendingDevice: 'A 001'
  });
  const fallbackOutcome = await fallback.auth.restore({ target: '/pages/../admin' });

  assert.equal(explicitOutcome.target, '/pages/home/home');
  assert.equal(pendingOutcome.target, '/pages/devicebinding/devicebinding?sn=A%20001');
  assert.equal(fallbackOutcome.target, '/pages/alarms/alarms');

  for (const target of [
    '/pages/alarm-history/alarm-history',
    '/pages/alarm-history-detail/alarm-history-detail?alarmId=2790303266003'
  ]) {
    const history = createHarness({ stored: { loginToken: 'login-user' } });
    const outcome = await history.auth.restore({ target });
    assert.equal(outcome.target, target);
  }
});

test('explicit login invalidation clears state and applies the login navigation policy', () => {
  const harness = createHarness({
    stored: { loginToken: 'login-user', userInfo: { phone: '13800000000' } },
    currentUrl: '/pages/alarms/alarms'
  });

  harness.auth.invalidate('login');

  assert.equal('loginToken' in harness.storage.snapshot(), false);
  assert.deepEqual(harness.navigation.calls(), [['reLaunch', '/pages/login/login']]);
});

test('401 during device restoration invalidates the single user credential and all devices', async () => {
  const harness = createHarness({
    stored: { loginToken: 'expired-user', boundDevices: [{ sn: 'A', name: '桥 A' }] },
    transport: transport({
      async listBoundDevices() { return ['A']; },
      async validateDevice() { throw { code: 401 }; }
    })
  });
  assert.equal((await harness.auth.restore()).type, 'login-required');
  assert.equal('loginToken' in harness.storage.snapshot(), false);
  assert.deepEqual(harness.storage.snapshot().boundDevices, []);
});

test('device invalidation changes selection but preserves the single user credential', () => {
  const harness = createHarness({ stored: {
    loginToken: 'login-user', boundDevices: [{ sn: 'A' }, { sn: 'B' }], selectedDeviceSn: 'A'
  } });
  harness.auth.invalidate({ type: 'device', sn: 'A' });
  assert.equal(harness.storage.snapshot().loginToken, 'login-user');
  assert.equal(harness.storage.snapshot().selectedDeviceSn, 'B');
  assert.deepEqual(harness.storage.snapshot().boundDevices, [{ sn: 'B', name: 'B' }]);
});

test('restore without a credential returns login-required and preserves a safe intended target', async () => {
  const harness = createHarness({ currentUrl: '/pages/home/home' });

  const outcome = await harness.auth.restore({ target: '/pages/home/home' });

  assert.deepEqual(outcome, { type: 'login-required', target: '/pages/home/home' });
  assert.deepEqual(harness.navigation.calls(), [[
    'reLaunch', `/pages/login/login?redirect=${encodeURIComponent('/pages/home/home')}`
  ]]);
  assert.equal(harness.transport.calls.length, 0);
});
