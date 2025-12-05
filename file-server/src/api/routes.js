import express from 'express';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import jobService from '../jobs/job-service.js';

const router = express.Router();

/**
 * 健康检查接口
 */
router.get('/health', (req, res) => {
  const uptime = process.uptime();
  res.json({
    status: 'ok',
    version: '0.1.0',
    uptime: Math.floor(uptime),
    timestamp: new Date().toISOString()
  });
});

/**
 * 授权页面 - 展示当前 Token
 */
router.get('/authorize', (req, res) => {
  const token = config.get('auth.token');
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MaoXian File Server - Authorization</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      margin-top: 0;
    }
    .token-box {
      background: #f0f0f0;
      padding: 15px;
      border-radius: 4px;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 14px;
      word-break: break-all;
      margin: 20px 0;
      border: 1px solid #ddd;
    }
    button {
      background: #007bff;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover {
      background: #0056b3;
    }
    .success {
      display: none;
      color: #28a745;
      margin-top: 10px;
    }
    .info {
      color: #666;
      font-size: 14px;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 MaoXian File Server</h1>
    <p class="info">请将以下 Token 配置到 MaoXian Web Clipper 插件的设置页面中：</p>

    <div class="token-box" id="token">${token}</div>

    <button onclick="copyToken()">复制 Token</button>
    <div class="success" id="success">✓ Token 已复制到剪贴板</div>

    <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">

    <h3>配置步骤：</h3>
    <ol class="info">
      <li>打开 MaoXian Web Clipper 插件设置</li>
      <li>找到 "File Server" 配置项</li>
      <li>输入服务器地址：<code>http://${config.get('server.host')}:${config.get('server.port')}</code></li>
      <li>粘贴上方的 Token</li>
      <li>点击"测试连接"验证配置</li>
    </ol>
  </div>

  <script>
    function copyToken() {
      const token = document.getElementById('token').textContent;
      navigator.clipboard.writeText(token).then(() => {
        const success = document.getElementById('success');
        success.style.display = 'block';
        setTimeout(() => {
          success.style.display = 'none';
        }, 3000);
      });
    }
  </script>
</body>
</html>
  `;

  res.send(html);
});

/**
 * API 路由占位 (后续实现)
 */
router.post('/api/jobs', async (req, res) => {
  try {
    const job = await jobService.createJob(req.body);
    res.status(202).json({ ok: true, job });
  } catch (error) {
    logger.warn('Failed to create job', { error: error.message });
    if (error.message && error.message.includes('resources')) {
      return res.status(400).json({ error: 'Bad Request', message: error.message });
    }
    if (error.message && error.message.includes('saveDir')) {
      return res.status(400).json({ error: 'Bad Request', message: error.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

router.get('/api/jobs/:id', (req, res) => {
  const job = jobService.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Not Found', message: 'Job not found' });
  }
  res.json({ ok: true, job });
});

router.post('/api/jobs/:id/cancel', (req, res) => {
  try {
    const job = jobService.cancelJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Not Found', message: 'Job not found' });
    }
    res.json({ ok: true, job });
  } catch (error) {
    if (error.message === 'Job already finished') {
      return res.status(409).json({ error: 'Conflict', message: error.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

export default router;
