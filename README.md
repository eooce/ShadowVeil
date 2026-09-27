# ShadowVeil

**让代码隐入暗影** —— 一个生产级、开源的在线代码混淆平台（多语言 + 开放 API）。

粘贴 JavaScript / Python / Shell，毫秒级获得混淆结果，可复制、可下载、可对比；同时提供带 API Key 的 RESTful 接口供程序调用。

> 视觉风格：深空霓虹 + 玻璃拟态 + 极光渐变。原生 HTML + TailwindCSS + Monaco Editor。

![ShadowVeil 首屏](<img width="600" height="400" alt="image" src="https://github.com/user-attachments/assets/8acac1ab-a206-43ee-bbad-2f51b9fb6f40" />
)

---

## ✨ 功能特性

- **多页面站点**：混淆器（首页）/ API 文档 / 定价 / 关于，各自独立页面
- **三语言混淆引擎**
  - **JavaScript**：基于 `javascript-obfuscator`，三级强度（轻 / 中 / 高，默认中），在 worker 线程中执行，不阻塞事件循环
  - **Python**：单一模式 —— 自研词法分析器混淆后套多层 zlib / base64 自解压外壳，运行效果与原代码一致
  - **Shell**：两级 —— 默认 base64 管道执行；高为 bashfuscator 风格多层变换（base64 + tr 字符替换 + 八进制 printf + 变量拼接）
