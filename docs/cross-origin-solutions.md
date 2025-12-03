# 跨域问题解决方案分析

> 生成时间：2025-12-03
> 针对 Manifest V3 跨域资源下载限制的深度分析

---

## 📋 问题概述

### 用户提出的核心问题

1. **保存的时候会把图片下载到本地么？**
2. **是否还有其他方法解决跨域问题？**
   - 启动一个本地服务
   - 远端服务代理
   - 将 URL 传递给远端服务

---

## ✅ 问题 1：图片下载机制

### 当前实现（V2 和 V3 均适用）

**答案：是的，图片会被下载到本地。**

### 下载流程

```
用户触发剪藏
    ↓
Content Script 提取页面内容
    ↓
解析所有资源 URL（图片、CSS、字体等）
    ↓
创建下载任务 (Task)
    ↓
执行下载：
  - V2: XHR + webRequest.onBeforeSendHeaders（修改请求头绕过 CORS）
  - V3: Fetch API（遵循 CORS 策略）
    ↓
下载到本地文件系统
    ↓
更新 HTML/Markdown 中的资源路径为本地路径
```

### 核心代码位置

#### 1. 图片捕获 (`src/js/capturer/img.js`)

```javascript
async function capture(node, params) {
  // 提取 <img> 的 src 和 srcset
  const r = await CaptureTool.captureAttrResource(node, params, {
    resourceType: 'image',
    attrName: 'src'
  });

  // 创建下载任务
  tasks.push(...r.tasks);

  return {change, tasks};
}
```

#### 2. 创建下载任务 (`src/js/capturer/tool.js:144-180`)

```javascript
async function captureAttrResource(node, params, attrParams) {
  const {url} = T.completeUrl(attrValue, baseUrl);

  // 获取 MIME 类型
  const mimeTypeData = {
    webUrlMimeType: await Asset.getWebUrlMimeType(requestParams.toParams(url), resourceType)
  };

  // 生成文件名和路径
  const {filename, path} = await Asset.getFilenameAndPath({
    link: url,
    mimeTypeData,
    clipId,
    storageInfo,
    resourceType
  });

  // 创建图片下载任务
  tasks.push(Task.createImageTask(filename, url, clipId, requestParams));

  // 更新 HTML 中的 src 属性为本地路径
  change.setAttr(attrName, path);

  return {change, tasks};
}
```

#### 3. 执行下载 (`src/js/saving/browser-download.js`)

```javascript
class Download {
  download() {
    // 使用浏览器的 downloads API
    return this.API.download({
      url: this.options.url,      // 资源 URL
      filename: this.options.filename,  // 保存路径
      saveAs: false                // 自动保存，不弹窗
    });
  }
}
```

### V2 vs V3 下载差异

| 方面 | Manifest V2 | Manifest V3 |
|------|-------------|-------------|
| 请求方式 | XHR (`fetcher-using-xhr.js`) | Fetch API (`fetcher.js`) |
| 请求头修改 | ✅ 可以通过 webRequest 修改 Referer/Origin | ❌ 无法修改（遵循 CORS） |
| 跨域资源 | ✅ 大部分可下载（绕过 CORS） | ⚠️ 部分失败（CORS 限制） |
| 缓存策略 | filterResponseData 内存缓存 | declarativeNetRequest 浏览器缓存 |

### 下载位置

根据配置不同，图片会被保存到：

1. **Browser Handler（默认）**
   - 保存到浏览器默认下载目录
   - 例如：`~/Downloads/maoxian-web-clipper/2025-12-03/page-title/`

2. **Native App Handler**
   - 保存到用户配置的目录
   - 通过本地应用程序处理文件写入

3. **WizNotePlus Handler**
   - 上传到为知笔记服务器

---

## 🔍 问题 2：跨域问题的其他解决方案

### 当前 V3 的限制

**无法修改的请求头：**
- `Referer`：某些图片服务器检查来源
- `Origin`：CORS 预检请求
- `User-Agent`：某些 CDN 的设备识别

