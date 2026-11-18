// Session-only shared device resources. Nothing here is written to wx storage.
function createDeviceRepository({ now = Date.now } = {}) {
  let token = '';
  let allowed = new Set();
  const entries = new Map();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const stale = () => ({ code: 'STALE_DEVICE_REQUEST', msg: '设备请求已失效' });

  function syncSession(nextToken, devices = []) {
    if (nextToken !== token) entries.clear();
    token = nextToken || '';
    allowed = new Set(token ? devices.map(device => typeof device === 'string' ? device : device.sn) : []);
    for (const id of entries.keys()) if (!allowed.has(id)) entries.delete(id);
  }

  function canAccess(credential, id) {
    return Boolean(credential && credential === token && allowed.has(id));
  }

  function entryFor(id) {
    if (!entries.has(id)) entries.set(id, { values: new Map(), pending: new Map(), revisions: new Map() });
    return entries.get(id);
  }

  function peek(credential, id, resource) {
    if (!canAccess(credential, id)) return null;
    const value = entries.get(id)?.values.get(resource);
    return value ? clone(value) : null;
  }

  function replace(credential, id, resource, value) {
    if (!canAccess(credential, id)) return;
    const entry = entryFor(id);
    entry.revisions.set(resource, (entry.revisions.get(resource) || 0) + 1);
    entry.pending.delete(resource);
    entry.values.set(resource, { value: clone(value), updatedAt: now() });
  }

  function patch(credential, id, resource, changes) {
    const previous = peek(credential, id, resource);
    if (previous) replace(credential, id, resource, { ...previous.value, ...changes });
  }

  function invalidate(credential, id, resource) {
    if (!canAccess(credential, id)) return;
    if (!resource) { entries.delete(id); return; }
    const entry = entryFor(id);
    entry.revisions.set(resource, (entry.revisions.get(resource) || 0) + 1);
    entry.pending.delete(resource);
    entry.values.delete(resource);
  }

  function clear() {
    entries.clear();
    token = '';
    allowed.clear();
  }

  function fetch(credential, id, resource, load) {
    if (!canAccess(credential, id)) return Promise.reject({ code: 403, msg: '设备不在当前绑定列表中' });
    const entry = entryFor(id);
    const existing = entry.pending.get(resource);
    if (existing) return existing.then(clone);
    const revision = entry.revisions.get(resource) || 0;
    const isCurrent = () => canAccess(credential, id) && entries.get(id) === entry &&
      (entry.revisions.get(resource) || 0) === revision;
    const pending = (async () => {
      try {
        const value = await load();
        if (!isCurrent()) throw stale();
        entry.values.set(resource, { value: clone(value), updatedAt: now() });
        return value;
      } catch (error) {
        if (!isCurrent()) throw stale();
        // Drop private values even if the requesting page is hidden. Keep the scope
        // until App changes it, so the next visible read gets the real 401, not a synthetic 403.
        if (error && error.code === 401) entries.clear();
        else if (error && error.code === 403) entries.delete(id);
        throw error;
      }
    })();
    entry.pending.set(resource, pending);
    const release = () => {
      if (entry.pending.get(resource) === pending) entry.pending.delete(resource);
    };
    pending.then(release, release);
    return pending.then(clone);
  }

  return Object.freeze({ syncSession, peek, replace, patch, invalidate, fetch, clear });
}

const deviceRepository = createDeviceRepository();
module.exports = { createDeviceRepository, deviceRepository };
