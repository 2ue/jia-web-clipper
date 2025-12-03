# Manifest V3 迁移分析报告

> 生成时间：2025-12-03
> 项目：MaoXian Web Clipper
> 当前版本：0.7.0 (Manifest V2)

---

## 📊 核心结论

**建议：暂不迁移** - Manifest V3 会导致核心功能受损，建议继续使用 V2 或仅支持 Firefox。

---

## ❌ 无法迁移的功能（致命问题）

### 1. UnescapeHeader - 跨域请求头修改

**当前实现** (`src/js/background/web-request.js:374-476`)：

```javascript
// 拦截扩展发出的 XHR 请求
browser.webRequest.onBeforeSendHeaders.addListener(
  listener,
  filter,
  ["blocking", "requestHeaders", "extraHeaders"]
);

// 核心逻辑：
// 1. 检测请求是否带有 X-MxWc-Token（识别由扩展发出）
// 2. 将 X-MxWc-Referer 改回 Referer
// 3. 将 X-MxWc-Origin 改回 Origin
// 4. 用于绕过跨域资源的 CORS 限制
```

**V3 中的问题：**
- ❌ `declarativeNetRequest` API 无法动态执行 JavaScript 逻辑
- ❌ 无法识别"由扩展发出"的请求（失去了 `X-MxWc-Token` 识别机制）
- ❌ 静态规则会影响用户正常浏览
- ❌ **无完美替代方案**

**业务影响：**
- 🔴 **高风险** - 预计 20-40% 的页面资源将下载失败
- **典型失败场景：**
  - CDN 资源带有严格的 CORS 策略
  - 图片服务器检查 Referer 和 Origin
  - 某些网站的防盗链机制
- **用户体验：** 剪藏的页面可能缺失图片或样式错乱
- **影响范围：** 取决于目标网站的 CORS 配置

---

### 2. StoreResource - 响应体缓存

**当前实现** (`src/js/background/web-request.js:259-364`)：

```javascript
// 使用 filterResponseData 拦截响应体
const filter = browser.webRequest.filterResponseData(details.requestId);

filter.ondata = (event) => {
  // 缓存 CSS、图片、字体的二进制数据
  data.push(new Uint8Array(event.data));
  filter.write(event.data);
}

filter.onstop = (event) => {
  // 将合并后的数据存入内存缓存
  Global.assetCache.add(url, {resourceType, data, responseHeaders});
};
```

**功能说明：**
- 拦截 CSS、图片、字体的响应体
- 缓存二进制数据到内存
- 避免同一资源被重复下载

**V3 中的问题：**
- ❌ `webRequest.filterResponseData` API 已被完全移除
- ❌ 没有任何替代 API

**业务影响：**
- 🟡 **中风险** - 性能下降 20-50%
- **典型场景：** 页面引用多个相同的 CSS 或图片资源
- **表现：** 每次都需要重新下载
- **用户体验：** 剪藏速度变慢（可感知）
- **功能完整性：** ✅ 不影响，可移除此功能

---

## ✅ 可以迁移的改动

### 1. manifest.json 基础改动

#### 改动对照表

| 项目 | Manifest V2 | Manifest V3 |
|------|-------------|-------------|
| 版本号 | `"manifest_version": 2` | `"manifest_version": 3` |
| 浏览器动作 | `"browser_action"` | `"action"` |
| 背景脚本 | `"background": {"page": "pages/background.html"}` | `"background": {"service_worker": "background.js", "type": "module"}` |
| 权限分离 | `"permissions": ["<all_urls>"]` | `"host_permissions": ["<all_urls>"]` + 新增 `"scripting"` |
| Web 资源 | 数组格式 | 对象格式（需指定 resources 和 matches） |

#### 完整改动示例

