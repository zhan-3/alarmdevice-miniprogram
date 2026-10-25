const DEVICE_STORAGE_KEY = 'boundDevices';
const SELECTED_DEVICE_KEY = 'selectedDeviceSn';

function cloneDevice(device) {
  return { sn: device.sn, name: device.name || device.sn };
}

function createBoundDeviceSet(storage) {
  let devices = [];
  let selectedSn = '';

  function persist() {
    storage.set(DEVICE_STORAGE_KEY, devices.map(cloneDevice));
    storage.set(SELECTED_DEVICE_KEY, selectedSn);
  }

  function restore() {
    const stored = storage.get(DEVICE_STORAGE_KEY, null);
    const source = Array.isArray(stored) ? stored : storage.get('deviceTokens', []);
    devices = [...new Map((Array.isArray(source) ? source : [])
      .filter(device => device && typeof device.sn === 'string' && device.sn)
      .map(device => [device.sn, cloneDevice(device)])).values()];
    const previous = storage.get(SELECTED_DEVICE_KEY, '') || storage.get('currentSn', '');
    selectedSn = devices.some(device => device.sn === previous) ? previous : (devices[0]?.sn || '');
    // Preserve cached metadata, but never retain legacy device credentials.
    storage.remove('deviceTokens');
    storage.remove('currentSn');
    if (stored !== null || devices.length || previous) persist();
    return list();
  }

  function list() { return devices.map(cloneDevice); }
  function get(sn) {
    const device = devices.find(item => item.sn === sn);
    return device ? cloneDevice(device) : null;
  }
  function select(sn) {
    if (!devices.some(item => item.sn === sn)) return false;
    selectedSn = sn;
    persist();
    return true;
  }
  function bind(device) {
    if (!device || !device.sn) throw new Error('设备必须包含 SN');
    const normalized = cloneDevice(device);
    const index = devices.findIndex(item => item.sn === normalized.sn);
    if (index >= 0) devices[index] = normalized;
    else devices.push(normalized);
    selectedSn = normalized.sn;
    persist();
    return cloneDevice(normalized);
  }
  function rename(sn, name) {
    const device = devices.find(item => item.sn === sn);
    if (!device) return false;
    device.name = name || sn;
    persist();
    return true;
  }
  function remove(sn) {
    const index = devices.findIndex(item => item.sn === sn);
    if (index < 0) return false;
    devices.splice(index, 1);
    if (selectedSn === sn) selectedSn = devices[0]?.sn || '';
    persist();
    return true;
  }
  function clear() { devices = []; selectedSn = ''; persist(); }

  restore();
  return Object.freeze({ list, get, selectedDeviceSn: () => selectedSn, select, bind, rename, remove, clear, restore });
}

module.exports = { createBoundDeviceSet };
