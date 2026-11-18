const { miniProgram } = wx.getAccountInfoSync()
const { envVersion } = miniProgram

// 2026-11-18 经用户确认，开发版临时连接生产，用于恢复后的联调。
// 登录、设备与报警读取均访问真实数据；不要随意确认报警、修改绑定或试发通知。
// 恢复隔离开发时将 develop 改为 http://127.0.0.1:8080；上传/发布仍须单独确认。
const API_BASE_URLS = Object.freeze({
  develop: 'https://bridgemonitor.xyz',
  trial: 'https://bridgemonitor.xyz',
  release: 'https://bridgemonitor.xyz'
})

function resolveBaseURL(version) {
  const baseURL = API_BASE_URLS[version]
  if (!baseURL) {
    throw new Error(`未配置 ${version} 环境的后端 API 地址`)
  }
  if (version !== 'develop' && !baseURL.startsWith('https://')) {
    throw new Error(`${version} 环境的后端 API 地址必须使用 HTTPS`)
  }
  return baseURL.replace(/\/$/, '')
}

const env = Object.freeze({
  version: envVersion,
  baseURL: resolveBaseURL(envVersion)
})

export { env }
