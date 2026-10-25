const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthTransport } = require('../utils/authTransport');

test('uses one login credential and explicit deviceId without requesting device tokens', async () => {
  const calls = [];
  const transport = createAuthTransport({
    async get(...args) {
      calls.push(args);
      if (args[0] === '/user/getMainMessage') return { data: { phone: '13800000000' } };
      return { data: args[1].deviceId ? { status: 'normal' } : ['A', 'B'] };
    },
    async post() { assert.fail('restoration must not request a replacement token'); }
  });
  assert.deepEqual(await transport.validateLogin('login-user'), { phone: '13800000000' });
  assert.deepEqual(await transport.listBoundDevices('login-user'), ['A', 'B']);
  assert.deepEqual(await transport.validateDevice('login-user', 'A'), { status: 'normal' });
  assert.deepEqual(await transport.validateDevice('login-user', 'B'), { status: 'normal' });
  assert.deepEqual(calls, [
    ['/user/getMainMessage', {}, { credentialScope: 'login', credential: 'login-user', invalidateOn401: false }],
    ['/user/bind/status', {}, { credentialScope: 'login', credential: 'login-user', invalidateOn401: false }],
    ['/user/bind/status', { deviceId: 'A' }, { credentialScope: 'login', credential: 'login-user', invalidateOn401: false, deviceId: 'A' }],
    ['/user/bind/status', { deviceId: 'B' }, { credentialScope: 'login', credential: 'login-user', invalidateOn401: false, deviceId: 'B' }]
  ]);
});
