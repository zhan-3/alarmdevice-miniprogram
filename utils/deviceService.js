// 设备数据加载公共服务，供 device-detail 和 setting 页共用
import http from './http';
import { DEVICE_STATUS_MAP } from './constants';
import logger from './logger';

const { loadDeviceDetailsConcurrently } = require('./deviceDetailsLoader');
const { deviceRepository } = require('./deviceRepository');

async function fetchResource(deviceId, authToken, resource, load, options = {}) {
  try {
    return await deviceRepository.fetch(authToken, deviceId, resource, load);
  } catch (error) {
    // Shared reads must never let an old session's failure invalidate a new login.
    const app = getApp();
    if (options.invalidateOn401 !== false && authToken === app.getLoginToken() &&
        (!options.isCurrent || options.isCurrent()) && error && (error.code === 401 || error.code === 403)) {
      app.authNavigation.invalidate(error.code === 401 ? 'login' : { type: 'device', sn: deviceId });
    }
    throw error;
  }
}

async function loadDeviceStatus(deviceId, authToken, options = {}) {
  return fetchResource(deviceId, authToken, 'status', async () => {
    const res = await http.get('/user/bind/status', { deviceId }, {
      credentialScope: 'login', credential: authToken, deviceId, invalidateOn401: false
    });
    if (res.code !== 1 || !res.data) throw { msg: '设备状态返回异常' };
    return res.data;
  }, options);
}

async function requestDeviceLocation(endpoint, deviceId, authToken, options = {}) {
  return fetchResource(deviceId, authToken, 'location', async () => {
    const res = await http.get(endpoint, { deviceId }, {
      credentialScope: 'login', credential: authToken, deviceId, invalidateOn401: false
    });
    return res.code === 1 && res.data ? res.data : null;
  }, options);
}

export function loadDeviceInstallationLocation(deviceId, authToken, options) {
  return requestDeviceLocation('/user/getInstallLocation', deviceId, authToken, options);
}

function createDevice(deviceId) {
  return {
    id: deviceId,
    sn: deviceId,
    name: deviceId,
    status: 'unknown',
    statusText: '数据不可用',
    latitude: null,
    longitude: null,
    address: '',
    contacts: []
  };
}

function applyStoredName(device) {
  try {
    const app = getApp();
    const stored = app && app.getDevice ? app.getDevice(device.sn) : null;
    if (stored && stored.name && stored.name !== device.sn) {
      device.name = stored.name;
    }
  } catch (err) {
    // 页面预览或测试环境可能没有 app 实例，使用 SN 作为默认名称。
    logger.debug('设备名称使用默认值', { deviceId: device.sn })
  }
}

function composeDevice(deviceId, statusDetails, installationLocation) {
  const device = createDevice(deviceId);
  applyStoredName(device);
  device.locationSource = installationLocation ? 'installation' : 'unknown';

  if (statusDetails) {
    device.status = statusDetails.status || 'unknown';
    device.statusText = DEVICE_STATUS_MAP[device.status] || '未知状态';
    const remoteName = typeof statusDetails.name === 'string' ? statusDetails.name.trim() : '';
    if (remoteName) device.name = remoteName;
  }
  if (installationLocation) {
    const latitude = Number(installationLocation.gpsLat);
    const longitude = Number(installationLocation.gpsLng);
    device.latitude = Number.isFinite(latitude) ? latitude : null;
    device.longitude = Number.isFinite(longitude) ? longitude : null;
    device.address = installationLocation.address || '';
  }

  return device;
}

export function getCachedDeviceSummary(deviceId, authToken) {
  const status = deviceRepository.peek(authToken, deviceId, 'status');
  return status ? { ...composeDevice(deviceId, status.value, null), statusCached: true } : null;
}

export function getCachedDeviceDetails(deviceId, authToken) {
  const status = deviceRepository.peek(authToken, deviceId, 'status');
  const location = deviceRepository.peek(authToken, deviceId, 'location');
  const contacts = deviceRepository.peek(authToken, deviceId, 'contacts');
  if (!status || !location || !contacts) return null;
  const device = { ...composeDevice(deviceId, status.value, location.value), contacts: contacts.value };
  return { device, markers: buildMarkers(device) };
}

function syncRemoteName(device, authToken, options) {
  if (authToken === getApp().getLoginToken() && (!options.isCurrent || options.isCurrent())) {
    getApp().renameDevice(device.sn, device.name);
  }
}

export async function loadDeviceSummary(deviceId, authToken, options = {}) {
  const status = await loadDeviceStatus(deviceId, authToken, options);
  const device = composeDevice(deviceId, status, null);
  syncRemoteName(device, authToken, options);
  return { ...device, statusCached: false };
}

export async function loadDeviceData(deviceId, authToken, options = {}) {
  const [status, location] = await Promise.all([
    loadDeviceStatus(deviceId, authToken, options),
    loadDeviceInstallationLocation(deviceId, authToken, options)
  ]);
  const device = composeDevice(deviceId, status, location);
  syncRemoteName(device, authToken, options);
  return device;
}

export async function loadDeviceContacts(authToken, deviceId, options = {}) {
  return fetchResource(deviceId, authToken, 'contacts', async () => {
    const phoneRes = await http.get('/user/userGetPhone', { deviceId }, {
      credentialScope: 'login',
      credential: authToken,
      deviceId,
      invalidateOn401: false
    });
    if (phoneRes.code === 1 && Array.isArray(phoneRes.data)) {
      return phoneRes.data.map((item, index) => {
        const phone = item.phone || '';
        return {
          id: 'c' + index,
          name: item.name || '未命名联系人',
          phone
        };
      });
    }
    throw { msg: '联系人列表返回异常，请重试' };
  }, options);
}

export async function loadDeviceDetails(deviceId, authToken, options = {}) {
  return loadDeviceDetailsConcurrently({
    deviceId,
    authToken,
    loadDeviceData: (id, token) => loadDeviceData(id, token, options),
    loadDeviceContacts: (token, id) => loadDeviceContacts(token, id, options),
    buildMarkers
  });
}

export function buildMarkers(device) {
  const lat = Number(device.latitude);
  const lng = Number(device.longitude);
  if (!lat || !lng) return [];
  return [{
    id: 1,
    latitude: lat,
    longitude: lng,
    snippet: device.address || '未知地址',
    iconPath: '/images/marker.png',
    width: 32,
    height: 42,
    callout: {
      content: [
        device.name,
        device.status === 'alarm' ? '警报中' : '正常',
        device.address || '未知地址'
      ].filter(Boolean).join('\n'),
      display: 'BYCLICK',
      fontSize: 12,
      bgColor: device.status === 'alarm' ? '#dc143c' : '#52c41a',
      color: '#fff',
      padding: 8,
      borderRadius: 4
    },
    animation: true
  }];
}
