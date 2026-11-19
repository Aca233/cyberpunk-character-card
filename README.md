# 赛博朋克 2077 角色卡

夜之城文字角色扮演游戏。由大语言模型扮演所有 NPC 与夜之城本身，玩家扮演自建佣兵，通过自由文字交互与检定推动剧情发展，界面还原游戏原作视觉风格。

### 核心特性

- **叙事导向的自由行动**：没有死板的轮次与技能槽限制。打斗、交涉、潜入或逃亡完全依据叙事推进，底层代码负责结算检定、伤口留疤、战利品与人际影响（死者亲属结仇、黑客反噬、流言扩散）。
- **纯前端静态运行**：整个游戏完全作为静态网页运行。存档、角色卡、酒馆预设、模型连接配置与密钥全部保存在浏览器本地 IndexedDB 中，前端直接请求模型 API，隐私安全且零后端成本。
- **创伤小组会员服务**：在人物页办理银卡或白金卡，管理续期、升级和退会，并按会籍、伤势和现场条件呼叫紧急救援。详见[会籍规则](docs/trauma-membership.md)。

---

## 快速上手

```bash
pnpm install
pnpm dev     # 启动纯静态前端开发服务器（http://127.0.0.1:5177）
pnpm check   # 类型检查 + Biome + Vitest + 数据校验
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
```

> **Windows PowerShell 子路径构建提示**：PowerShell 不支持 `VAR=val cmd` 行内环境变量写法，如需指定 `CP_BASE` 可执行：  
> `$env:CP_BASE='/仓库名/'; pnpm build`。
- 线上地址：https://cyberpunk-am6.pages.dev
- 首次进入时系统会依据 `config.example.json` 自动初始化本地配置，初次使用请在设置中添加自己的模型连接。


## 开工前核实（2026-10-23）

### 叙事模型：Gemini 3.8 Flash

来源：ai.google.dev 的模型页面、定价页面和安全设置指南。

| 项目        | 结果                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模型 ID     | `gemini-3.8-flash`，稳定版（2026-09 更新）                                                                                                            |
| 上下文      | 输入最多 1,048,576 token，单次输出最多 65,536 token                                                                                                   |
| 输入 / 输出 | 输入可以是文本、图片、视频、音频、PDF；只输出文本                                                                                                     |
| 思考强度    | `thinking_level`：`low` / `medium`（默认）/ `high`；不支持 `minimal`，旧的 `thinking_budget` 已被取代                                                 |
| 价格        | 优惠价到 2026-12-31：输入 $0.75 / 1M token，输出 $3.75 / 1M token；2027-01-01 起按标准价                                                              |
| 安全设置    | 类别：仇恨、色情、危险内容、骚扰、公民诚信、越狱。2.5 及以后的模型，没设置的类别默认 `OFF`。`BLOCK_NONE` 不拦截但会返回评分；`OFF` 不返回任何安全信息 |
| 被拦截时    | 本项目使用 generateContent 协议：检查 `promptFeedback.blockReason`、候选的 `finishReason` 和 `safetyRatings[].blocked`；转成 `blocked`，不记作成功    |

对实现的影响：
- 叙事模型上下文按 1M 输入、64k 输出设上限；预算和摘要策略不变，不把整份日志塞进去。
- 安全设置默认不传（即 `OFF`）；需要拿评分做自己的规则时再改成 `BLOCK_NONE`。
- 提供方识别输入拦截、候选拦截及明确的安全错误码，转成 `LlmEvent` 的 `blocked`；其他 HTTP 错误按状态码处理，不能把所有 400/403 都当成内容拦截。
- 提供方用 `streamGenerateContent?alt=sse`（2026-10-24 接入）：系统消息放 `systemInstruction`，assistant 转成 `model`，密钥放 `x-goog-api-key` 请求头；思考内容不放进正文，思考 token 算进输出用量；`MAX_TOKENS`、`CONTINUATION` 和别的异常结束都报错，不自动续写或重试。
- 模型页面显示 Gemini 4 Argon 已经可用。M1 仍用 3.8 Flash，模型 ID 放在 `config.json` 里，以后可以换。

### Gemini 原生接入补充（2026-10-24）

