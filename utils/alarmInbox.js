const { getAlarmMapLocation } = require('./alarmLocation');

function pad(value) {
  return String(value).padStart(2, '0');
}

function startOfDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function formatDateTime(value, now = new Date()) {
  if (!value) return '';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ');

  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const dayDifference = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (dayDifference === 0) return `今天 ${time}`;
  if (dayDifference === 1) return `昨天 ${time}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function alarmTimestamp(item) {
  if (!item || !item.alarmTime) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(String(item.alarmTime).replace(' ', 'T')).getTime();
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function compareAlarmTimeDesc(left, right) {
  const leftTime = alarmTimestamp(left);
  const rightTime = alarmTimestamp(right);
  if (leftTime === rightTime) return 0;
  return rightTime > leftTime ? 1 : -1;
}

function normalizeAlarmItems(items, devices = []) {
  if (!Array.isArray(items)) return [];
  const deviceNames = new Map(
    (Array.isArray(devices) ? devices : [])
      .filter(device => device && device.sn)
      .map(device => [String(device.sn), String(device.name || '')])
  );

  return items.map(item => {
    const alarmId = String(item.alarmId || '');
    const deviceSn = String(item.deviceSn || '');
    const storedName = deviceNames.get(deviceSn) || '';
    const mapLocation = getAlarmMapLocation(item);
    return {
      ...item,
      mapLocation,
      hasLocation: Boolean(mapLocation),
      alarmId,
      deviceSn,
      deviceName: storedName && storedName !== deviceSn ? storedName : '',
      canHandle: Boolean(alarmId),
      displayTime: formatDateTime(item.alarmTime) || '时间未知',
      displayHandledAt: formatDateTime(item.handledAt)
    };
  }).sort(compareAlarmTimeDesc);
}

function mergeAlarmItems(currentItems, incomingItems) {
  const merged = [];
  const seenIds = new Set();
  const items = [
    ...(Array.isArray(currentItems) ? currentItems : []),
    ...(Array.isArray(incomingItems) ? incomingItems : [])
  ];

  items.forEach(item => {
    const alarmId = String(item && item.alarmId || '');
    if (alarmId && seenIds.has(alarmId)) return;
    if (alarmId) seenIds.add(alarmId);
    merged.push(item);
  });

  return merged.sort(compareAlarmTimeDesc);
}

module.exports = { formatDateTime, normalizeAlarmItems, mergeAlarmItems };
