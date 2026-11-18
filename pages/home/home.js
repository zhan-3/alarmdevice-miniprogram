import { getStorage, setStorage } from '../../utils/storage';
import http from '../../utils/http';
import { loadDeviceSummary, getCachedDeviceSummary } from '../../utils/deviceService';
import logger from '../../utils/logger';

Page({
  data: {
    isLogin: false,
    userInfo: {},
    devices: [],
    currentSn: '',
    hasPhone: false,
    pageLoading: true,
    loadError: false
  },

  renderCachedDevices(allowPlaceholders = false) {
    const app = getApp();
    const token = app.getLoginToken();
    const bound = app.listBoundDevices();
    const cached = bound.map(device => getCachedDeviceSummary(device.sn, token));
    if (!allowPlaceholders && !cached.some(Boolean)) {
      const allowed = new Set(bound.map(device => device.sn));
      const remaining = this.data.devices.filter(device => allowed.has(device.sn));
      if (remaining.length !== this.data.devices.length) this.setData({ devices: remaining });
      return;
    }
    const devices = bound.map((device, index) => cached[index] || {
      id: device.sn, sn: device.sn, name: device.name || device.sn,
      status: 'unknown', statusText: '待更新', statusCached: false
    });
    this.setData({ devices, pageLoading: false });
  },

  async onShow() {
    this.isPageVisible = true;
    if (this.authChecking) return;
    const app = getApp();
    const token = app.getLoginToken();
    if (this.viewToken && this.viewToken !== token) {
      this.setData({ devices: [], userInfo: {}, isLogin: false, pageLoading: true, loadError: false });
    }
    this.viewToken = token;
    const version = (this.viewVersion || 0) + 1;
    this.viewVersion = version;
    this.loadDevicesTask = null;
    this.renderCachedDevices();
    this.authChecking = true;
    const outcome = await app.authNavigation.restore({ target: '/pages/home/home' });
    if (!this.isPageVisible || version !== this.viewVersion) return;
    this.authChecking = false;
    if (token !== app.getLoginToken()) {
      this.setData({ devices: [], userInfo: {}, pageLoading: false });
      // A cold restore may establish the first session; never reuse a prior account's view.
      if (token || outcome.type !== 'ready' || !app.getLoginToken()) return;
      this.viewToken = app.getLoginToken();
    }
    if (outcome.type === 'retryable-error') {
      this.setData({ isLogin: true, pageLoading: false, loadError: true });
      return;
    }
    if (outcome.type !== 'ready') {
      this.setData({ devices: [], userInfo: {}, isLogin: false, pageLoading: false });
      return;
    }
    this.setData({
      isLogin: true, hasPhone: true, userInfo: getStorage('userInfo') || {},
      currentSn: app.globalData.selectedDeviceSn, loadError: false
    });
    this.renderCachedDevices(true);
    this.startPolling();
    return this.loadAllDevices();
  },

  goBindPhone() {
    wx.reLaunch({ url: `/pages/login/login?redirect=${encodeURIComponent('/pages/home/home')}` });
  },

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.loadAllDevices(), 15000);
  },

  onHide() {
    this.isPageVisible = false;
    this.authChecking = false;
    this.viewVersion = (this.viewVersion || 0) + 1;
    this.loadDevicesTask = null;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  },

  onUnload() {
    this.onHide();
  },

  async loadUserInfo() {
    const app = getApp();
    const token = app.getLoginToken();
    const version = this.viewVersion;
    try {
      const res = await http.get('/user/getMainMessage', {}, {
        credentialScope: 'login', credential: token, invalidateOn401: false
      });
      if (!this.isPageVisible || version !== this.viewVersion || token !== app.getLoginToken()) return;
      if (res.code === 1 && res.data) {
        const cached = getStorage('userInfo') || {};
        const userInfo = { ...cached, ...res.data };
        setStorage('userInfo', userInfo);
        this.setData({ userInfo });
      }
    } catch (error) {
      if (!this.isPageVisible || token !== app.getLoginToken()) return;
      logger.error('获取用户信息失败', { error });
      if (error && error.code === 401) app.authNavigation.invalidate('login');
    }
  },

  loadAllDevices(force = false) {
    const app = getApp();
    const token = app.getLoginToken();
    const version = this.viewVersion;
    const isCurrent = () => this.isPageVisible && version === this.viewVersion && token === app.getLoginToken();
    if (!token || !isCurrent()) return Promise.resolve();
    if (this.loadDevicesTask) {
      if (!force) return this.loadDevicesTask;
      // A user refresh must query membership again after an older polling cycle.
      return this.loadDevicesTask.then(() => isCurrent() ? this.loadAllDevices() : undefined);
    }
    let failed = false;
    const task = app.refreshBoundDevices().then(() => {
      if (!isCurrent()) return null;
      this.renderCachedDevices(true);
      this.setData({ currentSn: app.globalData.selectedDeviceSn });
      return Promise.all(app.listBoundDevices().map(async device => {
        try {
          return await loadDeviceSummary(device.sn, token, { invalidateOn401: false, isCurrent });
        } catch (error) {
          if (!isCurrent()) return null;
          if (error && error.code === 401) {
            this.setData({ devices: [], userInfo: {}, isLogin: false });
            app.authNavigation.invalidate('login');
            return null;
          }
          if (error && error.code === 403) {
            app.authNavigation.invalidate({ type: 'device', sn: device.sn });
            return null;
          }
          if (!error || error.code !== 'STALE_DEVICE_REQUEST') {
            failed = true;
            logger.error('获取设备状态失败', { deviceSn: device.sn, error });
          }
          return getCachedDeviceSummary(device.sn, token) || {
            id: device.sn, sn: device.sn, name: device.name || device.sn,
            status: 'unknown', statusText: '连接失败', statusCached: false
          };
        }
      }));
    }).then(results => {
      if (!isCurrent() || !results) return;
      const allowed = new Set(app.listBoundDevices().map(device => device.sn));
      const devices = results.filter(device => device && allowed.has(device.sn));
      if (JSON.stringify(devices) !== JSON.stringify(this.data.devices) || failed !== this.data.loadError) {
        this.setData({ devices, loadError: failed, pageLoading: false });
      }
    }).catch(error => {
      if (!isCurrent() || (error && error.code === 'STALE_DEVICE_REQUEST')) return;
      logger.error('刷新关联设备列表失败', { error });
      this.setData({ loadError: true, pageLoading: false });
    }).finally(() => {
      if (this.loadDevicesTask === task) this.loadDevicesTask = null;
    });
    this.loadDevicesTask = task;
    return task;
  },

  retryLoad() {
    return this.onShow();
  },

  onPullDownRefresh() {
    return Promise.all([this.loadUserInfo(), this.loadAllDevices(true)]).finally(() => wx.stopPullDownRefresh());
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  goSetting() {
    wx.navigateTo({ url: '/pages/setting/setting' });
  },

  goBindDevice() {
    wx.navigateTo({ url: '/pages/devicebinding/devicebinding' });
  },

  goDeviceDetail(e) {
    const sn = e.currentTarget.dataset.id;
    getApp().selectDevice(sn);
    this.setData({ currentSn: sn });
    wx.navigateTo({ url: `/pages/device-detail/device-detail?id=${encodeURIComponent(sn)}` });
  }
});
