// app.js
import './utils/extendApi'
import http from './utils/http'
import { isValidSN } from './utils/validators'
import logger from './utils/logger'

const { deviceRepository } = require('./utils/deviceRepository')
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
        if (state.loginToken !== this.globalData.loginToken) {
          this.bindingRevision = (this.bindingRevision || 0) + 1
        }
        deviceRepository.syncSession(state.loginToken, state.devices)
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
    deviceRepository.syncSession(this.getLoginToken(), devices)
    this.globalData.boundDevices = devices
    this.globalData.selectedDeviceSn = this.boundDeviceSet.selectedDeviceSn()
  },

  getLoginToken() {
    return this.globalData.loginToken
  },

  listBoundDevices() {
    return this.boundDeviceSet.list()
  },

  refreshBoundDevices() {
    const token = this.getLoginToken()
    if (!token) return Promise.reject({ code: 401, msg: '登录状态已失效' })
    const revision = this.bindingRevision || 0
    const pending = this.boundDevicesRefresh
    if (pending && pending.token === token && pending.revision === revision) return pending.task
    const isCurrent = () => token === this.getLoginToken() && revision === (this.bindingRevision || 0)
    const task = (async () => {
      try {
        // No deviceId: query the authoritative membership, not one cached device's status.
        const response = await http.get('/user/bind/status', {}, {
          credentialScope: 'login', credential: token, invalidateOn401: false
        })
        if (!isCurrent()) throw { code: 'STALE_DEVICE_REQUEST' }
        if (response.code !== 1 || !Array.isArray(response.data) ||
            !response.data.every(sn => typeof sn === 'string' && isValidSN(sn))) {
          throw { msg: '关联设备列表返回异常，请重试' }
        }
        this.boundDeviceSet.reconcile(response.data)
        this.syncBoundDeviceState()
        return this.listBoundDevices()
      } catch (error) {
        if (!isCurrent()) throw { code: 'STALE_DEVICE_REQUEST' }
        if (error && error.code === 401) this.authNavigation.invalidate('login')
        throw error
      }
    })()
    this.boundDevicesRefresh = { token, revision, task }
    const release = () => {
      if (this.boundDevicesRefresh?.task === task) this.boundDevicesRefresh = null
    }
    task.then(release, release)
    return task
  },

  bindDevice(sn, name = '') {
    this.bindingRevision = (this.bindingRevision || 0) + 1
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
    if (renamed) {
      const token = this.getLoginToken()
      const cached = deviceRepository.peek(token, sn, 'status')
      if (cached && cached.value.name !== name) deviceRepository.patch(token, sn, 'status', { name })
      this.syncBoundDeviceState()
    }
    return renamed
  },

  removeLocalDevice(sn) {
    this.bindingRevision = (this.bindingRevision || 0) + 1
    const removed = this.boundDeviceSet.remove(sn)
    if (removed) this.syncBoundDeviceState()
    return removed
  },

  clearAuthState() {
    if (this.authNavigation) this.authNavigation.invalidate('login')
    this.globalData.pendingSN = ''
  }
})
