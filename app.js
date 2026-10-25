// app.js
import './utils/extendApi'
import http from './utils/http'
import { isValidSN } from './utils/validators'
import logger from './utils/logger'

const { createBoundDeviceSet } = require('./utils/boundDeviceSet')
const { createAuthNavigation } = require('./utils/authNavigation')
const { createAuthTransport } = require('./utils/authTransport')
const { createWxStorageAdapter, createWxNavigationAdapter } = require('./utils/authAdapters')

App({
  globalData: {
    userInfo: null,
    loginToken: '',
    hasBaseLogin: false,
    boundDevices: [],
    selectedDeviceSn: '',
    alarmTemplateId: 'LmNsyQCK_araAosSu9UKOyQKnjNMIB1xLU0qGxqIx4o',
    pendingSN: ''
  },

  onLaunch(options) {
    try {
      const { envVersion } = wx.getAccountInfoSync().miniProgram
      logger.configure({ minLevel: envVersion === 'release' ? 'info' : 'debug' })
    } catch (error) {
      logger.warn('无法读取运行环境，使用默认日志级别', { error })
    }
    logger.info('小程序启动')

    const storage = createWxStorageAdapter(wx)
    this.boundDeviceSet = createBoundDeviceSet(storage)
    this.authNavigation = createAuthNavigation({
      storage,
      transport: createAuthTransport(http),
      navigation: createWxNavigationAdapter(wx, () => getCurrentPages()),
      boundDeviceSet: this.boundDeviceSet,
      onStateChange: state => {
        this.globalData.loginToken = state.loginToken
        this.globalData.hasBaseLogin = state.isLoggedIn
        this.globalData.userInfo = state.profile
        this.globalData.boundDevices = state.devices
        this.globalData.selectedDeviceSn = state.selectedDeviceSn
      }
    })
    this.syncBoundDeviceState()

    // options.scene 是微信入口场景值；设备参数位于 options.query.scene。
    const encodedSN = options && options.query && options.query.scene
    if (encodedSN) {
      try {
        const sn = decodeURIComponent(encodedSN).trim().toUpperCase()
        if (isValidSN(sn)) this.globalData.pendingSN = sn
      } catch (err) {
        logger.warn('设备场景参数解析失败', { error: err })
      }
    }
  },

  onError(error) {
    logger.error('小程序运行异常', { error })
  },

  onUnhandledRejection(event) {
    logger.error('未处理的 Promise 异常', { reason: event && event.reason })
  },

  syncBoundDeviceState() {
    const devices = this.boundDeviceSet.list()
    this.globalData.boundDevices = devices
    this.globalData.selectedDeviceSn = this.boundDeviceSet.selectedDeviceSn()
  },

  getLoginToken() {
    return this.globalData.loginToken
  },

  listBoundDevices() {
    return this.boundDeviceSet.list()
  },

  bindDevice(sn, name = '') {
    const device = this.boundDeviceSet.bind({ sn, name })
    this.syncBoundDeviceState()
    return device
  },

  selectDevice(sn) {
    const selected = this.boundDeviceSet.select(sn)
    if (selected) this.syncBoundDeviceState()
    return selected
  },

  getDevice(sn) {
    return this.boundDeviceSet.get(sn)
  },

  renameDevice(sn, name) {
    const renamed = this.boundDeviceSet.rename(sn, name)
    if (renamed) this.syncBoundDeviceState()
    return renamed
  },

  removeLocalDevice(sn) {
    const removed = this.boundDeviceSet.remove(sn)
    if (removed) this.syncBoundDeviceState()
    return removed
  },

  clearAuthState() {
    if (this.authNavigation) this.authNavigation.invalidate('login')
    this.globalData.pendingSN = ''
  }
})
