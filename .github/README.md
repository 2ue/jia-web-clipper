# GitHub Actions 快速开始

## 🎯 快速发布新版本

### 方法 1: 命令行方式（3 步骤）

```bash
# 1. 更新版本号（在 package.json 和 src/manifest.json）
# 手动编辑或使用脚本

# 2. 创建并推送 tag
git tag tagv0.7.1
git push origin tagv0.7.1

# 3. 等待自动构建完成 ✅
# 访问: https://github.com/YOUR_USERNAME/YOUR_REPO/actions
```

### 方法 2: GitHub 网页方式（点击操作）

1. 访问 **Actions** → **Version Bump (Optional)**
2. 点击 **Run workflow**
3. 选择版本类型（patch/minor/major）
4. 点击运行 ✅

---

## ⚙️ 首次使用配置

### 🎉 无需配置，开箱即用！

GitHub Actions 已配置**自动生成随机占位符**，你可以：

✅ 直接创建 tag 触发打包
✅ 无需配置任何 Secrets
✅ 立即获得可用的构建产物

### 可选：配置真实 Secrets（正式发布时）

只有当你需要发布到 Chrome Web Store 或 Firefox AMO 时，才需要配置：

访问: **Settings** → **Secrets and variables** → **Actions**

添加以下 Secrets:

| Secret 名称 | 说明 |
|------------|------|
| `MX_CHROMIUM_ID` | Chromium 扩展公钥（正式发布） |
| `MX_FIREFOX_ID` | Firefox 扩展 ID（正式发布） |
| `MX_CHROMIUM_UPDATE_URL` | 更新清单 URL（可选） |

---

## 📦 工作流说明

| 工作流 | 触发条件 | 功能 |
|--------|---------|------|
| **CI** | Push/PR | 自动测试和构建验证 |
| **Release** | Tag `tagv*.*.*` | 构建并发布新版本 |
| **Version Bump** | 手动触发 | 自动更新版本号 |

---

## 📚 详细文档

查看 [ACTIONS_SETUP.md](./ACTIONS_SETUP.md) 了解：
- 详细配置说明
- 故障排查指南
- 最佳实践

---

**当前配置版本**: v1.0.0
**pnpm 版本**: 7.33.7
**Node.js 版本**: 18
