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

test('contains transport failure semantics in the workflow', async () => {
  const { workflow } = createWorkflow({
    transport: {
      send: async () => {
        throw { msg: '发送太频繁' };
      },
      confirm: async () => {
        throw { userNotified: true };
      }
    }
  });
  workflow.changePhone('13800000003');

  assert.deepEqual(await workflow.send(), { status: 'failed' });
  assert.equal(workflow.snapshot().message, '发送太频繁');
  workflow.changeCode('123456');
  assert.deepEqual(await workflow.confirm(), { status: 'failed' });
  assert.equal(workflow.snapshot().message, '');
});
