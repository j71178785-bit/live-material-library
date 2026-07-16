# AI 功能部署指南

## 架构说明

```
素材库前端（GitHub Pages）
    ↓ 调用
Cloudflare Worker（API 代理）
    ↓ 调用
阿里云百练 DashScope API
```

API Key 存在 Cloudflare Worker 的环境变量中，前端代码里看不到。

---

## 第一步：获取阿里云百练 API Key

1. 打开 https://bailian.console.aliyun.com/
2. 登录阿里云账号（可支付宝扫码）
3. 左侧菜单 → API-KEY 管理 → 创建新 API Key
4. 复制 API Key（格式：`sk-xxxxxxxx`）

> 通义千问模型有免费额度，够日常使用。

---

## 第二步：安装 Node.js（如果已有可跳过）

打开终端（PowerShell）检查：
```powershell
node -v
```
如果提示找不到命令，去 https://nodejs.org 下载 LTS 版安装。

---

## 第三步：安装 Cloudflare Wrangler CLI

```powershell
npm install -g wrangler
```

安装完成后验证：
```powershell
wrangler --version
```

---

## 第四步：登录 Cloudflare

```powershell
wrangler login
```
浏览器会自动打开 Cloudflare 授权页，点击 Allow。
（如果没有 Cloudflare 账号，会提示注册，免费，2分钟搞定）

---

## 第五步：部署 Worker

进入 worker 目录：
```powershell
cd C:\Users\Hyc\WorkBuddy\2026-06-28-19-36-06\worker
```

部署：
```powershell
wrangler deploy
```

部署成功后会显示：
```
Published material-ai-proxy
  https://material-ai-proxy.<你的子域名>.workers.dev
```

**复制这个 URL**，这是你的 Worker 地址。

---

## 第六步：设置 API Key（环境变量）

```powershell
wrangler secret put AI_API_KEY
```
系统会提示输入值，粘贴第一步获取的阿里云百练 API Key（`sk-xxx`），回车。

> Secret 不会出现在代码里，也不在 wrangler.toml 里，只存在 Cloudflare 的加密存储中。

---

## 第七步：在前端填入 Worker URL

1. 打开素材库网页：https://j71178785-bit.github.io/live-material-library/
2. 点击顶部导航栏的「AI 设置」
3. 粘贴第五步获得的 Worker URL
4. 点击「保存设置」

完成！现在可以打开任意素材详情，使用「分析内容」和「推荐标签」功能了。

---

## 验证是否成功

1. 打开一个素材的详情弹窗
2. AI 区域右上角应显示「已连接」（绿色）
3. 在转写文本框输入一些内容，点「分析内容」
4. 几秒后应返回 AI 分析结果

## 常见问题

**Q: 显示「未连接」？**
A: 点击「AI 设置」检查 Worker URL 是否填写正确，必须以 `https://` 开头。

**Q: 分析失败提示 API 调用失败？**
A: 检查 API Key 是否正确设置（第六步），确认阿里云百练服务已开通。

**Q: 部署后 Worker URL 忘了？**
A: 在 worker 目录运行 `wrangler deploy` 会重新显示 URL，或登录 Cloudflare Dashboard 查看。

**Q: 免费额度够用吗？**
A: Cloudflare Workers 免费 10万次/天。阿里云百练通义千问模型也有免费额度。正常使用完全够。
