# Demox CLI

命令行工具，用于部署静态网站到 Demox 平台。

## 安装

```bash
# 使用 npm
npm install -g @demox-site/cli

# 使用 npx (无需安装)
npx @demox-site/cli --help
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

# 部署 ZIP 文件
demox deploy ./website.zip

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

# 删除网站
demox delete WEBSITE_ID
```

## 命令参考

| 命令 | 描述 |
|------|------|
| `demox login` | 登录到 Demox 服务 |
| `demox logout` | 登出并删除本地 Token |
| `demox status` | 查看当前登录状态 |
| `demox deploy <path>` | 部署网站或目录 |
| `demox list` / `demox ls` | 列出所有网站 |
| `demox info <id>` | 查看网站详情 |
| `demox delete <id>` / `demox rm <id>` | 删除网站 |
| `demox test` | 测试服务连接 |
| `demox clean` | 清理本地缓存 |

### deploy 选项

```
-n, --name <name>    网站名称
-i, --id <id>        网站 ID（更新现有网站）
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
| `DEMOX_AUTH_URL` | 授权 URL | `https://demox.site/#/mcp-authorize` |
| `DEMOX_API_BASE` | API 基础 URL | `https://demox.site` |
| `DEMOX_CLOUD_FUNCTION_URL` | 云函数 URL | (腾讯云 SCF) |

## 限制

- 最大文件大小: 8MB
- 支持的文件类型: ZIP 文件或目录

## 许可证

MIT
