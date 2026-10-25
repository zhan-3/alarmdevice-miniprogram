// utils/http.js
import { env } from './env'
import logger from './logger'

const { classifyAuthResponse } = require('./httpPolicy')

let requestSequence = 0

function isValidToken(token) {
  if (!token || typeof token !== 'string') return false
  return !/[\u4e00-\u9fa5]/.test(token)
}

function invalidateCredential() {
  const app = getApp()
  if (app.authNavigation) app.authNavigation.invalidate('login')
}

function request({
  url,
  method = 'GET',
  data = {},
  headers = {},
  credentialScope = 'none',
  credential = '',
  deviceId = '',
  invalidateOn401 = true,
  allowDeviceRequired = false,
  retryCount = 0
}) {
  return new Promise((resolve, reject) => {
    const requestId = ++requestSequence
    const startedAt = Date.now()
    // 日志只记录接口路径，避免查询参数中的手机号等隐私数据泄露。
    const requestPath = String(url).split('?')[0]
    const app = getApp()
    const authCredential = credential || (credentialScope !== 'none' ? app.getLoginToken() : '')
    logger.info('请求开始', { requestId, method, url: requestPath, credentialScope })

    if (credentialScope !== 'none' && !isValidToken(authCredential)) {
      logger.error('凭证格式无效', { requestId, url: requestPath, credentialScope })
      if (invalidateOn401) invalidateCredential()
      reject({ code: 401, msg: '无效token', credentialScope })
      return
    }

    const fullUrl = env.baseURL + url
    wx.request({
      url: fullUrl,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...headers,
        ...(authCredential ? { Authorization: `Bearer ${authCredential}` } : {})
      },
      timeout: 15000,
      success(res) {
        const { statusCode, data: responseData } = res
        const authResponse = classifyAuthResponse(statusCode, credentialScope, allowDeviceRequired)
        if (authResponse.type === 'credential-invalid') {
          logger.warn('凭证已失效', {
            requestId,
            url: requestPath,
            statusCode,
            credentialScope,
            durationMs: Date.now() - startedAt
          })
          if (invalidateOn401) invalidateCredential()
          reject({ code: 401, msg: '请提供有效的token', credentialScope })
          return
        }

        if (authResponse.type === 'device-required') {
          logger.warn('请求缺少设备权限', { requestId, url: requestPath, statusCode, durationMs: Date.now() - startedAt })
          if (deviceId && invalidateOn401 && app.authNavigation) {
            app.authNavigation.invalidate({ type: 'device', sn: deviceId })
          }
          reject({ code: 403, msg: (responseData && (responseData.msg || responseData.message)) || '设备访问权限已失效' })
          return
        }

        if (statusCode < 200 || statusCode >= 300) {
          const message = (responseData && (responseData.msg || responseData.message)) || `服务异常（${statusCode}）`
          wx.toast({ title: message, icon: 'none' })
          logger.error('HTTP 请求失败', { requestId, url: requestPath, statusCode, durationMs: Date.now() - startedAt, message })
          reject({ code: statusCode, msg: message, data: responseData, userNotified: true })
          return
        }

        if (!responseData || typeof responseData.code === 'undefined') {
          wx.toast({ title: '返回数据异常', icon: 'error' })
          logger.error('接口返回格式异常', { requestId, url: requestPath, statusCode, durationMs: Date.now() - startedAt })
          reject({ ...res, userNotified: true })
          return
        }

        if (responseData.code === 1) {
          logger.info('请求成功', { requestId, url: requestPath, statusCode, durationMs: Date.now() - startedAt })
          resolve(responseData)
          return
        }

        wx.toast({
          title: responseData.msg || responseData.message || '请求失败',
          icon: 'error'
        })
        logger.warn('业务请求失败', {
          requestId,
          url: requestPath,
          statusCode,
          durationMs: Date.now() - startedAt,
          code: responseData.code,
          message: responseData.msg || responseData.message
        })
        reject({ ...responseData, userNotified: true })
      },
      fail(err) {
        // 只重试幂等查询，绝不自动重试 POST/DELETE，避免重复写入。
        if (method === 'GET' && retryCount < 1) {
          logger.warn('GET 请求失败，准备重试', {
            requestId,
            url: requestPath,
            retryCount: retryCount + 1,
            error: err
          })
          setTimeout(() => {
            request({
              url,
              method,
              data,
              headers,
              credentialScope,
              credential,
              deviceId,
              invalidateOn401,
              allowDeviceRequired,
              retryCount: retryCount + 1
            }).then(resolve).catch(reject)
          }, 300)
          return
        }

        const isTimeout = err && err.errMsg && err.errMsg.includes('timeout')
        const message = isTimeout ? '请求超时，请重试' : '网络连接失败，请检查网络'
        wx.toast({ title: message, icon: 'none' })
        logger.error('网络请求失败', {
          requestId,
          url: requestPath,
          durationMs: Date.now() - startedAt,
          retryCount,
          error: err,
          message
        })
        reject({ ...err, code: -1, msg: message, userNotified: true })
      }
    })
  })
}

export default {
  get(url, data = {}, options = {}) {
    return request({ url, method: 'GET', data, ...options })
  },
  post(url, data = {}, options = {}) {
    return request({ url, method: 'POST', data, ...options })
  },
  publicPost(url, data, headers = {}) {
    return request({ url, method: 'POST', data, headers, credentialScope: 'none' })
  },
  delete(url, data = {}, options = {}) {
    return request({ url, method: 'DELETE', data, ...options })
  }
}
