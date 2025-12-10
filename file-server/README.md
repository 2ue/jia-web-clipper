# MaoXian File Server

本地 HTTP 文件服务器,为 MaoXian Web Clipper 提供跨域资源下载和文件管理能力,突破 Manifest V3 浏览器沙箱限制。

## 功能特性

- ✅ **批量异步下载** - 接收多个 URL,立即返回任务 ID,异步执行
- ✅ **智能缓存系统** - 基于 URL 哈希的缓存复用,支持 APFS clone/硬链接优化
- ✅ **并发控制与节流** - 全局和主机级并发限制,避免触发反爬虫
- ✅ **In-Flight 去重** - 正在下载的 URL 共享 Promise,避免重复请求
- ✅ **崩溃恢复** - 任务和缓存状态持久化,支持重启恢复
- ✅ **安全机制** - Token 认证 + 路径白名单 + 遍历防护

## 系统要求

- Node.js 18.0.0 或更高版本
- 支持的操作系统: Windows, macOS, Linux

## 快速开始

### 1. 安装依赖

```bash
cd file-server
npm install
```

### 2. 配置服务器

首次启动时,服务器会在 `data/config.json` 生成默认配置。编辑此文件配置白名单路径:

```json
{
  "server": {
    "port": 3456,
    "host": "127.0.0.1",
    "token": "your-secret-token-here"
  },
  "profiles": {
    "default": [
      "/Users/your-name/Documents/maoxian-clips"
    ]
  },
  "concurrency": {
    "global": 4,
    "perHost": 2
  },
  "throttle": {
    "perHostMs": 1000
  }
}
```

**重要配置:**
- `server.token`: 认证令牌,建议设置强密码
- `profiles.default`: 白名单路径,只有这些路径下的文件可访问
- `concurrency.perHost`: 每个主机并发数,建议 2-3
- `throttle.perHostMs`: 请求间隔(毫秒),建议 1000ms 以上

### 3. 启动服务器

```bash
npm start
```

服务器将在 `http://127.0.0.1:3456` 启动。

### 4. 获取 Token

打开浏览器访问 `http://127.0.0.1:3456/authorize`,页面会显示认证 Token。

### 5. 配置插件

1. 打开 MaoXian Web Clipper 插件设置
2. 找到 "File Server" 配置项
3. 输入服务器地址: `http://127.0.0.1:3456`
4. 粘贴 Token
5. 点击"测试连接"验证

## API 文档

### 健康检查

```http
GET /health
```

### 创建下载任务

```http
POST /api/jobs
X-Auth-Token: <your-token>
Content-Type: application/json

{
  "resources": [
    {"url": "https://example.com/image.png", "filename": "image.png"}
  ],
  "saveDir": "/path/to/save",
  "docPath": "/path/to/document.html",
  "relativeTo": "/path/to/base",
  "relativeProfile": "default"
}
```

**字段说明:**
- `resources`: 资源列表 (必需)
  - `url`: 资源 URL (必需)
  - `filename`: 文件名 (可选,默认从 URL 推导)
- `saveDir`: 保存目录 (必需)
- `docPath`: 文档路径 (可选,用于计算相对路径)
- `relativeTo`: 相对路径基准 (可选)
- `relativeProfile`: 白名单配置名称 (可选,默认 "default")

**响应:**

```json
{
  "id": "job_1234567890_abc123",
  "status": "queued",
  "stats": {"total": 1, "completed": 0, "failed": 0},
  "results": [...],
  "nextPollAfterMs": 1500
}
```

### 查询任务状态

```http
GET /api/jobs/:id
X-Auth-Token: <your-token>
```

**任务状态:**
- `queued`: 排队中
- `running`: 运行中
- `completed`: 全部成功
- `failed`: 全部失败
- `partial`: 部分成功
- `cancelled`: 已取消

### 取消任务

```http
POST /api/jobs/:id/cancel
X-Auth-Token: <your-token>
```

