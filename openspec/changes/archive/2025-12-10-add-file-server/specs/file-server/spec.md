# File Server Specification

## Overview

File Server 是一个本地 HTTP 服务器，为 MaoXian Web Clipper 浏览器扩展提供跨域资源下载、智能缓存和灵活的文件管理能力，突破 Manifest V3 的浏览器沙箱限制。

## ADDED Requirements

### Requirement: 服务器启动和健康检查

服务器 SHALL 在启动时初始化所有必要的组件，并提供健康检查接口用于监控服务状态。

#### Scenario: 正常启动

- **WHEN** 用户运行 `npm run file-server` 启动服务
- **THEN** 服务器应在指定端口监听 HTTP 请求
- **AND** 日志输出包含服务器地址和 Token 信息
- **AND** 加载并恢复持久化的任务和缓存状态

#### Scenario: 健康检查

- **WHEN** 客户端发送 GET 请求到 `/health`
- **THEN** 服务器应返回 200 状态码
- **AND** 响应体包含服务状态信息 (版本号、运行时间、活跃任务数)

#### Scenario: 启动失败

- **WHEN** 端口已被占用或配置文件无效
- **THEN** 服务器应输出清晰的错误消息
- **AND** 进程以非零退出码退出

---

### Requirement: Token 认证

所有 API 接口 SHALL 要求客户端在请求头中提供有效的认证 Token，以防止未授权访问。

#### Scenario: 有效 Token

- **WHEN** 客户端在请求头中包含正确的 `X-Auth-Token`
- **THEN** 请求应被正常处理
- **AND** 返回正常的业务响应

#### Scenario: 无效或缺失 Token

- **WHEN** 客户端未提供 Token 或 Token 不正确
- **THEN** 服务器应返回 401 Unauthorized 状态码
- **AND** 响应体包含错误消息 "Invalid or missing authentication token"

#### Scenario: 获取当前 Token

- **WHEN** 用户访问 GET `/authorize`
- **THEN** 服务器应返回 HTML 页面展示当前 Token
- **AND** 页面提示用户将 Token 配置到插件中

---

### Requirement: 路径白名单验证

服务器 SHALL 验证所有文件操作路径是否在配置的白名单范围内，防止恶意路径访问。

#### Scenario: 路径在白名单内

- **WHEN** 客户端提交的 `saveDir` 在配置的 `relativeProfile` 白名单内
- **THEN** 路径验证应通过
- **AND** 文件操作继续执行

#### Scenario: 路径不在白名单内

- **WHEN** 客户端提交的 `saveDir` 不在任何白名单路径下
- **THEN** 服务器应返回 403 Forbidden 状态码
- **AND** 错误消息明确指出路径超出允许范围

#### Scenario: 路径遍历攻击防护

- **WHEN** 客户端提交包含 `..` 或符号链接的路径
- **THEN** 服务器应检测并拒绝该路径
- **AND** 返回 403 状态码和安全警告消息

---

### Requirement: 批量下载任务创建

服务器 SHALL 接受批量资源下载请求，立即返回任务 ID，并异步执行所有下载操作。

#### Scenario: 创建任务成功

- **WHEN** 客户端 POST `/api/jobs` 并提供有效的资源列表和配置
- **THEN** 服务器应立即返回 202 Accepted 状态码
- **AND** 响应体包含唯一的 `jobId`
- **AND** 响应体包含初始状态 `status: "queued"`
- **AND** 响应体包含建议的轮询间隔 `nextPollAfterMs`
- **AND** 所有资源被加入异步处理队列

#### Scenario: 请求体验证失败

- **WHEN** 客户端提交的请求体缺少必需字段或格式错误
- **THEN** 服务器应返回 400 Bad Request 状态码
- **AND** 错误消息详细说明验证失败的具体字段

#### Scenario: 白名单验证失败

- **WHEN** 客户端提交的 `saveDir` 或 `relativeProfile` 无效
- **THEN** 服务器应返回 403 Forbidden 状态码
- **AND** 不创建任务

---

### Requirement: 任务状态查询

服务器 SHALL 提供任务状态查询接口，返回任务的完整状态、进度和每个资源的处理结果。

#### Scenario: 查询进行中的任务