```diff
{
-  "manifest_version": 2,
+  "manifest_version": 3,

-  "browser_action": {
-    "browser_style": true,  // V3 不支持
-    "theme_icons": [...]    // V3 不支持
+  "action": {
     "default_title": "__MSG_extensionDefaultTooltip__",
     "default_popup": "pages/popup.html",
     "default_icon": {
       "16": "icons/mx-wc-16.png",
       "32": "icons/mx-wc-32.png",
       "48": "icons/mx-wc-48.png"
     }
   },

-  "background": {
-    "page": "pages/background.html"
-  },
+  "background": {
+    "service_worker": "background.js",
+    "type": "module"
+  },

   "permissions": [
-    "<all_urls>",
     "webNavigation",
-    "webRequest",
-    "webRequestBlocking",
     "storage",
     "unlimitedStorage",
     "tabs",
     "downloads",
-    "downloads.open"
+    "downloads.open",
+    "scripting"  // 新增
   ],

+  "host_permissions": [
+    "<all_urls>"
+  ],

-  "web_accessible_resources": [
-    "pages/*",
-    "icons/*",
-    "css/*",
-    "js/*"
-  ]
+  "web_accessible_resources": [
+    {
+      "resources": ["pages/*", "icons/*", "css/*", "js/*"],
+      "matches": ["<all_urls>"]
+    }
+  ]
}
```

**工作量：** 1 小时

---

### 2. Background Script 改动

#### 当前结构

**background.html:**
```html
<!DOCTYPE html>
<html>
  <body>
    <script src="../vendor/js/browser-polyfill.js"></script>
    <script src="../vendor/js/i18n.js"></script>
    <script src="../_locales/en/common.js"></script>
    <script src="../_locales/zh_CN/common.js"></script>
    <script src="background.js" type="module"></script>
  </body>
</html>
```

#### V3 改为

**background.js (Service Worker):**
```javascript
// 方案 1: 使用 importScripts (非模块)
importScripts(
  'vendor/js/browser-polyfill.js',
  'vendor/js/i18n.js',
  '_locales/en/common.js',
  '_locales/zh_CN/common.js'
);
// ... 主逻辑

// 方案 2: 使用 ES6 模块 (推荐)
import './vendor/js/browser-polyfill.js';
import './vendor/js/i18n.js';
// ... 需要确保所有依赖都支持 ES6 模块
```

**注意事项：**
- Service Worker 中不能使用 DOM API（如 `document`, `window`）
- 当前代码已检查，未使用 DOM API ✅
- `Blob` 和 `URL.createObjectURL` 在 Service Worker 中可用 ✅

**工作量：** 2 小时

---

### 3. 状态管理重构

#### 当前问题

**background.js 使用全局变量存储状态：**
```javascript
const Global = {
  evTarget: new MxEvTarget(),           // 事件总线
  contentMessage: null,                 // 临时消息
  assetCache: T.createResourceCache(), // 资源缓存
  requestToken: 'xxx',                 // 请求令牌
};
```

**Service Worker 的限制：**
- ⏱️ 30 秒无活动会被浏览器终止
- 💾 内存状态会丢失
- 🔄 下次唤醒时需要重新初始化

#### 解决方案

| 状态类型 | 当前方案 | V3 方案 | API |
|---------|---------|---------|-----|
| 临时消息 | `Global.contentMessage` | Session Storage | `chrome.storage.session.set()` |
| 资源缓存 | `Global.assetCache` | Local Storage | `chrome.storage.local.set()` |
| 请求令牌 | `Global.requestToken` | 每次启动生成 | - |
| 事件总线 | `Global.evTarget` | 重新设计（使用消息传递） | `chrome.runtime.sendMessage()` |

**代码示例：**

```javascript
// === 临时消息（Session Storage）===
// 保存
await chrome.storage.session.set({ contentMessage: msg });

// 读取
const { contentMessage } = await chrome.storage.session.get('contentMessage');

// === 资源缓存（Local Storage）===
// 保存
await chrome.storage.local.set({
  assetCache: {
    [url]: { resourceType, data, responseHeaders }
  }
});

// 读取
const { assetCache } = await chrome.storage.local.get('assetCache');

// === 事件总线重构 ===
// 原方案：内存中的 EventTarget
Global.evTarget.dispatchEvent({ type: 'saving.completed' });

// V3 方案：消息广播
chrome.runtime.sendMessage({ type: 'saving.completed' });
```

