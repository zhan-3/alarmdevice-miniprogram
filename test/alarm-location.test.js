const test = require('node:test');
const assert = require('node:assert/strict');
const { getAlarmMapLocation } = require('../utils/alarmLocation');
const { normalizeAlarmItems } = require('../utils/alarmInbox');
const { normalizeHistoryItem, mergeHistoryItems } = require('../utils/alarmHistory');

function hardwareAlarm(overrides = {}) {
  return {
    alarmId: '9007199254740993', deviceSn: 'SN001', gpsLng: 116.404, gpsLat: 39.915,
    coordinateSystem: 'wgs84',
    displayLocation: { longitude: 116.4102445, latitude: 39.9164043, coordinateSystem: 'gcj02' },
    ...overrides
  };
}

test('consumes backend GCJ-02 without changing raw WGS-84 or converting it again', () => {
  const source = hardwareAlarm();
  const expected = { longitude: 116.4102445, latitude: 39.9164043, coordinateSystem: 'gcj02' };
  const inbox = normalizeAlarmItems([source])[0];
  const history = normalizeHistoryItem(source);
  for (const item of [inbox, history]) {
    assert.deepEqual(item.mapLocation, expected);
    assert.equal(item.hasLocation, true);
    assert.equal(item.gpsLng, source.gpsLng);
    assert.equal(item.gpsLat, source.gpsLat);
    assert.equal(item.coordinateSystem, 'wgs84');
    assert.equal(item.alarmId, '9007199254740993');
  }
  assert.equal(source.gpsLng, 116.404);
  assert.deepEqual(normalizeAlarmItems([inbox])[0].mapLocation, expected);
  assert.deepEqual(normalizeHistoryItem(history).mapLocation, expected);
  assert.deepEqual(mergeHistoryItems([history], [history])[0].mapLocation, expected);
});

test('does not fall back to raw hardware coordinates when display coordinates are missing or not GCJ-02', () => {
  for (const displayLocation of [null, undefined, {}, { longitude: 116.404, latitude: 39.915, coordinateSystem: 'wgs84' },
    { longitude: 116.404, latitude: 39.915 }]) {
    const source = hardwareAlarm({ displayLocation });
    assert.equal(getAlarmMapLocation(source), null);
    assert.equal(normalizeAlarmItems([source])[0].hasLocation, false);
    assert.equal(normalizeHistoryItem(source).hasLocation, false);
  }
});

test('rejects invalid display values instead of coercing null, empty strings or booleans into zero', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, '', ' ', '116.4', false, true, {}, [], 181, -181]) {
    assert.equal(getAlarmMapLocation(hardwareAlarm({ displayLocation: { longitude: value, latitude: 39.9, coordinateSystem: 'gcj02' } })), null);
  }
  for (const value of [null, undefined, NaN, Infinity, '', false, 91, -91]) {
    assert.equal(getAlarmMapLocation(hardwareAlarm({ displayLocation: { longitude: 116.4, latitude: value, coordinateSystem: 'gcj02' } })), null);
  }
  assert.equal(getAlarmMapLocation(null), null);
});

test('keeps an explicitly supplied numeric zero rather than treating it as a missing coordinate', () => {
  const source = hardwareAlarm({ displayLocation: { longitude: 0, latitude: 0, coordinateSystem: 'gcj02' } });
  assert.deepEqual(getAlarmMapLocation(source), source.displayLocation);
  assert.equal(normalizeAlarmItems([source])[0].hasLocation, true);
});
