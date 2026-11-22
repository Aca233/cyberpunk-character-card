# 赛博朋克2091

夜之城文字角色扮演游戏。由大语言模型扮演所有 NPC 与夜之城本身，玩家扮演自建佣兵，通过自由文字交互与检定推动剧情发展，界面还原游戏原作视觉风格。

### 核心特性

- **叙事导向的自由行动**：没有死板的轮次与技能槽限制。打斗、交涉、潜入或逃亡完全依据叙事推进，底层代码负责结算检定、伤口留疤、战利品与人际影响（死者亲属结仇、黑客反噬、流言扩散）。
- **纯前端静态运行**：整个游戏完全作为静态网页运行，无独立后端进程。存档、角色卡、酒馆预设、模型连接配置与密钥全部保存在浏览器本地 IndexedDB 中，前端直接请求模型 API，隐私安全且零后端成本。
- **创伤小组会员服务**：在人物页办理银卡或白金卡，管理续期、升级和退会，并按会籍、伤势和现场条件呼叫紧急救援。详见 [会籍规则](docs/trauma-membership.md)。

---

## 技术架构

项目采用 pnpm Monorepo 组织，唯一可部署产物是 `apps/web` 的静态网页：

| 目录               | 包名          | 职责                                                                                                                                     |
| ------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`         | `@cp/web`     | React 19 + Vite 静态前端应用，界面、音频与交互逻辑                                                                                       |
| `packages/runtime` | `@cp/runtime` | 浏览器端本地运行时层：基于 Hono 内存虚拟路由（`app.fetch`）+ IndexedDB 事务存储 + 多模型直连适配；另导出 `./llm` 供本地 CLI 测评脚本使用 |
| `packages/core`    | `@cp/core`    | 规则内核、回合日志重放、状态投影与叙事提示词编排（纯逻辑，零 React / Node 依赖）                                                         |
| `packages/content` | `@cp/content` | 夜之城世界观静态数据、人物、地点、装备、义体与任务目录                                                                                   |
| `tools`            | `@cp/tools`   | 本地开发辅助工具（素材处理与校验、数据校验、CLI 叙事评测、一键发布）                                                                     |

更多设计文档见 [玩法与机制总览](docs/gameplay-mechanics.md) 与 [因果结算设计](docs/causal-settlement-design.md)。

---

## 快速上手

```bash
pnpm install
pnpm dev     # 启动纯静态前端开发服务器（http://127.0.0.1:5177）
pnpm check   # 类型检查 + Biome + 数据校验
```

- **环境要求**：Node 24+，pnpm 12。
- **游戏素材**：原作解包素材放置于 `apps/web/public/assets/local/`（仅供个人本地使用，不随仓库分发）。
- **CLI 测评配置（可选）**：仅命令行测评工具 `pnpm eval` 需要在本地新建 `config.json`（参考 `config.example.json`），默认不进入版本库。

## 静态构建与部署

所有玩家数据（存档、角色卡、预设、模型密钥）均由浏览器 IndexedDB 本地管理，页面直接通过 CORS 调用模型服务商。

```bash
pnpm dev                                    # 本地开发预览
pnpm build                                  # 构建静态产物至 apps/web/dist
CP_BASE=/仓库名/ pnpm --filter @cp/web build # GitHub Pages 项目子路径站点构建
```

- **路由与刷新**：使用 Hash 路由（`#/menu`），静态托管任意子路径刷新均不会 404，无需配置服务端重定向。
- **素材与构建**：素材目录不进 Git。本地完成构建后，直接将 `apps/web/dist` 上传托管。如果未解包正式素材，会以 demo 素材兜底运行并在界面标注提示。
- **跨域与连接**：所选模型服务商需支持浏览器端 CORS 访问；若使用本地 Ollama，请配置 `OLLAMA_ORIGINS`。
- **数据安全**：存档仅保存在当前浏览器的存储区，清理浏览器缓存会导致存档丢失；请随时在「读取存档」页面导出 JSON 备份。

### 部署到 Cloudflare Pages

通过 Wrangler 直接上传构建产物（`apps/web/wrangler.toml` 项目名为 `cyberpunk`，对应域名 `https://cyberpunk-am6.pages.dev`）：

```bash
npx wrangler login                          # 首次使用需登录
pnpm deploy                                 # 构建并部署 apps/web/dist 到 Cloudflare Pages
pnpm push                                   # 一键推送 GitHub 并构建部署 Cloudflare Pages
```

- **Windows 一键双击**：直接双击根目录的 [`publish.cmd`](publish.cmd)，即可自动完成 GitHub 推送 + 构建并部署 Cloudflare Pages（若有未提交改动会交互提示输入 commit 说明，也支持命令行传参，例如 `.\publish.cmd -m "说明"`、`.\publish.cmd --check`、`.\publish.cmd --skip-git`、`.\publish.cmd --skip-pages`）。

> **Windows PowerShell 子路径构建提示**：PowerShell 不支持 `VAR=val cmd` 行内环境变量写法，如需指定 `CP_BASE` 可执行：
> `$env:CP_BASE='/仓库名/'; pnpm build`。
- 线上地址：https://cyberpunk-am6.pages.dev
- 首次进入时系统会依据 `config.example.json` 自动初始化本地配置，初次使用请在设置中添加自己的模型连接。
