# Change: 添加本地文件服务器支持跨域资源下载

## Why

浏览器扩展在 Manifest V3 架构下面临严格的跨域资源访问限制和文件系统权限约束。当前的 MaoXian Web Clipper 无法：

1. **跨域下载受限**：Content Script 无法绕过 CORS 限制下载第三方资源
2. **文件路径控制受限**：浏览器的 Downloads API 无法指定精确的保存路径和目录结构
3. **批量操作性能差**：每个资源都需要单独触发下载对话框，用户体验极差
4. **缓存复用缺失**：重复资源无法复用，浪费带宽和存储

通过引入本地 File Server,可以突破这些限制,提供专业级的资源管理能力。

## What Changes

新增一个独立的 Node.js 本地服务器(`file-server/`)，提供以下核心能力：

- **批量异步下载 API**：接收多个 URL，返回任务 ID，支持轮询查询进度
- **智能缓存系统**：基于 URL 哈希的缓存索引，自动复用已下载资源
- **灵活路径管理**：支持自定义目录结构、文件重命名、相对路径计算
- **并发控制与节流**：全局和主机级别的并发限制，避免触发反爬虫机制
- **持久化状态**：任务和缓存数据持久化，支持崩溃恢复
- **安全机制**：Token 认证、路径白名单、路径遍历防护

## Impact

### 新增组件

- **file-server/**：完整的本地服务器实现
  - `src/server.js`：Express 服务器入口
  - `src/api/routes.js`：RESTful API 路由
  - `src/jobs/`：任务管理、队列调度、缓存索引
  - `src/downloads/`：HTTP 下载、文件存储
  - `src/security/`：认证、路径安全
  - `tests/`：单元测试和集成测试

### 受影响的插件模块

- **保存处理器 (src/js/handler/)**：需要新增 `file-server.js` 处理器
- **后台服务 (src/js/background.js)**：集成 File Server 通信逻辑
- **配置系统 (src/js/lib/config.js)**：添加 File Server 相关配置项
- **用户界面 (src/pages/setting.html)**：添加 File Server 设置面板

### 配置变更

新增配置项：
- `fileServer.enabled`：是否启用 File Server
- `fileServer.url`：服务器地址（默认 `http://localhost:3456`）
- `fileServer.token`：认证令牌
- `fileServer.relativeProfile`：白名单配置文件名称
- `fileServer.maxConcurrency`：最大并发数
- `fileServer.pollInterval`：轮询间隔

### 构建与部署

- 保持插件构建流程不变
- File Server 作为独立进程运行，需要单独启动
- 提供 `npm run file-server` 启动脚本

### 向后兼容

- **完全向后兼容**：File Server 为可选功能，默认禁用
- 用户可继续使用现有的浏览器下载方式
- 仅当显式配置并启动 File Server 后才生效

### 文档更新

- `file-server/README.md`：服务器使用文档
- `docs/file-server-integration.md`：插件集成指南
- `README.md`：添加 File Server 功能介绍

## Breaking Changes

无。此为纯新增功能，不影响现有代码路径。
