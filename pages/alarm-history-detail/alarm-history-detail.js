import http from '../../utils/http';
import logger from '../../utils/logger';
import { env } from '../../utils/env';
const { normalizeHistoryItem } = require('../../utils/alarmHistory');

Page({
  data: {
    alarmId: '',
    item: null,
    loading: false,
    loadError: false,
    refreshError: false,
    unavailable: false,
    authRetryNeeded: false,
    recordingLoading: false,
    recordingPlaying: false,
    recordingPath: ''
  },

  onLoad(options = {}) {
    this.setData({ alarmId: String(options.alarmId || '') });
  },

  async onShow() {
    if (this.authChecking) return;
    this.detailHidden = false;
    const token = getApp().getLoginToken();
    if (!token || this.detailToken !== token || this.detailAlarmId !== this.data.alarmId) this.clearPrivateData();
    this.detailToken = token;
    this.detailAlarmId = this.data.alarmId;
    this.authChecking = true;
    const showVersion = (this.detailShowVersion || 0) + 1;
    this.detailShowVersion = showVersion;
    this.detailAccessReady = false;
    this.reloadAfterCurrentDetailLoad = false;
    this.invalidateDetailLoad();
    this.loadingDetailRequestVersion = null;
    this.releaseRecording();
    this.setData({ loading: false });
    const target = `/pages/alarm-history-detail/alarm-history-detail?alarmId=${encodeURIComponent(this.data.alarmId)}`;
    const outcome = await getApp().authNavigation.restore({ target });
    if (showVersion !== this.detailShowVersion || this.detailHidden) return;
    this.authChecking = false;
    if (token !== getApp().getLoginToken()) {
      this.clearPrivateData();
      return;
    }
    if (outcome.type === 'ready') {
      this.detailAccessReady = true;
      this.setData({ authRetryNeeded: false });
      return this.loadDetail(true);
    }
    if (outcome.type !== 'retryable-error') this.clearPrivateData();
    if (outcome.type === 'retryable-error') {
      this.setData({ authRetryNeeded: true, loadError: !this.data.item, refreshError: Boolean(this.data.item) });
    }
  },

  invalidateDetailLoad() {
    this.detailRequestVersion = (this.detailRequestVersion || 0) + 1;
  },

  removeTemporaryFile(path) {
    if (!path || typeof wx.getFileSystemManager !== 'function') return;
    try {
      wx.getFileSystemManager().unlink({ filePath: path, fail() {} });
    } catch (error) { /* noop */ }
  },

  releaseRecording(updateState = true) {
    this.recordingRequestVersion = (this.recordingRequestVersion || 0) + 1;
    if (this.recordingDownloadTask && typeof this.recordingDownloadTask.abort === 'function') {
      try { this.recordingDownloadTask.abort(); } catch (error) { /* noop */ }
    }
    this.recordingDownloadTask = null;
    if (this.recordingAudio) {
      try { this.recordingAudio.destroy(); } catch (error) { /* noop */ }
      this.recordingAudio = null;
    }
    this.removeTemporaryFile(this.data.recordingPath);
    if (updateState) {
      this.setData({ recordingLoading: false, recordingPlaying: false, recordingPath: '' });
    }
  },

  clearPrivateData() {
    this.detailToken = '';
    this.detailAlarmId = '';
    this.invalidateDetailLoad();
    this.releaseRecording();
    this.setData({ item: null, unavailable: false, loadError: false, refreshError: false });
  },

  onHide() {
    this.detailHidden = true;
    this.authChecking = false;
    this.detailShowVersion = (this.detailShowVersion || 0) + 1;
    this.detailAccessReady = false;
    this.reloadAfterCurrentDetailLoad = false;
    this.invalidateDetailLoad();
    this.loadingDetailRequestVersion = null;
    this.setData({ loading: false });
    this.releaseRecording();
  },

  onUnload() {
    this.onHide();
    this.clearPrivateData();
  },

  async loadDetail(queueIfBusy = false) {
    if (this.detailHidden) return;
    if (!this.data.alarmId || this.data.loading) {
      if (!this.data.alarmId) this.setData({ unavailable: true });
      if (this.data.loading && queueIfBusy) this.reloadAfterCurrentDetailLoad = true;
      return;
    }
    const requestVersion = (this.detailRequestVersion || 0) + 1;
    this.detailRequestVersion = requestVersion;
    this.loadingDetailRequestVersion = requestVersion;
    const token = getApp().getLoginToken();
    const alarmId = this.data.alarmId;
    const isCurrent = () => !this.detailHidden && requestVersion === this.detailRequestVersion &&
      token === getApp().getLoginToken() && alarmId === this.data.alarmId;
    this.setData({ loading: true, loadError: false, refreshError: false, unavailable: false });
    try {
      const res = await http.get(
        `/user/alarms/history/${encodeURIComponent(this.data.alarmId)}`,
        {},
        { credentialScope: 'login', credential: token }
      );
      if (!isCurrent()) return;
      this.detailToken = token;
      this.detailAlarmId = alarmId;
      this.setData({ item: normalizeHistoryItem(res.data) });
    } catch (error) {
      if (!isCurrent()) return;
      logger.error('加载处理历史详情失败', { alarmId: this.data.alarmId, error });
      this.releaseRecording();
      if (error && error.code === 401) {
        this.detailAccessReady = false;
        this.setData({ item: null, authRetryNeeded: true, loadError: true });
      } else if (error && (error.code === 403 || error.code === 404)) {
        this.detailAccessReady = false;
        this.setData({ item: null, unavailable: true });
      } else {
        this.setData({ loadError: !this.data.item, refreshError: Boolean(this.data.item) });
      }
    } finally {
      if (this.loadingDetailRequestVersion === requestVersion) {
        this.loadingDetailRequestVersion = null;
        this.setData({ loading: false });
      }
      if (this.reloadAfterCurrentDetailLoad && !this.data.loading && this.detailAccessReady) {
        this.reloadAfterCurrentDetailLoad = false;
        await this.loadDetail(true);
      }
    }
  },

  retryLoad() {
    if (this.data.authRetryNeeded) {
      this.onShow();
      return;
    }
    this.loadDetail();
  },

  initRecordingAudio(path) {
    if (this.recordingAudio) this.recordingAudio.destroy();
    const audio = wx.createInnerAudioContext();
    audio.obeyMuteSwitch = false;
    audio.src = path;
    audio.onPlay(() => this.setData({ recordingPlaying: true }));
    audio.onPause(() => this.setData({ recordingPlaying: false }));
    audio.onEnded(() => this.setData({ recordingPlaying: false }));
    audio.onError(error => {
      logger.error('播放报警录音失败', { alarmId: this.data.alarmId, error });
      this.releaseRecording();
      wx.showToast({ title: '录音暂时不可用', icon: 'none' });
    });
    this.recordingAudio = audio;
  },

  async toggleRecording() {
    if (!this.data.item || !this.data.item.fileId || this.data.recordingLoading) return;
    if (this.recordingAudio && this.data.recordingPath) {
      if (this.data.recordingPlaying) this.recordingAudio.pause();
      else this.recordingAudio.play();
      return;
    }

    const token = getApp().getLoginToken();
    if (!token) {
      wx.showToast({ title: '登录状态已失效，请重新登录', icon: 'none' });
      return;
    }
    const requestVersion = (this.recordingRequestVersion || 0) + 1;
    this.recordingRequestVersion = requestVersion;
    this.setData({ recordingLoading: true });
    try {
      const path = await new Promise((resolve, reject) => {
        this.recordingDownloadTask = wx.downloadFile({
          url: `${env.baseURL}/user/alarms/history/${encodeURIComponent(this.data.alarmId)}/recording`,
          header: { Authorization: `Bearer ${token}` },
          timeout: 15000,
          success: result => {
            if (result.statusCode >= 200 && result.statusCode < 300 && result.tempFilePath) {
              resolve(result.tempFilePath);
              return;
            }
            reject({ code: result.statusCode });
          },
          fail: reject
        });
      });
      if (requestVersion !== this.recordingRequestVersion || token !== getApp().getLoginToken() || !this.data.item) {
        this.removeTemporaryFile(path);
        return;
      }
      this.recordingDownloadTask = null;
      this.initRecordingAudio(path);
      this.setData({ recordingPath: path });
      this.recordingAudio.play();
    } catch (error) {
      if (requestVersion !== this.recordingRequestVersion || token !== getApp().getLoginToken()) return;
      this.recordingDownloadTask = null;
      logger.error('下载报警录音失败', { alarmId: this.data.alarmId, error });
      if (error && (error.code === 401 || error.code === 403 || error.code === 404)) {
        this.detailAccessReady = false;
        this.clearPrivateData();
        this.setData({ authRetryNeeded: error.code === 401, unavailable: error.code !== 401 });
        wx.showToast({ title: error.code === 401 ? '登录状态已失效，请重新登录' : '记录已不可访问', icon: 'none' });
        return;
      }
      wx.showToast({ title: '录音暂时不可用', icon: 'none' });
    } finally {
      if (requestVersion === this.recordingRequestVersion) {
        this.setData({ recordingLoading: false });
      }
    }
  },

  openAlarmLocation() {
    const item = this.data.item;
    if (!item || !item.hasLocation || !item.mapLocation) {
      wx.showToast({ title: '位置数据不可用', icon: 'none' });
      return;
    }
    wx.openLocation({
      latitude: item.mapLocation.latitude,
      longitude: item.mapLocation.longitude,
      scale: 16,
      name: `${item.deviceName || `设备 ${item.deviceSn}`} 报警位置`
    });
  }
});