- 接口：`POST /v1beta/models/{model}:streamGenerateContent?alt=sse`。`baseUrl` 填 API 根路径，不填完整生成接口；模型 ID 从方案配置读取。
- 密钥使用 `x-goog-api-key` 请求头，不拼进 URL；本地 `config.json` 不纳入版本库。
- `systemInstruction` 接收系统消息，历史 assistant 消息转换为 `model`。只显示普通文本片段，跳过思考摘要。
- 用量采用流中的累计值，不逐块相加；输出用量包含 `candidatesTokenCount` 和 `thoughtsTokenCount`。
- 停止生成、断流、格式错误、空正文、达到输出上限和要求续写，都不当成完成；不自动发起续写或重试。
- 设置页新增 Gemini 官方接入方式。测试连接会产生模型费用；Gemini 测试请求最多允许 2048 个输出 token，且不超过方案的输出上限。较低上限仍可能被思考耗尽，此时明确报错，不自动放宽。
- 本机假服务已验证协议 20 项、停止和路由 6 项；真实 Google 接口和浏览器操作尚未验证。
- 协议参考：[生成接口](https://ai.google.dev/api/generate-content)、[generateContent 思考配置](https://ai.google.dev/gemini-api/docs/generate-content/thinking)、[generateContent 安全反馈](https://ai.google.dev/gemini-api/docs/generate-content/safety-settings)。

### 依赖版本

M1 用到的依赖，2026-10-23 查到的最新版：

| 包                    | 版本                                                     |
| --------------------- | -------------------------------------------------------- |
| react / react-dom     | 19.3.1                                                   |
| vite                  | 8.3.5                                                    |
| @vitejs/plugin-react  | 6.1.2                                                    |
| react-router          | 8.5.0                                                    |
| zustand               | 5.0.16                                                   |
| @tanstack/react-query | 5.104.5                                                  |
| immer                 | 11.2.9                                                   |
| hono                  | 4.13.13                                                  |
| @hono/node-server     | 2.1.5                                                    |
| zod                   | 4.6.7                                                    |
| @playwright/test      | 1.64.1                                                   |
| sharp                 | 0.35.5（需要 `pnpm approve-builds sharp`）               |
| concurrently          | 10.0.6                                                   |
| typescript            | 7.0.2                                                    |
| @biomejs/biome        | 2.6.2（`rules.recommended` 已弃用，改用 `rules.preset`） |
| vitest                | 5.0.5                                                    |

### 素材转换：WolvenKit CLI

来源：WolvenKit wiki 的 CLI 页面。本机核对的是 `_unpack` 里的文件。
- **`.inkwidget` 和 `onscreens.json` 都还是 CR2W 二进制**：本机核对过，文件开头 4 个字节是 `CR2W`。这包括 `_unpack/assets/ui_layout/` 下的 1,698 个 `.inkwidget`，以及 `text_zh_en/{base,ep1}/localization/zh-cn/onscreens/onscreens.json`。`onscreens.json` 虽然扩展名是 `.json`，实际也是 CR2W；目前还没有转成文本 JSON 的版本。
- **转换命令是 `convert serialize`**，可以只转一个文件：`WolvenKit.CLI convert serialize "<文件或目录>" -o "<输出目录>"`。目录可以加 `-w *.inkwidget` 过滤，加 `--print` 输出到标准输出；旧的 `cr2w -s` 写法已弃用。
- **贴图（`.xbm`）用 `export`**：`WolvenKit.CLI export "<文件.xbm>" --uext png -o "<输出目录>"`。还在 `.archive` 里的文件用 `uncook -p "<archive>" -w *.xbm --uext png -o "<输出目录>"`。
- **本机还没装 WolvenKit CLI**；dotnet 已有（`C:\Program Files\dotnet`）。安装命令是 `dotnet tool install -g wolvenkit.cli`，等切片 5 做素材时再装，装之前先确认。
- 转出的 JSON 放到 `reference/ui/layouts/` 和 `tools/assets/` 的输入目录，不进版本库。`pick.ts` 缺图或缺布局时报错，并给出可以照抄的命令，不自动调用，也不用 CSS / SVG 代替。