**需要修改的文件：**
- `src/pages/background.js` - 主入口，全局状态初始化
- `src/js/background/web-request.js` - 使用了 `Global.evTarget`
- `src/js/lib/event-target.js` - 可能需要适配

**工作量：** 4-6 小时

---

### 4. tabs.executeScript → scripting.executeScript

#### 当前代码

**`src/js/lib/ext-api.js:93`:**
```javascript
ExtApi.executeContentScript = (tabId, details) => {
  return browser.tabs.executeScript(tabId, details);
}
```

#### V3 改为

```javascript
ExtApi.executeContentScript = (tabId, details) => {
  // V2: {file: 'script.js', allFrames: true}
  // V3: {target: {tabId, allFrames}, files: ['script.js']}

  return browser.scripting.executeScript({
    target: {
      tabId: tabId,
      allFrames: details.allFrames || false
    },
    files: details.file ? [details.file] : undefined,
    func: details.code ? new Function(details.code) : undefined
  });
}
```

**API 参数对照：**

| V2 参数 | V3 参数 |
|---------|---------|
| `tabId` (第一参数) | `target.tabId` |
| `details.file` | `files: [...]` (数组) |
| `details.code` | `func: function() {...}` |
| `details.allFrames` | `target.allFrames` |

**需要在 manifest.json 添加权限：**
```json
"permissions": ["scripting"]
```

**工作量：** 1 小时

---

### 5. webRequest API 简化

#### 保留的功能（只读，不需要 blocking）

##### StoreRedirection - 追踪重定向

**代码位置：** `src/js/background/web-request.js:9-132`

```javascript
// ✅ V3 仍支持
browser.webRequest.onBeforeRedirect.addListener(
  listener,
  {
    urls: ["http://*/*", "https://*/*"],
    types: ["image", "sub_frame", "imageset"]
  }
  // 不需要 ["blocking"]
);
```

**功能：** 追踪图片和 iframe 的 HTTP 重定向链，存储映射关系。

---

##### StoreMimeType - 读取 MIME 类型

**代码位置：** `src/js/background/web-request.js:137-254`

```javascript
// ✅ V3 仍支持
browser.webRequest.onHeadersReceived.addListener(
  listener,
  {
    urls: ["http://*/*", "https://*/*"],
    types: ["xmlhttprequest", "image", "imageset"]
  },
  ["responseHeaders"]  // 只读，不需要 ["blocking"]
);
```

**功能：** 从响应头提取 MIME 类型并缓存，用于判断资源类型。

---

#### 需要移除的功能

##### ❌ StoreResource - 响应体拦截

**代码位置：** `src/js/background/web-request.js:259-364`

```javascript
// ❌ V3 已移除 filterResponseData API
browser.webRequest.onHeadersReceived.addListener(
  listener,
  filter,
  ["blocking", "responseHeaders"]  // blocking 在 V3 中受限
);

const filter = browser.webRequest.filterResponseData(details.requestId);
// ❌ filterResponseData 不存在
```

**删除步骤：**
1. 移除 `StoreResource` 模块
2. 移除 `web-request.js:509` 中的 `StoreResource.listen()` 调用
3. 移除相关的全局状态和事件监听

---

##### ❌ UnescapeHeader - 修改请求头

**代码位置：** `src/js/background/web-request.js:374-476`

```javascript
// ❌ V3 无法动态修改请求头
browser.webRequest.onBeforeSendHeaders.addListener(
  listener,
  filter,
  ["blocking", "requestHeaders", "extraHeaders"]
);
```

**删除步骤：**
1. 移除 `UnescapeHeader` 模块
2. 移除 `web-request.js:508` 中的 `UnescapeHeader.listen()` 调用
3. 移除 `Fetcher` 中设置自定义请求头的逻辑

---

#### manifest.json 权限调整

```diff
"permissions": [
-  "webRequest",
-  "webRequestBlocking",
   // 保留其他权限
]
```

