const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeviceRepository } = require('../utils/deviceRepository');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const repository = createDeviceRepository({ now: () => 1000 });
  repository.syncSession('user-A', ['SN-A', 'SN-B']);
  return repository;
}

test('device resources survive page recreation and share in-flight reads without sharing mutable objects', async () => {
  const repository = setup();
  const pending = deferred();
  let reads = 0;
  const load = () => { reads += 1; return pending.promise; };
  const list = repository.fetch('user-A', 'SN-A', 'status', load);
  const detail = repository.fetch('user-A', 'SN-A', 'status', load);
  assert.equal(reads, 1);
  pending.resolve({ name: '桥A', status: 'normal' });
  const [first, second] = await Promise.all([list, detail]);
  first.name = 'changed';
  assert.equal(second.name, '桥A');
  assert.deepEqual(repository.peek('user-A', 'SN-A', 'status'), {
    value: { name: '桥A', status: 'normal' }, updatedAt: 1000
  });
});

test('account changes, logout and removing bindings clear resources and reject late responses', async () => {
  for (const transition of ['account', 'logout', 'unbind']) {
    const repository = setup();
    repository.replace('user-A', 'SN-A', 'contacts', [{ phone: 'synthetic' }]);
    const pending = deferred();
    const loading = repository.fetch('user-A', 'SN-A', 'status', () => pending.promise);
    if (transition === 'account') repository.syncSession('user-B', ['SN-A']);
    if (transition === 'logout') repository.clear();
    if (transition === 'unbind') repository.syncSession('user-A', ['SN-B']);
    assert.equal(repository.peek('user-A', 'SN-A', 'contacts'), null);
    pending.resolve({ name: 'late-A' });
    await assert.rejects(loading, { code: 'STALE_DEVICE_REQUEST' });
    assert.equal(repository.peek('user-B', 'SN-A', 'status'), null);
  }
});

test('local saves supersede in-flight reads and one device does not replace another', async () => {
  const repository = setup();
  repository.replace('user-A', 'SN-A', 'status', { name: 'old', status: 'normal' });
  repository.replace('user-A', 'SN-B', 'status', { name: 'B' });
  const pending = deferred();
  const loading = repository.fetch('user-A', 'SN-A', 'status', () => pending.promise);
  repository.patch('user-A', 'SN-A', 'status', { name: 'new' });
  pending.resolve({ name: 'old' });
  await assert.rejects(loading, { code: 'STALE_DEVICE_REQUEST' });
  assert.equal(repository.peek('user-A', 'SN-A', 'status').value.name, 'new');
  assert.equal(repository.peek('user-A', 'SN-B', 'status').value.name, 'B');
});

test('network errors preserve prior resources; permission failures evict them', async () => {
  const repository = setup();
  repository.replace('user-A', 'SN-A', 'contacts', [{ name: 'cached' }]);
  await assert.rejects(repository.fetch('user-A', 'SN-A', 'contacts', async () => { throw { code: -1 }; }), { code: -1 });
  assert.equal(repository.peek('user-A', 'SN-A', 'contacts').value[0].name, 'cached');
  await assert.rejects(repository.fetch('user-A', 'SN-A', 'status', async () => { throw { code: 403 }; }), { code: 403 });
  assert.equal(repository.peek('user-A', 'SN-A', 'contacts'), null);
});

test('a hidden-page 401 drops private data without turning the next permission check into local 403', async () => {
  const repository = setup();
  repository.replace('user-A', 'SN-A', 'contacts', [{ name: 'private' }]);
  await assert.rejects(repository.fetch('user-A', 'SN-A', 'status', async () => { throw { code: 401 }; }), { code: 401 });
  assert.equal(repository.peek('user-A', 'SN-A', 'contacts'), null);
  let requested = false;
  await assert.rejects(repository.fetch('user-A', 'SN-A', 'status', async () => {
    requested = true;
    throw { code: 401 };
  }), { code: 401 });
  assert.equal(requested, true);
});

test('read cache never skips a new permission check and stale credentials cannot evict a newer session', async () => {
  const repository = setup();
  const pending = deferred();
  const loading = repository.fetch('user-A', 'SN-A', 'status', () => pending.promise);
  repository.syncSession('user-B', ['SN-A']);
  repository.replace('user-B', 'SN-A', 'status', { name: 'B' });
  pending.reject({ code: 401 });
  await assert.rejects(loading, { code: 'STALE_DEVICE_REQUEST' });
  let reads = 0;
  await repository.fetch('user-B', 'SN-A', 'status', async () => { reads += 1; return { name: 'fresh B' }; });
  assert.equal(reads, 1);
  assert.equal(repository.peek('user-B', 'SN-A', 'status').value.name, 'fresh B');
});
