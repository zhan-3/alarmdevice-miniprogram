const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const qrcode = require('qrcode')
const app = express()

app.disable('x-powered-by')
app.use(cors())
app.use(express.json())

const publicDir = path.join(__dirname, 'public')
app.use(express.static(publicDir, {
  extensions: ['html'],
  maxAge: '1h'
}))

const audioDir = path.join(__dirname, 'audio')
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir)

const imagesDir = path.join(__dirname, '..', 'images')
if (!fs.existsSync(imagesDir)) {
  console.warn('[warn] images directory not found:', imagesDir)
} else {
  app.use('/images', express.static(imagesDir))
}

app.use('/audio', express.static(audioDir))

app.get('/audio/generate', (req, res) => {
  const { count = 5 } = req.query
  const urls = []
  for (let i = 1; i <= count; i++) {
    const filename = `record_${i}.mp3`
    urls.push(`http://localhost:8080/audio/${filename}`)
  }
  res.json({ code: 1, data: urls })
})

const PORT = Number(process.env.PORT) || 8080
let requestLog = []

function log(req, res, code) {
  requestLog.unshift({
    time: new Date().toISOString().slice(11, 19),
    method: req.method,
    url: req.url,
    code,
    body: JSON.stringify(req.body).slice(0, 80)
  })
  if (requestLog.length > 100) requestLog.pop()
  console.log(`[${req.method}] ${req.url} -> ${code}`)
}

const response = (res, code, msg, data) => res.json({ code, msg, data })

const DB = {
  users: new Map(),
  devices: new Map(),
  phoneNumbers: new Map(),
  contacts: new Map(),
  records: new Map(),
  settings: new Map()
}

const initData = () => {
  const sn = 'SA100-2024-A7B3C9D1'
  DB.devices.set(sn, {
    id: sn, sn, name: '智能烟雾报警器 A1', status: 'normal',
    latitude: 39.9042, longitude: 116.4074,
    address: '北京市朝阳区建国路88号'
  })
  DB.contacts.set(sn, [
    { phone: '15053957932' },
    { phone: '18105487580' },
    { phone: '19819692340' }
  ])
  DB.phoneNumbers.set('default', ['13812345678', '13988776655'])
  DB.settings.set(sn, {
    autoRecord: true, qualityIndex: 1, dayIndex: 1,
    alarmPush: true, alarmSound: true, disconnectWarn: true
  })
  DB.records.set(sn, [
    'http://localhost:8080/audio/test1.mp3',
    'http://localhost:8080/audio/test2.mp3'
  ])
}
initData()

function getUserToken(authHeader) {
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  if (token.startsWith('mock_user_') || token.startsWith('device_token_')) return token
  return null
}

function getAuthToken(authHeader) {
  if (!authHeader) return null
  return authHeader.replace('Bearer ', '')
}

function getDeviceSnFromToken(authHeader) {
  const token = getAuthToken(authHeader)
  if (!token) return null
  for (const [sn, d] of DB.devices) {
    if (d.token === token) return sn
  }
  return null
}

app.post('/system/log', (req, res) => {
  const { code } = req.body
  if (!code) {
    log(req, res, 0)
    return response(res, 0, '微信信息错误，登录失败', null)
  }
  const token = 'mock_user_' + Date.now()
  DB.users.set(token, { id: token, phone: null, devices: [] })
  log(req, res, 1)
  response(res, 1, 'success', token)
})

app.post('/user/bind/device', (req, res) => {
  const auth = req.headers.authorization
  const token = getUserToken(auth)
  const user = token ? DB.users.get(token) : null
  
  if (!user) {
    log(req, res, 0)
    return response(res, 0, '请先绑定手机号', null)
  }

  const deviceSn = req.body.deviceSn || req.query.deviceSn
  const name = req.body.name || req.query.name
  if (!deviceSn) {
    log(req, res, 0)
    return response(res, 0, '设备序列号不能为空', null)
  }

  const deviceToken = 'device_token_' + Date.now() + '_' + deviceSn
  DB.devices.set(deviceSn, {
    id: deviceSn, sn: deviceSn, name: name || deviceSn, status: 'normal',
    latitude: 39.9042, longitude: 116.4074,
    address: '北京市朝阳区建国路88号',
    token: deviceToken
  })

  user.devices = user.devices || []
  user.devices.push(deviceSn)
  DB.users.set(token, user)

  log(req, res, 1)
  response(res, 1, 'success', deviceToken)
})

