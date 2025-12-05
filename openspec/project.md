# Project Context

## Purpose

MaoXian Web Clipper 是一个浏览器扩展,用于从网页剪辑信息并保存到用户的**本地机器**,以避免信息失效。

### 核心目标
- 提供完全离线的网页内容保存能力
- 用户完全控制自己的数据(无需注册、无需付费)
- 支持灵活的区域选择和内容捕获
- 提供丰富的分类、标签和历史记录管理

## Tech Stack

### 核心技术
- **JavaScript (ES6+)**: 原生 JavaScript,不使用 TypeScript
- **Webpack 5**: 模块打包和构建工具
- **Babel**: JavaScript 转译器,支持旧版浏览器
- **Manifest V3**: 浏览器扩展清单格式
- **WebExtension API**: 跨浏览器扩展 API

### 构建工具
- `webpack`: 打包工具
- `webpack-cli`: Webpack 命令行界面
- `babel-loader`: Webpack 的 Babel 加载器
- `copy-webpack-plugin`: 文件复制插件
- `clean-webpack-plugin`: 清理构建目录
- `zip-webpack-plugin`: 打包压缩插件
- `cross-env`: 跨平台环境变量设置

### 第三方库
- `webextension-polyfill`: WebExtension API 跨浏览器兼容层
- `turndown`: HTML 转 Markdown 转换器
- `turndown-plugin-gfm`: GitHub Flavored Markdown 插件
- `mustache`: 模板引擎
- `blueimp-md5`: MD5 哈希库
- `mathml2latex`: MathML 转 LaTeX 转换
- `css-selector-generator`: CSS 选择器生成器
- `css.escape`: CSS 字符串转义
- `magic-bytes.js`: 文件类型检测
- `strip-css-comments`: CSS 注释移除
- `awesomplete`: 自动完成组件
- `pikaday`: 日期选择器

### 测试框架
- `mocha`: 测试框架
- `jsdom`: 在 Node.js 中模拟 DOM
- `sinon-chrome`: Chrome API 模拟库

## Project Conventions

### 代码结构

```
src/
├── js/                      # JavaScript 源代码
│   ├── lib/                 # 核心库和工具
│   │   ├── log.js           # 日志工具
│   │   ├── tool.js          # 通用工具函数
│   │   ├── ext-api.js       # 扩展 API 封装
│   │   ├── ext-msg.js       # 扩展消息通信
│   │   ├── storage.js       # 存储管理
│   │   ├── config.js        # 配置管理
│   │   ├── frame-msg.js     # iframe 消息通信
│   │   └── ...
│   ├── background/          # 后台脚本模块
│   │   ├── blob-url.js      # Blob URL 管理
│   │   ├── migration.js     # 数据迁移
│   │   └── declarative-net-request.js # DNR API 管理
│   ├── content/             # 内容脚本模块
│   ├── clipping/            # 剪辑核心逻辑
│   │   ├── backend.js       # 后端服务
│   │   └── clipper.js       # 剪辑器
│   ├── capturer/            # 资源捕获器
│   │   ├── a.js             # 链接捕获
│   │   ├── iframe.js        # iframe 捕获
│   │   ├── media.js         # 媒体捕获
│   │   ├── picture.js       # 图片捕获
│   │   └── ...
│   ├── snapshot/            # 快照生成
│   │   ├── maker.js         # 快照生成器
│   │   ├── stylesheet.js    # 样式表处理
│   │   ├── css-text-parser.js # CSS 解析
│   │   └── ...
│   ├── saving/              # 保存处理
│   ├── selection/           # 选择管理
│   ├── assistant/           # 助手功能
│   │   ├── plan.js          # 计划管理
│   │   ├── plan-repository.js # 计划仓库
│   │   └── fuzzy-matcher.js # 模糊匹配
│   ├── handler/             # 保存处理器
│   │   ├── browser.js       # 浏览器保存
│   │   ├── native-app.js    # 原生应用保存
│   │   └── wiznoteplus.js   # WizNote+ 集成
│   ├── user-script/         # 用户脚本
│   ├── background.js        # 后台主入口
│   ├── content.js           # 内容脚本主入口
│   ├── content-frame.js     # iframe 内容脚本
│   ├── env.js               # 环境配置(开发)
│   └── env.production.js    # 环境配置(生产)
├── pages/                   # 扩展页面
│   ├── popup.html/js/css    # 弹出窗口
│   ├── setting.html/js/css  # 设置页面
│   ├── history.html/js/css  # 历史记录页面
│   ├── welcome.html/js/css  # 欢迎页面
│   └── ...
├── _locales/                # 国际化文件
│   ├── en/                  # 英文
│   └── zh_CN/               # 简体中文
├── icons/                   # 图标资源
├── manifest.json            # 清单基础文件
├── manifest-chromium.json   # Chromium 特定配置
└── manifest-firefox.json    # Firefox 特定配置
```

