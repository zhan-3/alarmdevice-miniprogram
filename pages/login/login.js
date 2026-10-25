// pages/login/login.js
import http from '../../utils/http'
import { getStorage, setStorage } from '../../utils/storage'
import logger from '../../utils/logger'
const { createPhoneVerificationWorkflow } = require('../../utils/phoneVerification')

Page({
  data: {
    step: 1,
    loading: false,
    phone: '',
    verificationCode: '',
    phoneError: false,
    sendingCode: false,
    confirmingPhone: false,
    countdown: 0,
    errMsg: '',
    privacyAuthorizing: false,
    postLoginUrl: '/pages/alarms/alarms'
  },

  async onLoad(options = {}) {
    this.phoneVerification = createPhoneVerificationWorkflow({
      transport: {
        send: phone => http.post('/user/phone-verification/send', { phone }, {
          credentialScope: 'login'
        }),
        confirm: (phone, code) => http.post('/user/phone-verification/confirm', { phone, code }, {
          credentialScope: 'login'
        })
      },
      storage: { get: getStorage, set: setStorage },
      logger,
      onChange: state => this.setData({
        phone: state.phone,
        verificationCode: state.code,
        phoneError: state.phoneInvalid,
        sendingCode: state.sending,
        confirmingPhone: state.confirming,
        countdown: state.retryAfterSeconds,
        errMsg: state.message
      })
    })


    const app = getApp()
    this.authIntent = {
      target: options.redirect || '',
      pendingDevice: app.globalData.pendingSN || ''
    }
    this.setData({ loading: true, errMsg: '' })
    const outcome = await app.authNavigation.restore(this.authIntent)
    this.renderAuthOutcome(outcome)
  },

  onShow() {
    // 未登录时回首页仍会跳回登录页，不展示无效的原生回首页入口。
    if (typeof wx.hideHomeButton === 'function') wx.hideHomeButton()
  },

  renderAuthOutcome(outcome) {
    if (outcome.type === 'phone-required') {
      this.setData({ step: 2, loading: false, postLoginUrl: outcome.target })
      return
    }
    if (outcome.type === 'retryable-error') {
      this.setData({ loading: false, errMsg: '暂时无法验证登录状态，请重试' })
      return
    }
    this.setData({ loading: false, postLoginUrl: outcome.target || this.data.postLoginUrl })
  },

  onUnload() {
    if (this.phoneVerification) this.phoneVerification.dispose()
  },

  openPrivacyPolicy() {
    if (typeof wx.openPrivacyContract !== 'function') {
      wx.showToast({ title: '请升级微信后查看隐私指引', icon: 'none' })
      return
    }
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: '隐私指引暂时无法打开，请稍后重试', icon: 'none' })
    })
  },

  async requirePrivacyAgreement() {
    if (this.data.privacyAuthorizing) return false
    if (typeof wx.requirePrivacyAuthorize !== 'function') {
      this.setData({ errMsg: '请升级微信后再登录或注册' })
      return false
    }
    this.setData({ privacyAuthorizing: true, errMsg: '' })
    try {
      // 不注册自定义隐私监听，让微信展示官方授权弹窗。
      // 已授权的用户直接成功；是否需要重新授权由微信判断。
      await new Promise((resolve, reject) => {
        wx.requirePrivacyAuthorize({ success: resolve, fail: reject })
      })
      return true
    } catch (error) {
      this.setData({ errMsg: '未完成隐私授权，暂未继续操作；你可以重新点击按钮授权' })
      return false
    } finally {
      this.setData({ privacyAuthorizing: false })
    }
  },

  async doLogin() {
    if (this.data.loading || this.data.privacyAuthorizing) return
    this.setData({ loading: true, errMsg: '' })

    try {
      if (!await this.requirePrivacyAgreement()) {
        this.setData({ loading: false })
        return
      }
      const loginRes = await new Promise((resolve, reject) => {
        wx.login({ timeout: 5000, success: resolve, fail: reject })
      })
      if (!loginRes.code) {
        this.setData({ loading: false, errMsg: '获取登录凭证失败' })
        return
      }

      const res = await http.publicPost('/system/log', { code: loginRes.code })
      if (res.code !== 1 || !res.data) {
        this.setData({ loading: false, errMsg: res.msg || '登录失败' })
        return
      }

      const outcome = await getApp().authNavigation.establish(res.data, this.authIntent)
      this.renderAuthOutcome(outcome)
    } catch (err) {
      logger.error('登录失败', { error: err })
      this.setData({ loading: false, errMsg: '网络异常，请重试' })
    }
  },

  onPhoneInput(e) {
    this.phoneVerification.changePhone(e.detail.value)
  },

  onVerificationCodeInput(e) {
    this.phoneVerification.changeCode(e.detail.value)
  },

  async sendVerificationCode() {
    if (this.data.loading || this.data.privacyAuthorizing || this.data.sendingCode || this.data.confirmingPhone || this.data.countdown > 0) return
    if (!await this.requirePrivacyAgreement()) return
    return this.phoneVerification.send()
  },

  async confirmPhone() {
    if (this.data.loading || this.data.privacyAuthorizing || this.data.confirmingPhone || this.data.sendingCode) return
    if (!await this.requirePrivacyAgreement()) return
    const outcome = await this.phoneVerification.confirm()
    if (outcome.status !== 'verified') return

    this.setData({ loading: true })
    try {
      const app = getApp()
      const authOutcome = await app.authNavigation.establish(app.getLoginToken(), this.authIntent)
      this.renderAuthOutcome(authOutcome)
    } finally {
      this.setData({ loading: false })
    }
  }
})
