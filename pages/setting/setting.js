import { loadDeviceData, buildMarkers, getCachedDeviceDetails } from '../../utils/deviceService';
const { deviceRepository } = require('../../utils/deviceRepository');
import http from '../../utils/http';
import { getStorage, setStorage } from '../../utils/storage';
import logger from '../../utils/logger';
Page({
  data: {
    userInfo: {},
    profileLoading: false,
    profileReady: false,
    profileError: '',
    showNicknameModal: false,
    tempNickname: '',
    savingNickname: false,
    nicknameError: '',
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

  onShow() {
    const wasHidden = this.profileHidden;
    this.profileHidden = false;
    if (this.data.isDeviceSetting && wasHidden && this.requestedDeviceId) return this.loadDevice(this.requestedDeviceId);
    if (!this.data.isDeviceSetting) {
      if (this.data.profileReady && !this.profileNeedsRefresh && this.accountProfileToken === getApp().getLoginToken()) return;
      return this.loadAccountProfile();
    }
  },

  onHide() {
    this.profileHidden = true;
    this.profileRequestVersion = (this.profileRequestVersion || 0) + 1;
    this.deviceRequestVersion = (this.deviceRequestVersion || 0) + 1;
    this.nicknameSaveVersion = (this.nicknameSaveVersion || 0) + 1;
    this.setData({
      profileLoading: false, deviceLoading: false,
      showNicknameModal: false, tempNickname: '', nicknameError: '', savingNickname: false
    });
  },

  onUnload() {
    this.onHide();
    this.accountProfileToken = '';
    this.setData({ userInfo: {}, profileReady: false });
  },

  loadUserInfo() {
    const userInfo = getStorage('userInfo') || {};
    this.setData({ userInfo });
  },

  isCurrentAccount(token) {
    return !this.profileHidden && Boolean(token) && getApp().getLoginToken() === token;
  },

  applyAccountProfile(profile, token) {
    if (!this.isCurrentAccount(token)) return;
    const userInfo = { ...profile };
    getApp().globalData.userInfo = userInfo;
    setStorage('userInfo', userInfo);
    this.accountProfileToken = token;
    this.profileNeedsRefresh = false;
    this.setData({ userInfo, profileReady: true, profileError: '' });
  },

  async loadAccountProfile() {
    const token = getApp().getLoginToken();
    const version = (this.profileRequestVersion || 0) + 1;
    this.profileRequestVersion = version;
    const canReuse = Boolean(token && this.accountProfileToken === token && this.data.profileReady);
    this.setData({
      profileLoading: true, profileError: '',
      ...(canReuse ? {} : { profileReady: false, userInfo: {} })
    });
    try {
      if (!token) throw { code: 401 };
      const res = await http.get('/user/getMainMessage', {}, {
        credentialScope: 'login', credential: token, invalidateOn401: false
      });
      if (version !== this.profileRequestVersion || !this.isCurrentAccount(token)) return;
      if (!res.data || typeof res.data !== 'object' || Array.isArray(res.data)) throw { msg: '账号资料返回异常，请重试' };
      this.applyAccountProfile(res.data, token);
    } catch (error) {
      if (version !== this.profileRequestVersion || this.profileHidden || getApp().getLoginToken() !== token) return;
      if (error && error.code === 401) {
        this.accountProfileToken = '';
        this.setData({ userInfo: {}, profileReady: false, profileError: '账号信息加载失败，请重试' });
        getApp().authNavigation.invalidate('login');
      } else {
        this.setData({ profileError: '账号信息更新失败，请重试' });
      }
    } finally {
      if (version === this.profileRequestVersion && !this.profileHidden) this.setData({ profileLoading: false });
    }
  },

  editNickname() {
    if (!this.data.profileReady || !this.isCurrentAccount(this.accountProfileToken)) return;
    this.setData({ showNicknameModal: true, tempNickname: this.data.userInfo.nickName || '', nicknameError: '' });
  },

  onNicknameInput(e) {
    this.setData({ tempNickname: e.detail.value, nicknameError: '' });
  },

  closeNicknameModal() {
    if (this.data.savingNickname) return;
    this.setData({ showNicknameModal: false, tempNickname: '', nicknameError: '' });
  },

  async saveNickname() {
    if (this.data.savingNickname || !this.data.profileReady) return;
    const token = this.accountProfileToken;
    if (!this.isCurrentAccount(token)) return;
    const nickName = String(this.data.tempNickname || '').trim();
    if (nickName.length > 20) {
      this.setData({ nicknameError: '昵称最多20个字符' });
      return;
    }
    const version = (this.nicknameSaveVersion || 0) + 1;
    this.nicknameSaveVersion = version;
    const isCurrent = () => version === this.nicknameSaveVersion && this.isCurrentAccount(token);
    const options = { credentialScope: 'login', credential: token, invalidateOn401: false };
    let saved = false;
    this.profileNeedsRefresh = true;
    this.setData({ savingNickname: true, nicknameError: '' });
    try {
      // 资料接口会同时更新头像：保存前重新读取，绝不以空头像覆盖未知资料。
      const current = await http.get('/user/getMainMessage', {}, options);
      if (!isCurrent()) return;
      if (!current.data || typeof current.data !== 'object' || Array.isArray(current.data)) throw { msg: '账号资料返回异常，请重试' };
      await http.post('/user/getMessage', {
        nickName,
        avatarUrl: current.data && current.data.avatarUrl != null ? current.data.avatarUrl : null
      }, options);
      saved = true;
      if (!isCurrent()) {
        // A save may finish after leaving and returning; re-read only for the same account.
        if (getApp().getLoginToken() === token) {
          this.profileNeedsRefresh = true;
          if (!this.profileHidden) await this.loadAccountProfile();
        }
        return;
      }
      const refreshed = await http.get('/user/getMainMessage', {}, options);
      if (!isCurrent()) return;
      if (!refreshed.data || typeof refreshed.data !== 'object' || Array.isArray(refreshed.data)) throw { msg: '账号资料返回异常，请重试' };
      this.applyAccountProfile(refreshed.data, token);
      this.setData({ showNicknameModal: false, tempNickname: '' });
      wx.toast({ title: '账号昵称已保存', icon: 'success' });
    } catch (error) {
      if (!isCurrent()) return;
      if (error && error.code === 401) {
        this.setData({ userInfo: {}, profileReady: false, showNicknameModal: false });
        getApp().authNavigation.invalidate('login');
        return;
      }
      this.setData({ nicknameError: saved ? '昵称可能已保存，资料刷新失败，请重试' : ((error && error.msg) || '昵称保存失败，请重试') });
    } finally {
      if (version === this.nicknameSaveVersion && !this.profileHidden) this.setData({ savingNickname: false });
    }
  },

  async loadDevice(deviceId) {
    this.requestedDeviceId = deviceId;
    const app = getApp();
    const authToken = app.getLoginToken();
    const version = (this.deviceRequestVersion || 0) + 1;
    this.deviceRequestVersion = version;
    const isCurrent = () => !this.profileHidden && version === this.deviceRequestVersion && authToken === app.getLoginToken();
    if (this.settingDeviceToken !== authToken) this.setData({ device: null, markers: [] });
    this.settingDeviceToken = authToken;
    const cached = getCachedDeviceDetails(deviceId, authToken);
    this.setData({ ...(cached || {}), deviceLoading: true, deviceLoadError: false });
    try {
      const device = await loadDeviceData(deviceId, authToken, { invalidateOn401: false, isCurrent });
      if (!isCurrent()) return;
      this.setData({ device, markers: buildMarkers(device), deviceLoadError: false });
    } catch (err) {
      if (!isCurrent() || (err && err.code === 'STALE_DEVICE_REQUEST')) return;
      logger.error('设置页加载设备信息失败', { deviceId, error: err });
      if (err && (err.code === 401 || err.code === 403)) {
        this.setData({ deviceLoadError: true, device: null, markers: [] });
        app.authNavigation.invalidate(err.code === 401 ? 'login' : { type: 'device', sn: deviceId });
      } else {
        this.setData({ deviceLoadError: true });
      }
    } finally {
      if (isCurrent()) this.setData({ deviceLoading: false });
    }
  },

  retryLoadDevice() {
    const deviceId = this.requestedDeviceId || (this.data.device && this.data.device.id);
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
    const token = app.getLoginToken();
    this.setData({ savingName: true });
    try {
      await http.post('/device/updateName', {
        deviceId: device.sn,
        name: newName
      }, {
        credentialScope: 'login', credential: token, invalidateOn401: false,
        deviceId: device.sn
      });
      if (token !== app.getLoginToken()) return;
      app.renameDevice(device.sn, newName);
      this.setData({
        'device.name': newName,
        showEditNameModal: false,
        tempName: ''
      });
      wx.toast({ title: '名称已修改', icon: 'success' });
    } catch (err) {
      if (token !== app.getLoginToken()) return;
      if (err && (err.code === 401 || err.code === 403)) {
        app.authNavigation.invalidate(err.code === 401 ? 'login' : { type: 'device', sn: device.sn });
      }
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
    const token = getApp().getLoginToken();
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
            await http.post('/device/updateLocation', {
              deviceId: device.sn,
              latitude,
              longitude,
              address
            }, {
              credentialScope: 'login', credential: token, invalidateOn401: false,
              deviceId: device.sn
            });
            if (token !== getApp().getLoginToken()) return;
            deviceRepository.replace(token, device.sn, 'location', {
              gpsLat: latitude, gpsLng: longitude, address
            });
            this.setData({
              'device.latitude': latitude,
              'device.longitude': longitude,
              'device.address': address,
              markers
            });
            wx.toast({ title: '安装位置已保存', icon: 'success' });
          } catch (err) {
            if (token !== getApp().getLoginToken()) return;
            if (err && (err.code === 401 || err.code === 403)) {
              getApp().authNavigation.invalidate(err.code === 401 ? 'login' : { type: 'device', sn: device.sn });
            }
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