**影响范围：**
- 带防盗链的图片（约 20-40%）
- 严格 CORS 策略的 CDN 资源
- 需要特定 Referer 的 API

---

## 💡 解决方案探讨

### 方案 A：Native App 本地代理（已实现）✅

**当前项目已支持！**

#### 工作原理

```
浏览器扩展 ← Native Messaging → 本地应用程序
                                    ↓
                              下载资源（无 CORS 限制）
                                    ↓
                              保存到本地文件系统
```

#### 代码位置

**`src/js/handler/native-app.js`**

```javascript
async function saveTask(task) {
  if (task.type === 'url') {
    // 方式 1：扩展下载 + 本地应用保存
    const blob = await fetchUrlTask(task);  // 扩展中用 Fetch 下载
    const binStr = await T.blob2BinaryString(blob);

    // 发送给本地应用保存
    const msg = {
      type: 'download.url',
      encode: 'base64',
      content: btoa(binStr),  // Base64 编码
      filename: task.filename
    };

    return await (new DownloadMessage(Client, msg)).send();
  }
}
```

#### 优点

- ✅ **完全绕过浏览器 CORS 限制**
- ✅ **已有成熟实现**（本地应用代码在 `dist/native-app/`）
- ✅ **性能较好**（本地通信）
- ✅ **隐私保护**（不经过第三方服务器）

#### 缺点

- ❌ **用户需要额外安装本地程序**
  - Windows、macOS、Linux 需要分别打包
  - 增加了安装复杂度
- ❌ **维护成本高**
  - 需要同时维护扩展和本地应用
  - 跨平台兼容性问题

#### 本地应用架构

根据代码推测，Native App 是一个 **Ruby 应用**：

```javascript
// native-app.js:42
{
  version: resp.version,        // Native App 版本
  rubyVersion: resp.rubyVersion // Ruby 版本
}
```

**Native App 功能：**
1. 接收扩展的下载请求
2. 使用 Ruby 的 HTTP 库下载资源（无浏览器限制）
3. 保存到用户指定目录
4. 管理剪藏历史

**最低版本要求：** `ENV.minNativeAppVersion`

---

### 方案 B：远端代理服务 🆕

#### 架构设计

```
浏览器扩展 → HTTPS → 代理服务器（你的服务器）
                            ↓
                    代理下载目标资源
                            ↓
                    返回给扩展（绕过 CORS）
```

#### 实现方案

##### 方案 B1：简单转发代理

**服务端（Node.js 示例）：**

