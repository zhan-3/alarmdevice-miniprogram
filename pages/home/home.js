import { getStorage, setStorage } from '../../utils/storage';
import http from '../../utils/http';
import { DEVICE_STATUS_MAP } from '../../utils/constants';
import logger from '../../utils/logger';

Page({
  data: {
    isLogin: false,
    userInfo: {},
    devices: [],
    currentSn: '',   // 当前激活的设备SN
    hasPhone: false,
    pageLoading: true,
    loadError: false
  },

  // 把状态映射表定义为页面私有常量（避免data读取延迟问题）
  statusTextMap: {
    normal: '正常',
    alarm: '警报中',
    offline: '设备离线'
  },

  onShow() {
    this.isPageVisible = true;
    const isLogin = getStorage('isLogin');
    const token = getApp().getLoginToken();

    if (!isLogin || !token) {
      wx.reLaunch({
        url: `/pages/login/login?redirect=${encodeURIComponent('/pages/home/home')}`
      });
      return
    }

    const userInfo = getStorage('userInfo') || {};

    if (!userInfo.phone) {
      this.setData({
        isLogin: true,
        hasPhone: false,
        userInfo,
        devices: [],
        currentSn: '',
        pageLoading: false,
        loadError: false
      });
      wx.showModal({
        title: '请绑定手机号',
        content: '绑定手机号后才能正常使用报警服务',
        showCancel: false,
        confirmText: '去绑定'
      }).then(() => {
        wx.reLaunch({
          url: `/pages/login/login?redirect=${encodeURIComponent('/pages/home/home')}`
        });
      });
      return;
    }

    const app = getApp();
    this.setData({
      isLogin: true,
      hasPhone: true,
      userInfo,
      currentSn: app.globalData.selectedDeviceSn,
      loadError: false
    });
    Promise.all([
      this.loadUserInfo(),
      this.loadAllDevices()
    ]).finally(() => {
      this.setData({ pageLoading: false });
    });
    this.startPolling();
  },

  goBindPhone() {
    wx.reLaunch({
      url: `/pages/login/login?redirect=${encodeURIComponent('/pages/home/home')}`
    });
  },

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.loadAllDevices(), 15000);
  },

  onHide() {
    this.isPageVisible = false;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  },

  onUnload() {
    this.isPageVisible = false;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  },

  async loadUserInfo() {
    try {
      const res = await http.get('/user/getMainMessage');
      if (res.code === 1 && res.data) {
        const cached = getStorage('userInfo') || {};
        const userInfo = {
          nickName: res.data.nickName || cached.nickName || '',
          avatarUrl: res.data.avatarUrl || cached.avatarUrl || '',
          phone: res.data.phone || cached.phone || ''
        };
        setStorage('userInfo', userInfo);
        if (this.isPageVisible) this.setData({ userInfo });
        return;
      }
    } catch (err) {
      logger.error('获取用户信息失败', { error: err });
    }
    const userInfo = getStorage('userInfo') || {};
    if (this.isPageVisible) this.setData({ userInfo });
  },

  // 遍历所有已绑定设备的token，构建设备列表（并行请求）
  async loadAllDevices() {
    if (this.isLoadingDevices) return;
    this.isLoadingDevices = true;
    try {
      const app = getApp();
      const boundDevices = app.listBoundDevices();

      if (!boundDevices || boundDevices.length === 0) {
        this.setData({ devices: [], loadError: false });
        return;
      }

      // 并行请求所有设备状态
      const results = await Promise.allSettled(
        boundDevices.map(device =>
          http.get('/user/bind/status', { deviceSn: device.sn }, {
            Authorization: `Bearer ${device.deviceAccessToken}`
          }).then(bindRes => {
            if (bindRes.code === 1 && bindRes.data) {
              const displayName = (device.name && device.name !== device.sn) ? device.name : device.sn;
              return {
                id: device.sn,
                sn: device.sn,
                name: displayName,
                status: bindRes.data.status || 'normal',
                statusText: DEVICE_STATUS_MAP[bindRes.data.status] || '正常'
              };
            }
            return null;
          }).catch(err => {
            logger.error('获取设备状态失败', { deviceSn: device.sn, error: err });
            const displayName = (device.name && device.name !== device.sn) ? device.name : device.sn;
            return {
              id: device.sn,
              sn: device.sn,
              name: displayName,
              status: 'unknown',
              statusText: '连接失败'
            };
          })
        )
      );

      const devices = results
        .map(r => r.status === 'fulfilled' ? r.value : null)
        .filter(Boolean);
      const loadError = devices.length > 0 && devices.every(device => device.status === 'unknown');

      // 页面已隐藏时丢弃迟到结果；数据未变化时避免无意义渲染。
      if (!this.isPageVisible) return;
      if (JSON.stringify(devices) !== JSON.stringify(this.data.devices) || loadError !== this.data.loadError) {
        this.setData({ devices, loadError });
      }
    } finally {
      this.isLoadingDevices = false;
    }
  },

  retryLoad() {
    this.setData({ loadError: false, pageLoading: true });
    Promise.all([this.loadUserInfo(), this.loadAllDevices()]).finally(() => {
      if (this.isPageVisible) this.setData({ pageLoading: false });
    });
  },

  // 下拉刷新
  onPullDownRefresh() {
    Promise.all([
      this.loadUserInfo(),
      this.loadAllDevices()
    ]).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  goLogin() {
    wx.navigateTo({
      url: '/pages/login/login'
    });
  },

  goSetting() {
    wx.navigateTo({ url: '/pages/setting/setting' });
  },

  goBindDevice() {
    wx.navigateTo({
      url: '/pages/devicebinding/devicebinding'
    });
  },

  goDeviceDetail(e) {
    const sn = e.currentTarget.dataset.id;
    // 切换到该设备的token，后续所有请求自动使用对应设备数据
    getApp().selectDevice(sn);
    this.setData({ currentSn: sn });
    wx.navigateTo({
      url: `/pages/device-detail/device-detail?id=${sn}`
    });
  }
});