app.post('/user/bind/userDeviceLogin', (req, res) => {
  const auth = req.headers.authorization
  const token = getUserToken(auth)
  const user = token ? DB.users.get(token) : null

  if (!user) {
    log(req, res, 0)
    return response(res, 0, '请先绑定手机号', null)
  }

  const deviceSn = req.query.deviceSn || req.body.deviceSn
  if (!deviceSn) {
    log(req, res, 0)
    return response(res, 0, '设备序列号不能为空', null)
  }

  const device = DB.devices.get(deviceSn)
  if (!device) {
    log(req, res, 0)
    return response(res, 0, '该设备未绑定到您的账号', null)
  }

  const deviceToken = 'device_token_' + Date.now() + '_' + deviceSn
  device.token = deviceToken
  DB.devices.set(deviceSn, device)

  log(req, res, 1)
  response(res, 1, 'success', deviceToken)
})

app.get('/user/bind/status', (req, res) => {
  const auth = req.headers.authorization
  const token = getAuthToken(auth)
  const sn = req.query.deviceSn

  if (sn) {
    const d = DB.devices.get(sn)
    log(req, res, 1)
    response(res, 1, 'success', d ? { status: d.status } : { status: 'offline' })
  } else {
    const allSn = Array.from(DB.devices.keys())
    log(req, res, 1)
    response(res, 1, 'success', token ? (allSn.length > 0 ? allSn : '') : [])
  }
})

app.post('/user/userBindPhone', (req, res) => {
  const auth = req.headers.authorization
  const token = getUserToken(auth)
  const phone = req.query.phone || req.body.phone

  if (!phone) {
    log(req, res, 0)
    return response(res, 0, '手机号不能为空', null)
  }

  if (token) {
    const user = DB.users.get(token)
    if (user) {
      user.phone = phone
      DB.users.set(token, user)
    }
  }

  log(req, res, 1)
  response(res, 1, 'success', '绑定成功')
})

app.get('/user/getMainMessage', (req, res) => {
  const auth = req.headers.authorization
  const token = getUserToken(auth)
  const user = token ? DB.users.get(token) : null

  log(req, res, 1)
  response(res, 1, 'success', {
    nickName: user?.nickName || '',
    avatarUrl: user?.avatarUrl || '',
    phone: user?.phone || ''
  })
})

app.post('/user/getMessage', (req, res) => {
  const auth = req.headers.authorization
  const token = getUserToken(auth)
  const { avatarUrl, nickName } = req.body

  if (token) {
    const user = DB.users.get(token)
    if (user) {
      user.avatarUrl = avatarUrl
      user.nickName = nickName
      DB.users.set(token, user)
    }
  }

  log(req, res, 1)
  response(res, 1, 'success', '获取成功')
})

app.get('/user/showPhoneNumber', (req, res) => {
  const sn = getDeviceSnFromToken(req.headers.authorization)
  const phones = DB.phoneNumbers.get(sn || 'default') || []

  log(req, res, 1)
  response(res, 1, 'success', phones)
})

app.get('/user/getLocation', (req, res) => {
  const sn = req.query.deviceSn || getDeviceSnFromToken(req.headers.authorization)
  const d = DB.devices.get(sn) || DB.devices.values().next().value

  if (d) {
    log(req, res, 1)
    response(res, 1, 'success', { gpsLng: d.longitude, gpsLat: d.latitude, address: d.address })
  } else {
    log(req, res, 1)
    response(res, 1, 'success', { gpsLng: '116.4074', gpsLat: '39.9042', address: '未知' })
  }
})

app.get('/user/getInstallLocation', (req, res) => {
  const sn = req.query.deviceSn || getDeviceSnFromToken(req.headers.authorization)
  const d = DB.devices.get(sn) || DB.devices.values().next().value

  if (d) {
    log(req, res, 1)
    response(res, 1, 'success', { gpsLng: d.longitude, gpsLat: d.latitude, address: d.address })
  } else {
    log(req, res, 1)
    response(res, 1, 'success', { gpsLng: '116.4074', gpsLat: '39.9042', address: '未知' })
  }
})

app.get('/user/userGetPhone', (req, res) => {
  const sn = req.query.deviceSn || getDeviceSnFromToken(req.headers.authorization)
  const contacts = DB.contacts.get(sn) || []

  log(req, res, 1)
  response(res, 1, 'success', contacts)
})

app.post('/user/addPhoneNumber', (req, res) => {
  const sn = getDeviceSnFromToken(req.headers.authorization)
  const { number, name } = req.query

  if (number && sn) {
    const contacts = DB.contacts.get(sn) || []
    contacts.push({ phone: number, name: name || '' })
    DB.contacts.set(sn, contacts)
  }

  log(req, res, 1)
  response(res, 1, 'success', null)
})

app.delete('/user/deletePhone', (req, res) => {
  const sn = getDeviceSnFromToken(req.headers.authorization)
  const number = req.query.number

  if (number && sn) {
    const contacts = DB.contacts.get(sn) || []
    const idx = contacts.findIndex(c => c.phone === number)
    if (idx >= 0) {
      contacts.splice(idx, 1)
      DB.contacts.set(sn, contacts)
    }
  }

  log(req, res, 1)
  response(res, 1, 'success', '已成功删除')
})