## 缓存机制

### 工作原理

1. 计算 URL 的 SHA-1 哈希值
2. 查询缓存索引
3. **路径相同**: 直接返回缓存路径
4. **路径不同**: 复制/硬链接文件到新路径

### 文件复制优化

优先级: **APFS Clone** (macOS) > **硬链接** > **普通复制**

### 缓存清理

使用 LRU (Least Recently Used) 淘汰策略,达到上限时自动删除最久未使用的缓存项。

## 开发指南

### 运行测试

```bash
# 运行所有测试
npm test

# 运行单元测试
npm test -- tests/unit/

# 运行集成测试
npm test -- tests/integration/

# 测试覆盖率
npm run test:coverage
```

### 代码检查

```bash
# 检查代码
npm run lint

# 自动修复
npm run lint:fix
```

### 开发模式

```bash
# 自动重启
npm run dev
```

## 故障排查

### 端口被占用

```
Error: listen EADDRINUSE :::3456
```

**解决**: 修改 `data/config.json` 中的 `server.port`。

### 认证失败 (401)

**解决**: 检查 `X-Auth-Token` 是否正确。访问 `/authorize` 查看当前 Token。

### 路径不在白名单 (403)

**解决**: 在 `data/config.json` 的 `profiles` 中添加目标路径。

### 下载失败 (429 Too Many Requests)

**解决**:
- 降低 `concurrency.perHost` (建议 2)
- 增加 `throttle.perHostMs` (建议 1500-2000ms)

## 性能优化

### 并发配置建议

```json
{
  "concurrency": {
    "global": 4,     // 全局并发: 4-8
    "perHost": 2     // 单主机并发: 1-3
  },
  "throttle": {
    "perHostMs": 1000  // 节流间隔: 1000-2000ms
  }
}
```

### 缓存配置建议

```json
{
  "cache": {
    "maxEntries": 10000,          // 最多 10000 条
    "maxSizeBytes": 10737418240   // 最大 10GB
  }
}
```

## 项目结构

```
file-server/
├── src/
│   ├── server.js              # 服务器入口
│   ├── api/routes.js          # API 路由
│   ├── jobs/                  # 任务管理
│   │   ├── job-service.js     # 任务服务
│   │   ├── queue-manager.js   # 队列调度
│   │   ├── cache-index.js     # 缓存索引
│   │   └── inflight-registry.js # In-Flight 去重
│   ├── downloads/             # 下载模块
│   │   ├── fetch-worker.js    # HTTP 下载
│   │   ├── storage-driver.js  # 文件存储
│   │   └── metadata-builder.js # 元数据构建
│   ├── security/              # 安全模块
│   │   ├── auth.js            # Token 认证
│   │   └── path-guard.js      # 路径防护
│   └── utils/                 # 工具类
├── tests/                     # 测试文件
├── data/                      # 数据目录(运行时)
│   ├── jobs/                  # 任务持久化
│   └── cache/                 # 缓存数据
└── config.json                # 配置文件
```

## 技术栈

- **Node.js 18+** - 运行环境
- **Express 4** - Web 框架
- **Axios** - HTTP 客户端
- **Vitest** - 测试框架

## 常见问题

**Q: 是否支持 HTTPS?**
A: 当前仅支持本地 HTTP。远程访问建议使用 Nginx 反向代理配置 HTTPS。

**Q: 是否支持多实例?**
A: 不支持。多实例会导致缓存和任务状态冲突。

**Q: 如何备份数据?**
A: 备份 `data/` 目录和 `config.json` 文件。

**Q: 如何清理所有缓存?**
A: 停止服务,删除 `data/cache/` 目录,重启服务。

## 许可证

本项目遵循与 MaoXian Web Clipper 相同的许可证。

## 相关项目

- [MaoXian Web Clipper](https://github.com/mika-cn/maoxian-web-clipper)
