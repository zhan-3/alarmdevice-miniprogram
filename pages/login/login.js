// pages/login/login.js
import http from '../../utils/http'
import { getStorage, setStorage } from '../../utils/storage'
import logger from '../../utils/logger'
const { resolvePostLoginUrl } = require('../../utils/navigation')
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
    postLoginUrl: '/pages/home/home'
  },

  onLoad(options = {}) {
    this.phoneVerification = createPhoneVerificationWorkflow({
      transport: {
        send: phone => http.post('/user/phone-verification/send', { phone }),
        confirm: (phone, code) => http.post('/user/phone-verification/confirm', { phone, code })
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
    const postLoginUrl = resolvePostLoginUrl(options.redirect, app.globalData.pendingSN)
    this.setData({ postLoginUrl })

    // 已有登录凭证且有手机号，直接进入原目标页面。
    const token = app.getLoginToken()
    const isLogin = getStorage('isLogin')
    const userInfo = getStorage('userInfo') || {}
    if (token && isLogin) {
      this.restoreCachedSession(userInfo)
    }
  },

  async restoreCachedSession(cachedUserInfo) {
    this.setData({ loading: true, errMsg: '' })
    try {
      const profileRes = await http.get('/user/getMainMessage')
      const profile = profileRes.data || {}
      const userInfo = {
        nickName: profile.nickName || cachedUserInfo.nickName || '',
        avatarUrl: profile.avatarUrl || cachedUserInfo.avatarUrl || '',
        phone: profile.phone || ''
      }
      setStorage('userInfo', userInfo)
      if (userInfo.phone) {
        setStorage('phone', userInfo.phone)
        await this.restoreBoundDevices()
        this.finishLogin()
      } else {
        this.setData({ step: 2, loading: false })
      }
    } catch (error) {
      logger.error('恢复登录状态失败', { error })
      if (!error.userNotified) {
        this.setData({ loading: false, errMsg: '暂时无法验证登录状态，请重试' })
      }
    }
  },

  finishLogin() {
    const url = this.data.postLoginUrl || '/pages/alarms/alarms'
    wx.reLaunch({ url })
  },

  onUnload() {
    if (this.phoneVerification) this.phoneVerification.dispose()
  },

  async restoreBoundDevices() {
    try {
      const statusRes = await http.get('/user/bind/status')
      const deviceIds = Array.isArray(statusRes.data) ? statusRes.data : []
      const app = getApp()
      await Promise.allSettled(deviceIds.map(async deviceId => {
        const tokenRes = await http.post('/user/bind/userDeviceLogin', { deviceId })
        if (tokenRes.data) app.bindDevice(deviceId, tokenRes.data, deviceId)
      }))
    } catch (err) {
      logger.error('恢复设备访问凭证失败', { error: err })
    }
  },

  async doLogin() {
    if (this.data.loading) return
    this.setData({ loading: true, errMsg: '' })

    try {
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

      const token = res.data
      const app = getApp()
      app.setLoginToken(token)
      setStorage('isLogin', true)

      // 从后端恢复账号资料；手机号已经验证过时无需再次验证。
      const profileRes = await http.get('/user/getMainMessage')
      const userInfo = profileRes.data || {}
      setStorage('userInfo', userInfo)
      if (userInfo.phone) {
        setStorage('phone', userInfo.phone)
        await this.restoreBoundDevices()
        this.finishLogin()
        return
      }

      this.setData({ step: 2, loading: false })
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

  sendVerificationCode() {
    return this.phoneVerification.send()
  },

  async confirmPhone() {
    if (this.data.loading) return
    const outcome = await this.phoneVerification.confirm()
    if (outcome.status !== 'verified') return

    this.setData({ loading: true })
    try {
      await this.restoreBoundDevices()
      this.finishLogin()
    } finally {
      this.setData({ loading: false })
    }
  }
})
