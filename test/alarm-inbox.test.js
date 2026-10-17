const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDateTime, normalizeAlarmItems, mergeAlarmItems } = require('../utils/alarmInbox');

test('formats recent alarm times in a human-friendly way', () => {
  const now = new Date('2026-09-05T18:00:00');
  assert.equal(formatDateTime('2026-09-05T12:30:00', now), '今天 12:30');
  assert.equal(formatDateTime('2026-09-04T22:10:00', now), '昨天 22:10');
  assert.equal(formatDateTime('2026-08-30T08:05:00', now), '8月30日 08:05');
  assert.equal(formatDateTime('2025-12-31T23:00:00', now), '2025年12月31日 23:00');
});

test('normalizes alarm ids without inventing status', () => {
  const item = normalizeAlarmItems([{
    alarmId: 9007199254740991,
    alarmTime: null,
    handledAt: null,
    status: 'pending'
  }])[0];

  assert.equal(item.alarmId, '9007199254740991');
  assert.equal(item.status, 'pending');
  assert.equal(item.displayTime, '时间未知');
  assert.equal(item.displayHandledAt, '');
});

test('treats a missing alarm collection as empty', () => {
  assert.deepEqual(normalizeAlarmItems(null), []);
});

test('appends alarm pages without duplicating stable alarm ids', () => {
  const firstPage = [{ alarmId: '3' }, { alarmId: '2' }];
  const secondPage = [{ alarmId: '2' }, { alarmId: '1' }];

  assert.deepEqual(mergeAlarmItems(firstPage, secondPage), [
    { alarmId: '3' },
    { alarmId: '2' },
    { alarmId: '1' }
  ]);
});

test('keeps alarm items without ids instead of silently dropping data', () => {
  assert.deepEqual(mergeAlarmItems(null, [{ alarmId: '' }, { alarmId: '' }]), [
    { alarmId: '' },
    { alarmId: '' }
  ]);
});
