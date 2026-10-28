const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPhoneVerificationWorkflow,
  normalizeVerificationCode,
  isValidVerificationCode
} = require('../utils/phoneVerification');

function createClock() {
  let tick = null;
  return {
    setInterval(callback) {
      tick = callback;
      return 1;
    },
    clearInterval() {
      tick = null;
    },
    tick() {
      if (tick) tick();
    }
  };
}

function createWorkflow(overrides = {}) {
  const values = { userInfo: { nickName: 'Bridge watcher' } };
  const sentPhones = [];
  const confirmations = [];
  const states = [];
  const clock = createClock();
  const workflow = createPhoneVerificationWorkflow({
    transport: {
      async send(phone) {
        sentPhones.push(phone);
      },
      async confirm(phone, code) {
        confirmations.push({ phone, code });
      },
      ...overrides.transport
    },
    storage: {
      get(key) {
        return values[key];
      },
      set(key, value) {
        values[key] = value;
      }
    },
    clock,
    retrySeconds: overrides.retrySeconds || 2,
    onChange(state) {
      states.push(state);
    }
  });
  return { workflow, values, sentPhones, confirmations, states, clock };
}

test('normalizes and validates six-digit verification codes', () => {
  assert.equal(normalizeVerificationCode('12a34 567'), '123456');
  assert.equal(normalizeVerificationCode(null), '');
  assert.equal(isValidVerificationCode('012345'), true);
  assert.equal(isValidVerificationCode('12345'), false);
  assert.equal(isValidVerificationCode('12345a'), false);
});

test('validates the phone before sending', async () => {
  const { workflow, sentPhones } = createWorkflow();
  workflow.changePhone('123');

  assert.deepEqual(await workflow.send(), { status: 'invalid-phone' });
  assert.deepEqual(sentPhones, []);
  assert.equal(workflow.snapshot().phoneInvalid, true);
  assert.equal(workflow.snapshot().message, '请输入正确的11位手机号');
});

test('suppresses repeated sends until the countdown finishes', async () => {
  const { workflow, sentPhones, clock } = createWorkflow();
  workflow.changePhone('13800000003');

  assert.deepEqual(await workflow.send(), { status: 'sent' });
  assert.equal(workflow.snapshot().retryAfterSeconds, 2);
  assert.deepEqual(await workflow.send(), { status: 'suppressed' });
  workflow.reset();
  assert.equal(workflow.snapshot().retryAfterSeconds, 2);
  assert.deepEqual(await workflow.send(), { status: 'suppressed' });
  clock.tick();
  assert.equal(workflow.snapshot().retryAfterSeconds, 1);
  clock.tick();
  assert.equal(workflow.snapshot().retryAfterSeconds, 0);
  workflow.changePhone('13800000003');
  assert.deepEqual(await workflow.send(), { status: 'sent' });
  assert.deepEqual(sentPhones, ['13800000003', '13800000003']);
});

test('normalizes input, confirms once, and persists the verified phone', async () => {
  let resolveConfirmation;
  const confirmation = new Promise(resolve => {
    resolveConfirmation = resolve;
  });
  const { workflow, values, confirmations } = createWorkflow({
    transport: {
      confirm: async (phone, code) => {
        confirmations.push({ phone, code });
        await confirmation;
      }
    }
  });
  workflow.changePhone('13800000003');
  workflow.changeCode('12a34 56');

  const first = workflow.confirm();
  assert.equal(workflow.snapshot().confirming, true);
  assert.deepEqual(await workflow.confirm(), { status: 'suppressed' });
  resolveConfirmation();

  assert.deepEqual(await first, { status: 'verified', phone: '13800000003' });
  assert.deepEqual(confirmations, [{ phone: '13800000003', code: '123456' }]);
  assert.deepEqual(values.userInfo, { nickName: 'Bridge watcher', phone: '13800000003' });
  assert.equal(values.phone, '13800000003');
  assert.equal(workflow.snapshot().confirming, false);
});

test('keeps ownership rejections visible without a countdown or verified phone and allows correction', async () => {
  const message = '该手机号已绑定其他账号，不能重复绑定；如需更换微信，请联系管理员迁移。';
  const { workflow, values } = createWorkflow({
    transport: {
      send: async () => { throw { code: 0, msg: message, userNotified: true }; },
      confirm: async () => { throw { code: 0, msg: message, userNotified: true }; }
    }
  });
  values.loginToken = 'current-wechat-identity';
  workflow.changePhone('13800000003');

  assert.deepEqual(await workflow.send(), { status: 'failed' });
  assert.equal(workflow.snapshot().message, message);
  assert.equal(workflow.snapshot().retryAfterSeconds, 0);
  assert.equal(workflow.snapshot().sending, false);
  workflow.changeCode('123456');
  assert.deepEqual(await workflow.confirm(), { status: 'failed' });
  assert.equal(workflow.snapshot().message, message);
  assert.equal(workflow.snapshot().confirming, false);
  assert.equal(values.phone, undefined);
  assert.equal(values.userInfo.phone, undefined);
  assert.equal(values.loginToken, 'current-wechat-identity');

  workflow.changePhone('13900000004');
  assert.equal(workflow.snapshot().message, '');
  assert.equal(workflow.snapshot().code, '');
  assert.equal(workflow.snapshot().phone, '13900000004');
});

test('late phone requests cannot overwrite a changed form or persist after leaving', async () => {
  let rejectSend;
  let resolveConfirm;
  const { workflow, values } = createWorkflow({
    transport: {
      send: () => new Promise((_resolve, reject) => { rejectSend = reject; }),
      confirm: () => new Promise(resolve => { resolveConfirm = resolve; })
    }
  });
  workflow.changePhone('13800000003');
  const sending = workflow.send();
  workflow.changePhone('13900000004');
  rejectSend({ code: 0, msg: '旧号码已占用', userNotified: true });
  await sending;
  assert.equal(workflow.snapshot().message, '');
  assert.equal(workflow.snapshot().sending, false);

  workflow.changeCode('123456');
  const confirming = workflow.confirm();
  workflow.changePhone('13700000005');
  resolveConfirm();
  assert.notEqual((await confirming).status, 'verified');
  assert.equal(values.phone, undefined);
  assert.equal(workflow.snapshot().phone, '13700000005');

  workflow.changeCode('654321');
  const leaving = workflow.confirm();
  workflow.dispose();
  resolveConfirm();
  assert.notEqual((await leaving).status, 'verified');
  assert.equal(values.phone, undefined);
});
