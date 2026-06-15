# Demox CLI

命令行工具，用于部署静态网站到 Demox 平台。

## 安装

```bash
# 使用 npm
npm install -g @demox-site/cli@latest

# 使用 npx (无需安装)
npx @demox-site/cli@latest --help
```

## 快速开始

### 1. 登录

```bash
demox login
```

这会打开浏览器进行 OAuth 授权。

### 2. 部署网站

```bash
# 部署目录
demox deploy ./dist

# 部署 ZIP 文件、PDF 或文档
demox deploy ./website.zip
demox deploy ./document.pdf
demox deploy ./notes.md --template warm

# 指定网站名称
demox deploy ./dist --name my-website

# 更新现有网站
demox deploy ./dist --id WEBSITE_ID
```

### 3. 管理网站

```bash
# 列出所有网站
demox list

# 查看网站详情
demox info WEBSITE_ID

# 设置自定义子域名（5-63 位）
demox domain set WEBSITE_ID my-demo

# 检查 / 清除自定义子域名（5-63 位）
demox domain check my-demo
demox domain clear WEBSITE_ID

# 删除网站
demox delete WEBSITE_ID
```

## 命令参考

| 命令 | 描述 |
|------|------|
| `demox login` | 登录到 Demox 服务 |
| `demox logout` | 登出并删除本地 Token |
| `demox status` | 查看当前登录状态 |
| `demox deploy <path>` | 部署网站、目录、PDF 或文档 |
| `demox list` / `demox ls` | 列出所有网站 |
| `demox info <id>` | 查看网站详情 |
| `demox domain check <subdomain>` | 检查自定义子域名前缀是否可用，长度 5-63 位 |
| `demox domain set <id> <subdomain>` | 设置自定义子域名前缀，长度 5-63 位 |
| `demox domain clear <id>` | 清除自定义子域名前缀 |
| `demox delete <id>` / `demox rm <id>` | 删除网站 |
| `demox test` | 测试服务连接 |
| `demox clean` | 清理本地缓存 |

### deploy 选项

```
-n, --name <name>    网站名称
-i, --id <id>        网站 ID（更新现有网站）
-t, --template <id>  文档模板：insight、warm、dark
```

### delete 选项

```
-f, --force          强制删除，不提示确认
```

## 配置

Token 保存在 `~/.demox/token.json`。

### 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `DEMOX_CLIENT_ID` | OAuth 客户端 ID | `demox-mcp-client` |
| `DEMOX_SITE_URL` | Demox 站点 URL，用于生成授权入口 | 必填 |
| `DEMOX_API_URL` | 后端 API 统一入口 | 必填 |
| `DEMOX_AUTH_URL` | 授权 URL；不填时由 `DEMOX_SITE_URL` 生成 | 可选 |
| `DEMOX_API_BASE` | API 基础 URL；不填时使用 `DEMOX_SITE_URL` | 可选 |
| `DEMOX_CLOUD_FUNCTION_URL` | 部署/API 代理入口；不填时使用 `DEMOX_API_URL` | 可选 |
| `DEMOX_WEBSITE_API_URL` | 网站管理 API URL；不填时使用 `DEMOX_API_URL` | 可选 |

## 限制

- 最大文件大小: 8MB
- 支持的文件类型: 目录、ZIP、PDF、Markdown、TXT、DOCX
- 旧版 `.doc` 暂不支持，请另存为 `.docx`
- 自定义域名格式: `<subdomain>.demox.site`，前缀仅支持小写字母、数字和连字符

## 许可证

MIT
