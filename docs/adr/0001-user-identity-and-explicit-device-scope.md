---
status: accepted
---

# 一个用户登录凭证与显式设备范围

小程序只持有一个代表用户身份的 JWT，设备列表只保存 SN 与别名，选中设备是独立的客户端状态。访问设备时显式传 `deviceId`，由后端按已验证手机号与设备的当前绑定校验；本人手机号和额外通知联系人号码的绑定暂视为等同。这样不必为多设备分别保存、刷新令牌，也不会把界面选择误作访问授权；代价是设备范围接口需要与后端协调切换。

旧缓存只迁移设备名称和选择，不保留设备凭证。HTTP `401` 使整个登录状态失效，HTTP `403` 只使请求指定设备的本地状态失效。后端权威契约见 [mini-program-authentication.md](https://github.com/zhan-3/alarmdevice/blob/main/docs/mini-program-authentication.md)。
