# WebDAV 存储方案分析

> 生成时间：2025-12-03
> 用户需求：直接保存内容到 WebDAV，无需本地文件系统

---

## 📋 方案概述

### 核心思路

**将 WebDAV 作为存储后端，替代本地文件系统或 Native App。**

```
用户触发剪藏
    ↓
提取页面内容（HTML + 资源URL列表）
    ↓
下载资源（图片、CSS、字体等）← 仍受 CORS 限制
    ↓
上传到 WebDAV 服务器
    ↓
完成！内容保存在云端
```

---

## ✅ WebDAV 的优势

### 1. 无需 Native App

| 方案 | 需要安装 |
|------|----------|
| Browser Handler | 无（浏览器下载） |
| Native App | ✅ Ruby/Node/Go 程序 |
| **WebDAV Handler** | **❌ 无需安装** |

**用户只需：**
- 有一个 WebDAV 账号（坚果云、Nextcloud 等）
- 在扩展中配置 WebDAV 地址和凭证
- 开始使用！

### 2. 云端存储

| 特性 | 本地存储 | WebDAV |
|------|---------|--------|
| 跨设备访问 | ❌ | ✅ |
| 自动同步 | ❌ | ✅ |
| 备份 | 需要手动 | 自动 |
| 容量 | 受限于磁盘 | 取决于服务商 |
| 分享 | 困难 | 容易 |

### 3. 标准协议，生态成熟

**支持 WebDAV 的服务：**

| 服务 | 类型 | 免费容量 | 国内访问 |
|------|------|----------|----------|
| **坚果云** | 商业 | 1GB/月 | ✅ 快 |
| **Nextcloud** | 自建 | 无限（自己服务器） | ✅ 快 |
| **Seafile** | 自建 | 无限 | ✅ 快 |
| **ownCloud** | 自建 | 无限 | ✅ 快 |
| Box.com | 商业 | 10GB | ⚠️ 较慢 |
| 4shared | 商业 | 15GB | ⚠️ 较慢 |

### 4. 实现相对简单

**浏览器扩展中的 WebDAV 客户端：**

```javascript
// 使用 fetch API 实现 WebDAV 协议
async function uploadToWebDAV(url, content, username, password) {
  const auth = 'Basic ' + btoa(username + ':' + password);

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/octet-stream'
    },
    body: content
  });

  return response.ok;
}
```

**无需外部依赖！** 浏览器原生 fetch API 就能实现。

---

## ⚠️ WebDAV 的限制

### 核心问题：不能解决 CORS

**关键认知：**

> WebDAV 解决的是 **"存储位置"** 问题
> CORS 是 **"资源获取"** 问题
> **两者是正交的！**

#### 问题场景

```
1. 页面上有图片：https://cdn.example.com/image.jpg
2. 扩展尝试下载 ↓
   - 使用 fetch() 请求图片
   - 如果 CDN 有严格的 CORS 策略 → ❌ 失败
3. 即使有 WebDAV，也无法上传（因为根本没下载成功）
```

**示例：**

```javascript
// 扩展中的代码
async function clipImage(imageUrl) {
  try {
    // 1. 尝试下载图片
    const response = await fetch(imageUrl);  // ← 可能因 CORS 失败
    const blob = await response.blob();

    // 2. 上传到 WebDAV
    await uploadToWebDAV('/clipper/image.jpg', blob, username, password);

  } catch (error) {
    // CORS 错误：无法下载图片
    console.error('Failed to download image:', error);
    // 此时 WebDAV 也帮不上忙
  }
}
```

#### CORS 问题仍然存在

| 资源类型 | 典型 CORS 情况 | WebDAV 能解决吗？ |
|---------|----------------|-------------------|
| 同源图片 | ✅ 可下载 | ✅ 可上传 |
| 公开CDN图片 | ✅ 可下载 | ✅ 可上传 |
| 防盗链图片 | ❌ CORS 失败 | ❌ **无法下载，无法上传** |
| 需要 Referer 的资源 | ❌ CORS 失败 | ❌ **无法下载，无法上传** |

