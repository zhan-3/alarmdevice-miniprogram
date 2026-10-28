import http from '../../utils/http';
import { getStorage } from '../../utils/storage';
import { loadDeviceDetails, loadDeviceContacts } from '../../utils/deviceService';
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
    contactsRefreshing: false,
    contactRefreshError: '',
    contactSaveError: '',
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
    this.pageHidden = false;
    // 返回时重新读取，联系人显示名可能已被本人更新。
    if (this.data.device || this.pageWasHidden) this.loadDeviceFromAPI();
    this.pageWasHidden = false;
  },

  invalidateContactRequests() {
    this.contactGeneration = (this.contactGeneration || 0) + 1;
    if (this.detailRequests) this.detailRequests.begin();
  },

  onHide() {
    this.pageHidden = true;
    this.pageWasHidden = true;
    this.invalidateContactRequests();
    this.setData({
      device: null, markers: [], showAddContactModal: false,
      tempContactName: '', tempContactPhone: '', contactPhoneError: '', contactSaveError: '',
      savingContact: false, contactsRefreshing: false, deletingContactId: ''
    });
  },

  onUnload() {
    this.pageHidden = true;
    this.invalidateContactRequests();
  },

  captureContactScope() {
    return {
      token: getApp().getLoginToken(),
      deviceId: this.data.currentSn,
      generation: this.contactGeneration || 0
    };
  },

  isContactScopeCurrent(scope) {
    return !this.pageHidden && Boolean(scope.token && scope.deviceId) &&
      scope.generation === (this.contactGeneration || 0) &&
      scope.deviceId === this.data.currentSn && scope.token === getApp().getLoginToken();
  },

  handleContactAccessError(error, scope) {
    if (!this.isContactScopeCurrent(scope)) return;
    if (error && error.code === 401) {
      getApp().authNavigation.invalidate('login');
    } else if (error && error.code === 403) {
      getApp().authNavigation.invalidate({ type: 'device', sn: scope.deviceId });
      this.setData({ device: null, markers: [], loadError: true, showAddContactModal: false });
    }
  },

  // 从后端API并行加载设备状态、位置和联系人。
  async loadDeviceFromAPI() {
    if (this.data.savingContact || this.data.contactsRefreshing || this.data.deletingContactId) return;
    if (!this.detailRequests) this.detailRequests = createRequestVersion();
    const requestVersion = this.detailRequests.begin();
    const currentSn = this.data.currentSn;
    const app = getApp();
    const authToken = app.getLoginToken();
    const scope = this.captureContactScope();

    if (!currentSn || !authToken) {
      this.setData({ isLoading: false, loadError: true });
      return;
    }

    this.setData({ isLoading: true, loadError: false });
    try {
      const { device, markers } = await loadDeviceDetails(currentSn, authToken, {
        invalidateOn401: false,
        isCurrent: () => this.detailRequests.isCurrent(requestVersion) && this.isContactScopeCurrent(scope)
      });
      if (!this.detailRequests.isCurrent(requestVersion) || !this.isContactScopeCurrent(scope)) return;
      this.contactAdditionPending = false;
      this.setData({ device, markers, contactRefreshError: '' });
    } catch (err) {
      if (!this.detailRequests.isCurrent(requestVersion) || !this.isContactScopeCurrent(scope)) return;
      logger.error('加载设备详情失败', { error: err });
      this.setData({ loadError: true, device: null, markers: [] });
      this.handleContactAccessError(err, scope);
    } finally {
      if (this.detailRequests.isCurrent(requestVersion) && this.isContactScopeCurrent(scope)) {
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
    if (this.data.savingContact || this.data.contactsRefreshing || this.data.deletingContactId) return;
    if (this.contactAdditionPending || this.data.contactRefreshError) {
      wx.toast({ title: '请先重新加载联系人列表', icon: 'none' });
      return;
    }
    this.setData({
      showAddContactModal: true,
      tempContactName: '',
      tempContactPhone: '',
      contactPhoneError: '',
      contactSaveError: ''
    });
  },

  closeAddContactModal() {
    if (this.data.savingContact) return;
    this.setData({ showAddContactModal: false, tempContactName: '', tempContactPhone: '', contactPhoneError: '', contactSaveError: '' });
  },

  onContactNameInput(e) {
    this.setData({ tempContactName: e.detail.value, contactSaveError: '' });
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
      contactPhoneError: this.isOwnContactPhone(phone) ? '你已默认接收报警，无需添加自己' : '',
      contactSaveError: ''
    });
  },

  async refreshContacts(scope = this.captureContactScope(), afterAdd = false) {
    if (!this.isContactScopeCurrent(scope) || this.data.contactsRefreshing || !this.data.device) return;
    this.setData({ contactsRefreshing: true });
    try {
      const contacts = await loadDeviceContacts(scope.token, scope.deviceId, { invalidateOn401: false });
      if (!this.isContactScopeCurrent(scope) || !this.data.device) return;
      this.contactAdditionPending = false;
      this.setData({ 'device.contacts': contacts, contactRefreshError: '', swipeId: null, swipeOffset: 0 });
      if (afterAdd) wx.toast({ title: '联系人已添加', icon: 'success' });
    } catch (error) {
      if (!this.isContactScopeCurrent(scope)) return;
      this.setData({ contactRefreshError: this.contactAdditionPending
        ? '联系人已添加，但列表刷新失败。请重新加载，无需再次添加。'
        : '联系人列表刷新失败，请重新加载。' });
      this.handleContactAccessError(error, scope);
    } finally {
      if (this.isContactScopeCurrent(scope)) this.setData({ contactsRefreshing: false });
    }
  },

  retryContacts() {
    if (this.data.savingContact || this.data.deletingContactId) return;
    return this.refreshContacts();
  },

  async saveContact() {
    if (this.data.savingContact || this.data.contactsRefreshing || this.data.deletingContactId ||
      this.contactAdditionPending || this.data.contactRefreshError || !this.data.device) return;
    const { tempContactPhone, device } = this.data;
    const name = String(this.data.tempContactName || '').trim();
    if (this.isOwnContactPhone(tempContactPhone)) {
      this.setData({ contactPhoneError: '你已默认接收报警，无需添加自己' });
      return;
    }
    if (name.length > 20) {
      this.setData({ contactSaveError: '联系人称呼最多20个字符' });
      return;
    }
    const phoneReg = /^1[3-9]\d{9}$/;
    if (!phoneReg.test(tempContactPhone)) {
      this.setData({ contactPhoneError: '请输入正确的11位手机号' });
      return;
    }
    if (device.contacts.some(c => c.phone === tempContactPhone)) {
      this.setData({ contactPhoneError: '该手机号已添加' });
      return;
    }
    const scope = this.captureContactScope();
    if (!this.isContactScopeCurrent(scope)) return;
    // 废弃添加前发起的整页读取，避免旧列表晚到覆盖权威刷新结果。
    if (this.detailRequests) this.detailRequests.begin();
    this.setData({ savingContact: true, isLoading: false, contactSaveError: '' });
    try {
      const res = await http.post(
        `/user/addPhoneNumber?deviceId=${encodeURIComponent(scope.deviceId)}&number=${encodeURIComponent(tempContactPhone)}&name=${encodeURIComponent(name)}`,
        {},
        { credentialScope: 'login', credential: scope.token, deviceId: scope.deviceId, invalidateOn401: false }
      );
      if (!this.isContactScopeCurrent(scope)) return;
      if (res.code !== 1) throw res;
      this.contactAdditionPending = true;
      this.setData({ showAddContactModal: false, tempContactName: '', tempContactPhone: '', contactPhoneError: '' });
      await this.refreshContacts(scope, true);
    } catch (error) {
      if (!this.isContactScopeCurrent(scope)) return;
      logger.error('添加联系人失败', { error });
      this.setData({ contactSaveError: (error && error.msg) || '添加失败，请重试' });
      this.handleContactAccessError(error, scope);
    } finally {
      if (this.isContactScopeCurrent(scope)) this.setData({ savingContact: false });
    }
  },

  async deleteContact(e) {
    const contactId = e.currentTarget.dataset.id;
    if (this.data.deletingContactId || this.data.savingContact || this.data.contactsRefreshing ||
      this.data.contactRefreshError || !this.data.device) return;
    const contact = this.data.device.contacts.find(c => c.id === contactId);
    if (!contact) return;
    const scope = this.captureContactScope();
    if (!this.isContactScopeCurrent(scope)) return;
    const confirmed = await wx.modal({ content: '确定要删除该联系人吗？' });
    if (!confirmed || !this.isContactScopeCurrent(scope) || this.data.deletingContactId ||
      this.data.savingContact || this.data.contactsRefreshing) return;

    if (this.detailRequests) this.detailRequests.begin();
    this.setData({ deletingContactId: contactId, isLoading: false });
    try {
      const delRes = await http.delete(`/user/deletePhone?deviceId=${encodeURIComponent(scope.deviceId)}&number=${encodeURIComponent(contact.phone)}`, {}, {
        credentialScope: 'login', credential: scope.token, deviceId: scope.deviceId, invalidateOn401: false
      });
      if (!this.isContactScopeCurrent(scope) || !this.data.device) return;
      if (delRes.code === 1) {
        const contacts = this.data.device.contacts.filter(c => c.phone !== contact.phone);
        this.setData({ 'device.contacts': contacts, swipeId: null, swipeOffset: 0 });
        wx.toast({ title: '删除成功', icon: 'success' });
      }
    } catch (error) {
      if (!this.isContactScopeCurrent(scope)) return;
      logger.error('删除联系人失败', { error });
      this.handleContactAccessError(error, scope);
      if (!error || !error.userNotified) wx.toast({ title: '删除失败，请重试', icon: 'none' });
    } finally {
      if (this.isContactScopeCurrent(scope)) this.setData({ deletingContactId: '' });
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