```javascript
// proxy-server.js
const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.json());

// CORS 头，允许扩展访问
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

// 代理端点
app.post('/api/proxy-download', async (req, res) => {
  try {
    const { url, headers = {} } = req.body;

    // 服务器端下载（无 CORS 限制）
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0...',
        'Referer': headers.referer || '',
        ...headers
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Failed to fetch: ${response.statusText}`
      });
    }

    // 获取二进制数据
    const buffer = await response.buffer();
    const contentType = response.headers.get('content-type');

    // 返回 Base64 编码（或直接流式传输）
    res.json({
      data: buffer.toString('base64'),
      contentType: contentType,
      size: buffer.length
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log('Proxy server running on http://localhost:3000');
});
```

**客户端（扩展）：**

```javascript
// src/js/lib/fetcher.js 修改
async function fetchThroughProxy(url, requestOptions = {}) {
  const proxyUrl = 'https://your-proxy-server.com/api/proxy-download';
  // 或本地：'http://localhost:3000/api/proxy-download'

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: url,
      headers: requestOptions.headers || {}
    })
  });

  const result = await response.json();

  if (result.error) {
    throw new Error(result.error);
  }

  // 将 Base64 转回 Blob
  const binaryString = atob(result.data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new Blob([bytes], { type: result.contentType });
}
```

##### 方案 B2：智能代理（失败时才使用）

```javascript
// 混合策略
async function fetchWithFallback(url, options) {
  try {
    // 1. 先尝试直接下载
    return await fetch(url, options);
  } catch (corsError) {
    console.warn('CORS failed, using proxy:', url);

    // 2. CORS 失败时使用代理
    return await fetchThroughProxy(url, options);
  }
}
```

#### 优点

- ✅ **无需安装本地程序**
- ✅ **统一的用户体验**
- ✅ **易于部署和更新**
- ✅ **可以添加额外功能**（如图片压缩、格式转换）

#### 缺点

- ❌ **隐私问题**
  - 所有资源 URL 会经过代理服务器
  - 需要明确告知用户并获得同意
  - 需要有隐私政策

- ❌ **服务器成本**
  - 带宽成本（图片传输）
  - 计算资源（并发请求）
  - 存储成本（如果缓存）

- ❌ **可靠性依赖**
  - 服务器故障会导致功能失效
  - 需要 99.9% 可用性保证

- ❌ **法律风险**
  - 可能违反某些网站的 ToS
  - 版权和知识产权问题

- ❌ **延迟增加**
  - 额外的网络跳转

#### 成本估算

**假设：**
- 每天 1000 个活跃用户
- 每个用户平均剪藏 10 次
- 每次剪藏平均 10 张图片（每张 200KB）

**计算：**
```
每天流量 = 1000 用户 × 10 次 × 10 图片 × 200KB
         = 20,000 MB = 20 GB/天
         ≈ 600 GB/月
```

**云服务成本（AWS/阿里云）：**
- 流量费用：约 $60-100/月
- 服务器：t3.small ($15/月) 或更高
- **总计：$75-150/月**

如果使用 **Serverless（Lambda/Cloud Functions）：**
- 可能降到 $30-50/月

---

### 方案 C：本地 HTTP 服务（类似 Native App）🆕

#### 工作原理

启动一个本地 HTTP 服务器（127.0.0.1），扩展通过 HTTP 请求下载资源。

```
浏览器扩展 → HTTP (localhost:8080) → 本地 HTTP 服务
                                        ↓
                                  下载资源（无 CORS）
                                        ↓
                                  返回数据流
```

#### 对比 Native Messaging

| 方面 | Native Messaging | 本地 HTTP 服务 |
|------|------------------|----------------|
| 通信方式 | stdin/stdout | HTTP/WebSocket |
| 安装复杂度 | 需要 manifest 注册 | 独立启动 |
| 跨浏览器 | 需要分别配置 | 通用（任何浏览器） |
| 性能 | 稍快 | 稍慢（HTTP 开销） |
| 调试 | 困难 | 容易（curl/Postman） |

#### 实现示例

**本地服务（Node.js）：**

```javascript
const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.json());

// 允许来自扩展的请求
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'chrome-extension://*');
  res.header('Access-Control-Allow-Origin', 'moz-extension://*');
  next();
});

