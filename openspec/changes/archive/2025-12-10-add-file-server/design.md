# Design Document: File Server

## Context

MaoXian Web Clipper 在升级到 Manifest V3 后，面临严格的跨域资源访问和文件系统权限限制。浏览器扩展无法：

1. 绕过 CORS 限制下载第三方资源
2. 精确控制文件保存路径和目录结构
3. 高效处理批量资源下载
4. 复用已下载的重复资源

本设计引入一个独立的本地 HTTP 服务器，作为扩展的"资源下载代理"，突破浏览器沙箱限制。

### Stakeholders

- **最终用户**：需要更快、更可靠的资源下载体验
- **扩展开发者**：需要清晰的 API 和可维护的架构
- **系统管理员**：需要考虑安全性和资源占用

### Constraints

- Node.js 18+ (支持原生 fetch 和 AbortController)
- 跨平台兼容 (Windows, macOS, Linux)
- 最小化外部依赖
- 必须支持崩溃恢复和状态持久化

## Goals / Non-Goals

### Goals

1. **核心功能**
   - 提供批量异步下载 API
   - 实现智能缓存和去重
   - 支持灵活的路径管理和重命名
   - 实现并发控制和节流

2. **可靠性**
   - 任务和缓存状态持久化
   - 支持崩溃恢复
   - 提供详细的错误信息和重试机制

3. **安全性**
   - Token 认证
   - 路径白名单和遍历防护
   - 安全的文件名处理

4. **性能**
   - 全局和主机级并发控制
   - 文件复制优化 (APFS clone / 硬链接)
   - 最小化磁盘 I/O

### Non-Goals

1. **不做分布式**：仅支持单机部署，不考虑集群或负载均衡
2. **不做用户管理**：仅通过 Token 认证，不支持多用户或权限系统
3. **不做资源转换**：不处理图片格式转换、压缩等
4. **不做云存储集成**：仅支持本地文件系统
5. **不做实时同步**：插件通过轮询查询，不实现 WebSocket 长连接（SSE 为可选优化）

## Decisions

### Decision 1: 纯异步架构

**问题**：同步下载会阻塞 API 响应，批量任务耗时长

**选择**：所有下载任务异步执行，API 立即返回 jobId

**理由**：
- 符合用户需求 (明确要求 "立即返回 jobId")
- 避免 HTTP 超时问题
- 支持大量并发任务
- 便于实现优先级调度

**替代方案**：
- ❌ 同步等待：会阻塞请求，体验差
- ❌ 自适应：增加复杂度，接口语义不一致

### Decision 2: 缓存仅存路径映射

**问题**：是否缓存完整文件副本还是仅缓存路径

**选择**：仅缓存 `urlHash → canonicalPath` 映射

**理由**：
- 符合用户需求 (明确要求 "只缓存路径")
- 节省磁盘空间
- 简化缓存管理逻辑
- 命中后通过文件复制/硬链接满足不同路径需求

**替代方案**：
- ❌ 缓存文件副本：浪费空间，增加 I/O

### Decision 3: 持久化采用 Append-Only Log + Snapshot

**问题**：如何持久化任务和缓存状态

**选择**：Append-Only Log + 周期性 Snapshot

**理由**：
- 写入性能高 (仅追加)
- 易于实现崩溃恢复 (replay log)
- 支持审计和调试
- Snapshot 避免日志无限增长

**替代方案**：
- ❌ SQLite：引入额外依赖，过于重量级
- ❌ 纯内存：无法崩溃恢复
- ❌ 仅 Snapshot：无法记录中间状态

### Decision 4: 并发控制采用双层队列

**问题**：如何避免触发目标站点反爬虫机制

**选择**：全局并发限制 + 主机级并发限制 + 主机级节流

**理由**：
- 全局限制保护本地资源
- 主机限制避免触发 429
- 节流模拟人类行为
- 支持可配置参数

**替代方案**：
- ❌ 仅全局限制：无法针对特定主机节流
- ❌ 自适应节流：复杂度高，难以调试

### Decision 5: In-Flight 去重机制

**问题**：多个任务请求相同 URL 时是否重复下载

**选择**：引入 InFlightRegistry，正在下载的 URL 共享 Promise

**理由**：
- 避免重复网络请求
- 减少目标站点压力
- 自动等待结果，无需额外逻辑

