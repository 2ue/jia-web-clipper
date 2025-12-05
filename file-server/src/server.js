#!/usr/bin/env node

import express from 'express';
import config from './utils/config.js';
import logger from './utils/logger.js';
import routes from './api/routes.js';
import { authMiddleware } from './security/auth.js';

const app = express();

// 中间件
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 认证中间件 (在路由之前)
app.use(authMiddleware);

// 请求日志
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// 注册路由
app.use('/', routes);

// 404 处理
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// 错误处理
app.use((err, req, res, _next) => {
  logger.error('Server error:', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// 启动服务器
function start() {
  // 确保必要的目录存在
  config.ensureDirectories();

  const port = config.get('server.port');
  const host = config.get('server.host');
  const token = config.get('auth.token');

  app.listen(port, host, () => {
    logger.info(`🚀 MaoXian File Server started`);
    logger.info(`   Server: http://${host}:${port}`);
    logger.info(`   Health: http://${host}:${port}/health`);
    logger.info(`   Authorize: http://${host}:${port}/authorize`);
    logger.info(`   Token: ${token}`);
    logger.info('');
    logger.info('Press Ctrl+C to stop');
  });

  // 优雅退出
  process.on('SIGINT', () => {
    logger.info('Shutting down gracefully...');
    process.exit(0);
  });
}

// 仅在直接运行时启动
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

export { app, start };