**结论：** WebDAV 不能绕过 CORS，只能改变存储位置。

---

## 🔄 组合方案

### 方案 A：WebDAV + Native App（推荐）⭐⭐⭐⭐⭐

**架构：**

```
页面资源
    ↓
Native App 下载（绕过 CORS）
    ↓
返回二进制数据给扩展
    ↓
扩展上传到 WebDAV
    ↓
完成！
```

**优点：**
- ✅ 完全绕过 CORS
- ✅ 云端存储
- ✅ 跨设备同步

**缺点：**
- ⚠️ 仍需安装 Native App（但只用于下载，不管存储）

**实现示例：**

```javascript
// 扩展中的混合方案
async function downloadResource(url) {
  // 1. 优先尝试直接下载
  try {
    const response = await fetch(url);
    if (response.ok) {
      return await response.blob();
    }
  } catch (corsError) {
    console.warn('Direct download failed, trying Native App');
  }

  // 2. CORS 失败，使用 Native App
  if (nativeAppAvailable) {
    return await downloadViaNativeApp(url);
  }

  throw new Error('Cannot download resource');
}

async function clipPageToWebDAV(pageContent, resources) {
  // 1. 下载所有资源
  const downloadedResources = [];
  for (const resource of resources) {
    const blob = await downloadResource(resource.url);
    downloadedResources.push({ filename: resource.filename, blob });
  }

  // 2. 上传 HTML
  const htmlPath = `/clipper/${clipId}/index.html`;
  await webdavClient.put(htmlPath, pageContent.html);

  // 3. 上传资源
  for (const res of downloadedResources) {
    const path = `/clipper/${clipId}/assets/${res.filename}`;
    await webdavClient.put(path, res.blob);
  }

  // 4. 完成
  return { url: webdavClient.getPublicUrl(htmlPath) };
}
```

---

### 方案 B：WebDAV Only（简化版）⭐⭐⭐

**架构：**

```
页面资源
    ↓
fetch() 下载 ← 受 CORS 限制
    ↓
扩展上传到 WebDAV
    ↓
完成（部分资源可能失败）
```

**优点：**
- ✅ 无需安装任何本地程序
- ✅ 配置简单
- ✅ 云端存储

**缺点：**
- ❌ 部分资源因 CORS 无法下载（20-40%）

**适合场景：**
- 主要剪藏文字内容
- 不在意部分图片丢失
- 追求极简安装

**配置界面示例：**

```
WebDAV 设置
├─ 服务器地址：https://dav.jianguoyun.com/dav/
├─ 用户名：your-email@example.com
├─ 密码：app-specific-password
├─ 保存路径：/MaoXian-Clipper/
└─ [测试连接] ← 验证配置是否正确
```

---

### 方案 C：WebDAV + 代理服务（商业）⭐⭐⭐⭐

**架构：**

```
页面资源
    ↓
你的代理服务器下载（绕过 CORS）
    ↓
返回给扩展
    ↓
扩展上传到 WebDAV
    ↓
完成！
```

**优点：**
- ✅ 完全绕过 CORS
- ✅ 无需 Native App
- ✅ 云端存储

**缺点：**
- ⚠️ 需要运营代理服务器（成本 $50-100/月）
- ⚠️ 隐私问题（资源 URL 经过你的服务器）

---

## 🛠️ 实现方案

### WebDAV Handler 实现

#### 1. 配置管理

```javascript
// src/js/lib/config.js
const DEFAULT_CONFIG = {
  // ... 现有配置

  // WebDAV 配置
  webdavEnabled: false,
  webdavUrl: '',           // https://dav.jianguoyun.com/dav/
  webdavUsername: '',      // email
  webdavPassword: '',      // app password
  webdavBasePath: '/MaoXian-Clipper/',
  webdavTimeout: 30,       // 秒
};
```

#### 2. WebDAV 客户端