**工作量：** 2 小时（删除代码 + 测试）

---

## 📊 改动汇总

| 改动项 | 难度 | 工作量 | 功能影响 | 备注 |
|--------|------|--------|----------|------|
| manifest.json 基础改动 | ✅ 简单 | 1h | 无 | 配置文件修改 |
| Background → Service Worker | ✅ 简单 | 2h | 无 | 脚本加载方式调整 |
| 状态管理重构 | ⚠️ 中等 | 4-6h | 无 | 需要重构状态持久化 |
| tabs API 迁移 | ✅ 简单 | 1h | 无 | API 参数格式调整 |
| webRequest 简化 | ✅ 简单 | 2h | 无 | 删除代码 |
| **UnescapeHeader 移除** | ❌ **不可能完美迁移** | - | 🔴 **资源下载失败** | 核心功能受损 |
| **StoreResource 移除** | ❌ **不可能完美迁移** | - | 🟡 **性能下降** | 可接受 |

**总开发工作量：** 10-12 小时（不含功能受损部分的测试和文档更新）

**测试工作量：** 4-6 小时

**文档更新：** 2 小时

---

## 🎯 迁移方案建议

### 方案 A：继续使用 Manifest V2（推荐）

**理由：**
1. ✅ Firefox 明确表示长期支持 Manifest V2
2. ✅ 保持功能完整性
3. ✅ 等待 Google 提供更好的 API 替代方案
4. ✅ 避免用户体验下降

**适用场景：**
- 主要用户群体在 Firefox
- 功能完整性优先级 > Chrome 兼容性
- 团队资源有限，无法维护双版本

**风险：**
- Chrome Web Store 未来可能停止接受 V2 扩展（但已安装的仍可使用）
- 需要引导用户使用 Firefox 或支持 V2 的 Chromium 浏览器

---

### 方案 B：双版本维护

**策略：**
- **Firefox 版本：** Manifest V2（完整功能）
- **Chrome 版本：** Manifest V3（功能受限，明确告知用户）

**实施步骤：**
1. 创建 `manifest-v2` 和 `manifest-v3` 两个分支
2. 在 README 和商店页面明确说明：
   > ⚠️ **Chrome 版本限制**
   > 由于 Chrome Manifest V3 的限制，部分跨域资源可能无法下载。
   > 建议使用 Firefox 版本以获得完整功能。

**优点：**
- 同时支持两个平台
- 用户有选择权

**缺点：**
- 维护成本翻倍
- 需要为两个版本分别修复 Bug
- CI/CD 流程需要调整

**工作量：**
- 初期：20 小时
- 长期维护成本：每次更新 +50% 时间

---

### 方案 C：探索 Native Messaging（高级方案）

**思路：**
- 通过本地程序（Node.js / Python）代理网络请求
- 本地程序不受 CORS 限制
- 扩展通过 Native Messaging 与本地程序通信

**架构：**
```
Web Page → Content Script → Background (V3)
                                  ↓
                           Native Messaging
                                  ↓
                        Native App (本地程序)
                                  ↓
                        下载跨域资源（无 CORS 限制）
```

**优点：**
- ✅ 完整保留所有功能
- ✅ 不受浏览器 API 限制

**缺点：**
- ❌ 用户需要安装额外程序（体验下降）
- ❌ 跨平台兼容性问题（Windows/Mac/Linux）
- ❌ 开发和维护成本极高

**工作量：** 40+ 小时

---

### 方案 D：迁移到 Manifest V3 并接受功能受损（不推荐）

**适用场景：**
- Chrome 用户占比 > 80%
- 必须在 Chrome Web Store 上架新版本
- 可以接受部分功能缺失

**需要在文档中明确告知：**

> ⚠️ **已知限制（Chrome 版本）**
>
> 由于 Chrome Manifest V3 的限制，以下场景可能出现问题：
> - 部分图片无法下载（约 20-40% 概率，取决于网站的 CORS 配置）
> - 带有防盗链的资源无法保存
> - CDN 资源可能显示为损坏
>
> **建议：** 使用 Firefox 版本以获得完整功能。

