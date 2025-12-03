# Native App 安装指南与改进方案

> 生成时间：2025-12-03
> 针对 MaoXian Web Clipper Native App 的深度分析

---

## 📋 目录

1. [当前 Native App 架构](#当前-native-app-架构)
2. [macOS 安装指南](#macos-安装指南)
3. [Docker 化方案](#docker-化方案)
4. [更优的替代方案](#更优的替代方案)
5. [推荐实施路线](#推荐实施路线)

---

## 🏗️ 当前 Native App 架构

### 技术栈

| 组件 | 技术 | 版本要求 |
|------|------|----------|
| 运行时 | Ruby | >= 2.7.0 |
| 通信协议 | Native Messaging | - |
| 下载库 | open-uri (Ruby 标准库) | - |
| 打包工具 | web-ext-native-app-packer | gem |

### 工作原理

```
浏览器扩展
    ↓ Native Messaging
    ↓ (通过 stdin/stdout)
    ↓
Ruby 进程 (main.rb)
    ↓
读取消息 → 解析 JSON → 处理请求
    ↓
下载资源 (open-uri)
    ↓ 无 CORS 限制
保存到本地文件系统
    ↓
返回结果给扩展
```

### 核心功能（`native-app/lib/fetcher.rb`）

```ruby
# 使用 Ruby 的 open-uri 下载资源
content = URI.open(url, options).read

# 支持的选项：
# - proxy
# - User-Agent
# - Referer
# - Cookie
# 完全绕过浏览器的 CORS 限制
```

### 目录结构

```
native-app/
├── main.rb                 # 入口文件
├── config.yaml.example     # 配置示例
├── pack.yaml.example       # 打包配置
├── lib/
│   ├── app_env.rb         # 环境配置
│   ├── application.rb     # 主应用逻辑
│   ├── clipping.rb        # 剪藏处理
│   ├── config.rb          # 配置管理
│   ├── fetcher.rb         # 资源下载（关键）
│   ├── history.rb         # 历史记录管理
│   ├── log.rb             # 日志
│   ├── native_message.rb  # Native Messaging 协议
│   ├── storage.rb         # 存储管理
│   └── msg-handler/       # 消息处理器
└── test/                   # 测试
```

---

## 🍎 macOS 安装指南

### 方式 1：从源码安装（开发者）

#### 步骤 1：安装 Ruby

macOS 自带 Ruby，但建议使用最新版本：

```bash
# 使用 Homebrew 安装 Ruby
brew install ruby

# 或使用 rbenv（推荐）
brew install rbenv ruby-build
rbenv install 3.2.2
rbenv global 3.2.2

# 验证版本
ruby -v  # 应该 >= 2.7.0
```

#### 步骤 2：克隆项目（如果还没有）

```bash
cd /Users/yuanfeijie/Desktop/project/jia-web-clipper/native-app
```

#### 步骤 3：配置

```bash
# 创建配置文件
cp config.yaml.example config.yaml

# 编辑配置文件
nano config.yaml
```

**config.yaml 配置：**

```yaml
environment: 'production'

# 数据目录（必须存在）
data_dir: '/Users/yuanfeijie/Documents/MaoXian-Clipper'

# 消息处理器
msg_handler: 'default'

# 可选：代理配置
# proxy_url: 'http://localhost:8080'
# proxy_user: 'username:password'
```

#### 步骤 4：创建数据目录

```bash
mkdir -p /Users/yuanfeijie/Documents/MaoXian-Clipper
```

#### 步骤 5：安装打包工具

```bash
gem install web-ext-native-app-packer
```

#### 步骤 6：打包

```bash
# 回到项目根目录
cd /Users/yuanfeijie/Desktop/project/jia-web-clipper

# 执行打包脚本
./scripts/pack-native-app.sh
```

**打包后的产物：**
```
dist/native-app/
├── maoxian-web-clipper-native-macos-chrome.zip
├── maoxian-web-clipper-native-macos-chromium.zip
└── maoxian-web-clipper-native-macos-firefox.zip
```

#### 步骤 7：安装（以 Chrome 为例）

```bash
cd dist/native-app

# 解压
unzip maoxian-web-clipper-native-macos-chrome.zip -d native-app-chrome
cd native-app-chrome

# 安装
./install.sh

# 或手动安装（等效）
mkdir -p ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts
cp maoxian_web_clipper_native.json ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/
```

**验证安装：**

```bash
# 检查 manifest 文件
cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/maoxian_web_clipper_native.json

# 应该包含：
# - "path": "/path/to/main.rb"
# - "allowed_origins": ["chrome-extension://..."]
```

#### 步骤 8：在扩展中启用

1. 打开扩展设置
2. 找到 "Clipping Handler" 选项
3. 选择 "Native App"
4. 测试连接

---

### 方式 2：从预编译包安装（用户）

**问题：** 当前项目没有提供预编译的 macOS 包。

**解决方案：** 需要项目维护者提供打包好的 release。

---

## 🐳 Docker 化方案

### 方案 A：Docker + Native Messaging 桥接（复杂）

#### 架构

```
浏览器扩展
    ↓ Native Messaging
本地桥接脚本 (shell/Python)
    ↓ HTTP
Docker 容器 (Ruby 应用)
    ↓
下载资源 → 返回
```

#### 实现

**Dockerfile:**

```dockerfile
# native-app/Dockerfile
FROM ruby:3.2-alpine

WORKDIR /app

# 安装依赖
RUN apk add --no-cache \
    ca-certificates \
    tzdata

# 复制应用代码
COPY lib/ /app/lib/
COPY main.rb /app/
COPY config.yaml /app/

# 暴露端口（HTTP 服务）
EXPOSE 8080

# 启动命令（需要改造为 HTTP 服务）
CMD ["ruby", "main.rb"]
```

**问题：**

1. ❌ **Native Messaging 协议不支持 Docker**
   - Native Messaging 需要直接访问本地进程的 stdin/stdout
   - Docker 容器是隔离的环境

2. ❌ **需要重写通信层**
   - 将 Native Messaging 改为 HTTP API
   - 需要桥接脚本

#### 改造方案

**1. 将 Native App 改为 HTTP 服务（HTTP 模式）：**

```ruby
# native-app/main_http.rb
require 'sinatra'
require_relative 'lib/fetcher'
require_relative 'lib/config'

set :port, 8080
set :bind, '0.0.0.0'

# CORS 支持
before do
  headers 'Access-Control-Allow-Origin' => '*'
  headers 'Access-Control-Allow-Methods' => 'POST, OPTIONS'
end

# 健康检查
get '/health' do
  {
    status: 'ok',
    version: AppEnv::APP_VERSION,
    ruby_version: AppEnv::RUBY_VERSION
  }.to_json
end

# 下载资源
post '/download' do
  request.body.rewind
  data = JSON.parse(request.body.read)

  url = data['url']
  options = data['options'] || {}

  result = Fetcher.get(url, options)

  if result.ok
    # 返回 Base64 编码的数据
    content_type 'application/json'
    {
      ok: true,
      data: Base64.strict_encode64(result.content),
      size: result.content.bytesize
    }.to_json
  else
    status 500
    { ok: false, message: result.message }.to_json
  end
end
```

**2. Docker Compose 配置：**

```yaml
# docker-compose.yml
version: '3.8'

services:
  native-app:
    build: ./native-app
    ports:
      - "8080:8080"
    volumes:
      - ~/Documents/MaoXian-Clipper:/data
    environment:
      - DATA_DIR=/data
      - ENVIRONMENT=production
    restart: unless-stopped
```

**3. 扩展侧修改（fetcher.js）：**

```javascript
// src/js/lib/fetcher.js
async function fetchViaDocker(url, options) {
  const response = await fetch('http://localhost:8080/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, options })
  });

  const result = await response.json();

  if (result.ok) {
    // Base64 解码
    const binaryString = atob(result.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes]);
  } else {
    throw new Error(result.message);
  }
}
```

**4. 启动：**

```bash
# 启动 Docker 服务
docker-compose up -d

# 检查状态
curl http://localhost:8080/health
```

#### 优点

- ✅ 无需安装 Ruby
- ✅ 环境一致性
- ✅ 易于更新
- ✅ 跨平台（Docker 支持 Windows/Mac/Linux）

#### 缺点

- ❌ 需要安装 Docker（体积大）
- ❌ 需要重写通信层
- ❌ 不再使用 Native Messaging（需要改扩展代码）
- ❌ 端口占用问题

---

### 方案 B：Docker + 共享卷（简化版）⚠️

**思路：** 使用 Docker 运行下载任务，但通过共享卷与宿主机通信。

```yaml
services:
  downloader:
    image: ruby:3.2-alpine
    volumes:
      - ./native-app:/app
      - ~/Documents/MaoXian-Clipper:/data
    command: ruby /app/main.rb
    stdin_open: true
    tty: true
```

**问题：**
- ❌ Native Messaging 仍然无法直接工作
- ❌ 需要额外的 IPC 机制

**结论：** 此方案不推荐。

---

## 🚀 更优的替代方案

### 方案 1：Node.js 重写（推荐）⭐⭐⭐⭐⭐

#### 优势

- ✅ **无需额外运行时**（用户通常已有 Node.js，或可打包为独立二进制）
- ✅ **更好的跨平台支持**
- ✅ **更活跃的生态系统**
- ✅ **与扩展技术栈一致**（都是 JavaScript）
- ✅ **可以使用 pkg 或 nexe 打包为单文件可执行文件**

#### 实现示例

**native-app-node/main.js:**

```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Native Messaging 协议
class NativeMessaging {
  constructor() {
    this.chunks = [];
  }

  start() {
    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        this.chunks.push(chunk);
        this.tryProcessMessage();
      }
    });

    process.stdin.on('end', () => {
      process.exit(0);
    });
  }

  tryProcessMessage() {
    if (this.chunks.length === 0) return;

    const buffer = Buffer.concat(this.chunks);
    if (buffer.length < 4) return;

    // 读取消息长度（4 字节）
    const messageLength = buffer.readUInt32LE(0);

    if (buffer.length < 4 + messageLength) return;

    // 读取消息内容
    const messageBytes = buffer.slice(4, 4 + messageLength);
    const message = JSON.parse(messageBytes.toString('utf8'));

    // 处理剩余数据
    this.chunks = [buffer.slice(4 + messageLength)];

    // 处理消息
    this.handleMessage(message);
  }

  async handleMessage(message) {
    try {
      const response = await this.processMessage(message);
      this.sendMessage(response);
    } catch (error) {
      this.sendMessage({
        type: 'error',
        message: error.message
      });
    }
  }

  async processMessage(message) {
    switch (message.type) {
      case 'get.version':
        return {
          version: '0.2.6',
          nodeVersion: process.version
        };

      case 'download.url':
        return await this.downloadResource(message);

      case 'get.downloadFolder':
        return {
          downloadFolder: this.config.dataDir
        };

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  async downloadResource(message) {
    const { url, headers = {} } = message;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': headers.userAgent || 'Mozilla/5.0',
          'Referer': headers.referer || '',
          ...headers
        },
        timeout: 30000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.buffer();
      const filename = path.join(this.config.dataDir, message.filename);

      // 创建目录（如果不存在）
      fs.mkdirSync(path.dirname(filename), { recursive: true });

      // 保存文件
      fs.writeFileSync(filename, buffer);

      return {
        ok: true,
        filename: filename,
        size: buffer.length
      };

    } catch (error) {
      return {
        failed: true,
        errMsg: error.message
      };
    }
  }

  sendMessage(message) {
    const json = JSON.stringify(message);
    const buffer = Buffer.from(json, 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(buffer.length, 0);

    process.stdout.write(header);
    process.stdout.write(buffer);
  }
}

// 加载配置
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// 启动
const app = new NativeMessaging();
app.config = config;
app.start();
```

**打包为独立可执行文件：**

```bash
# 使用 pkg 打包
npm install -g pkg

pkg main.js --targets node18-macos-x64 -o native-app-macos

# 生成单文件可执行文件：native-app-macos（约 50MB）
# 用户无需安装 Node.js！
```

**安装脚本（install.sh）：**

```bash
#!/bin/bash

# 检测操作系统
OS=$(uname -s)
case "$OS" in
  Darwin)
    MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    ;;
  Linux)
    MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

# 创建目录
mkdir -p "$MANIFEST_DIR"

# 复制可执行文件
INSTALL_DIR="$HOME/.maoxian-web-clipper/native-app"
mkdir -p "$INSTALL_DIR"
cp native-app-macos "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/native-app-macos"

# 创建 manifest 文件
cat > "$MANIFEST_DIR/maoxian_web_clipper_native.json" <<EOF
{
  "name": "maoxian_web_clipper_native",
  "description": "Native application for MaoXian Web Clipper",
  "path": "$INSTALL_DIR/native-app-macos",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/"
  ]
}
EOF

echo "✅ Native App installed successfully!"
echo "📁 Location: $INSTALL_DIR/native-app-macos"
```

**用户安装流程：**

```bash
# 1. 下载 release
curl -L https://github.com/your-repo/releases/latest/download/native-app-macos.zip -o native-app.zip

# 2. 解压
unzip native-app.zip

# 3. 运行安装脚本
cd native-app
./install.sh

# 完成！无需安装 Ruby 或 Node.js
```

---

### 方案 2：Go/Rust 重写（终极方案）⭐⭐⭐⭐⭐

#### 优势

- ✅ **真正的零依赖**（编译为静态二进制）
- ✅ **极小的体积**（Go: ~5-10MB, Rust: ~2-5MB）
- ✅ **极快的启动速度**
- ✅ **更好的性能**
- ✅ **内存占用低**

#### Go 实现示例

**native-app-go/main.go:**

```go
package main

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"io/ioutil"
	"net/http"
	"os"
	"path/filepath"
)

type Message struct {
	Type     string            `json:"type"`
	URL      string            `json:"url"`
	Filename string            `json:"filename"`
	Headers  map[string]string `json:"headers"`
}

type Response struct {
	OK       bool   `json:"ok,omitempty"`
	Failed   bool   `json:"failed,omitempty"`
	Filename string `json:"filename,omitempty"`
	ErrMsg   string `json:"errMsg,omitempty"`
	Version  string `json:"version,omitempty"`
}

func main() {
	for {
		msg, err := readMessage()
		if err != nil {
			if err == io.EOF {
				break
			}
			sendError(err.Error())
			continue
		}

		resp := handleMessage(msg)
		sendMessage(resp)
	}
}

func readMessage() (*Message, error) {
	// 读取消息长度（4 字节）
	var length uint32
	if err := binary.Read(os.Stdin, binary.LittleEndian, &length); err != nil {
		return nil, err
	}

	// 读取消息内容
	buffer := make([]byte, length)
	if _, err := io.ReadFull(os.Stdin, buffer); err != nil {
		return nil, err
	}

	var msg Message
	if err := json.Unmarshal(buffer, &msg); err != nil {
		return nil, err
	}

	return &msg, nil
}

func handleMessage(msg *Message) *Response {
	switch msg.Type {
	case "get.version":
		return &Response{Version: "0.2.6"}

	case "download.url":
		return downloadResource(msg)

	default:
		return &Response{Failed: true, ErrMsg: "Unknown message type"}
	}
}

func downloadResource(msg *Message) *Response {
	// 创建 HTTP 请求
	client := &http.Client{}
	req, err := http.NewRequest("GET", msg.URL, nil)
	if err != nil {
		return &Response{Failed: true, ErrMsg: err.Error()}
	}

	// 设置请求头
	for key, value := range msg.Headers {
		req.Header.Set(key, value)
	}

	// 发送请求
	resp, err := client.Do(req)
	if err != nil {
		return &Response{Failed: true, ErrMsg: err.Error()}
	}
	defer resp.Body.Close()

	// 读取响应体
	data, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return &Response{Failed: true, ErrMsg: err.Error()}
	}

	// 保存文件
	filename := filepath.Join("/path/to/data", msg.Filename)
	os.MkdirAll(filepath.Dir(filename), 0755)

	if err := ioutil.WriteFile(filename, data, 0644); err != nil {
		return &Response{Failed: true, ErrMsg: err.Error()}
	}

	return &Response{OK: true, Filename: filename}
}

func sendMessage(resp *Response) {
	data, _ := json.Marshal(resp)
	length := uint32(len(data))

	binary.Write(os.Stdout, binary.LittleEndian, length)
	os.Stdout.Write(data)
}

func sendError(msg string) {
	sendMessage(&Response{Failed: true, ErrMsg: msg})
}
```

**编译：**

```bash
# macOS
GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o native-app-macos

# Linux
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o native-app-linux

# Windows
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o native-app-windows.exe

# 生成的文件约 5-8MB，无任何依赖！
```

---

### 方案 3：Electron 本地应用（用户友好）⭐⭐⭐

#### 优势

- ✅ **图形化界面**（可视化配置）
- ✅ **跨平台**
- ✅ **自动更新**
- ✅ **系统托盘图标**

#### 缺点

- ❌ **体积大**（约 100-200MB）
- ❌ **内存占用高**

---

## 📊 方案对比

| 方案 | 体积 | 依赖 | 安装难度 | 维护成本 | 用户体验 | 推荐度 |
|------|------|------|----------|----------|----------|--------|
| **当前 Ruby** | ~0.5MB | Ruby | ⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ |
| **Docker (HTTP)** | ~50MB | Docker | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **Node.js (pkg)** | ~50MB | 无 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Go/Rust** | ~5MB | 无 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Electron** | ~150MB | 无 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

---

## 🎯 推荐实施路线

### 短期（1-2 周）- 改进当前 Ruby 方案

**目标：** 降低用户安装门槛

1. **提供一键安装脚本**

```bash
# install-macos.sh
#!/bin/bash

echo "🚀 Installing MaoXian Native App..."

# 检查 Ruby
if ! command -v ruby &> /dev/null; then
    echo "❌ Ruby not found. Installing via Homebrew..."
    if ! command -v brew &> /dev/null; then
        echo "📦 Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    brew install ruby
fi

# 检查版本
RUBY_VERSION=$(ruby -e 'print RUBY_VERSION')
echo "✅ Ruby $RUBY_VERSION detected"

# 下载并安装
curl -L https://github.com/your-repo/releases/latest/download/native-app-macos.zip -o /tmp/native-app.zip
unzip -o /tmp/native-app.zip -d /tmp/native-app
cd /tmp/native-app
./install.sh

echo "✅ Installation completed!"
```

2. **制作视频教程**
   - macOS 安装演示
   - 配置演示
   - 常见问题解决

3. **改进文档**
   - 添加详细的安装步骤
   - 添加故障排查指南
   - 提供配置示例

---

### 中期（1-2 个月）- Node.js 重写

**目标：** 提供更好的跨平台支持和用户体验

#### 阶段 1：核心功能迁移（1 周）

- [ ] 实现 Native Messaging 协议
- [ ] 实现资源下载功能
- [ ] 实现文件保存功能
- [ ] 实现历史记录管理

#### 阶段 2：打包和测试（1 周）

- [ ] 使用 pkg 打包为单文件可执行文件
- [ ] 测试 macOS、Windows、Linux
- [ ] 创建安装脚本
- [ ] 编写文档

#### 阶段 3：发布（1 周）

- [ ] 创建 GitHub Release
- [ ] 提供下载链接
- [ ] 更新扩展文档
- [ ] 收集用户反馈

**优点：**
- ✅ 用户无需安装 Ruby
- ✅ 单文件安装
- ✅ 更好的跨平台支持

---

### 长期（3-6 个月）- Go/Rust 重写（可选）

**目标：** 极致的性能和体积

#### 适合场景

- 用户基数大（> 10,000）
- 性能敏感
- 追求极致体积

#### 不适合场景

- 快速迭代阶段
- 团队不熟悉 Go/Rust
- 功能频繁变更

---

## 📦 快速开始：macOS 安装（当前版本）

### 最简安装（适合开发者）

```bash
# 1. 确保有 Ruby（macOS 自带）
ruby -v

# 2. 进入 native-app 目录
cd /Users/yuanfeijie/Desktop/project/jia-web-clipper/native-app

# 3. 创建配置
cp config.yaml.example config.yaml

# 4. 编辑配置（修改 data_dir）
nano config.yaml

# 5. 创建数据目录
mkdir -p ~/Documents/MaoXian-Clipper

# 6. 测试运行
ruby main.rb < test/fixtures/get-version.json

# 如果输出 JSON 消息，说明工作正常

# 7. 回到项目根目录，安装打包工具
cd ..
gem install web-ext-native-app-packer

# 8. 打包
./scripts/pack-native-app.sh

# 9. 安装
cd dist/native-app
unzip maoxian-web-clipper-native-macos-chrome.zip -d native-app
cd native-app
./install.sh

# 10. 重启浏览器，在扩展中选择 "Native App" Handler
```

---

## 🐛 故障排查

### 问题 1：扩展无法连接到 Native App

**检查清单：**

```bash
# 1. 检查 manifest 文件是否存在
ls ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/

# 2. 查看 manifest 内容
cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/maoxian_web_clipper_native.json

# 3. 检查 path 是否正确
# 4. 检查文件权限
# 5. 查看 Chrome 扩展日志
# 打开 chrome://extensions/，点击扩展的 "background page"
```

### 问题 2：Ruby 版本过低

```bash
# 检查版本
ruby -v

# 使用 rbenv 安装新版本
brew install rbenv
rbenv install 3.2.2
rbenv global 3.2.2
```

### 问题 3：下载失败

**查看日志：**

```bash
# 日志位置
~/path/to/native-app/tmp/*.log
```

---

## 📚 参考资料

- [Native Messaging 协议文档](https://developer.chrome.com/docs/extensions/mv3/nativeMessaging/)
- [web-ext-native-app-packer](https://github.com/mika-cn/web-ext-native-app-packer)
- [pkg - 打包 Node.js 应用](https://github.com/vercel/pkg)

---

*本文档由 AI 辅助生成，提供了 Native App 的全面分析和改进方案。*