```javascript
// src/js/lib/webdav-client.js

class WebDAVClient {
  constructor(config) {
    this.baseUrl = config.webdavUrl.replace(/\/$/, '');
    this.basePath = config.webdavBasePath;
    this.username = config.webdavUsername;
    this.password = config.webdavPassword;
    this.timeout = config.webdavTimeout * 1000;

    // 生成 Basic Auth 头
    this.authHeader = 'Basic ' + btoa(`${this.username}:${this.password}`);
  }

  /**
   * 创建目录（MKCOL）
   */
  async createDirectory(path) {
    const fullPath = this.getFullPath(path);

    const response = await fetch(fullPath, {
      method: 'MKCOL',
      headers: {
        'Authorization': this.authHeader
      },
      signal: AbortSignal.timeout(this.timeout)
    });

    // 201 Created 或 405 Method Not Allowed (目录已存在)
    return response.status === 201 || response.status === 405;
  }

  /**
   * 上传文件（PUT）
   */
  async uploadFile(path, content, contentType = 'application/octet-stream') {
    const fullPath = this.getFullPath(path);

    // 确保父目录存在
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (dir) {
      await this.ensureDirectory(dir);
    }

    const response = await fetch(fullPath, {
      method: 'PUT',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': contentType
      },
      body: content,
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
    }

    return {
      ok: true,
      url: fullPath,
      size: content.size || content.length
    };
  }

  /**
   * 下载文件（GET）
   */
  async downloadFile(path) {
    const fullPath = this.getFullPath(path);

    const response = await fetch(fullPath, {
      method: 'GET',
      headers: {
        'Authorization': this.authHeader
      },
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    return await response.blob();
  }

  /**
   * 删除文件/目录（DELETE）
   */
  async delete(path) {
    const fullPath = this.getFullPath(path);

    const response = await fetch(fullPath, {
      method: 'DELETE',
      headers: {
        'Authorization': this.authHeader
      }
    });

    return response.status === 204 || response.status === 404;
  }

  /**
   * 列出目录内容（PROPFIND）
   */
  async listDirectory(path = '/') {
    const fullPath = this.getFullPath(path);

    const response = await fetch(fullPath, {
      method: 'PROPFIND',
      headers: {
        'Authorization': this.authHeader,
        'Depth': '1',
        'Content-Type': 'application/xml'
      },
      body: `<?xml version="1.0"?>
        <d:propfind xmlns:d="DAV:">
          <d:prop>
            <d:displayname/>
            <d:getcontentlength/>
            <d:getlastmodified/>
            <d:resourcetype/>
          </d:prop>
        </d:propfind>`
    });

    if (!response.ok) {
      throw new Error(`List failed: ${response.status}`);
    }

    const xml = await response.text();
    return this.parseListResponse(xml);
  }

  /**
   * 测试连接
   */
  async testConnection() {
    try {
      await this.listDirectory('/');
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error.message
      };
    }
  }

  /**
   * 递归创建目录
   */
  async ensureDirectory(path) {
    const parts = path.split('/').filter(p => p);
    let currentPath = '';

    for (const part of parts) {
      currentPath += '/' + part;
      await this.createDirectory(currentPath);
    }
  }

  getFullPath(path) {
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return `${this.baseUrl}${this.basePath}${cleanPath}`;
  }

  parseListResponse(xml) {
    // 解析 XML 响应，提取文件列表
    // 简化实现，实际需要使用 DOMParser
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');

    const responses = doc.getElementsByTagNameNS('DAV:', 'response');
    const items = [];

    for (const response of responses) {
      const href = response.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent;
      const propstat = response.getElementsByTagNameNS('DAV:', 'propstat')[0];

      if (!propstat) continue;

      const prop = propstat.getElementsByTagNameNS('DAV:', 'prop')[0];
      const displayname = prop.getElementsByTagNameNS('DAV:', 'displayname')[0]?.textContent;
      const size = prop.getElementsByTagNameNS('DAV:', 'getcontentlength')[0]?.textContent;
      const modified = prop.getElementsByTagNameNS('DAV:', 'getlastmodified')[0]?.textContent;
      const resourcetype = prop.getElementsByTagNameNS('DAV:', 'resourcetype')[0];
      const isDirectory = resourcetype?.getElementsByTagNameNS('DAV:', 'collection').length > 0;

      items.push({
        path: href,
        name: displayname,
        size: parseInt(size) || 0,
        modified: new Date(modified),
        isDirectory
      });
    }

    return items;
  }
}

export default WebDAVClient;
```

