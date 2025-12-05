# Implementation Tasks

## 1. 项目基础设施

- [x] 1.1 初始化 file-server 项目结构
- [x] 1.2 配置 package.json (dependencies, scripts)
- [x] 1.3 设置 ESLint 和代码格式化规则
- [x] 1.4 配置测试框架 (Vitest + Supertest)
- [x] 1.5 创建基础目录结构 (src/, tests/, docs/)

## 2. 核心服务骨架

- [x] 2.1 实现 Express 服务器入口 (src/server.js)
- [x] 2.2 实现配置管理模块 (src/utils/config.js)
- [x] 2.3 实现日志模块 (src/utils/logger.js)
- [x] 2.4 实现健康检查接口 (/health)
- [x] 2.5 实现授权页面接口 (/authorize)
- [x] 2.6 添加基础服务启动测试

## 3. 安全机制实现

- [x] 3.1 实现 Token 认证中间件 (src/security/auth.js)
- [x] 3.2 实现路径白名单校验 (src/security/path-guard.js)
- [x] 3.3 实现路径遍历防护
- [x] 3.4 实现文件名安全校验
- [ ] 3.5 实现速率限制中间件 (可选)
- [x] 3.6 编写安全模块单元测试 (100% 覆盖)

## 4. 存储驱动实现

- [x] 4.1 实现 StorageDriver 基础类 (src/downloads/storage-driver.js)
- [x] 4.2 实现目录自动创建功能
- [x] 4.3 实现文件复制/硬链接/APFS clone
- [x] 4.4 实现相对路径计算 (relativePath, relativePathFromDoc)
- [x] 4.5 实现文件元数据提取
- [x] 4.6 编写 StorageDriver 单元测试

## 5. 缓存索引实现

- [x] 5.1 实现 CacheIndex 内存存储 (src/jobs/cache-index.js)
- [x] 5.2 实现 URL 哈希计算 (SHA-1)
- [x] 5.3 实现 append-only 日志持久化
- [x] 5.4 实现 snapshot 快照机制
- [x] 5.5 实现启动时日志 replay
- [x] 5.6 实现 LRU 淘汰策略
- [x] 5.7 实现失效路径自动清理
- [x] 5.8 编写 CacheIndex 单元测试

## 6. 下载工作器实现

- [x] 6.1 实现 FetchWorker 基础类 (src/downloads/fetch-worker.js)
- [x] 6.2 实现 HTTP 流式下载 (Axios/Undici)
- [x] 6.3 实现超时控制和重试机制
- [x] 6.4 实现重定向处理
- [x] 6.5 实现 Content-Length 校验
- [x] 6.6 实现临时文件管理
- [x] 6.7 编写 FetchWorker 单元测试

## 7. 并发队列实现

- [x] 7.1 实现 QueueManager 基础类 (src/jobs/queue-manager.js)
- [x] 7.2 实现全局并发限制
- [x] 7.3 实现主机级并发限制
- [x] 7.4 实现主机级节流 (per-host throttle)
- [x] 7.5 实现优先级队列
- [x] 7.6 实现排队原因记录 (queueReason)
- [x] 7.7 编写 QueueManager 单元测试

## 8. In-Flight 去重实现

- [x] 8.1 实现 InFlightRegistry (src/jobs/inflight-registry.js)
- [x] 8.2 实现 URL 去重逻辑
- [x] 8.3 实现 Promise 共享机制
- [x] 8.4 实现失败处理和清理
- [x] 8.5 编写 InFlightRegistry 单元测试

## 9. 任务管理服务实现

- [x] 9.1 实现 JobService 基础类 (src/jobs/job-service.js)
- [x] 9.2 实现任务创建和 ID 分配
- [x] 9.3 实现任务状态机管理
- [x] 9.4 实现 heartbeat 更新机制
- [x] 9.5 实现任务统计 (stats)
- [x] 9.6 实现 JobStore 持久化
- [x] 9.7 实现崩溃恢复逻辑
- [x] 9.8 实现任务查询接口
- [x] 9.9 实现任务取消接口
- [ ] 9.10 编写 JobService 单元测试