app.post('/download', async (req, res) => {
  const { url, headers } = req.body;

  const response = await fetch(url, { headers });
  const buffer = await response.buffer();

  res.set('Content-Type', response.headers.get('content-type'));
  res.send(buffer);
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

app.listen(8080, '127.0.0.1', () => {
  console.log('Local proxy running on http://127.0.0.1:8080');
});
```

#### 优点

- ✅ **调试方便**
- ✅ **跨浏览器**
- ✅ **无需 Native Messaging 配置**

#### 缺点

- ❌ **用户需要手动启动服务**
- ❌ **端口冲突风险**
- ❌ **安全性问题**（需要验证请求来源）

---

### 方案 D：Service Worker Fetch Handler（理论探索）⚠️

#### 可能性探索

Service Worker 可以拦截 fetch 请求，理论上可以：

```javascript
// background.js (Service Worker)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 拦截特定的资源请求
  if (url.hostname === 'some-cdn.com') {
    event.respondWith(
      fetch(event.request, {
        mode: 'no-cors',  // 尝试绕过 CORS
        // ...
      })
    );
  }
});
```

#### 限制

- ❌ **`mode: 'no-cors'` 返回的是 opaque response**
  - 无法读取响应体
  - 无法获取状态码
  - 本质上无法使用

- ❌ **Service Worker 只能拦截自己域下的请求**
  - 无法拦截其他网站的资源请求

**结论：此方案在 V3 中不可行。**

---

## 📊 方案对比总结

| 方案 | 实现难度 | 用户体验 | 隐私性 | 成本 | 可靠性 | 推荐度 |
|------|---------|---------|--------|------|--------|--------|
| **A. Native App**（已实现） | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | 免费 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **B1. 远端代理（全量）** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | 高 | ⭐⭐⭐ | ⭐⭐ |
| **B2. 远端代理（fallback）** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | 中 | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **C. 本地 HTTP 服务** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | 免费 | ⭐⭐⭐ | ⭐⭐⭐ |
| **D. SW Fetch Handler** | N/A | N/A | N/A | N/A | N/A | ❌ 不可行 |

---

## 🎯 推荐方案

### 短期（立即可用）

**继续使用 Native App Handler**

当前项目已有成熟的 Native App 实现，建议：

1. **完善文档**
   - 添加详细的安装指南
   - 制作安装视频教程
   - 提供常见问题解答

2. **简化安装流程**
   - 提供一键安装脚本
   - 自动检测操作系统
   - 自动配置 Native Messaging

3. **提供替代方案**
   - 对于不想安装本地程序的用户，明确说明限制
   - 建议使用 Firefox（如果继续支持 V2）

### 中期（3-6 个月）

**混合方案：Native App + Fallback Proxy**

```javascript
// 智能选择下载方式
async function downloadResource(url, options) {
  // 1. 检查 Native App 是否可用
  const nativeAppAvailable = await checkNativeAppStatus();

  if (nativeAppAvailable) {
    // 优先使用 Native App（最佳隐私和性能）
    return await downloadViaNativeApp(url, options);
  }

  // 2. 尝试直接下载
  try {
    return await fetch(url, options);
  } catch (corsError) {
    // 3. CORS 失败，提示用户选择
    const userChoice = await showProxyDialog();

    if (userChoice === 'use-proxy') {
      // 使用远端代理（需要用户同意）
      return await fetchThroughProxy(url, options);
    } else {
      // 标记资源下载失败
      throw corsError;
    }
  }
}
```

**优点：**
- ✅ 最大化兼容性
- ✅ 用户有选择权
- ✅ 隐私优先（Native App first）

### 长期（1 年+）

**等待浏览器 API 演进**

关注以下可能性：

1. **Manifest V3 API 增强**
   - Google 可能会提供更灵活的 declarativeNetRequest
   - 可能会有新的权限模型

2. **Web 标准演进**
   - CORS 策略可能会放宽
   - 新的 Fetch API 特性

3. **社区反馈**
   - 其他扩展的解决方案
   - 最佳实践的形成

---

## 🚀 实施建议

### 如果选择实现远端代理

#### 隐私保护措施

1. **用户明确同意**
   ```javascript
   // 首次使用时弹窗
   const consent = await showConsentDialog({
     title: '使用代理服务？',
     message: `
       某些资源因浏览器限制无法直接下载。

       您可以选择使用我们的代理服务下载这些资源。
       代理服务器会临时接收资源 URL，但不会存储任何数据。

       或者，您可以安装本地程序以获得更好的隐私保护。
     `,
     options: ['使用代理', '安装本地程序', '跳过']
   });
   ```

2. **隐私政策**
   - 明确说明数据流向
   - 声明不记录日志
   - 提供开源代码（可选）

3. **技术保护**
   - 使用 HTTPS
   - 不记录日志
   - 定期删除临时文件
   - 限流防止滥用

#### 降低成本

1. **缓存策略**
   ```javascript
   // 服务端缓存热门资源
   const cache = new LRU({ max: 1000, ttl: 1000 * 60 * 60 });

   app.post('/api/proxy-download', async (req, res) => {
     const { url } = req.body;
     const cacheKey = crypto.createHash('md5').update(url).digest('hex');

     // 检查缓存
     const cached = cache.get(cacheKey);
     if (cached) {
       return res.json(cached);
     }

     // 下载并缓存
     const data = await fetchResource(url);
     cache.set(cacheKey, data);

     res.json(data);
   });
   ```

2. **CDN 加速**
   - 使用 CloudFlare Workers（免费额度）
   - 或 Vercel Edge Functions

3. **限流**
   ```javascript
   const rateLimit = require('express-rate-limit');

   app.use('/api/proxy-download', rateLimit({
     windowMs: 15 * 60 * 1000, // 15 分钟
     max: 100 // 每个 IP 最多 100 次请求
   }));
   ```

---

## 📚 代码示例：完整混合方案

```javascript
// src/js/lib/cross-origin-fetcher.js