app.get('/user/getRecord', (req, res) => {
  const sn = req.query.deviceSn || getDeviceSnFromToken(req.headers.authorization)
  const records = DB.records.get(sn) || DB.records.values().next().value || []

  log(req, res, 1)
  response(res, 1, 'success', records)
})

app.get('/setting/list', (req, res) => {
  const sn = req.query.deviceSn || getDeviceSnFromToken(req.headers.authorization)
  const settings = DB.settings.get(sn) || DB.settings.values().next().value

  log(req, res, 1)
  response(res, 1, 'success', settings)
})

app.post('/setting/update', (req, res) => {
  const sn = getDeviceSnFromToken(req.headers.authorization)
  const settings = req.body

  if (sn && settings) {
    DB.settings.set(sn, settings)
  }

  log(req, res, 1)
  response(res, 1, 'success', '设置成功')
})

app.post('/device/bind', (req, res) => {
  const { sn, name } = req.body
  const deviceToken = 'device_token_' + Date.now()

  DB.devices.set(sn, {
    id: sn, sn, name: name || sn, status: 'normal',
    latitude: 39.9042, longitude: 116.4074,
    address: '北京市朝阳区建国路88号',
    token: deviceToken
  })

  log(req, res, 1)
  response(res, 1, 'success', { token: deviceToken })
})

app.delete('/device/unbind/:sn', (req, res) => {
  const { sn } = req.params
  DB.devices.delete(sn)
  DB.contacts.delete(sn)
  DB.records.delete(sn)
  DB.settings.delete(sn)

  log(req, res, 1)
  response(res, 1, 'success', '已解绑')
})

app.post('/device/updateLocation', (req, res) => {
  const sn = req.body.deviceSn
  const { latitude, longitude, address } = req.body

  const d = DB.devices.get(sn)
  if (d) {
    if (latitude) d.latitude = latitude
    if (longitude) d.longitude = longitude
    if (address) d.address = address
    DB.devices.set(sn, d)
  }

  log(req, res, 1)
  response(res, 1, 'success', '位置已更新')
})

app.get('/logs', (req, res) => {
  response(res, 1, 'success', requestLog)
})

app.get('/qrcode/:sn', async (req, res) => {
  try {
    const png = await qrcode.toBuffer(req.params.sn, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    })
    res.set('Content-Type', 'image/png')
    res.send(png)
  } catch (e) {
    response(res, 0, '生成二维码失败', null)
  }
})

app.post('/debug/reset', (req, res) => {
  const { scenario, sn } = req.body
  const targetSn = sn || Array.from(DB.devices.keys())[0]
  const d = DB.devices.get(targetSn)

  if (d && scenario) {
    d.status = scenario
    DB.devices.set(targetSn, d)
  }

  log(req, res, 1)
  response(res, 1, 'success', { scenario, sn: targetSn })
})

app.post('/debug/clear', (req, res) => {
  requestLog = []
  log(req, res, 1)
  response(res, 1, 'success', '已清空')
})

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║  Mock Server running on http://localhost:${PORT}                       ║
╠═══════════════════════════════════════════════════════════════════╣
║  系统接口                                                   ║
║    POST /system/log                    - 微信登录              ║
╠═══════════════════════════════════════════════════════════════════╣
║  绑定接口                                                   ║
║    POST /user/bind/device              - 绑定设备              ║
║    POST /user/bind/userDeviceLogin     - 设备登录              ║
║    GET  /user/bind/status             - 绑定状态              ║
║    POST /user/userBindPhone           - 绑定手机号            ║
╠═══════════════════════════════════════════════════════════════════╣
║  用户接口                                                   ║
║    GET  /user/getMainMessage          - 用户信息              ║
║    POST /user/getMessage             - 保存用户信息          ║
║    GET  /user/showPhoneNumber        - 手机号列表          ║
║    GET  /user/getLocation           - 位置信息             ║
║    GET  /user/userGetPhone           - 紧急联系人            ║
║    POST /user/addPhoneNumber         - 添加联系人           ║
║    DELETE /user/deletePhone          - 删除联系人           ║
║    GET  /user/getRecord              - 录音记录             ║
╠═══════════════════════════════════════════════════════════════════╣
║  设置接口                                                   ║
║    GET  /setting/list                - 设置列表              ║
║    POST /setting/update             - 更新设置              ║
╠═══════════════════════════════════════════════════════════════════╣
║  工具接口                                                   ║
║    GET  /qrcode/:sn                 - 生成设备二维码（PNG）   ║
╠═══════════════════════════════════════════════════════════════════╣
║  调试接口                                                   ║
║    GET  /logs                       - 请求日志              ║
║    POST /debug/reset                - 重置场景              ║
║    POST /debug/clear                - 清空日志              ║
╚═══════════════════════════════════════════════════════════════════╝
  `)
})