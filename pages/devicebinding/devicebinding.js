import http from '../../utils/http';
import { isValidSN } from '../../utils/validators';
import logger from '../../utils/logger';

function safeDecode(value) {
  try {
    return decodeURIComponent(value || '');
  } catch (err) {
    return '';
  }
}

Page({
  data: {
    showManualBind: false,
    inputSN: '',
    snError: false,    // SN码格式错误提示
    isLoading: false,
    deviceSN: '',
    isLogin: false
  },

  async onLoad(options = {}) {
    let deviceSN = '';

    if (options.scene) {
      // 从小程序码扫码进入（scene参数）
      deviceSN = safeDecode(options.scene).trim().toUpperCase();
    } else if (options.sn) {
      // 从登录页跳转回来（sn参数）
      deviceSN = safeDecode(options.sn).trim().toUpperCase();
    }

    if (deviceSN && !isValidSN(deviceSN)) {
      wx.toast({ title: '设备SN码格式错误', icon: 'none' });
      deviceSN = '';
    }

    if (deviceSN) {
      this.setData({ deviceSN });
      // 在可能跳转登录前先保存SN，防止页面跳转后丢失。
      getApp().globalData.pendingSN = deviceSN;
    }

    const target = deviceSN
      ? `/pages/devicebinding/devicebinding?sn=${encodeURIComponent(deviceSN)}`
      : '/pages/devicebinding/devicebinding';
    const outcome = await getApp().authNavigation.restore({
      target,
      pendingDevice: deviceSN || getApp().globalData.pendingSN || ''
    });
    if (outcome.type === 'retryable-error') {
      this.setData({ isLogin: false });
      wx.toast({ title: '暂时无法验证登录状态，请重试', icon: 'none' });
      return;
    }
    if (outcome.type === 'ready') {
      this.setData({ isLogin: true });
      if (deviceSN) await this.autoBindDevice(deviceSN);
    }
  },

  /**
   * 扫码绑定（主动点击扫码按钮）
   */
  scanBindDevice() {
    if (!this.data.isLogin) return; // 未登录不执行
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode'],
      success: (res) => {
        let sn = (res.result || '').trim().toUpperCase();
        // 兼容小程序码 scene 参数格式。
        if (sn.includes('SCENE=')) {
          sn = safeDecode(sn.split('SCENE=')[1].split('&')[0]).trim().toUpperCase();
        }
        if (!isValidSN(sn)) {
          wx.toast({ title: '二维码中未识别到有效SN码', icon: 'none' });
          return;
        }
        this.bindDevice(sn);
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.includes('cancel')) return;
        wx.toast({ title: '扫码失败，请重试', icon: 'none' });
      }
    });
  },

  /**
   * 打开手动绑定弹窗
   */
  openManualBind() {
    if (!this.data.isLogin) return;
    this.setData({
      showManualBind: true,
      inputSN: '',
      snError: false
    });
  },

  /**
   * 关闭手动绑定弹窗
   */
  async closeManualBind() {
    if (this.data.isLoading) return;
    const { inputSN } = this.data;
    if (inputSN) {
      const confirmed = await wx.modal({
        content: '你已输入SN码，确定要退出吗？',
        cancelText: '继续编辑',
        confirmText: '确认退出'
      });
      if (confirmed) {
        this.setData({ showManualBind: false, inputSN: '' });
      }
    } else {
      this.setData({ showManualBind: false, inputSN: '' });
    }
  },

  /**
   * 输入SN码（实时格式验证）
   */
  onInputSN(e) {
    const sn = e.detail.value.trim().toUpperCase();
    this.setData({
      inputSN: sn,
      snError: sn.length > 0 && !isValidSN(sn)
    });
  },

  /**
   * 确认手动绑定
   */
  async confirmBind() {
    const { inputSN, snError } = this.data;
    if (!inputSN) {
      wx.toast({ title: '请输入设备SN码' });
      return;
    }
    if (snError || !isValidSN(inputSN)) {
      wx.toast({ title: 'SN码格式错误' });
      return;
    }

    const confirmed = await wx.modal({
      title: '确认绑定',
      content: `你确定要绑定SN码为【${inputSN}】的设备吗？`,
      cancelText: '取消',
      confirmText: '确认绑定'
    });
    if (confirmed) {
      const bound = await this.bindDevice(inputSN);
      if (bound) this.setData({ showManualBind: false, inputSN: '', snError: false });
    }
  },

  /**
   * 自动绑定（从二维码跳转进入时）
   */
  async autoBindDevice(sn) {
    const confirmed = await wx.modal({
      title: '自动绑定',
      content: `检测到设备SN码：【${sn}】，是否直接绑定？`,
      cancelText: '取消',
      confirmText: '确认绑定'
    });
    if (confirmed) {
      await this.bindDevice(sn);
    }
  },

  /**
   * 核心绑定逻辑（统一处理扫码/手动/自动绑定）
   */
  async bindDevice(sn) {
    const normalizedSN = String(sn || '').trim().toUpperCase();
    if (this.data.isLoading || !isValidSN(normalizedSN)) {
      if (!this.data.isLoading) wx.toast({ title: '设备SN码格式错误', icon: 'none' });
      return false;
    }
    this.setData({ isLoading: true });
    let succeeded = false;

    try {
      wx.showLoading({ title: '绑定设备中...', mask: true });

      const loginToken = getApp().getLoginToken();

      const bindRes = await http.post('/user/bind/device', {
        deviceId: normalizedSN
      }, { credentialScope: 'login', credential: loginToken });

      if (bindRes.code === 1 && bindRes.data === normalizedSN) {
        const app = getApp();
        app.bindDevice(normalizedSN, normalizedSN);
        app.globalData.pendingSN = '';
        succeeded = true;

        wx.toast({ title: '绑定成功', icon: 'success' });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/home/home' });
        }, 1000);
      } else {
        logger.warn('设备绑定被服务端拒绝', { error: bindRes });
        wx.toast({ title: bindRes.msg || '绑定失败', icon: 'none' });
      }

    } catch (err) {
      logger.error('设备绑定失败', { error: err });
      const errMsg = err?.msg || err?.message || '绑定失败，请检查网络或设备ID是否正确';
      if (!err?.userNotified) wx.toast({ title: errMsg, icon: 'none' });
    } finally {
      this.setData({ isLoading: false });
      wx.hideLoading();
    }
    return succeeded;
  },

});