**替代方案**：
- ❌ 无去重：浪费带宽和时间
- ❌ 队列去重：无法处理已在下载中的情况

### Decision 6: 相对路径计算策略

**问题**：如何计算文档内的资源引用路径

**选择**：同时提供 `relativePath` (相对于 `relativeTo`) 和 `relativePathFromDoc` (相对于文档)

**理由**：
- `relativePath`：用于归档和存储管理
- `relativePathFromDoc`：用于 Markdown/HTML 引用
- 满足不同使用场景
- 避免插件重复计算

### Decision 7: 文件复制优化

**问题**：缓存命中但路径不同时，如何高效复制文件

**选择**：优先尝试 APFS clone / 硬链接，fallback 到普通复制

**理由**：
- APFS clone：瞬时完成，零空间占用 (macOS)
- 硬链接：兼容性好，节省空间
- 普通复制：最终 fallback，保证功能

**替代方案**：
- ❌ 仅普通复制：性能差，浪费空间
- ❌ 仅硬链接：跨文件系统失败

### Decision 8: 技术栈选择

**核心依赖**：
- **Express 4.x**：成熟稳定，生态丰富
- **Axios / Undici**：流式下载，超时控制简洁
- **p-queue 7.x**：并发和优先级控制
- **Vitest + Supertest**：现代化测试工具

**理由**：
- 与项目现有技术栈一致
- 最小化学习成本
- 社区支持良好

## Architecture

### 四层模型

```
┌─────────────────────────────────────┐
│  API Layer (接口层)                │
│  - Express Routes                  │
│  - Request Validation              │
│  - Response Formatting             │
└──────────────┬──────────────────────┘
               │
┌──────────────┴──────────────────────┐
│  Job Layer (任务层)                │
│  - JobService (生命周期)           │
│  - QueueManager (调度/限流)        │
│  - CacheIndex (缓存索引)           │
│  - InFlightRegistry (去重)         │
└──────────────┬──────────────────────┘
               │
┌──────────────┴──────────────────────┐
│  Download Layer (下载层)           │
│  - FetchWorker (HTTP 下载)         │
│  - StorageDriver (文件存储)        │
│  - MetadataBuilder (元数据)        │
└──────────────┬──────────────────────┘
               │
┌──────────────┴──────────────────────┐
│  Security Layer (安全层)           │
│  - Auth Middleware                 │
│  - PathGuard                       │
│  - RateLimit (可选)                │
└─────────────────────────────────────┘
```

### 数据流

```
1. 插件 → POST /api/jobs
   ├─ Auth 验证 Token
   ├─ PathGuard 验证白名单
   └─ JobService 创建任务

2. JobService → QueueManager
   ├─ 为每个 URL 创建子任务
   ├─ 计算 urlHash
   └─ 查询 CacheIndex

3. CacheIndex 命中
   ├─ 路径相同 → 直接返回
   └─ 路径不同 → StorageDriver 复制

4. CacheIndex 未命中
   ├─ 检查 InFlightRegistry
   │  ├─ 正在下载 → 等待结果
   │  └─ 无进行中 → 入队下载
   └─ QueueManager 调度
      ├─ 检查全局并发
      ├─ 检查主机并发
      ├─ 主机节流等待
      └─ FetchWorker 下载

5. 下载完成
   ├─ StorageDriver 存储
   ├─ CacheIndex 更新
   ├─ MetadataBuilder 构建结果
   └─ JobService 更新状态

6. 插件 → GET /api/jobs/:id
   └─ 返回任务状态和结果
```

### 持久化设计

```
data/
├── jobs/
│   ├── journal.log         # Append-only 任务日志
│   └── snapshot.json       # 周期性快照
├── cache/
│   ├── index.log          # Append-only 缓存日志
│   └── index.json         # 缓存快照
└── files/
    └── [cached files]     # 实际下载的文件
```

**日志格式**：
```json
{"op":"add","jobId":"job_123","timestamp":1234567890,"data":{...}}
{"op":"update","jobId":"job_123","timestamp":1234567891,"field":"status","value":"completed"}
```

**恢复流程**：
1. 加载最近的 snapshot
2. Replay 之后的 log
3. 清理无效数据 (路径不存在)
4. 重建内存索引

