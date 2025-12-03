# CLI Server 简化版：纯图片下载代理

> 核心定位：**只负责下载图片，返回路径信息**
>
> 扩展负责：HTML 处理、路径替换、最终保存

---

## 🎯 核心设计理念

### 职责分离

```
┌──────────────────────┐
│    浏览器扩展         │
│  ┌────────────────┐  │
│  │  提取页面内容   │  │
│  │  处理 HTML      │  │
│  │  替换图片路径   │  │
│  │  保存最终文件   │  │
│  └────────┬───────┘  │
└───────────┼──────────┘
            │ 只发送图片 URLs
            ↓
┌──────────────────────┐
│    CLI Server        │
│  ┌────────────────┐  │
│  │  下载图片       │  │ ← 绕过 CORS
│  │  返回路径信息   │  │
│  └────────────────┘  │
└──────────────────────┘
```

### 简化的数据流

```
扩展：发现页面有 3 张图片
  ↓
POST /api/download-images
{
  "images": [
    {
      "url": "https://example.com/img1.jpg",
      "filename": "img1.jpg"  // 期望的文件名
    }
  ],
  "saveDir": "/Users/xxx/Downloads/clip-123/assets"
}
  ↓
Server：下载图片到指定目录
  ↓
返回：
{
  "ok": true,
  "results": [
    {
      "url": "https://example.com/img1.jpg",
      "filename": "img1.jpg",
      "absolutePath": "/Users/xxx/Downloads/clip-123/assets/img1.jpg",
      "relativePath": "assets/img1.jpg",  // 相对于剪藏根目录
      "size": 102400,
      "mimeType": "image/jpeg"
    }
  ]
}
  ↓
扩展：替换 HTML 中的图片路径
<img src="https://example.com/img1.jpg">
  ↓
<img src="assets/img1.jpg">
  ↓
保存 HTML 文件
```

---

## 🔌 最简 API

### 唯一的下载接口

```http
POST /api/download-images

Headers:
  Content-Type: application/json
  X-Auth-Token: <token>

Request Body:
{
  "images": [
    {
      "url": "https://example.com/image.jpg",
      "filename": "image.jpg"  // 可选，不提供则自动提取
    }
  ],
  "saveDir": "/absolute/path/to/save",
  "relativeTo": "/absolute/path/to/clip-root"  // 用于计算相对路径
}

Response:
{
  "ok": true,
  "results": [
    {
      "url": "https://example.com/image.jpg",
      "filename": "image.jpg",
      "absolutePath": "/absolute/path/to/save/image.jpg",
      "relativePath": "assets/image.jpg",  // 相对于 relativeTo
      "size": 102400,
      "mimeType": "image/jpeg",
      "ok": true
    }
  ]
}

// 如果某些图片失败：
{
  "ok": true,  // 整体请求成功
  "results": [
    {
      "url": "https://example.com/fail.jpg",
      "filename": "fail.jpg",
      "ok": false,
      "error": "Download timeout"
    }
  ]
}
```

### 路径计算逻辑

```javascript
// Server 端计算相对路径
function getRelativePath(absolutePath, relativeTo) {
  // absolutePath: /Users/xxx/Downloads/clip-123/assets/img1.jpg
  // relativeTo:   /Users/xxx/Downloads/clip-123
  // 返回:          assets/img1.jpg

  return path.relative(relativeTo, absolutePath);
}
```

---

## 💻 精简的 Server 实现

### 核心代码（~200 行）