### Code Style

#### 命名约定
- **模块命名**: 使用 Pascal Case (如 `MxWcConfig`, `ExtMsg`)
- **函数命名**: 使用 camelCase (如 `resetClippingState`, `initBackend`)
- **常量命名**: 使用 UPPER_SNAKE_CASE (如 `API_SETTABLE_KEYS`)
- **文件命名**: 使用 kebab-case (如 `ext-api.js`, `plan-repository.js`)

#### 模块系统
- 使用 ES6 模块 (`import`/`export`)
- 每个模块职责单一、清晰
- 模块间通过统一的消息机制通信

#### 日志规范
- 使用 `Log` 模块统一管理日志
- 支持不同级别: debug, info, warn, error

### Architecture Patterns

#### 多层架构
1. **Background Layer** (后台层)
   - Service Worker (Manifest V3)
   - 处理扩展生命周期事件
   - 管理跨页面状态
   - 协调各个功能模块

2. **Content Layer** (内容层)
   - 注入到网页中的脚本
   - 处理页面内容的提取和捕获
   - 提供用户交互界面(选择框、控制面板)

3. **Page Layer** (页面层)
   - 扩展专属页面(设置、历史等)
   - 独立的 HTML/CSS/JS

#### 功能模块化
- **Clipping**: 剪辑流程管理
- **Capturer**: 资源捕获(图片、链接、媒体等)
- **Snapshot**: 页面快照生成(保留样式)
- **Saving**: 保存处理(浏览器下载、原生应用、第三方服务)
- **Selection**: 选择区域管理
- **Assistant**: 剪辑助手(自动化配置)

#### 消息通信模式
- **ExtMsg**: 扩展内部消息通信(background ↔ content)
- **FrameMsg**: iframe 间消息通信
- **EventTarget**: 自定义事件系统

#### 平台适配
- 通过 Webpack 构建时环境变量区分平台
- Manifest 差异化配置(Chromium/Firefox)
- 平台特定代码通过条件编译处理

### Testing Strategy

#### 测试框架
- 使用 Mocha 作为测试运行器
- 使用 jsdom 模拟浏览器环境
- 使用 sinon-chrome 模拟 Chrome API

#### 测试组织
- 测试文件位于 `test/` 目录
- 测试文件结构镜像 `src/` 目录
- 使用递归方式运行所有测试

#### 测试命令
```bash
npm test
```

### Git Workflow

#### 分支策略
- `master`: 主分支,稳定版本
- `release/*`: 发布分支(如 `release/0.7.70`)
- 功能分支: 根据需要创建(如 `upgrade-to-manifest-v3`, `docs-manifest-v3`)

#### 提交约定
- 使用语义化提交消息
- 格式: `type: description`
- 常用 type:
  - `chore`: 构建/工具配置更新
  - `docs`: 文档更新
  - `feat`: 新功能
  - `fix`: 错误修复
  - `refactor`: 代码重构
  - `test`: 测试相关

#### 版本管理
- 使用语义化版本 (Semantic Versioning)
- 版本号格式: `MAJOR.MINOR.PATCH`
- 当前版本: `0.7.70`

## Domain Context

### 核心概念

#### Clipping (剪辑)
- 用户从网页中选择并保存内容的完整过程
- 包括: 选择区域 → 捕获资源 → 生成快照 → 保存文件

#### Snapshot (快照)
- 保留页面样式的完整 HTML 快照
- 内联 CSS 样式
- 处理相对路径和资源引用
- 支持 iframe 嵌套

#### Capturer (捕获器)
- 针对不同类型资源的专门处理器
- 图片、视频、音频、iframe、链接等
- 支持懒加载资源检测

#### Handler (处理器)
- 不同保存方式的实现
- Browser Handler: 使用浏览器下载 API
- Native App Handler: 通过原生应用保存
- Third-party Handler: 集成第三方服务(如 WizNote+)

