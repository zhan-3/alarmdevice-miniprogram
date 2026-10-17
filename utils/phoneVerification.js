const PHONE_REGEX = /^1[3-9]\d{9}$/;
const VERIFICATION_CODE_REGEX = /^\d{6}$/;
const DEFAULT_RETRY_SECONDS = 60;

function normalizeVerificationCode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function isValidVerificationCode(value) {
  return VERIFICATION_CODE_REGEX.test(String(value || ''));
}

function initialState() {
  return {
    phone: '',
    code: '',
    phoneInvalid: false,
    sending: false,
    confirming: false,
    retryAfterSeconds: 0,
    message: ''
  };
}

function createPhoneVerificationWorkflow({
  transport,
  storage,
  clock = { setInterval, clearInterval },
  onChange = () => {},
  logger = { error() {} },
  retrySeconds = DEFAULT_RETRY_SECONDS
}) {
  if (!transport || typeof transport.send !== 'function' || typeof transport.confirm !== 'function') {
    throw new TypeError('phone verification transport must provide send and confirm');
  }
  if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
    throw new TypeError('phone verification storage must provide get and set');
  }

  let state = initialState();
  let countdownTimer = null;
  let disposed = false;

  function snapshot() {
    return Object.freeze({ ...state });
  }

  function publish(patch) {
    state = { ...state, ...patch };
    if (!disposed) onChange(snapshot());
  }

  function stopCountdown() {
    if (countdownTimer !== null) {
      clock.clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function startCountdown() {
    stopCountdown();
    publish({ retryAfterSeconds: retrySeconds });
    countdownTimer = clock.setInterval(() => {
      const next = Math.max(state.retryAfterSeconds - 1, 0);
      publish({ retryAfterSeconds: next });
      if (next === 0) stopCountdown();
    }, 1000);
  }

  function saveVerifiedPhone(phone) {
    const cachedUserInfo = storage.get('userInfo') || {};
    storage.set('userInfo', { ...cachedUserInfo, phone });
    storage.set('phone', phone);
  }

  function changePhone(value) {
    const phone = String(value || '');
    publish({
      phone,
      phoneInvalid: phone.length > 0 && !PHONE_REGEX.test(phone),
      message: ''
    });
  }

  function changeCode(value) {
    publish({ code: normalizeVerificationCode(value), message: '' });
  }

  async function send() {
    if (state.sending || state.confirming || state.retryAfterSeconds > 0) {
      return { status: 'suppressed' };
    }
    if (!PHONE_REGEX.test(state.phone)) {
      publish({ phoneInvalid: true, message: '请输入正确的11位手机号' });
      return { status: 'invalid-phone' };
    }

    publish({ sending: true, message: '' });
    try {
      await transport.send(state.phone);
      if (disposed) return { status: 'disposed' };
      startCountdown();
      return { status: 'sent' };
    } catch (error) {
      logger.error('发送手机验证码失败', { error });
      publish({ message: error && error.userNotified ? '' : ((error && error.msg) || '验证码发送失败，请重试') });
      return { status: 'failed' };
    } finally {
      publish({ sending: false });
    }
  }

  async function confirm() {
    if (state.confirming || state.sending) return { status: 'suppressed' };
    if (!PHONE_REGEX.test(state.phone)) {
      publish({ phoneInvalid: true, message: '请输入正确的11位手机号' });
      return { status: 'invalid-phone' };
    }
    if (!isValidVerificationCode(state.code)) {
      publish({ message: '请输入6位验证码' });
      return { status: 'invalid-code' };
    }

    const phone = state.phone;
    const code = state.code;
    publish({ confirming: true, message: '' });
    try {
      await transport.confirm(phone, code);
      saveVerifiedPhone(phone);
      return { status: 'verified', phone };
    } catch (error) {
      logger.error('验证手机号失败', { error });
      publish({ message: error && error.userNotified ? '' : ((error && error.msg) || '验证失败，请重试') });
      return { status: 'failed' };
    } finally {
      publish({ confirming: false });
    }
  }

  function reset() {
    publish({ ...initialState(), retryAfterSeconds: state.retryAfterSeconds });
  }

  function dispose() {
    stopCountdown();
    disposed = true;
  }

  onChange(snapshot());

  return Object.freeze({ changePhone, changeCode, send, confirm, reset, dispose, snapshot });
}

module.exports = {
  createPhoneVerificationWorkflow,
  normalizeVerificationCode,
  isValidVerificationCode
};
