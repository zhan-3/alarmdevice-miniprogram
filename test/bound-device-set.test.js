const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoundDeviceSet } = require('../utils/boundDeviceSet');
function memoryStorage(initial = {}) {
  const values = { ...initial };
  return {
    get: (key, fallback = null) => Object.hasOwn(values, key) ? values[key] : fallback,
    set(key, value) { values[key] = value; },
    remove(key) { delete values[key]; },
    snapshot: () => structuredClone(values)
  };
}

test('migrates cached metadata and selection but discards every device credential', () => {
  for (const initial of [
    { deviceTokens: [{ sn: 'A', token: 'legacy-secret', name: '桥 A' }], currentSn: 'A' },
    { boundDevices: [{ sn: 'A', deviceAccessToken: 'old-secret', name: '桥 A' }], selectedDeviceSn: 'A' }
  ]) {
    const storage = memoryStorage(initial);
    const devices = createBoundDeviceSet(storage);
    assert.deepEqual(devices.list(), [{ sn: 'A', name: '桥 A' }]);
    assert.equal(devices.selectedDeviceSn(), 'A');
    assert.deepEqual(storage.snapshot(), { boundDevices: [{ sn: 'A', name: '桥 A' }], selectedDeviceSn: 'A' });
  }
});

test('binding and switching never stores or replaces the login credential', () => {
  const storage = memoryStorage({ loginToken: 'login-user' });
  const devices = createBoundDeviceSet(storage);
  devices.bind({ sn: 'A', name: '桥 A' });
  devices.bind({ sn: 'B', name: '桥 B', deviceAccessToken: 'discard-me' });
  assert.equal(devices.selectedDeviceSn(), 'B');
  assert.equal(devices.select('A'), true);
  assert.equal(devices.select('UNBOUND'), false);
  assert.equal(storage.snapshot().loginToken, 'login-user');
  assert.deepEqual(devices.list(), [{ sn: 'A', name: '桥 A' }, { sn: 'B', name: '桥 B' }]);
});

test('rename persists metadata across restoration without tokens', () => {
  const storage = memoryStorage();
  const devices = createBoundDeviceSet(storage);
  devices.bind({ sn: 'A' });
  devices.rename('A', '桥梁 A');
  assert.deepEqual(createBoundDeviceSet(storage).get('A'), { sn: 'A', name: '桥梁 A' });
});

test('removing selected device selects another and clearing preserves login identity', () => {
  const storage = memoryStorage({ loginToken: 'login-user' });
  const devices = createBoundDeviceSet(storage);
  devices.bind({ sn: 'A' }); devices.bind({ sn: 'B' });
  assert.equal(devices.remove('B'), true);
  assert.equal(devices.selectedDeviceSn(), 'A');
  assert.equal(devices.remove('missing'), false);
  devices.clear();
  assert.equal(devices.selectedDeviceSn(), '');
  assert.deepEqual(devices.list(), []);
  assert.equal(storage.snapshot().loginToken, 'login-user');
});

test('ignores invalid stale selection and duplicate cached records', () => {
  const devices = createBoundDeviceSet(memoryStorage({
    boundDevices: [{ sn: 'A' }, null, { sn: 'A', name: '桥 A' }], selectedDeviceSn: 'REVOKED'
  }));
  assert.deepEqual(devices.list(), [{ sn: 'A', name: '桥 A' }]);
  assert.equal(devices.selectedDeviceSn(), 'A');
});
