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

function normalizeAlarmItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => ({
    ...item,
    alarmId: String(item.alarmId || ''),
    displayTime: formatDateTime(item.alarmTime) || '时间未知',
    displayHandledAt: formatDateTime(item.handledAt)
  }));
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

  return merged;
}

module.exports = { formatDateTime, normalizeAlarmItems, mergeAlarmItems };