#### 3. WebDAV Handler

```javascript
// src/js/handler/webdav.js

import WebDAVClient from '../lib/webdav-client.js';
import T from '../lib/tool.js';
import MxWcConfig from '../lib/config.js';

class ClippingHandler_WebDAV {
  constructor() {
    this.name = 'WebDAV';
    this.client = null;
  }

  async init() {
    const config = await MxWcConfig.load();

    if (!config.webdavEnabled) {
      return {
        ready: false,
        message: 'WebDAV is not enabled in settings'
      };
    }

    this.client = new WebDAVClient({
      webdavUrl: config.webdavUrl,
      webdavUsername: config.webdavUsername,
      webdavPassword: config.webdavPassword,
      webdavBasePath: config.webdavBasePath,
      webdavTimeout: config.webdavTimeout
    });

    return { ready: true };
  }

  async getInfo() {
    if (!this.client) {
      await this.init();
    }

    const testResult = await this.client.testConnection();

    return {
      ready: testResult.ok,
      message: testResult.ok ? '' : testResult.message,
      supportFormats: ['html', 'md']
    };
  }

  async saveClipping(clipping, feedback) {
    // 创建剪藏目录
    const clipPath = `/${clipping.info.clipId}`;

    feedback.onStart();

    try {
      // 1. 上传主文件
      const mainFileTask = clipping.tasks.find(t => t.taskType === 'mainFileTask');
      if (mainFileTask) {
        const htmlPath = `${clipPath}/${mainFileTask.filename}`;
        await this.client.uploadFile(htmlPath, mainFileTask.content, 'text/html');
        feedback.onMainFileTaskCompleted({ fullFilename: htmlPath });
      }

      // 2. 上传资源文件
      for (const task of clipping.tasks) {
        if (task.taskType === 'mainFileTask') continue;

        try {
          // 下载资源（可能因 CORS 失败）
          const blob = await this.fetchResource(task.url);

          // 上传到 WebDAV
          const assetPath = `${clipPath}/assets/${task.filename}`;
          await this.client.uploadFile(assetPath, blob, task.mimeType);

          feedback.onAssetTaskCompleted(task);
        } catch (error) {
          feedback.onAssetTaskFailed(task, error.message);
        }
      }

      feedback.onComplete({
        url: this.client.getFullPath(`${clipPath}/index.html`)
      });

    } catch (error) {
      feedback.onFail(error.message);
    }
  }

  async fetchResource(url) {
    // 尝试下载资源
    // 可以在这里集成 Native App 或代理
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }

    return await response.blob();
  }
}

export default new ClippingHandler_WebDAV();
```

---

## 📊 方案对比

### 存储方案对比

| 方案 | 安装 | 跨设备 | 云端 | CORS | 推荐度 |
|------|------|--------|------|------|--------|
| **Browser Handler** | 无 | ❌ | ❌ | ⚠️ 受限 | ⭐⭐⭐ |
| **Native App** | Ruby/Node/Go | ❌ | ❌ | ✅ 绕过 | ⭐⭐⭐⭐ |
| **WebDAV Only** | 无 | ✅ | ✅ | ⚠️ 受限 | ⭐⭐⭐ |
| **Native App + WebDAV** | Ruby/Node/Go | ✅ | ✅ | ✅ 绕过 | ⭐⭐⭐⭐⭐ |
| **代理 + WebDAV** | 无 | ✅ | ✅ | ✅ 绕过 | ⭐⭐⭐⭐ |

### 成本对比

