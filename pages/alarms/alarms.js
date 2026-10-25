import http from '../../utils/http';
import logger from '../../utils/logger';
const { normalizeAlarmItems, mergeAlarmItems } = require('../../utils/alarmInbox');
const { requestAlarmSubscription } = require('../../utils/alarmSubscription');

Page({
  data: {
    isLogin: false,
    userInfo: {},
    alarms: [],
    loading: false,
    loadError: false,
    authRetryNeeded: false,
    hasMore: false,
    page: 1,
    handlingId: '',
    subscribing: false,
    subscriptionAccepted: false
  },

  async onShow() {
    if (this.authChecking) return;
    this.authChecking = true;
    const outcome = await getApp().authNavigation.restore({ target: '/pages/alarms/alarms' });
    this.authChecking = false;
    if (outcome.type === 'ready') {
      this.setData({
        isLogin: true,
        userInfo: getApp().globalData.userInfo || {},
        authRetryNeeded: false
      });
      this.loadAlarms(true);
      return;
    }
    if (outcome.type === 'retryable-error') {
      this.setData({ isLogin: true, authRetryNeeded: true, loadError: true });
    }
  },

  async loadAlarms(reset = false, queueIfBusy = false) {
    if (!this.data.isLogin) return;
    if (this.data.loading) {
      if (reset && queueIfBusy) this.reloadAfterCurrentLoad = true;
      return;
    }
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true, loadError: false });
    try {
      const res = await http.get('/user/alarms', {
        status: 'pending',
        page,
        pageSize: 20
      }, { credentialScope: 'login' });
      const result = res.data || {};
      const items = normalizeAlarmItems(result.items, getApp().listBoundDevices());
      this.setData({
        alarms: reset ? items : mergeAlarmItems(this.data.alarms, items),
        page: page + 1,
        hasMore: Boolean(result.hasMore)
      });
    } catch (error) {
      logger.error('加载报警列表失败', { error });
      if (this.data.alarms.length === 0) {
        this.setData({ loadError: true });
      } else {
        wx.showToast({ title: '加载更多失败，请重试', icon: 'none' });
      }
    } finally {
      this.setData({ loading: false });
      if (this.reloadAfterCurrentLoad) {
        this.reloadAfterCurrentLoad = false;
        await this.loadAlarms(true);
      }
    }
  },

  retryLoad() {
    if (this.data.authRetryNeeded) {
      this.onShow();
      return;
    }
    this.loadAlarms(true);
  },

  async subscribeAlarmNotifications() {
    if (this.data.subscribing || this.data.subscriptionAccepted) return;
    this.setData({ subscribing: true });
    try {
      const decision = await requestAlarmSubscription(wx);
      if (decision === 'accept') {
        this.setData({ subscriptionAccepted: true });
        wx.showToast({ title: '已订阅下一次报警提醒', icon: 'success' });
      } else if (decision === 'ban') {
        wx.showModal({
          title: '通知权限已关闭',
          content: '请在小程序设置中开启订阅消息权限后重试。',
          showCancel: false
        });
      } else {
        wx.showToast({ title: '未开启提醒，可稍后再试', icon: 'none' });
      }
    } catch (error) {
      logger.error('订阅微信报警提醒失败', { error });
      wx.showToast({ title: '暂时无法订阅，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ subscribing: false });
    }
  },

  loadMore() {
    if (this.data.hasMore && !this.data.loading) this.loadAlarms(false);
  },

  onPullDownRefresh() {
    if (this.data.authRetryNeeded) {
      this.onShow().finally(() => wx.stopPullDownRefresh());
      return;
    }
    if (!this.data.isLogin) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadAlarms(true).finally(() => wx.stopPullDownRefresh());
  },

  async handleAlarm(e) {
    const alarmId = String(e.currentTarget.dataset.id || '');
    if (!alarmId || this.data.handlingId) return;

    this.setData({ handlingId: alarmId });
    try {
      const confirmed = await new Promise((resolve, reject) => {
        wx.showModal({
          title: '确认已经处理？',
          content: '你和其他联系人都将看到“已处理”。这不会改变设备当前状态。',
          confirmText: '确认处理',
          success: result => resolve(Boolean(result.confirm)),
          fail: reject
        });
      });
      if (!confirmed) return;

      await http.post('/user/alarms/handle', { alarmId }, { credentialScope: 'login' });
      this.setData({
        alarms: this.data.alarms.filter(item => String(item.alarmId) !== alarmId)
      });
      wx.showToast({ title: '已确认处理', icon: 'success' });
    } catch (error) {
      logger.error('标记报警处理失败', { alarmId, error });
      if (!error || !error.userNotified) {
        wx.showToast({ title: '处理失败，请重试', icon: 'none' });
      }
    } finally {
      this.setData({ handlingId: '' });
    }
  },

  openAlarmLocation(e) {
    const latitude = Number(e.currentTarget.dataset.lat);
    const longitude = Number(e.currentTarget.dataset.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      wx.showToast({ title: '位置数据不可用', icon: 'none' });
      return;
    }
    wx.openLocation({
      latitude,
      longitude,
      scale: 16,
      name: `设备 ${e.currentTarget.dataset.sn || ''} 报警位置`
    });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/alarm-history/alarm-history' });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/setting/setting' });
  }
});