---

## 📋 迁移检查清单

如果决定迁移到 Manifest V3，请按以下步骤进行：

### 阶段 1：准备工作（1-2h）
- [ ] 创建新分支 `upgrade-to-manifest-v3`
- [ ] 备份当前代码
- [ ] 准备测试环境（Chrome Canary / Chrome Dev）

### 阶段 2：manifest.json 改动（1h）
- [ ] 修改 `manifest_version: 3`
- [ ] `browser_action` → `action`
- [ ] 移除 `browser_style`
- [ ] 移除 `theme_icons`
- [ ] 重构 `background` 配置
- [ ] 分离 `host_permissions`
- [ ] 添加 `scripting` 权限
- [ ] 重构 `web_accessible_resources`
- [ ] 移除 `webRequest` 和 `webRequestBlocking` 权限

### 阶段 3：Background Script 改造（2h）
- [ ] 删除 `src/pages/background.html`
- [ ] 调整 `background.js` 为 Service Worker 入口
- [ ] 重构模块加载方式
- [ ] 确保无 DOM API 使用

### 阶段 4：状态管理重构（4-6h）
- [ ] 识别所有全局状态
- [ ] 迁移临时状态到 `chrome.storage.session`
- [ ] 迁移持久状态到 `chrome.storage.local`
- [ ] 重构事件总线机制
- [ ] 处理 Service Worker 生命周期

### 阶段 5：API 迁移（1h）
- [ ] 修改 `ext-api.js` 中的 `executeContentScript`
- [ ] 测试 Content Scripts 注入

### 阶段 6：webRequest 简化（2h）
- [ ] 保留 `StoreRedirection`
- [ ] 保留 `StoreMimeType`
- [ ] 移除 `StoreResource` 模块
- [ ] 移除 `UnescapeHeader` 模块
- [ ] 清理相关代码和配置

### 阶段 7：测试（4-6h）
- [ ] 基本功能测试（剪藏、保存）
- [ ] 跨域资源测试（记录失败案例）
- [ ] 性能测试（对比 V2）
- [ ] 多页面测试
- [ ] Service Worker 生命周期测试

### 阶段 8：文档更新（2h）
- [ ] 更新 README
- [ ] 添加已知限制说明
- [ ] 更新用户文档
- [ ] 编写迁移日志

---

## 🔍 后续监控建议

迁移后需要持续关注：

1. **Chrome API 更新**
   - 监控 `declarativeNetRequest` API 的演进
   - 关注是否有新的 API 可以替代 `webRequest`

2. **用户反馈**
   - 收集跨域资源下载失败的案例
   - 统计功能受损的影响范围

3. **浏览器政策**
   - 关注 Firefox 对 Manifest V2 的支持策略
   - 关注 Chrome Web Store 的政策变化

---

## 📚 参考资料

- [Chrome Manifest V3 迁移指南](https://developer.chrome.com/docs/extensions/migrating/)
- [Manifest V3 API 变化](https://developer.chrome.com/docs/extensions/mv3/intro/mv3-overview/)
- [declarativeNetRequest API](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/)
- [Service Worker 生命周期](https://developer.chrome.com/docs/extensions/mv3/service_workers/)
- [Firefox Manifest V2 支持声明](https://blog.mozilla.org/addons/2022/05/18/manifest-v3-in-firefox-recap-next-steps/)

---

## 💬 结论

**当前最佳策略：**

1. **短期：** 继续使用 Firefox + Manifest V2，保持功能完整性
2. **中期：** 观察 Chrome API 演进，评估是否出现更好的替代方案
3. **长期：** 如果必须支持 Chrome，考虑双版本维护或 Native Messaging 方案

**不建议立即迁移的原因：**
- 核心功能会严重受损（UnescapeHeader）
- 性能会明显下降（StoreResource）
- 用户体验下降不可接受
- 迁移成本 vs 收益不成正比

---

*本文档由 AI 辅助生成，基于对源代码的深度分析。*