| 方案 | 用户成本 | 开发者成本 |
|------|---------|-----------|
| Browser Handler | 免费 | 已实现 |
| Native App | 免费（需安装） | 已实现 |
| WebDAV Only | 免费-$10/月（云存储） | ~40小时 |
| Native App + WebDAV | 免费-$10/月 | ~60小时 |
| 代理 + WebDAV | 免费-$10/月 | ~80小时 + $50-100/月运营 |

---

## 🎯 推荐方案

### 最佳组合：Native App + WebDAV ⭐⭐⭐⭐⭐

**理由：**

1. **完美解决所有问题**
   - ✅ Native App 绕过 CORS
   - ✅ WebDAV 云端存储
   - ✅ 跨设备同步

2. **用户选择灵活**
   ```
   存储位置选择：
   [ ] 本地文件系统（Browser Handler）
   [ ] 本地文件系统（Native App）
   [x] 云端存储（WebDAV）
   ```

3. **实现成本可控**
   - Native App 已有实现（Ruby 版本）
   - WebDAV 客户端约 500 行代码
   - 总计 40-60 小时开发时间

---

### 快速方案：WebDAV Only ⭐⭐⭐

**适合场景：**
- 快速上线
- 目标用户主要剪藏文字
- 不在意部分图片丢失

**优点：**
- 无需安装
- 配置简单
- 20-30 小时开发时间

---

## 🚀 实施建议

### 阶段 1：WebDAV Only（2-3 周）

**Week 1: 核心功能**
- [ ] 实现 WebDAVClient 类
- [ ] 实现基本的 PUT/GET/DELETE 操作
- [ ] 添加配置界面

**Week 2: Handler 集成**
- [ ] 实现 WebDAV Handler
- [ ] 集成到现有的保存流程
- [ ] 处理错误和重试

**Week 3: 测试和优化**
- [ ] 测试主流 WebDAV 服务（坚果云、Nextcloud）
- [ ] 优化上传性能
- [ ] 编写文档

---

### 阶段 2：与 Native App 集成（2-3 周）

**Week 1: 架构调整**
- [ ] 解耦下载和存储逻辑
- [ ] Native App 只负责下载
- [ ] 扩展负责上传到 WebDAV

**Week 2: 实现和测试**
- [ ] 实现混合方案
- [ ] 测试完整流程
- [ ] 性能优化

**Week 3: 发布**
- [ ] 更新文档
- [ ] 发布新版本

---

## 📚 常见 WebDAV 服务配置

### 坚果云（推荐，国内）

```yaml
服务器地址: https://dav.jianguoyun.com/dav/
用户名: your-email@example.com
密码: 应用密码（需在坚果云设置中生成）
免费额度: 1GB/月上传流量，3GB/月下载流量
```

### Nextcloud（自建）

```yaml
服务器地址: https://your-domain.com/remote.php/dav/files/username/
用户名: username
密码: password 或 app password
优势: 完全控制，无限容量
```

### Seafile（自建）

```yaml
服务器地址: https://your-domain.com/seafdav/
用户名: email
密码: password
优势: 性能好，国内开发
```

---

## 💬 总结

### WebDAV 能否解决跨域问题？

**答案：不能直接解决，但提供了很好的存储方案。**

| 问题 | WebDAV 的作用 |
|------|--------------|
| 跨域下载资源 | ❌ 不能解决（仍受 CORS 限制） |
| 云端存储 | ✅ 完美解决 |
| 跨设备同步 | ✅ 完美解决 |
| 无需 Native App | ⚠️ 部分解决（需接受资源丢失） |

### 最佳组合

**推荐：Native App（下载） + WebDAV（存储）**

```
资源下载（绕过 CORS）
    ↓ Native App
扩展获得资源
    ↓
上传到云端
    ↓ WebDAV
完成！
```

这样既绕过了 CORS，又实现了云端存储和跨设备同步。

---

*本文档由 AI 辅助生成，分析了 WebDAV 方案的可行性和实现细节。*