## Risks / Trade-offs

### Risk 1: 目标站点限速或封禁

**影响**：下载失败率高，用户体验差

**缓解措施**：
- 主机级并发限制 (默认 2)
- 主机级节流 (默认 1000ms)
- 重试退避策略 (指数退避)
- 缓存复用减少新请求
- 用户可配置参数

### Risk 2: 缓存路径失效

**影响**：命中缓存但文件不存在

**缓解措施**：
- 每次命中前校验 `fs.existsSync`
- 失效则删除缓存项并重新下载
- 日志记录失效事件

### Risk 3: 磁盘占用增长

**影响**：长期运行后缓存文件过多

**缓解措施**：
- LRU 淘汰策略
- 配置 `maxCacheEntries` 和 `maxCacheSize`
- 提供 CLI 清理命令
- 定期清理过期任务日志

### Risk 4: 服务器崩溃丢失任务

**影响**：正在执行的任务状态丢失

**缓解措施**：
- JobStore 和 CacheIndex 持久化
- Append-only log 确保写入安全
- 重启后自动恢复任务
- 插件轮询可重新提交失败任务

### Risk 5: 路径配置错误

**影响**：文件保存到错误位置或权限错误

**缓解措施**：
- 启动时验证白名单路径可写
- API 请求时再次校验
- 清晰的错误消息
- 插件提供测试连接功能

### Trade-off 1: 异步 vs 简单性

**选择**：异步架构

**代价**：
- 增加代码复杂度
- 需要轮询机制
- 调试更困难

**收益**：
- 不阻塞请求
- 支持大量并发
- 更好的用户体验

### Trade-off 2: 持久化 vs 性能

**选择**：Append-only log + Snapshot

**代价**：
- 每次操作都要写日志 (I/O 开销)
- 启动时需要 replay (启动慢)

**收益**：
- 崩溃恢复能力
- 可审计和调试
- 数据一致性

## Migration Plan

### 初始部署

**Phase 1: 服务器部署**
1. 用户安装 Node.js 18+
2. 运行 `npm install` 安装依赖
3. 配置 `config.json` (白名单、Token)
4. 运行 `npm run file-server` 启动服务
5. 访问 `/authorize` 获取 Token

**Phase 2: 插件配置**
1. 打开插件设置页面
2. 启用 "File Server" 功能
3. 输入服务器地址和 Token
4. 选择 relativeProfile (白名单配置)
5. 点击 "测试连接" 验证配置

**Phase 3: 验证**
1. 执行一次剪辑
2. 查看文件是否正确保存
3. 再次剪辑相同资源
4. 验证缓存复用

### 向后兼容

- File Server 为**可选功能**，默认禁用
- 未配置时，插件继续使用浏览器下载方式
- 不影响现有用户

### 回滚策略

如果 File Server 出现问题：
1. 在插件设置中禁用 File Server
2. 系统自动回退到浏览器下载
3. 已保存的文件不受影响

### 数据迁移

无需迁移现有数据。File Server 仅处理新的剪辑任务。

## Open Questions

1. **缓存大小限制**：默认值设为多少合适？
   - 建议：maxCacheEntries=10000, maxCacheSize=10GB
   - 需要根据实际使用情况调整

2. **并发参数默认值**：如何平衡速度和风险？
   - 建议：全局并发=4，主机并发=2，节流=1000ms
   - 考虑提供预设配置 (保守/平衡/激进)

3. **SSE 推送优先级**：是否必须实现？
   - 建议：Phase 1 仅轮询，Phase 2 添加 SSE 优化
   - SSE 可显著减少无效轮询

4. **日志清理策略**：多久清理一次？
   - 建议：每次启动时清理 7 天前的任务日志
   - 缓存日志在 Snapshot 后可安全删除

5. **跨文件系统支持**：是否需要处理？
   - macOS/Linux：硬链接仅同文件系统
   - 建议：检测失败后 fallback 到复制

## References

- [IMPLEMENTATION_PLAN.md](../../../file-server/IMPLEMENTATION_PLAN.md)
- [Express.js Documentation](https://expressjs.com/)
- [Node.js Streams](https://nodejs.org/api/stream.html)
- [APFS Clonefile API](https://developer.apple.com/documentation/kernel/1629133-clonefile)
