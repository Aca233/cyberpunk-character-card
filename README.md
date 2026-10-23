# 赛博朋克 2077 角色卡

由大模型主持文字剧情的角色卡网页。以自建角色为中心，界面还原原作风格。策划案见 `~/.claude/plans/2077-generic-hamster.md`。

## 开发

```bash
pnpm install
pnpm check   # 类型检查 + Biome + Vitest
```

- 需要 Node 24 以上、pnpm 12。
- `config.json`（含密钥）由用户在本地创建，不进版本库。
- 原作素材放在 `apps/web/public/assets/local/`，不进版本库，也不随项目分享。

## 开工前核实（2026-10-23）

### 主持人模型：Gemini 3.8 Flash

来源：ai.google.dev 的模型页面、定价页面和安全设置指南。

| 项目 | 结果 |
|---|---|
| 模型 ID | `gemini-3.8-flash`，稳定版（2026-09 更新） |
| 上下文 | 输入最多 1,048,576 token，单次输出最多 65,536 token |
| 输入 / 输出 | 输入可以是文本、图片、视频、音频、PDF；只输出文本 |
| 思考强度 | `thinking_level`：`low` / `medium`（默认）/ `high`；不支持 `minimal`，旧的 `thinking_budget` 已被取代 |
| 价格 | 优惠价到 2026-12-31：输入 $0.75 / 1M token，输出 $3.75 / 1M token；2027-01-01 起按标准价 |
| 安全设置 | 类别：仇恨、色情、危险内容、骚扰、公民诚信、越狱。2.5 及以后的模型，没设置的类别默认 `OFF`。`BLOCK_NONE` 不拦截但会返回评分；`OFF` 不返回任何安全信息 |
| 被拦截时 | Interactions API 返回 HTTP 400，错误码 `safety`，不返回被拦截的内容 |

对实现的影响：

- 主持人上下文按 1M 输入、64k 输出设上限；预算和摘要策略不变，不把整份日志塞进去。
- 安全设置默认不传（即 `OFF`）；需要拿评分做自己的规则时再改成 `BLOCK_NONE`。
- 提供方必须把"HTTP 400 + `safety`"转成 `LlmEvent` 的 `blocked` 事件，不能当成网络错误重试。
- 用 `generateContent` 还是 Interactions API（`POST /v1beta/interactions`，请求头 `Api-Revision: 2026-05-20`），在切片 3 写提供方时决定。
- 模型页面显示 Gemini 4 Argon 已经可用。M1 仍用 3.8 Flash，模型 ID 放在 `config.json` 里，以后可以换。

### 依赖版本

M1 用到的依赖，2026-10-23 查到的最新版：

| 包 | 版本 |
|---|---|
| react / react-dom | 19.3.1 |
| vite | 8.3.5 |
| @vitejs/plugin-react | 6.1.2 |
| react-router | 8.5.0 |
| zustand | 5.0.16 |
| @tanstack/react-query | 5.104.5 |
| immer | 11.2.9 |
| hono | 4.13.13 |
| @hono/node-server | 2.1.5 |
| zod | 4.6.7 |
| @playwright/test | 1.64.1 |
| sharp | 0.35.5（需要 `pnpm approve-builds sharp`） |
| concurrently | 10.0.6 |
| typescript | 7.0.2 |
| @biomejs/biome | 2.6.2（`rules.recommended` 已弃用，改用 `rules.preset`） |
| vitest | 5.0.5 |

### 素材转换：WolvenKit CLI

来源：WolvenKit wiki 的 CLI 页面。

- 支持转换单个文件：`WolvenKit.CLI.exe export "<文件.xbm>" --uext png -o "<输出目录>"`。也可以传多个文件或一个目录；旧的 `-p` 写法已弃用。
- 还在 `.archive` 里的文件要用 `uncook -p "<archive>" -w *.xbm --uext png -o "<输出目录>"`。
- 安装方法：`dotnet tool install -g wolvenkit.cli`。
- `tools/assets/pick.ts` 优先使用 `_unpack` 里已经解出的 PNG。缺图时报错，并给出可以照抄的 `export` 命令，不自动调用，也不用 CSS / SVG 代替。