- **WHEN** 客户端 GET `/api/jobs/:id` 查询一个正在执行的任务
- **THEN** 服务器应返回 200 状态码
- **AND** 响应体包含 `status: "running"` 或 `"queued"`
- **AND** 响应体包含 `heartbeatAt` 时间戳
- **AND** 响应体包含 `queueReason` (如果正在排队)
- **AND** 响应体包含 `stats` (总数、完成数、失败数)
- **AND** 响应体包含 `results` 数组，每个资源的当前状态

#### Scenario: 查询已完成的任务

- **WHEN** 客户端查询一个已完成的任务
- **THEN** 响应体的 `status` 应为 `"completed"` 或 `"failed"` 或 `"partial"`
- **AND** `results` 数组包含所有资源的最终结果
- **AND** 每个成功资源包含 `absolutePath`, `relativePath`, `relativePathFromDoc`
- **AND** 每个失败资源包含 `errorCode` 和 `errorMessage`

#### Scenario: 查询不存在的任务

- **WHEN** 客户端查询一个不存在的 `jobId`
- **THEN** 服务器应返回 404 Not Found 状态码

---

### Requirement: URL 哈希缓存索引

服务器 SHALL 为每个下载的资源计算 URL 哈希，并维护 `urlHash → canonicalPath` 映射，以实现缓存复用。

#### Scenario: 缓存未命中

- **WHEN** 某个 URL 的哈希在缓存索引中不存在
- **THEN** 服务器应发起 HTTP 下载
- **AND** 下载完成后，将 `urlHash → targetPath` 写入缓存
- **AND** 持久化缓存日志

#### Scenario: 缓存命中且路径相同

- **WHEN** URL 哈希命中缓存，且计算的 `targetPath` 与 `canonicalPath` 相同
- **THEN** 服务器应直接返回缓存路径
- **AND** 标记 `cacheHit: true`, `copiedFromCache: false`
- **AND** 不发起网络请求

#### Scenario: 缓存命中但路径不同

- **WHEN** URL 哈希命中缓存，但 `targetPath` 与 `canonicalPath` 不同
- **THEN** 服务器应将 `canonicalPath` 文件复制/硬链接到 `targetPath`
- **AND** 更新缓存映射为新的 `targetPath`
- **AND** 标记 `cacheHit: true`, `copiedFromCache: true`
- **AND** 记录 `fromPath` 为原始缓存路径

#### Scenario: 缓存路径失效

- **WHEN** 缓存命中但 `canonicalPath` 文件不存在
- **THEN** 服务器应删除该缓存项
- **AND** 重新发起下载
- **AND** 更新缓存为新路径

---

### Requirement: 并发控制和节流

服务器 SHALL 实现全局和主机级别的并发限制，以及主机级别的请求节流，避免触发目标站点的反爬虫机制。

#### Scenario: 全局并发限制

- **WHEN** 当前正在下载的任务数达到全局上限
- **THEN** 新任务应进入队列等待
- **AND** 任务状态标记为 `queued`
- **AND** `queueReason` 设为 `"waiting_global_limit"`

#### Scenario: 主机级并发限制

- **WHEN** 某个主机的并发下载数达到主机上限
- **THEN** 该主机的新任务应等待
- **AND** `queueReason` 设为 `"waiting_host_limit"`

#### Scenario: 主机级节流

- **WHEN** 某个主机的上次请求在节流时间窗口内
- **THEN** 新请求应延迟执行
- **AND** `queueReason` 设为 `"waiting_host_throttle"`

---

### Requirement: HTTP 下载执行

服务器 SHALL 使用流式下载方式获取资源，支持重定向、超时控制和自动重试。

#### Scenario: 下载成功

- **WHEN** HTTP 请求返回 200 状态码
- **THEN** 服务器应将响应流写入临时文件
- **AND** 下载完成后移动到目标路径
- **AND** 更新任务状态为 `success`
- **AND** 计算文件大小、MIME 类型等元数据

#### Scenario: 重定向处理

- **WHEN** HTTP 响应为 3xx 重定向
- **THEN** 服务器应自动跟随重定向
- **AND** 最多跟随 5 次

#### Scenario: 超时重试

- **WHEN** HTTP 请求超时 (连接超时 10s 或读取超时 30s)
- **THEN** 服务器应重试最多 2 次
- **AND** 使用指数退避策略 (1s, 2s, 4s)
- **AND** 所有重试失败后标记任务为 `failed`
- **AND** 记录 `errorCode: "TIMEOUT"`

#### Scenario: 429 限速响应

