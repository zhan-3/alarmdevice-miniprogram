const { createBoundDeviceSet } = require('./boundDeviceSet');

const LOGIN_URL = '/pages/login/login';
const HOME_URL = '/pages/alarms/alarms';
const POST_LOGIN_PATHS = new Set([
  HOME_URL,
  '/pages/alarm-history/alarm-history',
  '/pages/alarm-history-detail/alarm-history-detail',
  '/pages/home/home',
  '/pages/devicebinding/devicebinding'
]);

function decodeRedirect(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return '';
  }
}

function resolvePostLoginUrl(redirect, pendingDevice) {
  const target = decodeRedirect(redirect);
  const path = target.split('?')[0];
  const isSafeTarget = /^\/pages\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+(?:\?[^#]*)?$/.test(target) &&
    !target.includes('..') &&
    !target.includes('://');
  if (isSafeTarget && POST_LOGIN_PATHS.has(path)) return target;
  if (pendingDevice) {
    return `/pages/devicebinding/devicebinding?sn=${encodeURIComponent(pendingDevice)}`;
  }
  return HOME_URL;
}

function createAuthNavigation({
  storage,
  transport,
  navigation,
  boundDeviceSet = createBoundDeviceSet(storage),
  onStateChange = () => {}
}) {
  let restoration = null;
  let sessionVersion = 0;

  function isCurrentSession(loginToken, version) {
    return version === sessionVersion && loginToken === storage.get('loginToken', '');
  }

  function requireCurrentSession(loginToken, version) {
    if (!isCurrentSession(loginToken, version)) throw { code: 'STALE_AUTH_RESTORATION' };
  }

  function migrateLegacyCredential() {
    const current = storage.get('loginToken', '');
    const legacy = storage.get('token', '');
    const credential = current || legacy;
    if (!current && legacy) storage.set('loginToken', legacy);
    storage.remove('token');
    storage.remove('isLogin');
    return credential;
  }

  function syncState(loginToken, profile = null) {
    onStateChange({
      loginToken,
      isLoggedIn: Boolean(loginToken && profile),
      profile,
      devices: boundDeviceSet.list(),
      selectedDeviceSn: boundDeviceSet.selectedDeviceSn()
    });
  }

  async function restoreDevices(loginToken, version) {
    const previouslySelectedSn = boundDeviceSet.selectedDeviceSn();
    let remoteDeviceIds;
    try {
      remoteDeviceIds = await transport.listBoundDevices(loginToken);
    } catch (error) {
      requireCurrentSession(loginToken, version);
      if (error && error.code === 401) throw error;
      return true;
    }
    requireCurrentSession(loginToken, version);

    const ids = Array.isArray(remoteDeviceIds) ? remoteDeviceIds.map(String) : [];
    const remoteIds = new Set(ids);
    boundDeviceSet.list().forEach(device => {
      if (!remoteIds.has(device.sn)) boundDeviceSet.remove(device.sn);
    });

    let restorationIncomplete = false;
    for (const sn of ids) {
      const existing = boundDeviceSet.get(sn);
      try {
        const remoteDevice = await transport.validateDevice(loginToken, sn);
        requireCurrentSession(loginToken, version);
        const remoteName = remoteDevice && typeof remoteDevice.name === 'string'
          ? remoteDevice.name.trim() : '';
        boundDeviceSet.bind({ sn, name: remoteName || (existing ? existing.name : sn) });
      } catch (error) {
        requireCurrentSession(loginToken, version);
        if (error && error.code === 401) throw error;
        if (error && error.code === 403) {
          boundDeviceSet.remove(sn);
          continue;
        }
        restorationIncomplete = true;
        // The device list was confirmed by the server; keep metadata on a transient failure.
        if (!existing) boundDeviceSet.bind({ sn });
      }
    }
    if (previouslySelectedSn && boundDeviceSet.get(previouslySelectedSn)) {
      boundDeviceSet.select(previouslySelectedSn);
    }
    return restorationIncomplete;
  }

  async function performRestoration(version) {
    const loginToken = migrateLegacyCredential();
    if (!loginToken) {
      syncState('', null);
      return { outcome: { type: 'login-required' }, version };
    }

    try {
      const remoteProfile = await transport.validateLogin(loginToken);
      requireCurrentSession(loginToken, version);
      const cachedProfile = storage.get('userInfo', {}) || {};
      const profile = {
        ...cachedProfile,
        ...(remoteProfile || {}),
        nickName: (remoteProfile && remoteProfile.nickName) || cachedProfile.nickName || '',
        avatarUrl: (remoteProfile && remoteProfile.avatarUrl) || cachedProfile.avatarUrl || '',
        phone: (remoteProfile && remoteProfile.phone) || ''
      };
      storage.set('userInfo', profile);
      if (profile.phone) storage.set('phone', profile.phone);
      else storage.remove('phone');
      if (!profile.phone) {
        syncState(loginToken, profile);
        return { outcome: { type: 'phone-required', profile }, version };
      }

      const restorationIncomplete = await restoreDevices(loginToken, version);
      requireCurrentSession(loginToken, version);
      syncState(loginToken, profile);
      return { outcome: { type: 'ready', profile, restorationIncomplete }, version };
    } catch (error) {
      if (!isCurrentSession(loginToken, version)) return { outcome: { type: 'superseded' }, version };
      if (error && error.code === 401) {
        clearLoginState();
        return { outcome: { type: 'login-required' }, version: sessionVersion };
      }
      return { outcome: { type: 'retryable-error' }, version };
    }
  }

  function routeOutcome(base, intent = {}) {
    const target = resolvePostLoginUrl(intent.target || '', intent.pendingDevice || '');
    const outcome = { ...base, target };
    if (base.type === 'ready') navigation.reLaunch(target);
    if (base.type === 'login-required' || base.type === 'phone-required') {
      navigation.reLaunch(`${LOGIN_URL}?redirect=${encodeURIComponent(target)}`);
    }
    return outcome;
  }

  function observeRestoration(currentRestoration, intent) {
    return currentRestoration.then(({ outcome, version }) => {
      // Check again before routing: even an already resolved promise can outlive logout.
      if (version !== sessionVersion) return routeOutcome({ type: 'superseded' }, intent);
      if (outcome.type === 'retryable-error' && restoration === currentRestoration) restoration = null;
      return routeOutcome(outcome, intent);
    });
  }

  function restore(intent = {}) {
    if (!restoration) restoration = performRestoration(sessionVersion);
    return observeRestoration(restoration, intent);
  }

  function establish(credential, intent = {}) {
    if (!credential) throw new Error('登录凭证不能为空');
    sessionVersion += 1;
    storage.set('loginToken', credential);
    restoration = performRestoration(sessionVersion);
    return observeRestoration(restoration, intent);
  }

  function clearLoginState() {
    sessionVersion += 1;
    storage.remove('loginToken');
    storage.remove('token');
    storage.remove('isLogin');
    storage.remove('userInfo');
    storage.remove('phone');
    storage.remove('deviceTokens');
    storage.remove('currentSn');
    boundDeviceSet.clear();
    restoration = Promise.resolve({ outcome: { type: 'login-required' }, version: sessionVersion });
    syncState('', null);
  }

  function invalidate(scope) {
    const type = typeof scope === 'string' ? scope : scope && scope.type;
    if (type === 'device') {
      if (scope.sn) boundDeviceSet.remove(scope.sn);
      syncState(migrateLegacyCredential(), storage.get('userInfo', null));
      return;
    }
    clearLoginState();
    navigation.reLaunch(LOGIN_URL);
  }

  function logout() {
    invalidate('login');
    return { type: 'login-required', target: LOGIN_URL };
  }

  return Object.freeze({ restore, establish, invalidate, logout, getSessionVersion: () => sessionVersion, isCurrentSession });
}

module.exports = { createAuthNavigation };
