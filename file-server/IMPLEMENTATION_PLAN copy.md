# File Server 实施方案

> 基于 cli-server-simplified.md 的资源下载服务重构版
>
> **核心定位**：负责跨域下载、缓存和目录整理；浏览器插件只负责提取 URL、传参和替换，最终写回内容

---

## 📋 目录

1. [需求分析](#需求分析)
2. [方案设计](#方案设计)
3. [架构设计](#架构设计)
4. [核心模块设计](#核心模块设计)
5. [安全机制设计](#安全机制设计)
6. [测试方案](#测试方案)
7. [插件集成方案](#插件集成方案)
8. [技术栈选择](#技术栈选择)
9. [实施步骤](#实施步骤)
10. [风险评估](#风险评估)
11. [关键决策](#关键决策)

---

## 需求分析

### 用户明确要求

1. **运行位置**：file-server 目录，供本地插件通过 HTTP 调用。
2. **调用流程**：插件一次性提交多个资源 URL、目标保存目录、重命名映射（如 `url -> filename`），并额外传入文档保存路径（`docPath`）。
3. **返回值**：Server 立即返回该次批量任务的 `jobId`，任务全部异步执行；插件通过查询接口获取每个 URL 的下载状态、最终路径以及“相对文档路径”。
4. **缓存策略**：只缓存 `urlHash -> canonicalPath` 映射，不额外复制源文件。命中缓存时，若目标目录/文件名不同，则复制到新位置并重命名，再返回；若相同直接返回。
5. **下载策略**：未命中缓存时才真正发起 HTTP 下载；下载完成后需要缓存 `urlHash` 与落盘路径。
6. **异步流程**：下载可能耗时，接口需异步返回任务 ID，插件轮询任务状态，识别成功/失败/重试状态。
7. **失败处理**：Server 要记录失败原因（timeout、429 等），插件可据此提示或重试；长时间无进度需提供心跳，让插件判断是否排队/卡住。
8. **路径安全**：白名单、自动创建目录、防止路径遍历。
9. **测试要求**：file-server/tests 下使用 `/Users/yuanfeijie/Desktop/project/jia-web-clipper/file-server/a.md` 里的资源 URL。

### 需求分析总结

| 问题 | 影响 | 方案摘要 |
|------|------|----------|
| 浏览器 CORS/Manifest V3 限制 | 插件无法直接下载或指定路径 | 由本地 Server 发起下载并写入磁盘 |
| 多 URL 批量执行 | 需要成组管理状态 | 单次请求→单个 `jobId`，统一查询接口 |
| 重复资源浪费流量 | 下载慢且易被限速 | 构建 `urlHash` 缓存，命中后复用本地文件 |
| 目录/命名差异 | 不同剪藏要不同路径 | 缓存仅保存 canonicalPath，必要时复制/重命名 |
| 并发/限速 | 大量并行会触发封禁 | 全局 + 主机级队列与节流 |
| 异步失败体验 | 用户无法判断卡住还是排队 | `heartbeatAt`, `queueReason`, per-resource 状态，插件可提示/取消 |

---

## 方案设计

### 整体定位

> Server 是“资源工厂”：接收批量下载任务、管理缓存、落盘并输出文件元数据；插件是“任务协调者”：负责上下文处理与最终替换。

### 流程概览

```
插件 POST /api/jobs (urls[], saveDir, docPath, renameMap)
            │
            ▼
Server 验证 Token/白名单 → 创建 jobId → 初始化任务状态（默认 queued）
            │
            ▼
对每个 URL:
  ├─ 计算 urlHash → CacheIndex.lookup
  │     ├─ 命中且目标路径==缓存路径 → 标记 success(cacheHit)
  │     ├─ 命中但路径不同 → StorageDriver 复制/重命名 → success(cacheHit,copied)
  │     └─ 未命中 → 入下载队列 → FetchWorker 下载 → 写 targetPath
  │                         └─ 完成后 CacheIndex.update(urlHash,targetPath)
  └─ 写入 result 状态、relativePath、relativePathFromDoc、heartbeat
            │
            ▼
JobService 汇总 job stats（完全异步）
            │
            ▼
插件轮询 GET /api/jobs/{jobId}
  ├─ status=completed → 获取 results → 替换内容
  ├─ status=failed/partial → 根据 error 处理/重试
  └─ heartbeat 长时间未变 → 显示“排队”并可 cancel
```

### API 设计

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/jobs` | POST | 创建批量下载任务。body 包含 `resources[]`, `saveDir`, `docPath`, `relativeTo`, `renameMap`, `metadata`。`docPath` 用于计算“相对文档路径”。所有任务都异步，立即返回 `jobId`。|
| `/api/jobs/:id` | GET | 查询任务状态、每个资源的进度、缓存命中情况、复制动作、失败原因。|
| `/api/jobs/:id/cancel` | POST | 可选。取消正在排队/下载的任务。|
| `/health` | GET | 健康检查。|
| `/authorize` | GET | 显示当前 Token。|

**请求示例**
```json
{
  "resources": [
    {"url": "https://img.example.com/a.png", "filename": "cover.png"},
    {"url": "https://cdn.site.com/b.jpg", "filename": "thumb.jpg"}
  ],
  "saveDir": "/Users/xxx/Clips/2025-12-05/assets",
  "docPath": "/Users/xxx/Clips/2025-12-05/note.md",
  "relativeTo": "/Users/xxx/Clips",
  "allowedDirs": ["/Users/xxx/Clips"],
  "renameStrategy": "keep-extension",
  "maxConcurrency": 3
}
```

**响应示例**
```json
{
  "ok": true,
  "jobId": "job_1743990001",
  "status": "queued",
  "stats": {"total": 2, "completed": 0, "failed": 0},
  "nextPollAfterMs": 1200
}
```

**响应示例（查询）**
```json
{
  "ok": true,
  "jobId": "job_1743990001",
  "status": "running",
  "heartbeatAt": "2025-12-05T04:15:31Z",
  "queueReason": "waiting_host_throttle",
  "results": [
    {
      "url": "https://cdn.site.com/b.jpg",
      "filename": "thumb.jpg",
      "cacheHit": true,
      "copiedFromCache": true,
      "fromPath": "/Users/xxx/Clips/cache/b.jpg",
      "absolutePath": "/Users/xxx/Clips/2025-12-05/assets/thumb.jpg",
      "relativePath": "2025-12-05/assets/thumb.jpg",
      "relativePathFromDoc": "assets/thumb.jpg",
      "status": "success"
    }
  ]
}
```

### 异步执行策略

- 所有任务一律异步：`POST /api/jobs` 仅返回 `jobId`、队列状态、建议的 `nextPollAfterMs`。
- QueueManager 决定任务何时开始（全局/host 并发 + 节流）。
- JobService 维护 `heartbeatAt` 与 `queueReason`，供插件在 UI 上展示“下载中/排队中”。
- 失败项需要通过查询接口得知，再由插件选择重试（新 job、可设置 priority）。

### 下载与缓存策略

- **urlHash 计算**：默认 `sha1(url.trim())`。哈希存储为 40 字符串，作为 CacheIndex 主键。
- **缓存内容**：`cacheIndex[urlHash] = canonicalPath`；canonicalPath 即最近一次下载完成后的实际路径（绝对路径）。
- **命中逻辑**：
  1. 计算 `targetPath = saveDir + renameMap[url]`（若无 rename 则用 URL basename）。
  2. 若 `targetPath === canonicalPath` → 用缓存结果直接返回，不复制。
  3. 若不相同 → 由 StorageDriver 将 `canonicalPath` 复制到 `targetPath`，再更新缓存映射为 `targetPath`。
- **未命中逻辑**：下载结束后，以 `targetPath` 作为 canonicalPath 写入缓存。
- **缓存维护**：提供 LRU/N 最近任务容量限制；支持 `cache gc` CLI 或在 job 执行时删除失效路径（比如原文件被用户删除）。
- **相对路径**：无论命中与否，都要根据 `docPath` 计算 `relativePathFromDoc = path.relative(path.dirname(docPath), targetPath)`，用于插件在文档中引用。

---

## 架构设计

### 四层模型

```
┌───────────────────────────────┐
│ 接口层 (API Layer)           │
│ - routes.js / controllers    │
│ - 请求体验、参数校验         │
└──────────────┬───────────────┘
               │
┌──────────────┴───────────────┐
│ 任务层 (Job Layer)           │
│ - JobService (job lifecycle) │
│ - QueueManager (限流/排队)   │
│ - CacheIndex (hash->path)    │
└──────────────┬───────────────┘
               │
┌──────────────┴───────────────┐
│ 下载层 (Download Layer)      │
│ - FetchWorker (HTTP 下载)    │
│ - StorageDriver (落盘/复制)  │
│ - MetadataBuilder            │
└──────────────┬───────────────┘
               │
┌──────────────┴───────────────┐
│ 安全层 (Security Layer)      │
│ - Auth, PathGuard, RateLimit │
└───────────────────────────────┘
```

### 目录结构

```
file-server/
├── src/
│   ├── server.js
│   ├── api/
│   │   └── routes.js
│   ├── jobs/
│   │   ├── job-service.js
│   │   ├── queue-manager.js
│   │   └── cache-index.js
│   ├── downloads/
│   │   ├── fetch-worker.js
│   │   └── storage-driver.js
│   ├── security/
│   │   ├── auth.js
│   │   └── path-guard.js
│   └── utils/
│       ├── config.js
│       └── logger.js
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/a.md
└── package.json
```

---

## 核心模块设计

### 1. JobService

- 负责创建任务、分配 `jobId`、管理状态机（`pending → running → completed | failed | cancelled`）。
- 保存 `stats`（total/completed/failed/cacheHits）、`heartbeatAt`、`queueReason`。
- 创建 job 时始终入队，所有资源异步处理，结果通过查询接口返回。
- 提供 `queryJob(id)`, `cancelJob(id)`, `cleanupExpiredJobs()`。

### 2. QueueManager

- 全局并发上限（默认 4）与每 host 上限（默认 2）。
- 每 host 请求间加 `perHostThrottleMs`，避免 429。
- 支持优先级（重试任务/用户主动任务优先）。
- 记录排队理由（`waiting_global_limit`, `waiting_host_throttle`）。

### 3. CacheIndex

- 内存 Map + 持久化文件（JSON snapshot，可选）。
- API：`lookup(urlHash)`, `update(urlHash, path)`, `delete(urlHash)`。
- 启动时从 snapshot 载入；当路径不存在时自动清理该条。
- 维护 `maxEntries`，超过时按 LRU 淘汰。

### 4. FetchWorker

- 使用 Axios/Undici 进行流式下载，自动处理重定向、Content-Length 校验。
- 超时：连接 10s、读取 30s，支持重试最多 2 次（指数退避）。
- 返回 `tempPath`，由 StorageDriver 负责 rename。

### 5. StorageDriver

- 负责路径解析、白名单校验、目录自动创建。
- `handleCacheHitSamePath`：直接返回 metadata。
- `handleCacheHitDifferentPath`：复制 canonicalPath → targetPath，再更新缓存。
- `handleDownloadResult`：把 temp 文件移动到 targetPath。
- 计算 `relativePath = path.relative(relativeTo, targetPath)` 与 `relativePathFromDoc = path.relative(path.dirname(docPath), targetPath)`，同时返回供插件引用。

### 6. MetadataBuilder

- 生成 `size`, `mimeType`, `hash`, `downloadDuration`, `cacheHit`, `copiedFromCache`, `fromPath`, `relativePath`, `relativePathFromDoc` 等字段。
- 统一 serializer，便于 API 返回。

### 7. PathGuard

- 校验 `saveDir` 是否位于白名单内；检测 `..`、符号链接逃逸。
- 验证 filename 中不包含路径分隔符/控制字符。

### 8. Auth Middleware

- 启动时生成 Token 或从环境变量读取。
- 所有 `/api/*` 路由需 `X-Auth-Token` 头。

---

## 安全机制设计

| 机制 | 目的 | 说明 |
|------|------|------|
| Token 认证 | 避免未授权访问 | `/authorize` 页面展示当前 Token，提示插件配置 |
| 白名单 | 限制写入范围 | 全局 + 请求级白名单；`saveDir` 必须在其内 |
| 路径遍历防护 | 防止逃逸系统目录 | `path.resolve` + `path.relative`，阻断 `..`、符号链接 |
| 临时目录隔离 | 防止半成品文件被使用 | 下载到 `.tmp`，成功后 rename |
| 速率限制 | 避免被滥用 | `/api/jobs` 可配置 IP 级限速（可选） |
| 日志脱敏 | 防止泄露敏感 URL | 记录 host + hash，不记录 query/token |

---

## 测试方案

### 测试金字塔

- **单元测试 (60%)**：JobService、QueueManager、CacheIndex、StorageDriver、PathGuard。
- **集成测试 (30%)**：API + Mock HTTP server（重写 a.md URL 指向本地），覆盖同步/异步、缓存命中。
- **端到端 (10%)**：真实 server 进程 + 插件模拟脚本，验证流程与轮询行为。

### 关键测试用例

| 模块 | 用例 |
|------|------|
| JobService | 创建/查询/取消、同步阈值切换、heartbeat 更新 |
| QueueManager | 全局/host 并发限制、节流、优先级、queueReason 输出 |
| CacheIndex | 命中、更新、路径失效自动清理、LRU 淘汰、快照恢复 |
| StorageDriver | 目录自动创建、白名单校验、缓存同/不同路径复制、文件名安全、docPath 相对路径计算 |
| MetadataBuilder | 构造 size/hash/mime、`relativePath`、`relativePathFromDoc`、`cacheHit` 字段 |
| FetchWorker | 成功下载、重定向、429 退避、超时重试、TLS 错误 |
| API | POST 创建任务（永远异步）、GET 查询心跳、取消接口、失败结果格式 |
| 集成 | 使用 a.md URL：模拟 12 张图片，覆盖缓存命中、复制、失败重试、`relativePathFromDoc` 正确性 |

---

## 插件集成方案

1. **提取阶段**：插件提取网页，获得 Markdown/HTML 与资源列表 `[{url, alt, suggestedFilename, type}]`。
2. **任务创建**：一次 POST 携带全部 URL、目标目录、文档保存路径 `docPath`、重命名映射（`renameMap[url]=filename`）。所有任务默认异步，调用方只需保存 `jobId`。
3. **轮询策略**：
   - 使用响应中的 `nextPollAfterMs` 作为初始轮询间隔，随后可指数退避。
   - 如果多次查询 `progress` 与 `heartbeatAt` 均未变化，显示“排队/限速”，并提供 `取消` 或 `重试失败项` 按钮。
4. **结果应用**：
   - 构建 `url -> relativePathFromDoc` map，直接用于文档内容中的图片引用；`relativePath`（相对于 `relativeTo`）仍可用于存档或后续处理。
   - 根据 `cacheHit/copiedFromCache` 可展示“复用历史资源”提示。
   - 插件负责替换 Markdown/HTML 中的 URL，并将结果写入本地（插件已有机制）。
5. **错误体验**：
   - 某些 URL 失败时，插件在 UI 中列出 `errorCode`，允许单独重试（新的 job，`priority=high`）。
   - Server 返回 `retryAfterMs` 供插件合理等待。
6. **配置项**：`serverUrl`, `token`, `defaultSaveDir`, `defaultRelativeRoot`, `allowedDirs`, `maxSyncItems`, `pollIntervalMin/Max`。

---

## 技术栈选择

| 组件 | 版本 | 理由 |
|------|------|------|
| Node.js ≥18 | LTS，支持原生 fetch/stream 和 AbortController |
| Express 4.x | 生态成熟，与项目现状一致 |
| Axios 1.x 或 Undici | 流式下载、超时控制简洁 |
| p-queue 7.x | 简单好用的并发/优先级控制 |
| Vitest 1.x + Supertest 6.x | 保持项目一致，测试写法现代 |
| Nock / MSW Node | 模拟 HTTP 响应，注入 429/timeout 场景 |

---

## 实施步骤

| 阶段 | 目标 | 输出 |
|------|------|------|
| 第 1 阶段：骨架 (1d) | 初始化项目、Express server、健康检查、Token | 基础服务可启动 |
| 第 2 阶段：安全 (1d) | PathGuard、白名单校验、目录自动创建 | 安全单测 100% 通过 |
| 第 3 阶段：缓存/任务 (1-2d) | JobService、CacheIndex、QueueManager、同步/异步切换 | 支持 job 生命周期与心跳 |
| 第 4 阶段：下载链路 (2d) | FetchWorker、StorageDriver、缓存命中复制逻辑 | 可完成下载与缓存写入 |
| 第 5 阶段：API 集成 (1d) | POST/GET/CANCEL API、异步轮询逻辑 | 通过 a.md 集成测试 |
| 第 6 阶段：测试/文档 (1d) | 单元+集成覆盖率 >80%，使用文档、插件指南 | 准备交付 |

---

## 风险评估

| 风险 | 等级 | 应对 |
|------|------|------|
| 目标站限速或封禁 | 高 | 主机节流 + 重试退避 + 缓存复用，减少新请求 |
| 缓存路径失效 | 中 | 每次命中前校验 `fs.existsSync`，失效则删除缓存并重新下载 |
| 大任务长时间无反馈 | 中 | `heartbeatAt` + `queueReason` + 轮询退避；插件可取消 |
| 路径配置错误 | 中 | 提前校验 + 清晰错误消息，插件提示用户更新设置 |
| 磁盘占用增长 | 低 | 缓存 LRU、配置 `maxCacheSize`、CLI 清理命令 |
| 服务器崩溃丢任务 | 低 | JobStore 内存 + 可选 snapshot，重启后恢复缓存映射 |

---

## 关键决策

| ID | 决策点 | 选项 | 结论 | 备注 |
|----|--------|------|------|------|
| D1 | Server 返回方式 | 仅同步 / 仅异步 / 自适应 | 自适应 | 小批量快速反馈，大任务异步 |
| D2 | 缓存内容 | 缓存完整文件 / 缓存路径映射 | 仅缓存路径映射 | 满足“只存路径”的要求，减少磁盘占用 |
| D3 | 缓存命中不同路径处理 | 重新下载 / 复制缓存文件 | 复制并更新缓存 | 保证目标目录一致性，避免重复下载 |
| D4 | 任务粒度 | 每 URL 建任务 / 每批次建任务 | 每批次 | 一个 jobId 对应一次剪藏，便于插件跟踪 |
| D5 | 并发控制 | 无限制 / 固定 / 自适应 | 固定 + 配置项 | 简洁可靠，可随需求调整 |
| D6 | 状态反馈 | 简单布尔 / 细粒度 | 细粒度 | 返回 per-resource 状态、cacheHit、copiedFromCache |

---

**文档版本**：3.0  
**创建日期**：2025-12-05  
**最后更新**：2025-12-05  
**状态**：已排期，待开发
