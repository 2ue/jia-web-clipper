# MaoXian File Server

本地文件服务器,为 MaoXian Web Clipper 提供跨域资源下载和文件管理能力。

## 功能特性

- ✅ 跨域资源下载 - 突破浏览器 CORS 限制
- ✅ 智能缓存系统 - 基于 URL 哈希的缓存复用
- ✅ 批量异步处理 - 高效处理大量下载任务
- ✅ 并发控制与节流 - 避免触发反爬虫机制
- ✅ 崩溃恢复 - 持久化状态,支持重启恢复
- ✅ 路径安全 - 白名单+遍历防护

## 快速开始

### 1. 安装依赖

```bash
cd file-server
npm install
```

### 2. 启动服务器

```bash
npm start
```

服务器将在 `http://127.0.0.1:3456` 启动。

### 3. 获取 Token

打开浏览器访问 `http://127.0.0.1:3456/authorize`,页面会显示认证 Token。

### 4. 配置插件

1. 打开 MaoXian Web Clipper 插件设置
2. 找到 "File Server" 配置项
3. 输入服务器地址: `http://127.0.0.1:3456`
4. 粘贴上一步获取的 Token
5. 点击"测试连接"验证

## 配置文件

首次启动时,服务器会在 `data/config.json` 生成默认配置:

```json
{
  "server": {
    "port": 3456,
    "host": "127.0.0.1"
  },
  "profiles": {
    "default": [
      "/Users/your-name/Documents/maoxian-clips"
    ]
  }
}
```

### 添加白名单路径

编辑 `data/config.json`,在 `profiles.default` 数组中添加允许的保存路径:

```json
{
  "profiles": {
    "default": [
      "/Users/your-name/Documents/maoxian-clips",
      "/Users/your-name/Downloads/clips"
    ]
  }
}
```

## 开发指南

### 运行测试

```bash
# 运行所有测试
npm test

# 运行单元测试
npm run test:unit

# 运行集成测试
npm run test:integration

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
# 自动重启 (Node 18+)
npm run dev
```

## API 文档

### 健康检查

```
GET /health
```

### 创建下载任务

```
POST /api/jobs
Headers: X-Auth-Token: <your-token>
Body: {
  "resources": [{"url": "...", "filename": "..."}],
  "saveDir": "/path/to/save",
  "docPath": "/path/to/document.md"
}
```

### 查询任务状态

```
GET /api/jobs/:id
Headers: X-Auth-Token: <your-token>
```

## 故障排查

### 端口被占用

修改 `data/config.json` 中的 `server.port`。

### Token 丢失

访问 `/authorize` 页面查看当前 Token。

### 路径不在白名单

编辑 `data/config.json`,将目标路径添加到白名单。

## 技术栈

- **Node.js 18+** - 运行环境
- **Express 4** - Web 框架
- **Axios** - HTTP 客户端
- **Vitest** - 测试框架

## 许可证

MIT License

## 相关项目

- [MaoXian Web Clipper](https://github.com/mika-cn/maoxian-web-clipper)