class CrossOriginFetcher {
  constructor() {
    this.nativeAppAvailable = false;
    this.proxyConsent = false;
    this.checkNativeApp();
  }

  async checkNativeApp() {
    try {
      const info = await NativeAppHandler.getInfo();
      this.nativeAppAvailable = info.ready;
    } catch (e) {
      this.nativeAppAvailable = false;
    }
  }

  async fetch(url, options = {}) {
    // 策略 1: Native App（最佳）
    if (this.nativeAppAvailable) {
      try {
        return await this.fetchViaNativeApp(url, options);
      } catch (e) {
        console.warn('Native App failed, trying direct fetch');
      }
    }

    // 策略 2: 直接下载
    try {
      return await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
        ...options
      });
    } catch (corsError) {
      console.warn('Direct fetch failed due to CORS:', url);

      // 策略 3: 代理（需要用户同意）
      if (!this.proxyConsent) {
        this.proxyConsent = await this.requestProxyConsent();
      }

      if (this.proxyConsent) {
        return await this.fetchViaProxy(url, options);
      } else {
        throw new Error('CORS error and proxy not consented');
      }
    }
  }

  async fetchViaNativeApp(url, options) {
    // 实现见 native-app.js
    const task = {
      type: 'url',
      url: url,
      filename: 'temp.bin'
    };
    return await NativeAppHandler.fetchUrlTask(task);
  }

  async fetchViaProxy(url, options) {
    const proxyUrl = 'https://proxy.your-domain.com/api/proxy';
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, headers: options.headers })
    });

    const result = await response.json();
    const blob = this.base64ToBlob(result.data, result.contentType);
    return new Response(blob);
  }

  async requestProxyConsent() {
    // UI 提示用户
    return new Promise((resolve) => {
      // 显示弹窗...
      resolve(userAgreed);
    });
  }

  base64ToBlob(base64, mimeType) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }
}

export default new CrossOriginFetcher();
```

---

## 🎯 最终建议

### 对于个人开发者

**推荐方案：Native App（当前实现） + 改进文档**

1. 完善 Native App 安装文档
2. 制作视频教程
3. 提供一键安装脚本
4. 在 README 中明确说明 V3 的限制

### 对于商业产品

**推荐方案：混合策略**

1. **优先使用 Native App**（最佳隐私）
2. **提供可选的代理服务**（需要付费/订阅）
   - 明确告知用户数据流向
   - 提供隐私政策
   - 考虑开源代理服务端代码
3. **清晰的降级提示**
   - 无法下载时，标记失败原因
   - 引导用户安装 Native App

### 对于开源项目

**推荐方案：Native App Only**

- 避免运营成本（代理服务器）
- 保持用户隐私
- 社区可以自行搭建代理服务

---

*本文档由 AI 辅助生成，基于对项目代码的深度分析。*