```javascript
// server.js - 完整实现
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';

const app = express();
const PORT = 7298;
const TOKEN = crypto.randomBytes(32).toString('hex');

// CORS：允许扩展访问
app.use(cors({
  origin: (origin, callback) => {
    if (!origin ||
        origin.startsWith('chrome-extension://') ||
        origin.startsWith('moz-extension://')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed'));
    }
  }
}));

app.use(express.json({limit: '10mb'}));

// 健康检查
app.get('/health', (req, res) => {
  res.json({ok: true, version: '1.0.0'});
});

// 授权页面
app.get('/authorize', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Token 授权</title>
      <style>
        body {
          font-family: sans-serif;
          max-width: 500px;
          margin: 100px auto;
          text-align: center;
        }
        .token {
          background: #f0f0f0;
          padding: 20px;
          border-radius: 5px;
          font-family: monospace;
          word-break: break-all;
          margin: 20px 0;
          font-size: 14px;
        }
        button {
          background: #4CAF50;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 16px;
        }
      </style>
    </head>
    <body>
      <h1>🔐 Clipper Server Token</h1>
      <p>将此 Token 复制到扩展设置中：</p>
      <div class="token">${TOKEN}</div>
      <button onclick="navigator.clipboard.writeText('${TOKEN}');alert('已复制')">
        复制 Token
      </button>
    </body>
    </html>
  `);
});

// Token 验证中间件
app.use('/api/*', (req, res, next) => {
  const token = req.headers['x-auth-token'];
  if (token !== TOKEN) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: '请访问 http://127.0.0.1:7298/authorize'
    });
  }
  next();
});