- **大工作区**：Monaco 双栏编辑器（可拖拽分栏、首屏即达）、语言分段控件、按语言动态显示的等级滑块、Ctrl/Cmd + Enter 快捷键
- **结果操作**：复制 / 下载 / 全屏 / 清空，彩色统计徽章（原始大小 → 混淆后大小、压缩率、耗时）
- **开放 API**：见下方 [API 使用示例](#-api-使用示例)
- **API Key 管理**：邮箱即刻换 Key，页面内显隐切换与复制，`/keys/me` 查询用量
- **分享配置**：语言与等级变化时自动写入 URL query（如 `?lang=shell&level=high`）
- **细节**：明暗双主题（默认暗）、`prefers-reduced-motion` 支持、8px 自定义滚动条、全键盘焦点可见描边、Toast 通知（绝不使用 `alert`）

## 🐳 Docker 部署

镜像基于 `node:24-alpine` 多阶段构建（native 依赖在构建阶段编译，运行镜像精简、以非 root 用户运行），每次推送 main 分支时 GitHub Actions 会自动构建 `linux/amd64` 与 `linux/arm64` 双平台镜像并发布到 GHCR。

```bash
# 使用官方镜像
docker run -d --name shadowveil -p 3000:3000 -v shadowveil-data:/app/data ghcr.io/eooce/shadowveil:latest

# 本地构建
docker build -t shadowveil .
docker run -d --name shadowveil -p 3000:3000 -v shadowveil-data:/app/data shadowveil
```

SQLite 数据库存放在 `/app/data`，通过卷挂载持久化。

## 🚀 本地启动

要求：Node.js 20+，无其他依赖（单进程运行，无 pm2 / docker）。

```bash
npm install
npm run dev          # 或 npm start
```

控制台会打印彩色 ASCII 启动横幅，随后打开 <http://localhost:3000>。

如需自定义端口 / 限流参数：

```bash
cp .env.example .env # 按需修改后重启
```

## 📡 API 使用示例

### 混淆代码

```bash
curl -X POST http://localhost:3000/api/v1/obfuscate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "language": "javascript",
    "level": "standard",
    "code": "function hello() { console.log(\"hi\"); }"
  }'
```

成功响应：

```json
{
  "success": true,
  "requestId": "5f0c…",
  "data": {
    "code": "var _0x…;",
    "stats": { "originalSize": 1024, "outputSize": 2048, "ratio": 2.0, "duration": 37 }
  }
}
```

失败响应（所有错误均为统一结构，绝不裸 500）：

```json
{
  "success": false,
  "requestId": "5f0c…",
  "error": { "code": "INVALID_SYNTAX", "message": "unterminated string literal (line 3)" }
}
```

### 获取 / 查询 API Key

```bash
# 邮箱换取 Key（同邮箱幂等）
curl -X POST http://localhost:3000/api/v1/keys \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'

# 查询当前 Key 用量
curl http://localhost:3000/api/v1/keys/me -H "X-API-Key: YOUR_API_KEY"

# 健康检查 / 语言元信息
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/languages
```

### 接口一览

| 方法 | 路径 | 说明 | 认证 |
| --- | --- | --- | --- |
| POST | `/api/v1/obfuscate` | 混淆代码（code ≤ 200KB） | 可选（无 Key 走匿名限流） |
| POST | `/api/v1/keys` | 邮箱换取 API Key（5 次/分钟/IP） | — |
| GET | `/api/v1/keys/me` | 查询当前 Key 的用量 | 需要 |
| GET | `/api/v1/health` | 健康检查 | — |
| GET | `/api/v1/languages` | 支持的语言 / 等级 / 默认值 | — |

页面路由：`/`（混淆器）· `/docs`（API 文档）· `/pricing` · `/about`。

## 🔐 限流与配额

| 调用方式 | 每分钟 | 每日 | 超限行为 |
| --- | --- | --- | --- |
| 匿名（按 IP） | 10 次 | — | `429` + `Retry-After` |
| API Key | 100 次 | 5,000 次 | `429` + `Retry-After`；日配额在 UTC 零点重置 |

## 📊 混淆等级说明

### JavaScript（javascript-obfuscator · 三级，默认 `standard`）

| 能力 | light（轻） | standard（中） | max（高） |
| --- | :-: | :-: | :-: |
| 压缩 / 标识符十六进制化 | ✅ | ✅ | ✅ |
| 字符串数组 + base64 编码 | — | ✅ | ✅（rc4） |
| 控制流扁平化 | — | ✅（阈值 0.5） | ✅（阈值 1） |
| 死代码注入 | — | — | ✅（0.4） |
| 字符串拆分 / 数字转表达式 | — | — | ✅ |
| 自我保护（selfDefending） | — | ✅ | ✅ |
| 调试保护 / 禁用 console | — | — | ✅ |

API 可用 `options` 覆盖预设：`selfDefending`、`debugProtection`、`controlFlowFlattening`、`deadCodeInjection`、`stringArray`、`identifierNamesGenerator`。

### Python（单一模式，无等级）

词法级混淆（变量重命名 / 字符串 base64 加密 / 数字混淆 / 注释移除）之后，再套**两层 zlib + base64 自解压外壳**：

```python
exec(__import__('zlib').decompress(__import__('base64').b64decode('…')))
```

运行效果与原代码完全一致，无任何第三方依赖。词法层安全保留 shebang、编码声明、docstring、关键字参数、属性访问。

### Shell（两级，默认 `base64`）

| 等级 | 产物形态 |
| --- | --- |
| `base64`（默认） | `echo "<base64>" \| base64 -d \| bash` —— 整段脚本 base64 后管道执行，shebang 保留在首行 |
| `high` | bashfuscator 风格多层变换：base64 → 字符替换（tr ROT13）→ 八进制转义（`\NNN`）→ 拆分到 `__` / `___` / `____` 变量 → `printf` 还原后经 `tr \| base64 -d \| bash` 执行 |

安全保证：跳过 `$?`/`$!`/`$$`/`$#`/`$@`/`$*`/`$0-$9` 等特殊参数与 `PATH`/`IFS` 等环境变量（编码型混淆不触碰变量名）；混淆前先做引号 / heredoc / 括号平衡扫描，语法错误直接返回友好提示，用户代码从不被执行。

## 🗂 目录结构

```text
shadowveil/
├── package.json
├── .env.example
├── README.md
├── scripts/
│   └── test-engines.mjs        # 引擎自测（语义等价验证）
├── src/
│   ├── server.js               # Fastify 启动入口 + 启动横幅
│   ├── config.js
│   ├── routes/
│   │   ├── api.js              # /api/v1 端点
│   │   └── pages.js            # 页面路由
│   ├── core/
│   │   ├── index.js            # 统一调度 obfuscate(code, language, options)
│   │   ├── javascript.js       # javascript-obfuscator 封装（worker 池）
│   │   ├── worker-pool.js      # worker_threads 线程池
│   │   ├── obfuscate-worker.js # worker 入口
│   │   ├── python/
│   │   │   ├── tokenizer.js    # Python 词法分析器
│   │   │   └── obfuscator.js   # 分析 + 变换 + 渲染
│   │   ├── shell.js            # Shell 混淆器
│   │   ├── presets.js          # 三档预设与高级选项元数据
│   │   └── errors.js           # ObfuscationError
│   ├── middleware/
│   │   ├── apiKey.js           # Key 校验 + 每日配额
│   │   ├── rateLimit.js        # @fastify/rate-limit 配置
│   │   └── errorHandler.js     # 统一结构化错误
│   ├── db/
│   │   └── index.js            # better-sqlite3 初始化 + 建表
│   └── utils/
│       ├── stats.js
│       ├── logger.js
│       └── banner.js           # ASCII 启动横幅
├── public/
│   ├── index.html              # 首页 · 在线混淆器
│   ├── docs.html               # API 文档页
│   ├── pricing.html            # 定价页
│   ├── about.html              # 关于页
│   ├── css/
│   │   ├── tailwind.css
│   │   └── custom.css          # 设计变量、玻璃拟态、光晕、动效
│   ├── js/
│   │   ├── app.js              # 主逻辑（主题 / 工作区 / 等级）
│   │   ├── editor.js           # Monaco 封装
│   │   └── api-docs.js         # 文档页示例与 Key 管理
│   └── assets/
│       └── logo.svg
└── data/
    └── shadowveil.db           # 首次启动自动创建
```

## ⚙️ 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `DB_PATH` | `data/shadowveil.db` | SQLite 文件路径 |
| `ANON_RATE_LIMIT` | `10` | 匿名每分钟请求数（按 IP） |
| `KEY_RATE_LIMIT` | `100` | Key 每分钟请求数 |
| `KEY_DAILY_QUOTA` | `5000` | Key 每日请求数 |
| `KEY_ISSUE_RATE_LIMIT` | `5` | 每分钟可签发的 Key 数（按 IP） |
| `MAX_CODE_BYTES` | `204800` | 接受的代码体积上限（200KB） |
| `LOG_LEVEL` | `info` | pino 日志级别 |
| `NODE_ENV` | `development` | 生产环境设为 `production` |

## 🧪 引擎自测

```bash
node scripts/test-engines.mjs
```

覆盖三语言 × 三档混淆：Python / Shell 产物会**真实执行**并与原代码输出逐字节比对，JS 产物经 `node --check` 与执行验证，另含语法错误拒绝用例。

## 🔒 安全与隐私

- 不执行用户代码：Python / Shell 混淆为纯词法变换，无 `eval`、无子进程
- 源码不落盘：请求体只在内存中处理，数据库仅记录体积与耗时等元数据
- 所有输入限长 200KB；HTML 输出经转义；Key 使用 `crypto.randomBytes(24).toString('hex')` 生成
- 每个请求都有 `requestId`（UUID），便于审计与排障

## 📄 License

MIT