## 10. 元数据构建器实现

- [x] 10.1 实现 MetadataBuilder (src/downloads/metadata-builder.js)
- [x] 10.2 实现文件大小计算
- [x] 10.3 实现 MIME 类型检测
- [ ] 10.4 实现文件哈希计算 (可选)
- [x] 10.5 实现缓存命中标记
- [ ] 10.6 编写 MetadataBuilder 单元测试

## 11. RESTful API 实现

- [x] 11.1 实现 POST /api/jobs 接口 (创建任务)
- [x] 11.2 实现 GET /api/jobs/:id 接口 (查询任务)
- [ ] 11.3 实现 GET /api/jobs/:id/stream 接口 (SSE 推送)
- [x] 11.4 实现 POST /api/jobs/:id/cancel 接口 (取消任务)
- [x] 11.5 实现请求体验证中间件
- [x] 11.6 实现错误处理中间件
- [x] 11.7 编写 API 集成测试

## 12. 集成测试

- [ ] 12.1 使用 a.md 中的 URL 创建测试 fixtures
- [ ] 12.2 模拟 HTTP 服务器 (Nock/MSW)
- [ ] 12.3 测试完整下载流程 (未命中缓存)
- [ ] 12.4 测试缓存命中流程 (相同路径)
- [ ] 12.5 测试缓存命中流程 (不同路径 → 复制)
- [ ] 12.6 测试失败重试流程
- [ ] 12.7 测试并发限制和节流
- [ ] 12.8 测试崩溃恢复
- [ ] 12.9 测试 429 限速响应
- [ ] 12.10 测试超时处理
- [ ] 12.11 测试 relativePathFromDoc 计算正确性

## 13. 插件集成 (Handler)

- [ ] 13.1 创建 FileServerHandler (src/js/handler/file-server.js)
- [ ] 13.2 实现批量任务提交逻辑
- [ ] 13.3 实现轮询查询逻辑
- [ ] 13.4 实现 SSE 连接逻辑 (可选)
- [ ] 13.5 实现结果应用 (URL → 相对路径替换)
- [ ] 13.6 实现错误处理和重试
- [ ] 13.7 集成到 backend.js

## 14. 配置与 UI

- [ ] 14.1 在 config.js 中添加 File Server 配置项
- [ ] 14.2 在 setting.html 中添加 File Server 设置面板
- [ ] 14.3 实现 Token 配置输入
- [ ] 14.4 实现白名单 profile 选择
- [ ] 14.5 实现连接测试按钮
- [ ] 14.6 实现启用/禁用开关

## 15. 文档编写

- [ ] 15.1 编写 file-server/README.md (服务器使用文档)
- [ ] 15.2 编写 API 文档
- [ ] 15.3 编写插件集成指南
- [ ] 15.4 编写配置示例
- [ ] 15.5 编写故障排查指南
- [ ] 15.6 更新主 README.md

## 16. 端到端测试

- [ ] 16.1 启动 File Server 进程
- [ ] 16.2 配置插件连接 File Server
- [ ] 16.3 执行完整剪辑流程
- [ ] 16.4 验证文件正确保存
- [ ] 16.5 验证缓存复用
- [ ] 16.6 验证相对路径正确

## 17. 性能优化与清理

- [ ] 17.1 审查代码质量
- [ ] 17.2 优化内存使用
- [ ] 17.3 优化磁盘 I/O
- [ ] 17.4 添加性能监控日志
- [ ] 17.5 清理调试代码和注释

## 18. 发布准备

- [ ] 18.1 确保所有测试通过 (覆盖率 >80%)
- [ ] 18.2 更新 CHANGELOG.md
- [ ] 18.3 打包发布版本
- [ ] 18.4 准备发布说明
- [ ] 18.5 代码审查
