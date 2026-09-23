# 部署公开网站

当前 `https://bridgemonitor.xyz/` 由业务后端处理，未登录访问会返回 `401`。公安联网备案审核需要能够直接查看网站内容，因此根地址必须公开访问，同时不能破坏小程序现有 API。

## 文件

公开站点位于：

```text
server/public/
├── index.html
├── privacy.html
├── styles.css
└── favicon.svg
```

Nginx 配置片段：

```text
server/deploy/nginx-public-site.conf.example
```

## 部署步骤

在服务器上创建静态目录并上传文件：

```bash
sudo mkdir -p /var/www/bridgemonitor-site
sudo cp server/public/index.html /var/www/bridgemonitor-site/
sudo cp server/public/privacy.html /var/www/bridgemonitor-site/
sudo cp server/public/styles.css /var/www/bridgemonitor-site/
sudo cp server/public/favicon.svg /var/www/bridgemonitor-site/
```

将 `server/deploy/nginx-public-site.conf.example` 中的四个 `location` 块合并到 `bridgemonitor.xyz` 当前启用的 HTTPS `server {}` 中。保留原有 API 反向代理配置。

检查并重新加载 Nginx：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 验收

```bash
curl -I https://bridgemonitor.xyz/
curl -I https://bridgemonitor.xyz/privacy.html
curl -I https://bridgemonitor.xyz/styles.css
```

三个地址都应返回 `200`。然后确认原有 API 仍然按预期响应，例如：

```bash
curl -i https://bridgemonitor.xyz/user/bind/status
```

未携带凭证时该接口可以返回认证错误，但不能变成 HTML 页面。

浏览器中还需检查：

- 首页能看到服务名称、用途、主办者和 ICP 备案号；
- 隐私说明页可打开；
- 桌面和手机宽度下均无横向滚动；
- 获得公安备案号后，将页面中的“公安联网备案办理中”替换为真实备案号并链接到公安备案查询平台。

## 注意

- 页面只用于真实介绍现有服务，不保证公安备案一定通过；最终以审核单位要求为准。
- 不要在公安备案完成前展示虚构的公安备案号。
- 如果生产环境不是 Nginx，应配置等价的“根路径静态文件优先、API 路径继续转发”规则。
