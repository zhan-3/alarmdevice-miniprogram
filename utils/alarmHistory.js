const { formatDateTime } = require('./alarmInbox');

function stringId(value) {
  return value === null || typeof value === 'undefined' ? '' : String(value);
}

function normalizeHistoryItem(item) {
  const source = item && typeof item === 'object' ? item : {};
  const gpsLng = source.gpsLng === null || typeof source.gpsLng === 'undefined'
    ? null
    : Number(source.gpsLng);
  const gpsLat = source.gpsLat === null || typeof source.gpsLat === 'undefined'
    ? null
    : Number(source.gpsLat);

  return {
    ...source,
    alarmId: stringId(source.alarmId),
    deviceSn: stringId(source.deviceSn),
    deviceName: stringId(source.deviceName),
    handledBy: stringId(source.handledBy),
    handlerName: stringId(source.handlerName),
    status: 'handled',
    gpsLng: Number.isFinite(gpsLng) ? gpsLng : null,
    gpsLat: Number.isFinite(gpsLat) ? gpsLat : null,
    hasLocation: Number.isFinite(gpsLng) && Number.isFinite(gpsLat),
    displayAlarmTime: formatDateTime(source.alarmTime) || '时间未知',
    displayHandledAt: formatDateTime(source.handledAt) || '时间未知',
    displayHandlerName: stringId(source.handlerName) || '处理人未知'
  };
}

function normalizeHistoryItems(items) {
  return Array.isArray(items) ? items.map(normalizeHistoryItem) : [];
}

function mergeHistoryItems(currentItems, incomingItems) {
  const result = [];
  const indexes = new Map();
  [...(Array.isArray(currentItems) ? currentItems : []), ...(Array.isArray(incomingItems) ? incomingItems : [])]
    .forEach(item => {
      const normalized = normalizeHistoryItem(item);
      if (!normalized.alarmId) {
        result.push(normalized);
        return;
      }
      if (indexes.has(normalized.alarmId)) {
        result[indexes.get(normalized.alarmId)] = normalized;
        return;
      }
      indexes.set(normalized.alarmId, result.length);
      result.push(normalized);
    });
  return result;
}

function shiftIsoDate(dateValue, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || ''))) return '';
  const [year, month, day] = String(dateValue).split('-').map(Number);
  const sourceDate = new Date(Date.UTC(year, month - 1, day));
  if (
    sourceDate.getUTCFullYear() !== year ||
    sourceDate.getUTCMonth() !== month - 1 ||
    sourceDate.getUTCDate() !== day
  ) return '';
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function buildHistoryParams(filters = {}, cursor = '', limit = 20) {
  const params = { limit };
  const keyword = String(filters.keyword || '').trim();
  const handlerId = stringId(filters.handlerId);
  const startDate = String(filters.startDate || '');
  const endDate = String(filters.endDate || '');

  if (cursor) params.cursor = String(cursor);
  if (startDate) params.startTime = `${startDate}T00:00:00`;
  if (endDate) {
    const exclusiveEnd = shiftIsoDate(endDate, 1);
    if (exclusiveEnd) params.endTime = `${exclusiveEnd}T00:00:00`;
  }
  if (handlerId) params.handlerId = handlerId;
  if (keyword) params.keyword = keyword;
  return params;
}

function isValidDateRange(startDate, endDate) {
  if (!startDate || !endDate) return true;
  return String(startDate) <= String(endDate);
}

function normalizeHandlers(data) {
  const items = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : []);
  const seen = new Set();
  return items.reduce((result, item) => {
    const id = stringId(item && item.id);
    if (!id || seen.has(id)) return result;
    seen.add(id);
    result.push({ id, name: stringId(item && item.name) || '未命名用户' });
    return result;
  }, []);
}

module.exports = {
  normalizeHistoryItem,
  normalizeHistoryItems,
  mergeHistoryItems,
  buildHistoryParams,
  isValidDateRange,
  normalizeHandlers,
  shiftIsoDate
};