#### Plan (计划)
- 预定义的剪辑配置
- 可根据 URL 模式自动应用
- 包括保存路径、格式、标签等配置

#### Selection (选择)
- 用户在页面上选择要剪辑的区域
- 支持精确调整(通过快捷键)
- 支持多种选择模式

### 文件保存结构
```
clippings/
├── category-name/           # 分类目录
│   ├── title-timestamp/     # 单次剪辑目录
│   │   ├── index.html       # 主文件
│   │   ├── index.md         # Markdown 版本(可选)
│   │   ├── assets/          # 资源文件
│   │   │   ├── images/
│   │   │   ├── styles/
│   │   │   └── ...
│   │   └── metadata.json    # 元数据(可选)
```

### 配置系统
- 存储在浏览器 Storage API 中
- 支持导入/导出配置
- 支持用户脚本扩展
- 支持 API 方式修改配置

## Important Constraints

### 浏览器兼容性
- **最低要求**: 支持 Manifest V3 的浏览器
- **Chromium**: Chrome 88+, Edge 88+, Opera 74+
- **Firefox**: Firefox 109+

### Manifest V3 限制
- Service Worker 替代 Background Page
- Declarative Net Request 替代 webRequest (部分)
- 需要显式声明 host_permissions
- 无法使用 remotely hosted code

### 性能约束
- Content Script 需要尽快加载,避免阻塞页面
- 大型资源(如视频)需要流式处理
- Snapshot 生成需要考虑内存限制

### 安全约束
- 所有资源必须符合 CSP (Content Security Policy)
- 不能执行远程代码
- 用户脚本需要沙箱执行
- 敏感数据(如配置)需要本地存储

### 存储约束
- 使用浏览器 Storage API,有容量限制
- 历史记录需要定期清理
- 大文件保存到本地文件系统

## External Dependencies

### 浏览器 API
- `chrome.storage`: 配置和数据存储
- `chrome.downloads`: 文件下载
- `chrome.tabs`: 标签页管理
- `chrome.runtime`: 消息通信和生命周期
- `chrome.contextMenus`: 右键菜单
- `chrome.commands`: 快捷键
- `chrome.declarativeNetRequest`: 网络请求管理 (MV3)
- `chrome.nativeMessaging`: 与原生应用通信(可选)

### 构建依赖
- Node.js 环境
- npm 包管理器
- Webpack 构建工具链

### 开发工具
- `web-ext`: Firefox 扩展开发和测试工具
- 浏览器开发者工具: 调试扩展

### 原生应用集成 (可选)
- Native Messaging Host: 自定义原生应用协议
- 位于 `native-app/` 目录

## Development Workflow

### 开发环境设置
```bash
# 安装依赖
npm install

# 开发模式(Chromium)
npm run watch-chromium

# 开发模式运行(Chromium)
npm run dev-chromium

# 开发模式(Firefox)
npm run watch-firefox
npm run dev-firefox
```

### 构建
```bash
# 构建生产版本(Chromium)
npm run build-chromium

# 构建生产版本(Firefox)
npm run build-firefox

# 构建所有平台
npm run build-all
```

### 测试
```bash
# 运行单元测试
npm test
```

### 输出目录
- `dist/extension/maoxian-web-clipper/`: 构建后的扩展文件
- `dist/extension/maoxian-web-clipper-{platform}-{version}.zip`: 打包文件

## Key Technical Decisions

### 为什么选择 Manifest V3
- Chrome Web Store 强制要求
- 更好的安全性和性能
- 使用 Declarative Net Request 替代 webRequest
- Service Worker 替代 Background Page

### 为什么不使用 TypeScript
- 项目初始时期 TypeScript 尚未流行
- 保持代码简单,降低构建复杂度
- JavaScript + JSDoc 提供足够的类型提示

### 为什么选择本地存储
- 用户完全控制数据
- 无需服务器,降低成本
- 避免隐私问题
- 支持离线使用

### 为什么支持多种保存方式
- 满足不同用户需求
- 浏览器 API 集成第三方服务
- Native App 提供更强大的文件管理能力

## Related Documentation

- [README.md](../README.md): 项目介绍和使用指南
- [README-DEV.md](../README-DEV.md): 开发者指南
- [官方主页](https://mika-cn.github.io/maoxian-web-clipper/index.html)
- [Firefox 插件商店](https://addons.mozilla.org/en-US/firefox/addon/maoxian-web-clipper/)
