import http from '../../utils/http';
import { getStorage, setStorage } from '../../utils/storage';
import { loadDeviceDetails } from '../../utils/deviceService';
const { createRequestVersion } = require('../../utils/requestVersion');
import { DEVICE_STATUS_MAP } from '../../utils/constants';
import logger from '../../utils/logger';

Page({
  data: {
    device: null,
    markers: [],
    isLoading: true,
    showEditNameModal: false,
    showAddContactModal: false,
    tempName: '',
    tempContactName: '',
    tempContactPhone: '',
    contactPhoneError: '',
    swipeId: null,
    swipeOffset: 0,
    touchStartX: 0,
    currentSn: '',
    loadError: false,
    savingName: false,
    savingContact: false,
    deletingContactId: ''
  },

  onLoad(options) {
    if (options.id) {
      const app = getApp();
      const deviceEntry = app.getDevice(options.id);
      if (deviceEntry) {
        app.selectDevice(options.id);
      }
      this.setData({ currentSn: options.id });
    }
    this.loadDeviceFromAPI();
  },

  onShow() {
    // 从子页面返回时刷新数据（如设置页修改了设备名）。
    if (this.data.device) {
      this.loadDeviceFromAPI();
    }
  },

  onUnload() {
    // 使尚未返回的请求失效，避免卸载后继续 setData。
    if (this.detailRequests) this.detailRequests.begin();
  },

  // 从后端API并行加载设备状态、位置和联系人。
  async loadDeviceFromAPI() {
    if (!this.detailRequests) this.detailRequests = createRequestVersion();
    const requestVersion = this.detailRequests.begin();
    const currentSn = this.data.currentSn;
    const app = getApp();
    const authToken = app.getLoginToken();

    if (!currentSn || !authToken) {
      this.setData({ isLoading: false, loadError: true });
      return;
    }

    this.setData({ isLoading: true, loadError: false });
    try {
      const { device, markers } = await loadDeviceDetails(currentSn, authToken);
      if (!this.detailRequests.isCurrent(requestVersion) || currentSn !== this.data.currentSn) return;
      this.setData({ device, markers });
    } catch (err) {
      if (!this.detailRequests.isCurrent(requestVersion)) return;
      logger.error('加载设备详情失败', { error: err });
      this.setData({ loadError: true, device: null, markers: [] });
    } finally {
      if (this.detailRequests.isCurrent(requestVersion)) {
        this.setData({ isLoading: false });
      }
    }
  },

  retryLoad() {
    this.loadDeviceFromAPI();
  },

  editName() {
    this.setData({
      showEditNameModal: true,
      tempName: this.data.device.name
    });
  },

  closeEditNameModal() {
    this.setData({ showEditNameModal: false, tempName: '' });
  },

  onNameInput(e) {
    this.setData({ tempName: e.detail.value.trim() });
  },

  async saveName() {
    const { tempName, currentSn, savingName } = this.data;
    if (savingName) return;
    if (!tempName || !tempName.trim()) {
      wx.toast({ title: '请输入设备名称', icon: 'none' });
      return;
    }

    const newName = tempName.trim();
    const app = getApp();
    this.setData({ savingName: true });
    try {
      await http.post('/device/updateName', {
        deviceId: currentSn,
        name: newName
      }, {
        credentialScope: 'login',
        deviceId: currentSn
      });
      app.renameDevice(currentSn, newName);
      this.setData({
        'device.name': newName,
        showEditNameModal: false,
        tempName: ''
      });
      wx.toast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      logger.error('保存设备名称失败', { deviceId: currentSn, error: err });
      if (!err || !err.userNotified) {
        wx.toast({ title: '名称保存失败，请重试', icon: 'none' });
      }
    } finally {
      this.setData({ savingName: false });
    }
  },

  showAddContact() {
    this.setData({
      showAddContactModal: true,
      tempContactName: '',
      tempContactPhone: '',
      contactPhoneError: ''
    });
  },

  closeAddContactModal() {
    this.setData({ showAddContactModal: false, tempContactName: '', tempContactPhone: '', contactPhoneError: '' });
  },

  onContactNameInput(e) {
    this.setData({ tempContactName: e.detail.value.trim() });
  },

  isOwnContactPhone(phone) {
    const app = getApp();
    const profile = app.globalData && app.globalData.userInfo;
    const ownPhone = String((profile && profile.phone) || getStorage('phone') || '').trim();
    return Boolean(ownPhone && String(phone).trim() === ownPhone);
  },

  onContactPhoneInput(e) {
    const phone = e.detail.value.trim();
    this.setData({
      tempContactPhone: phone,
      contactPhoneError: this.isOwnContactPhone(phone) ? '你已默认接收报警，无需添加自己' : ''
    });
  },

  async saveContact() {
    if (this.data.savingContact) return;
    const { tempContactName, tempContactPhone, device } = this.data;
    if (this.isOwnContactPhone(tempContactPhone)) {
      this.setData({ contactPhoneError: '你已默认接收报警，无需添加自己' });
      return;
    }
    if (!tempContactName) {
      wx.toast({ title: '请输入联系人姓名', icon: 'none' });
      return;
    }
    const phoneReg = /^1[3-9]\d{9}$/;
    if (!phoneReg.test(tempContactPhone)) {
      wx.toast({ title: '请输入正确的11位手机号', icon: 'none' });
      return;
    }
    if (device.contacts.some(c => c.phone === tempContactPhone)) {
      wx.toast({ title: '该手机号已添加', icon: 'none' });
      return;
    }

    this.setData({ savingContact: true });
    try {
      wx.showLoading({ title: '添加中...', mask: true });
      const res = await http.post(
        `/user/addPhoneNumber?deviceId=${encodeURIComponent(this.data.currentSn)}&number=${encodeURIComponent(tempContactPhone)}&name=${encodeURIComponent(tempContactName)}`,
        {},
        {
          credentialScope: 'login',
          deviceId: this.data.currentSn
        }
      );

      wx.hideLoading();
      if (res.code === 1) {
        // 本地缓存姓名，后端不返时回退用
        const nameCache = getStorage('contactNameCache') || {};
        nameCache[tempContactPhone] = tempContactName;
        setStorage('contactNameCache', nameCache);

        const newContact = {
          id: 'c' + Date.now(),
          name: tempContactName,
          phone: tempContactPhone
        };
        this.setData({
          'device.contacts': [...device.contacts, newContact],
          showAddContactModal: false,
          tempContactName: '',
          tempContactPhone: ''
        });
        wx.toast({ title: '添加成功', icon: 'success' });
      }
    } catch (err) {
      logger.error('添加联系人失败', { error: err });
    } finally {
      wx.hideLoading();
      this.setData({ savingContact: false });
    }
  },

  async deleteContact(e) {
    const contactId = e.currentTarget.dataset.id;
    if (this.data.deletingContactId) return;
    const contact = this.data.device.contacts.find(c => c.id === contactId);
    if (!contact) return;

    const confirmed = await wx.modal({ content: '确定要删除该联系人吗？' });
    if (!confirmed) return;

    this.setData({ deletingContactId: contactId });
    try {
      wx.showLoading({ title: '删除中...', mask: true });
      const delRes = await http.delete(`/user/deletePhone?deviceId=${encodeURIComponent(this.data.currentSn)}&number=${encodeURIComponent(contact.phone)}`, {}, {
        credentialScope: 'login',
        deviceId: this.data.currentSn
      });

      wx.hideLoading();
      if (delRes.code === 1) {
        const contacts = this.data.device.contacts.filter(c => c.id !== contactId);
        this.setData({ 'device.contacts': contacts });
        wx.toast({ title: '删除成功', icon: 'success' });
      }
    } catch (err) {
      logger.error('删除联系人失败', { error: err });
    } finally {
      wx.hideLoading();
      this.setData({ deletingContactId: '' });
    }
  },

  async confirmRemoveDevice() {
    const confirmed = await wx.modal({
      title: '从本机移除',
      content: '仅清除本机保存的设备信息，不会解除服务端绑定。'
    });
    if (!confirmed) return;

    const removed = getApp().removeLocalDevice(this.data.currentSn);
    if (!removed) {
      wx.toast({ title: '设备已不在本机列表中', icon: 'none' });
      return;
    }

    wx.toast({ title: '已从本机移除', icon: 'success' });
    setTimeout(() => {
      wx.switchTab({ url: '/pages/home/home' });
    }, 800);
  },

  startNavigation() {
    const { device } = this.data;
    const latitude = device && Number(device.latitude);
    const longitude = device && Number(device.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude === 0 || longitude === 0) {
      return wx.toast({ title: '位置数据不可用', icon: 'none' });
    }

    wx.openLocation({
      latitude: Number(latitude),
      longitude: Number(longitude),
      name: device.name || '设备位置',
      address: device.address || '未知地址',
      scale: 16
    });
  },

  goAudioPage() {
    wx.navigateTo({
      url: '/pages/audio/audio'
    });
  },

  goSetting() {
    const deviceId = this.data.device && this.data.device.id;
    if (!deviceId) {
      wx.toast({ title: '设备信息加载中', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/setting/setting?id=${encodeURIComponent(deviceId)}`
    });
  },

  touchStart(e) {
    this.setData({
      touchStartX: e.touches[0].clientX,
      swipeId: e.currentTarget.dataset.id,
      swipeOffset: 0
    });
  },

  touchMove(e) {
    const moveX = e.touches[0].clientX;
    const diff = this.data.touchStartX - moveX;
    if (diff > 0 && diff < 80) {
      this.setData({ swipeOffset: -diff });
    }
  },

  touchEnd(e) {
    const diff = this.data.touchStartX - e.changedTouches[0].clientX;
    if (diff > 40) {
      this.setData({ swipeOffset: -60 });
    } else {
      this.setData({ swipeOffset: 0, swipeId: null });
    }
  }
});
