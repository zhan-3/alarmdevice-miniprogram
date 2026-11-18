# 报警地图展示坐标

硬件报警的 `gpsLng` / `gpsLat` 是原始WGS-84。后端在报警收件箱及历史详情额外返回 `displayLocation`；小程序不转换坐标，只使用明确GCJ-02的展示字段。

```json
{
  "gpsLng": 116.404,
  "gpsLat": 39.915,
  "coordinateSystem": "wgs84",
  "displayLocation": {
    "longitude": 116.4102445,
    "latitude": 39.9164043,
    "coordinateSystem": "gcj02"
  }
}
```

以上是合成测试向量，不是实物部署位置；数值小数位数不代表定位精度。

- `utils/alarmLocation.js` 校验展示坐标系、数字及经纬范围；`utils/alarmInbox.js` / `utils/alarmHistory.js` 生成本地 `mapLocation`、`hasLocation`，保留原始gps字段。
- 报警收件箱和历史详情的 `wx.openLocation` 使用 `mapLocation`，不能使用原始WGS-84或再次偏移。收件箱按当前记录ID查找坐标，不信任事件属性中的经纬值。
- 旧后端没有展示字段、后端无法转换或展示数据异常时，位置入口隐藏/拒绝打开，不回退原始GPS，也不会将null当成0；其余报警功能仍可用。
- 后端当前本地算法只用于已确认的国内桥梁部署，支持范围预检不是精确国界。范围外返回null；供应商官方结果/现场精度需另行核验，不以Node向量测试代替。
- 设备详情和设置页展示的是**共享安装位置**，继续沿用 `/user/getInstallLocation`，不参与本次硬件报警坐标转换。

接口权威合同在后端仓库 `docs/alarm-coordinate-display.md`。部署顺序为先后端、再小程序；只部署后端不会改变旧客户端直接使用原始坐标的行为，新客户端连接旧后端会关闭报警位置入口。此改动未执行上传、体验版或正式发布。

验证：`npm test`；包含共享数据校验、重复归一化、两个页面实际方法的 `wx.openLocation` 参数检查。Node/VM测试不等同于微信开发者工具或真机地图验证。
