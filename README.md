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

### 3. 管理网站与项目

```bash
# 列出所有网站
demox list

# 查看网站详情
demox info WEBSITE_ID

# 列出所有项目
demox projects

# 设置自定义子域名（5-63 位）
demox domain set WEBSITE_ID my-demo

# 检查 / 清除自定义子域名（5-63 位）
demox domain check my-demo
demox domain clear WEBSITE_ID

# 配置页面水印（仅 pro/admin 角色）
demox watermark hide WEBSITE_ID
demox watermark show WEBSITE_ID

# 删除网站
demox delete WEBSITE_ID

# 检查并更新 CLI
demox update
demox update --check
```

## 命令参考

| 命令 | 描述 |
|------|------|
| `demox login` | 登录到 Demox 服务 |
| `demox logout` | 登出并删除本地 Token |
| `demox status` | 查看当前登录状态 |
| `demox deploy <path>` | 部署网站、目录、PDF 或文档 |
| `demox list` / `demox ls` | 列出所有网站 |
| `demox projects` | 列出所有项目 |
| `demox info <id>` | 查看网站详情 |
| `demox domain check <subdomain>` | 检查 `<subdomain>.demox.site` 是否可用，前缀长度 5-63 位 |
| `demox domain set <id> <subdomain>` | 设置 `<subdomain>.demox.site` 自定义子域名，前缀长度 5-63 位 |
| `demox domain clear <id>` | 清除自定义子域名前缀 |
| `demox watermark hide <id>` | 隐藏页面中的 Powered by Demox 水印，仅限 `pro/admin` 角色 |
| `demox watermark show <id>` | 重新显示页面水印，仅限 `pro/admin` 角色 |
| `demox delete <id>` / `demox rm <id>` | 删除网站 |
| `demox test` | 测试服务连接 |
| `demox clean` | 清理本地缓存 |
| `demox update` | 检查并安装最新版 CLI；`--check` 仅检查，`--force` 强制重装 |

### deploy 选项

```
-n, --name <name>    网站名称
-i, --id <id>        网站 ID（更新现有网站）
-p, --project <id>   项目 ID（将网站归入指定项目）
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
| `DEMOX_SITE_URL` | Demox 站点 URL，用于生成授权入口 | `https://www.demox.site` |
| `DEMOX_API_URL` | 后端 API 统一入口 | `https://api.demox.site` |
| `DEMOX_AUTH_URL` | 授权 URL | `${DEMOX_SITE_URL}/mcp-authorize` |
| `DEMOX_API_BASE` | API 基础 URL | `${DEMOX_SITE_URL}` |
| `DEMOX_CLOUD_FUNCTION_URL` | 部署/API 代理入口 | `${DEMOX_API_URL}` |
| `DEMOX_WEBSITE_API_URL` | 网站管理 API URL | `${DEMOX_API_URL}` |

## 限制

- 最大文件大小由 Demox 账户角色配额决定；传输使用分块上传，不受单请求 8MB 限制
- 支持的文件类型: 目录、ZIP、PDF、Markdown、TXT、DOCX
- 旧版 `.doc` 暂不支持，请另存为 `.docx`
- 自定义子域名格式: `<subdomain>.demox.site`，前缀仅支持小写字母、数字和连字符

## 许可证

MIT