- **WHEN** HTTP 响应为 429 Too Many Requests
- **THEN** 服务器应读取 `Retry-After` 响应头
- **AND** 延迟相应时间后重试
- **AND** 记录 `errorCode: "RATE_LIMITED"`

#### Scenario: 下载失败

- **WHEN** HTTP 响应为 4xx 或 5xx 错误
- **THEN** 服务器应标记任务为 `failed`
- **AND** 记录完整的 `errorCode` 和 `errorMessage`
- **AND** 不重试 4xx 错误 (客户端错误)

---

### Requirement: 文件存储和路径管理

服务器 SHALL 负责创建目标目录、安全写入文件，并计算多种相对路径供客户端使用。

#### Scenario: 自动创建目录

- **WHEN** 目标路径的父目录不存在
- **THEN** 服务器应递归创建所有必要的目录
- **AND** 使用安全的权限设置

#### Scenario: 文件复制优化 (APFS)

- **WHEN** 缓存命中需要复制文件，且文件系统支持 APFS clonefile
- **THEN** 服务器应使用 `clonefile` API
- **AND** 标记 `copyMethod: "apfs-clone"`

#### Scenario: 文件复制优化 (硬链接)

- **WHEN** APFS clone 不可用，但源和目标在同一文件系统
- **THEN** 服务器应创建硬链接
- **AND** 标记 `copyMethod: "hardlink"`

#### Scenario: 普通文件复制

- **WHEN** 优化方法均不可用
- **THEN** 服务器应执行普通文件复制
- **AND** 标记 `copyMethod: "copy"`

#### Scenario: 计算相对路径

- **WHEN** 文件成功保存
- **THEN** 服务器应计算 `relativePath = path.relative(relativeTo, absolutePath)`
- **AND** 计算 `relativePathFromDoc = path.relative(path.dirname(docPath), absolutePath)`
- **AND** 在响应中同时返回两种相对路径

---

### Requirement: In-Flight 下载去重

服务器 SHALL 检测并合并对相同 URL 的并发下载请求，避免重复的网络请求。

#### Scenario: 首次下载请求

- **WHEN** 某个 URL 哈希首次进入下载队列
- **THEN** 服务器应注册该 URL 到 InFlightRegistry
- **AND** 启动真实的 HTTP 下载

#### Scenario: 重复下载请求

- **WHEN** 某个 URL 哈希已在 InFlightRegistry 中 (正在下载)
- **THEN** 服务器应等待第一个下载完成
- **AND** 复用第一个下载的结果
- **AND** 不发起新的 HTTP 请求

#### Scenario: 下载完成清理

- **WHEN** URL 下载完成或失败
- **THEN** 服务器应从 InFlightRegistry 中移除该 URL
- **AND** 唤醒所有等待该 URL 的任务

---

### Requirement: 任务取消

服务器 SHALL 支持取消正在进行或排队中的任务。

#### Scenario: 取消排队任务

- **WHEN** 客户端 POST `/api/jobs/:id/cancel` 取消一个排队中的任务
- **THEN** 服务器应将任务状态设为 `cancelled`
- **AND** 从下载队列中移除该任务
- **AND** 返回 200 状态码

#### Scenario: 取消进行中任务

- **WHEN** 取消一个正在下载的任务
- **THEN** 服务器应中止 HTTP 请求 (使用 AbortController)
- **AND** 删除临时文件
- **AND** 标记任务为 `cancelled`

#### Scenario: 取消已完成任务

- **WHEN** 尝试取消一个已完成的任务
- **THEN** 服务器应返回 409 Conflict 状态码
- **AND** 错误消息说明任务已完成，无法取消

---

### Requirement: 任务和缓存持久化

服务器 SHALL 将任务状态和缓存索引持久化到磁盘，支持崩溃后的状态恢复。

#### Scenario: 任务日志持久化

- **WHEN** 任务状态发生变化 (创建、更新、完成)
- **THEN** 服务器应将变更追加到任务日志文件
- **AND** 日志格式为 JSON Lines (每行一个 JSON 对象)

#### Scenario: 缓存日志持久化

- **WHEN** 缓存索引发生变化 (添加、更新、删除)
- **THEN** 服务器应将变更追加到缓存日志文件
- **AND** 周期性生成 snapshot 快照

#### Scenario: 启动时状态恢复