// 核心：下载图片
app.post('/api/download-images', async (req, res) => {
  const { images, saveDir, relativeTo } = req.body;

  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({
      error: 'images must be a non-empty array'
    });
  }

  if (!saveDir) {
    return res.status(400).json({
      error: 'saveDir is required'
    });
  }

  try {
    // 确保目录存在
    await fs.mkdir(saveDir, { recursive: true });

    // 并发下载（最多 3 个）
    const results = await downloadImages(images, saveDir, relativeTo || saveDir);

    res.json({
      ok: true,
      results
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// 下载函数
async function downloadImages(images, saveDir, relativeTo) {
  const maxConcurrency = 3;
  const results = [];
  const queue = [...images];
  const running = new Set();

  while (queue.length > 0 || running.size > 0) {
    // 启动新任务
    while (running.size < maxConcurrency && queue.length > 0) {
      const image = queue.shift();
      const promise = downloadOne(image, saveDir, relativeTo)
        .then(result => {
          results.push(result);
          running.delete(promise);
        })
        .catch(error => {
          results.push({
            url: image.url,
            filename: image.filename,
            ok: false,
            error: error.message
          });
          running.delete(promise);
        });

      running.add(promise);
    }

    if (running.size > 0) {
      await Promise.race(running);
    }
  }

  return results;
}

async function downloadOne(image, saveDir, relativeTo) {
  const { url, filename: userFilename } = image;

  // 确定文件名
  const filename = userFilename || extractFilename(url);
  const absolutePath = path.join(saveDir, filename);
  const relativePath = path.relative(relativeTo, absolutePath);

  try {
    // 下载
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    // 流式写入
    await pipeline(response.data, createWriteStream(absolutePath));

    // 获取文件信息
    const stats = await fs.stat(absolutePath);

    return {
      url,
      filename,
      absolutePath,
      relativePath,
      size: stats.size,
      mimeType: response.headers['content-type'] || 'application/octet-stream',
      ok: true
    };

  } catch (error) {
    throw new Error(`下载失败: ${error.message}`);
  }
}

function extractFilename(url) {
  try {
    const urlObj = new URL(url);
    let filename = path.basename(urlObj.pathname);

    if (!filename || filename === '/') {
      filename = 'image.jpg';
    }

    // 确保有扩展名
    if (!path.extname(filename)) {
      filename += '.jpg';
    }

    return filename;
  } catch {
    return `image-${Date.now()}.jpg`;
  }
}

// 启动服务器
app.listen(PORT, '127.0.0.1', () => {
  console.log('✅ Clipper Server 已启动');
  console.log(`📍 地址: http://127.0.0.1:${PORT}`);
  console.log(`🔑 Token: ${TOKEN}`);
  console.log(`🔗 授权: http://127.0.0.1:${PORT}/authorize`);
});
```

### CLI 包装（可选）

```javascript
#!/usr/bin/env node
// cli.js
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import open from 'open';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, 'server.js');

console.log('正在启动 Clipper Server...');

const server = spawn('node', [serverPath], {
  stdio: 'inherit'
});

// 2秒后打开授权页面
setTimeout(() => {
  open('http://127.0.0.1:7298/authorize');
}, 2000);

process.on('SIGINT', () => {
  server.kill();
  process.exit();
});
```

---

## 🔧 扩展端集成

### 简化的 Handler

```javascript
// src/js/handler/server.js
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
  }

  async getInfo() {
    try {
      const response = await fetch(`${this.serverUrl}/health`);
      if (!this.token) {
        return {
          ready: false,
          message: '请先配置 Token'
        };
      }
      return { ready: true, supportFormats: ['html', 'md'] };
    } catch {
      return { ready: false, message: 'Server 未运行' };
    }
  }

  async saveClipping(clipping, feedback) {
    const savingTool = new SavingTool.SaveClipping(clipping, feedback, {
      mode: SavingTool.SaveClipping.MODE.COMPLETE_WHEN_ALL_TASK_FINISHED
    });

    try {
      // 1. 准备图片任务
      const imageTasks = clipping.tasks.filter(t => t.type === 'url');
      const textTasks = clipping.tasks.filter(t => t.type === 'text');

      // 2. 获取保存路径
      const config = await MxWcConfig.load();
      const clipId = clipping.info.clipId;
      const clipRoot = path.join(config.rootFolder, clipId);
      const assetsDir = path.join(clipRoot, 'assets');

      // 3. 调用 Server 下载图片
      if (imageTasks.length > 0) {
        const response = await fetch(`${this.serverUrl}/api/download-images`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': this.token
          },
          body: JSON.stringify({
            images: imageTasks.map(t => ({
              url: t.url,
              filename: t.filename
            })),
            saveDir: assetsDir,
            relativeTo: clipRoot  // 用于计算相对路径
          })
        });

        const result = await response.json();

        if (!result.ok) {
          throw new Error(result.error);
        }

        // 4. 更新 HTML 中的图片路径
        let html = textTasks[0]?.content || textTasks[0]?.text;

        result.results.forEach(img => {
          if (img.ok) {
            // 替换图片路径
            html = html.replace(img.url, img.relativePath);

            // 标记任务完成
            const task = imageTasks.find(t => t.url === img.url);
            if (task) {
              savingTool.taskCompleted(task, {
                fullFilename: img.absolutePath
              });
            }
          } else {
            // 标记任务失败
            const task = imageTasks.find(t => t.url === img.url);
            if (task) {
              savingTool.taskFailed(task, img.error);
            }
          }
        });

        // 5. 保存最终的 HTML（扩展负责）
        const htmlPath = path.join(clipRoot, 'index.html');
        await this.saveHtml(htmlPath, html);

        if (textTasks[0]) {
          savingTool.taskCompleted(textTasks[0], {
            fullFilename: htmlPath
          });
        }
      }

    } catch (error) {
      clipping.tasks.forEach(task => {
        savingTool.taskFailed(task, error.message);
      });
    }
  }

  async saveHtml(filepath, content) {
    // 使用浏览器的下载 API 或 fs API
    // 这里简化处理，实际需要使用 Browser Handler 的方法
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);

    // 触发下载
    await chrome.downloads.download({
      url: url,
      filename: filepath,
      saveAs: false
    });

    URL.revokeObjectURL(url);
  }
}
```

---

## 📦 安装和使用

### 安装

**方式 1：npm 全局安装（推荐）**

```bash
npm install -g mx-clipper-server

# 启动
mx-clipper-server

# 自动打开授权页面
```

**方式 2：直接运行源码**

```bash
# 克隆代码
git clone https://github.com/xxx/mx-clipper-server
cd mx-clipper-server

# 安装依赖
npm install

