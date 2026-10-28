// 设备数据加载公共服务，供 device-detail 和 setting 页共用
import http from './http';
import { DEVICE_STATUS_MAP } from './constants';
import logger from './logger';

const { loadDeviceDetailsConcurrently } = require('./deviceDetailsLoader');

async function loadDeviceStatus(deviceId, authToken, { invalidateOn401 = true } = {}) {
  try {
    const bindRes = await http.get('/user/bind/status', { deviceId }, {
      credentialScope: 'login',
      credential: authToken,
      deviceId,
      invalidateOn401
    });
    return bindRes.code === 1 && bindRes.data ? bindRes.data : null;
  } catch (err) {
    logger.error('获取设备绑定状态失败', { deviceId, error: err });
    throw err;
  }
}

async function requestDeviceLocation(endpoint, deviceId, authToken, { invalidateOn401 = true } = {}) {
  try {
    const locRes = await http.get(endpoint, { deviceId }, {
      credentialScope: 'login',
      credential: authToken,
      deviceId,
      invalidateOn401
    });
    return locRes.code === 1 && locRes.data ? locRes.data : null;
  } catch (err) {
    logger.error('获取设备位置失败', { deviceId, endpoint, error: err });
    throw err;
  }
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

export async function loadDeviceData(deviceId, authToken, options = {}) {
  const device = createDevice(deviceId);
  applyStoredName(device);

  const [statusDetails, installationLocation] = await Promise.all([
    loadDeviceStatus(deviceId, authToken, options),
    loadDeviceInstallationLocation(deviceId, authToken, options)
  ]);
  device.locationSource = installationLocation ? 'installation' : 'unknown';

  if (statusDetails) {
    device.status = statusDetails.status || 'unknown';
    device.statusText = DEVICE_STATUS_MAP[device.status] || '未知状态';
    const remoteName = typeof statusDetails.name === 'string' ? statusDetails.name.trim() : '';
    if (remoteName) {
      device.name = remoteName;
      try {
        if (!options.isCurrent || options.isCurrent()) getApp().renameDevice(deviceId, remoteName);
      } catch (err) {
        logger.debug('服务端设备名称未同步到本地缓存', { deviceId, error: err });
      }
    }
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

export async function loadDeviceContacts(authToken, deviceId, { invalidateOn401 = true } = {}) {
  try {
    const phoneRes = await http.get('/user/userGetPhone', { deviceId }, {
      credentialScope: 'login',
      credential: authToken,
      deviceId,
      invalidateOn401
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
  } catch (err) {
    logger.error('获取设备联系人失败', { deviceId, error: err });
    throw err;
  }
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