- **WHEN** 服务器启动
- **THEN** 应加载最近的 snapshot
- **AND** Replay 之后的日志
- **AND** 重建内存中的任务和缓存状态
- **AND** 对未完成的任务，标记为 `failed` 并记录原因

#### Scenario: 日志压缩

- **WHEN** 日志文件大小超过阈值或条目数过多
- **THEN** 服务器应生成新的 snapshot
- **AND** 删除已纳入 snapshot 的旧日志

---

### Requirement: SSE 实时推送 (可选实现)

当实现 Server-Sent Events 功能时，服务器 SHALL 提供 SSE 接口来实时推送任务进度更新，减少客户端轮询频率。此功能为可选实现，但一旦实现必须遵循以下规范。

#### Scenario: 建立 SSE 连接

- **WHEN** 客户端 GET `/api/jobs/:id/stream` 并接受 `text/event-stream`
- **THEN** 服务器应建立 SSE 连接
- **AND** 发送初始任务状态事件

#### Scenario: 推送进度更新

- **WHEN** 任务中某个资源状态变化
- **THEN** 服务器应通过 SSE 推送更新事件
- **AND** 事件数据包含资源 URL、新状态、进度百分比

#### Scenario: 连接断开

- **WHEN** 客户端关闭连接或网络中断
- **THEN** 服务器应清理 SSE 连接资源
- **AND** 客户端可回退到轮询模式

---

### Requirement: 缓存 LRU 淘汰

服务器 SHALL 实现 LRU (Least Recently Used) 缓存淘汰策略，防止缓存无限增长。

#### Scenario: 缓存未达上限

- **WHEN** 缓存条目数小于 `maxCacheEntries`
- **THEN** 新缓存项直接添加
- **AND** 不触发淘汰

#### Scenario: 缓存达到上限

- **WHEN** 缓存条目数达到 `maxCacheEntries`，且需要添加新项
- **THEN** 服务器应删除最久未使用的缓存项
- **AND** 将删除操作写入日志
- **AND** 可选地删除对应的文件 (根据配置)

#### Scenario: 更新访问时间

- **WHEN** 缓存项被命中使用
- **THEN** 服务器应更新该项的 `lastAccessedAt` 时间戳
- **AND** 将该项移到 LRU 队列末尾

---

### Requirement: 心跳和队列状态反馈

服务器 SHALL 定期更新任务的心跳时间戳，并提供清晰的队列状态原因，帮助客户端判断任务进度。

#### Scenario: 更新心跳

- **WHEN** 任务正在执行或排队
- **THEN** 服务器应每 5 秒更新 `heartbeatAt` 时间戳
- **AND** 客户端可通过心跳判断服务器是否正常工作

#### Scenario: 队列原因说明

- **WHEN** 任务处于排队状态
- **THEN** `queueReason` 应设置为明确的原因
- **AND** 可能的值包括: `"waiting_global_limit"`, `"waiting_host_limit"`, `"waiting_host_throttle"`

#### Scenario: 心跳长时间未更新

- **WHEN** 客户端检测到 `heartbeatAt` 超过 30 秒未更新
- **THEN** 客户端应认为任务可能卡住
- **AND** 可提示用户取消或重试

---

### Requirement: 元数据构建

服务器 SHALL 为每个成功下载的资源构建完整的元数据，包括文件大小、MIME 类型、路径等信息。

#### Scenario: 构建完整元数据

- **WHEN** 资源下载成功
- **THEN** 响应中的资源对象应包含以下字段:
  - `url`: 原始 URL
  - `filename`: 最终文件名
  - `absolutePath`: 绝对路径
  - `relativePath`: 相对于 `relativeTo` 的路径
  - `relativePathFromDoc`: 相对于文档的路径
  - `size`: 文件大小 (字节)
  - `mimeType`: MIME 类型
  - `cacheHit`: 是否命中缓存
  - `copiedFromCache`: 是否从缓存复制
  - `fromPath`: 缓存源路径 (如果复制)
  - `status`: `"success"`
  - `downloadDuration`: 下载耗时 (毫秒)

#### Scenario: 失败资源元数据

- **WHEN** 资源下载失败
- **THEN** 响应中的资源对象应包含:
  - `url`: 原始 URL
  - `filename`: 目标文件名
  - `status`: `"failed"`
  - `errorCode`: 错误代码
  - `errorMessage`: 详细错误信息
  - `retryCount`: 重试次数