# 启动
node server.js
```

### 配置扩展

1. 打开扩展设置
2. 选择"Server"作为存储方式
3. 粘贴 Token
4. 保存

### 使用

正常剪藏即可，Server 会自动：
- 接收图片 URL 列表
- 下载图片到指定目录
- 返回路径信息
- 扩展替换 HTML 路径并保存

---

## 🎯 核心优势

### 1. 极简设计

- **Server 端**：~200 行代码，只做一件事
- **扩展端**：HTML 处理和保存仍在扩展中，逻辑清晰
- **职责明确**：Server = 下载代理，Extension = 内容处理

### 2. 灵活性高

```javascript
// 扩展可以自由决定：
// - 图片保存在哪里
// - 如何组织目录结构
// - 如何处理路径替换
// - 最终保存到哪里（本地 / WebDAV / 其他）

// Server 只需要：
// - 一个 URL
// - 一个保存路径
// - 返回结果
```

### 3. 易于扩展

```javascript
// 未来可以轻松添加：
// - 图片压缩
// - 格式转换
// - 智能命名
// - 重复检测

// 只需修改 downloadOne 函数
```

### 4. 调试友好

```bash
# 测试 Server
curl -X POST http://127.0.0.1:7298/api/download-images \
  -H "X-Auth-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "images": [{"url": "https://example.com/test.jpg"}],
    "saveDir": "/tmp/test",
    "relativeTo": "/tmp"
  }'

# 返回：
{
  "ok": true,
  "results": [{
    "url": "https://example.com/test.jpg",
    "filename": "test.jpg",
    "absolutePath": "/tmp/test/test.jpg",
    "relativePath": "test/test.jpg",
    "size": 102400,
    "ok": true
  }]
}
```

---

## 📋 package.json

```json
{
  "name": "mx-clipper-server",
  "version": "1.0.0",
  "description": "Minimal image download proxy for MaoXian Web Clipper",
  "type": "module",
  "bin": {
    "mx-clipper-server": "./cli.js"
  },
  "files": [
    "server.js",
    "cli.js"
  ],
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "axios": "^1.6.0"
  },
  "optionalDependencies": {
    "open": "^9.1.0"
  },
  "keywords": [
    "clipper",
    "image-downloader",
    "cors-bypass"
  ],
  "license": "MIT"
}
```

---

## 🚀 与完整版对比

| 特性 | 完整版 | 简化版 |
|------|--------|--------|
| **代码量** | ~1000 行 | ~200 行 |
| **API 数量** | 5+ | 1 个 |
| **依赖** | 10+ | 3 个 |
| **功能** | 完整剪藏处理 | 只下载图片 |
| **职责** | Server 做所有事 | Server 只做下载 |
| **灵活性** | 较低 | 极高 |
| **学习曲线** | 陡峭 | 平缓 |
| **适合场景** | 独立服务 | 配合扩展 |

---

## ✅ 推荐使用场景

**选择简化版，如果：**
- ✅ 想快速解决 CORS 问题
- ✅ 希望扩展保持对保存流程的控制
- ✅ 需要灵活的路径处理
- ✅ 代码简单易维护

**选择完整版，如果：**
- ✅ 想要独立的剪藏服务
- ✅ 需要 WebDAV 自动上传
- ✅ 需要复杂的后处理逻辑

---

## 💡 总结

**简化版 Server 的定位**：

> **一个专注的图片下载代理，只做好一件事：**
> 接收 URL，下载图片，返回路径

**三个核心价值**：
1. **解决 CORS**：Server 端下载无限制
2. **返回路径**：绝对路径 + 相对路径，方便替换
3. **极简设计**：200 行代码，3 个依赖，1 个 API

**最佳实践**：
- Server 负责下载（绕过 CORS）
- 扩展负责业务逻辑（HTML处理、路径替换、保存）
- 职责清晰，易于维护和扩展

---

*这是一个精简但完整的解决方案，专注于核心需求，避免过度设计。*
