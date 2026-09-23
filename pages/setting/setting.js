import { loadDeviceData, buildMarkers } from '../../utils/deviceService';
import http from '../../utils/http';
import { getStorage } from '../../utils/storage';
import logger from '../../utils/logger';
Page({
  data: {
    userInfo: {},
    isDeviceSetting: false,
    deviceLoading: false,
    deviceLoadError: false,
    isLoggingOut: false,
    device: null,
    markers: [],
    showEditNameModal: false,
    tempName: '',
    savingName: false,
    savingLocation: false
  },

  onLoad(options) {
    this.loadUserInfo();
    const isDeviceSetting = Boolean(options.id);
    this.setData({ isDeviceSetting });
    wx.setNavigationBarTitle({ title: isDeviceSetting ? '设备设置' : '个人设置' });
    if (isDeviceSetting) {
      this.loadDevice(options.id);
    }
  },

  loadUserInfo() {
    const userInfo = getStorage('userInfo') || {};
    this.setData({ userInfo });
  },

  async loadDevice(deviceId) {
    this.setData({ deviceLoading: true, deviceLoadError: false });
    try {
      const app = getApp();
      const deviceEntry = app.getDevice(deviceId);
      const authToken = deviceEntry ? deviceEntry.deviceAccessToken : '';
      const device = await loadDeviceData(deviceId, authToken);
      const markers = buildMarkers(device);
      const deviceLoadError = device.status === 'unknown' && !device.address && markers.length === 0;
      this.setData({ device, markers, deviceLoadError });
    } catch (err) {
      logger.error('设置页加载设备信息失败', { deviceId, error: err });
      this.setData({ deviceLoadError: true });
    } finally {
      this.setData({ deviceLoading: false });
    }
  },

  retryLoadDevice() {
    const deviceId = this.data.device && this.data.device.id;
    if (deviceId) this.loadDevice(deviceId);
  },

  editDeviceName() {
    const { device } = this.data;
    if (device) {
      this.setData({
        showEditNameModal: true,
        tempName: device.name
      });
    }
  },

  onNameInput(e) {
    this.setData({ tempName: e.detail.value });
  },

  closeEditNameModal() {
    this.setData({
      showEditNameModal: false,
      tempName: ''
    });
  },

  async saveName() {
    const { device, tempName, savingName } = this.data;
    if (savingName || !device) return;
    const newName = tempName.trim();
    if (!newName) {
      wx.toast({ title: '请输入设备名称', icon: 'none' });
      return;
    }

    const app = getApp();
    this.setData({ savingName: true });
    try {
      await http.post('/device/updateName', {
        deviceSn: device.sn,
        name: newName
      }, {
        credentialScope: 'device',
        credential: app.getDeviceAccessToken(device.sn),
        deviceSn: device.sn
      });
      app.renameDevice(device.sn, newName);
      this.setData({
        'device.name': newName,
        showEditNameModal: false,
        tempName: ''
      });
      wx.toast({ title: '名称已修改', icon: 'success' });
    } catch (err) {
      logger.error('保存设备名称失败', { deviceId: device.sn, error: err });
      if (!err || !err.userNotified) {
        wx.toast({ title: '名称保存失败，请重试', icon: 'none' });
      }
    } finally {
      this.setData({ savingName: false });
    }
  },

  async chooseLocation() {
    const { device, savingLocation } = this.data;
    if (!device || savingLocation) return;
    if (device.latitude && device.longitude) {
      const confirmed = await wx.modal({
        title: '修改安装位置',
        content: '保存后，其他关联用户也会看到新的安装位置。',
        confirmText: '确认修改'
      });
      if (!confirmed) return;
    }

    const initialLatitude = Number(device.latitude) || 39.9042;
    const initialLongitude = Number(device.longitude) || 116.4074;

    const openPicker = () => {
      wx.chooseLocation({
        latitude: initialLatitude,
        longitude: initialLongitude,
        success: async (res) => {
          if (!res) return;

          const latitude = Number(res.latitude) || initialLatitude;
          const longitude = Number(res.longitude) || initialLongitude;
          const address = res.address || res.name || '设备位置';
          const markers = [{
            id: 1,
            latitude,
            longitude,
            iconPath: '/images/map.png',
            width: 32,
            height: 32
          }];

          this.setData({ savingLocation: true });
          try {
            const app = getApp();
            await http.post('/device/updateLocation', {
              deviceSn: device.sn,
              latitude,
              longitude,
              address
            }, {
              credentialScope: 'device',
              credential: app.getDeviceAccessToken(device.sn),
              deviceSn: device.sn
            });
            this.setData({
              'device.latitude': latitude,
              'device.longitude': longitude,
              'device.address': address,
              markers
            });
            wx.toast({ title: '安装位置已保存', icon: 'success' });
          } catch (err) {
            logger.error('保存设备位置失败', { deviceId: device.sn, error: err });
            if (!err || !err.userNotified) {
              wx.toast({ title: '位置保存失败，请重试', icon: 'none' });
            }
          } finally {
            this.setData({ savingLocation: false });
          }
        },
        fail: (err) => {
          logger.error('选择设备位置失败', { error: err });
          if (err.errMsg && err.errMsg.includes('cancel')) return;
          wx.toast({ title: '选择位置失败', icon: 'none' });
        }
      });
    };

    wx.getSetting({
      success: (res) => {
        if (res.authSetting && res.authSetting['scope.userLocation']) {
          openPicker();
          return;
        }

        wx.authorize({
          scope: 'scope.userLocation',
          success: openPicker,
          fail: () => {
            wx.toast({ title: '请先开启定位权限', icon: 'none' });
          }
        });
      },
      fail: openPicker
    });
  },

  async logout() {
    if (this.data.isLoggingOut) return;
    const confirmed = await wx.modal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      confirmText: '退出',
      confirmColor: '#f53f3f'
    });
    if (!confirmed) return;

    this.setData({ isLoggingOut: true });
    getApp().authNavigation.logout();
  }
});
