const { miniProgram } = wx.getAccountInfoSync()
const { envVersion } = miniProgram

// 微信开发者工具中的开发版可以访问本机；真机调试时请改为同一局域网内可访问的地址。
// 体验版和正式版必须使用已在微信公众平台登记的 HTTPS 合法域名。
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
