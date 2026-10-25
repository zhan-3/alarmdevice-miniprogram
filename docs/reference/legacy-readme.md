# 历史 README 与接口参考（归档）

> 本文件保留原 README，包含旧手机号绑定、旧凭证术语及过时环境地址，不代表当前接口契约。当前入口见 [README](../../README.md)，接口以 [alarmdevice 后端](https://github.com/zhan-3/alarmdevice) 为准。

# 报警设备管理系统 — 微信小程序

## 项目结构

```
miniprogram-11-终版/
├── app.js                      # 全局入口：globalData（登录凭证/已绑定设备集）、setLoginToken/selectDevice
├── app.json                    # 页面注册、窗口配置、权限声明、lazyCodeLoading按需注入
├── app.wxss                    # 全局样式：CSS变量（橙色主色调）、button重置
├── DEVLOG.md                   # 开发日志（问题背景/方案演进/改动记录）
├── README.md                   # 项目说明 + 后端接口文档
├── package.json                # npm依赖管理（目前无运行时依赖）
│
├── pages/                      # 页面层（每个页面4文件：js/wxml/wxss/json）
│   ├── home/                   # 首页 — 设备列表总览
│   │   ├── home.js             #   并行轮询设备状态（Promise.allSettled/15s间隔）
│   │   │                      #   下拉刷新、加载状态、登录态检查、用户信息缓存
│   │   ├── home.wxml           #   设备卡片列表、未登录/未绑定引导、加载spinner
│   │   ├── home.wxss           #   设备卡片、spinner动画、空状态样式
│   │   └── home.json           #   white-card组件、下拉刷新启用
│   │
│   ├── login/                  # 登录页 — 微信登录 + 手机号绑定
│   │   ├── login.js            #   doLogin（wx.login→/system/log）→ confirmPhone
│   │   ├── login.wxml          #   两步：微信登录按钮 → 手机号输入表单
│   │   ├── login.wxss          #   居中布局、表单样式
│   │   └── login.json          #   无组件依赖
│   │
│   ├── devicebinding/          # 设备绑定页 — 扫码/手动输入SN绑定
│   │   ├── devicebinding.js    #   scanBind/confirmBind/autoBind → POST /user/bind/device
│   │   ├── devicebinding.wxml  #   扫码按钮、手动输入弹窗
│   │   ├── devicebinding.wxss  #   绑定页样式
│   │   └── devicebinding.json  #   无组件依赖
│   │
│   ├── device-detail/          # 设备详情页 — 位置/联系人/事件
│   │   ├── device-detail.js    #   loadDeviceFromAPI + loadDeviceContacts + 加载状态
│   │   ├── device-detail.wxml  #   white-card包裹联系人列表、GPS地图、加载spinner
│   │   ├── device-detail.wxss  #   联系人卡片、spinner样式
│   │   └── device-detail.json  #   white-card组件
│   │
│   ├── setting/                # 设置页 — 个人资料/设备设置/录音配置
│   │   ├── setting.js          #   头像昵称编辑、手机号绑定、设备位置选择、设置项存储
│   │   ├── setting.wxml        #   多个white-card模块：个人资料/位置/设备信息/录音/报警
│   │   ├── setting.wxss        #   设置模块卡片样式
│   │   └── setting.json        #   white-card + custom-button组件
│   │
│   ├── audio/                  # 录音列表页 — 报警录音播放管理
│   │   ├── audio.js            #   轮询录音列表（脏检查）、音频播放控制（InnerAudioContext）
│   │   ├── audio.wxml          #   录音项列表、播放进度、长按删除/收藏
│   │   ├── audio.wxss          #   播放器界面样式
│   │   └── audio.json          #   无组件依赖
│   │
│
├── components/                 # 自定义组件层
│   ├── white-card/             # 白色卡片容器 — 被 pages/home / device-detail / setting 共用
│   │   ├── white-card.js
│   │   ├── white-card.wxml     #   title/rightContent/footer 插槽
│   │   ├── white-card.wxss     #   圆角阴影卡片
│   │   └── white-card.json
│   │
│   └── custom-button/          # 自定义按钮 — 仅 setting 页使用（3处）
│       ├── custom-button.js    #   type/size/disabled 属性
│       ├── custom-button.wxml
│       ├── custom-button.wxss  #   橙色主色调按钮样式
│       └── custom-button.json
│
├── utils/                      # 工具层
│   ├── http.js                 # HTTP请求封装：wx.request统一拦截、401/403处理、登录凭证注入
│   ├── storage.js              # 存储封装：wx.get/set/remove/clearStorageSync + try/catch
│   ├── env.js                  # 环境配置：baseURL（develop/trial/release三环境智能切换）
│   ├── boundDeviceSet.js       # 已绑定设备集：凭证、选择和旧缓存迁移
│   ├── loginCredential.js      # 登录凭证：用户级凭证读写
│   ├── deviceService.js        # 设备数据服务：loadDeviceData / loadDeviceContacts / buildMarkers
│   ├── constants.js            # 常量：DEVICE_STATUS_MAP（状态映射）、DEVICE_TYPE_MAP（SN前缀）
│   ├── validators.js           # 验证函数：isValidPhone / isValidSN
│   └── extendApi.js            # WeChat API扩展：wx.toast / wx.modal Promise封装
│
├── images/                     # 静态资源
│   ├── home.png                          # 首页图标（已删除未使用的 active 态）
│   ├── map.png                           # 地图图标（已删除未使用的 active 态）
│   ├── marker.png                        # 地图标记
│   ├── avatar.png                        # 默认头像
│   ├── setting.png / navigator.png       # 设置/导航图标
│   ├── voice.png                         # 音频状态图标（已删除未使用的 noaudio）
│   ├── play.png / pause.png / next.png / last.png  # 播放控制
│   │                                      #（已删除未使用的 audio-* 系列图标，audio 页使用 emoji）
│
├── server/                     # Mock后端服务（Express）
│   ├── app.js                  # 完整Mock后端：登录/绑定/联系人/位置/录音/调试接口
│   ├── package.json
│   ├── audio/                  # 测试音频文件（.mp3）
│   └── miniprogram_npm/        # 服务端依赖
│
└── project.config.json         # 微信开发者工具配置（含AppID）
```

## 关键流程

```
登录: 打开首页 → onShow检查token/手机号 → 无token → login页
      → doLogin (wx.login → POST /system/log → 保存登录凭证)
      → confirmPhone (POST /user/userBindPhone) → reLaunch首页

绑定: 扫码 → devicebinding页 → checkLoginStatus
      → 未登录 → login页 → 登录完成 → redirect回devicebinding
      → autoBindDevice → POST /user/bind/device → 首页

轮询: 首页onShow → loadAllDevices（Promise.allSettled并行）
      → startPolling（setInterval 15s）
      → onHide/onUnload → clearInterval
```

## 组件注册关系

| 页面 | 注册组件 | 用途 |
|------|---------|------|
| home | white-card | 设备列表卡片容器 |
| device-detail | white-card | 联系人卡片容器 |
| setting | white-card, custom-button | 设置模块卡片 + 操作按钮 |
| login/audio/devicebinding | 无 | 纯原生组件 |

## 已完成的优化（2026-06-13）

详见 [DEVLOG.md](./DEVLOG.md) 中 `2026-06-13` 条目。

---

# 报警设备后端接口文档

## 目录
- [概述](#概述)
- [认证机制](#认证机制)
- [系统接口](#系统接口)
- [绑定接口](#绑定接口)
- [用户接口](#用户接口)
- [响应格式](#响应格式)
- [错误码](#错误码)

---

## 概述

本系统为报警设备管理系统，提供用户登录、设备绑定、报警数据管理、紧急联系人管理等功能。系统采用JWT Token进行身份验证，支持微信小程序客户端和设备端两种接入方式。

---

## 认证机制

### Token说明

系统使用JWT Token进行身份验证，Token包含以下信息：

| 字段 | 说明 | 权限 |
|------|------|------|
| id | 用户ID | 必需 |
| deviceId | 设备ID | 绑定设备后包含 |

### 权限说明

- **初始Token**（仅含userId）：可访问 `/user/bind/*`、`/user/getMessage`、`/user/getMainMessage`、`/user/userBindPhone`
- **完整Token**（含userId+deviceId）：可访问所有 `/user/*` 接口
- **无Token或无效Token**：返回401
- **未绑定设备但访问受限接口**：返回403

### 请求头格式

```
Authorization: Bearer <token>
```

---

## 系统接口

### 1. 微信登录

- **接口地址**: `POST /system/log`
- **接口说明**: 通过微信登录验证，获取用户身份token。新用户会自动创建账户。
- **是否需要Token**: 否

**请求体 (JSON)**:
```json
{
  "code": "微信小程序登录时获取的code"
}
```

**参数说明**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| code | String | 是 | 微信小程序登录时获取的code，用于换取用户身份 |

**成功响应**:
```json
{
  "code": 1,
  "msg": "success",
  "data": "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MSwiZXhwIjoxNzM2MzY0MDAwfQ.xxxxxx"
}
```

**返回参数说明**:
| 参数名 | 类型 | 说明 |
|--------|------|------|
| data | String | JWT token（仅含userId），用于后续绑定设备接口 |

**失败响应**:
```json
{
  "code": 0,
  "msg": "微信信息错误，登录失败",
  "data": null
}
```

---

---

## 绑定接口

> ⚠️ 重要：以下接口需要初始token（未绑定设备的token）

### 1. 绑定设备

- **接口地址**: `POST /user/bind/device`
- **接口说明**: 将报警设备与当前用户绑定。绑定成功后系统会返回新的token（包含deviceId）。
- **需要Token**: 是（初始token）

**请求头**:
```
Authorization: Bearer <初始token>
```

**请求参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| deviceSn | String | 是 | 设备序列号 |

**成功响应**:
```json
{
  "code": 1,
  "msg": "success",
  "data": "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MSwiZGV2aWNlSWQiOiJEVklDRTAwMSJ9.xxxxxx"
}
```

**失败响应**:
```json
{
  "code": 0,
  "msg": "请先绑定手机号",
  "data": null
}
```
或
```json
{
  "code": 0,
  "msg": "该设备已被其他用户绑定",
  "data": null
}
```

---

### 2. 设备登录

- **接口地址**: `POST /user/bind/userDeviceLogin`
- **接口说明**: 用户已绑定设备后，用初始token换取包含deviceId的完整token。
- **需要Token**: 是（初始token）

**请求头**:
```
Authorization: Bearer <初始token>
```

**请求参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| deviceSn | String | 是 | 设备序列号 |

**成功响应**:
```json
{
  "code": 1,
  "msg": "success",
  "data": "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MSwiZGV2aWNlSWQiOiJEVklDRTAwMSJ9.xxxxxx"
}
```

**失败响应**:
```json
{
  "code": 0,
  "msg": "请先绑定手机号",
  "data": null
}
```
或
```json
{
  "code": 0,
  "msg": "该设备未绑定到您的账号",
  "data": null
}
```

---

### 3. 获取绑定状态

- **接口地址**: `GET /user/bind/status`
- **接口说明**: 查询当前用户的设备绑定状态，用于判断是否已完成设备绑定。
- **需要Token**: 是

**请求头**:
```
Authorization: Bearer <token>
```

**请求参数**: 无

**成功响应（已绑定）**:
```json
{
  "code": 1,
  "msg": "success",
  "data": ["DEVICE001", "DEVICE002"]
}
```

**成功响应（未绑定）**:
```json
{
  "code": 1,
  "msg": "success",
  "data": ""
}
```

---

## 用户接口

> ⚠️ 重要：除 `/user/getMessage`、`/user/getMainMessage`、`/user/userBindPhone` 外，其他接口都需要已完成设备绑定的token（包含deviceId）

### 1. 获取录音记录

- **接口地址**: `GET /user/getRecord`
- **接口说明**: 获取当前用户绑定的设备产生的所有报警录音文件URL列表。
- **需要Token**: 是（完整token）

**请求头**:
```
Authorization: Bearer <完整token>
```

**请求参数**: 无

**成功响应**:
```json
{
  "code": 1,
  "msg": "success",
  "data": [
  "http://localhost:8080/audio/aaaaa.mp3",
  "http://localhost:8080/audio/bbbbb.mp3"
  ]
}
```

---

### 2. 获取位置信息

- **接口地址**: `GET /user/getLocation`
- **接口说明**: 获取当前用户绑定的设备最近一次报警时的GPS经纬度坐标。
- **需要Token**: 是（完整token）

**请求头**:
```
Authorization: Bearer <完整token>
```

**请求参数**: 无

**成功响应**:
```json
{
  "code": 1,
  "msg": "success",
  "data": {
    "gpsLng": "116.397428",
    "gpsLat": "39.90923"
  }
}
```

**参数说明**:
| 参数名 | 类型 | 说明 |
|--------|------|------|
| gpsLng | String/Decimal | GPS经度 |
| gpsLat | String/Decimal | GPS纬度 |

---

### 3. 添加紧急联系人

- **接口地址**: `POST /user/addPhoneNumber`
- **接口说明**: 添加紧急联系人手机号，报警时会自动呼叫这些号码。
- **需要Token**: 是（完整token）

**请求头**:
```
Authorization: Bearer <完整token>
```

**请求参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| number | String | 是 | 手机号码 |
| name | String | 是 | 联系人姓名 |

**成功响应**:
```json
{
  "code": 1,
  "msg": "success",
  "data": null
}
```

---

### 4. 删除紧急联系人

- **接口地址**: `DELETE /user/deletePhone`
- **接口说明**: 删除指定的紧急联系人手机号，删除后该号码将不会收到报警呼叫。
- **需要Token**: 是（完整token）

**请求头**:
```
Authorization: Bearer <完整token>
```

**请求参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| number | String | 是 | 要删除的手机号码 |

**成功响应**:
```json
{
  "code": 1,
  "msg": "success",
  "data": "已成功删除"
}
```

**失败响应**:
```json
{
  "code": 0,
  "msg": "删除失败",
  "data": null
}
```

---

### 5. 获取所有紧急联系人

- **接口地址**: `GET /user/userGetPhone`
- **接口说明**: 获取当前用户的所有紧急联系人信息（包含姓名和电话）。
- **需要Token**: 是（完整token）

**请求头**:
```
Authorization: Bearer <完整token>
```

**成功响应**:
```json
{
  "code": 1,
  "msg": "success",
  "data": [
    {"名称": "张三", "手机号": "13800138000"},
    {"名称": "李四", "手机号": "13900139000"}
  ]
}
```

---

### 6. 获取手机号列表

- **接口地址**: `GET /user/showPhoneNumber`
- **接口说明**: 获取当前用户的手机号列表（仅号码）。
- **需要Token**: 是（完整token）

**请求头**:
```
Authorization: Bearer <完整token>
```

**成功响应**:
```json
{
  "code": 1,
  "msg": "success",
  "data": ["13800138000", "13900139000"]
}
```

---

### 7. 保存用户信息

- **接口地址**: `POST /user/getMessage`
- **接口说明**: 保存或更新用户的头像URL、昵称信息。
- **需要Token**: 是（初始token，无需绑定设备）

**请求头**:
```
Authorization: Bearer <初始token>
```

**请求体 (JSON)**:
```json
{
  "avatarUrl": "http://example.com/avatar.jpg",
  "nickName": "测试用户"
}
```

**参数说明**:

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| avatarUrl | String | 否 | 头像URL地址 |
| nickName | String | 否 | 用户昵称 |

**成功响应**:
```json
{
  "code": 1,
  "msg": "success",
  "data": "获取成功"
}
```

---

### 8. 获取用户主要信息

- **接口地址**: `GET /user/getMainMessage`
- **接口说明**: 获取当前用户的昵称、头像URL。
- **需要Token**: 是（初始token，无需绑定设备）

**请求头**:
```
Authorization: Bearer <初始token>
```

**请求参数**: 无

**成功响应**:
```json
{
  "code": 1,
  "msg": "success",
  "data": {
    "nickName": "测试用户",
    "avatarUrl": "http://example.com/avatar.jpg"
  }
}
```

**返回参数说明**:
| 参数名 | 类型 | 说明 |
|--------|------|------|
| nickName | String | 用户昵称 |
| avatarUrl | String | 头像URL地址 |

---

### 9. 绑定手机号

- **接口地址**: `POST /user/userBindPhone`
- **接口说明**: 将手机号与用户账户绑定，用于设备绑定验证。
- **需要Token**: 是（初始token，无需绑定设备）

**请求头**:
```
Authorization: Bearer <初始token>
```

**请求参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| phone | String | 是 | 手机号码 |

**成功响应**:
```json
{
  "code": 1,
  "msg": "success",
  "data": "绑定成功"
}
```

---

## 响应格式

### 成功响应
```json
{
  "code": 1,
  "msg": "success",
  "data": { ... }
}
```

### 失败响应
```json
{
  "code": 0,
  "msg": "错误信息",
  "data": null
}
```

### HTTP状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 401 | 未提供有效token |
| 403 | 已提供token但无权限（未绑定设备） |
| 500 | 服务器内部错误 |

---

## 错误码

| code | msg | 说明 |
|------|-----|------|
| 1 | success | 请求成功 |
| 0 | 错误信息 | 请求失败 |
| 401 | - | Token无效或未提供 |
| 403 | - | 无权限（未绑定设备时访问用户接口） |

---

## 完整使用流程

```
┌─────────────────────────────────────────────────────────────────┐
│ 步骤1: 微信登录                                                  │
│ POST /system/log                                                │
│ 请求: {"code": "微信code"}                                      │
│ 返回: {"data": "token_仅含userId"}                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 步骤2: 绑定手机号（可选，但绑定设备前需要）                       │
│ POST /user/userBindPhone                                        │
│ 请求: phone=13800138000                                         │
│ 返回: {"msg": "绑定成功"}                                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 步骤3: 绑定设备                                                  │
│ POST /user/bind/device                                          │
│ 请求: deviceSn=DEVICE001                                        │
│ 返回: {"data": "token_含userId+deviceId"}                       │
│                                                                  │
│ 或者使用:                                                        │
│ POST /user/bind/userDeviceLogin (已绑定过设备，直接登录)        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 步骤4: 正常使用（需要完整token）                                 │
│ - GET /user/getRecord      → 获取录音记录                       │
│ - GET /user/getLocation    → 获取GPS位置                        │
│ - POST /user/addPhoneNumber → 添加紧急联系人                    │
│ - DELETE /user/deletePhone  → 删除联系人                        │
│ - GET /user/userGetPhone    → 获取联系人列表                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 设备端: 上报警情                                                 │
│ POST /system/putRecordAndLocation                               │
│ 请求: deviceId + gps + 录音Base64                               │
│ 返回: 被呼叫的紧急联系人列表                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 服务器信息

- **生产服务器**: http://YOUR_SERVER_IP:8080
- **本地开发服务器**: http://localhost:8080
- **音频文件访问路径**: http://YOUR_SERVER_IP:8080/audio/{文件名}

---

## 本地开发

### 启动本地Mock服务器

```bash
cd server
npm install
npm start
```

### 调试接口

```bash
# 重置设备场景 (normal/alarm/offline)
curl -X POST http://localhost:8080/debug/reset -H "Content-Type: application/json" -d '{"scenario":"alarm"}'

# 查看请求日志
curl http://localhost:8080/logs

# 清空日志
curl -X POST http://localhost:8080/debug/clear
```

### 修改 env.js 切换服务器

开发阶段使用 `localhost:8080`，发布时使用生产地址。
