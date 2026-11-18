# 彻底转向纯静态前端与 Cloudflare Pages 部署计划

状态：进行中（2026-11-18）

## 目标与确认决策

1. **彻底转向静态**：移除 `VITE_CP_BACKEND=local` / `LOCAL_MODE` 双轨开关，删除 Node HTTP 服务端（`apps/server/src/main.ts` 及磁盘存档/内容工坊/本机 SQLite 设定库），前端开发（`dev`）与构建（`build`）默认即为纯静态浏览器应用（IndexedDB 存储 + 浏览器直连模型 + Hash 路由）。
2. **保留 CLI 测评能力**：`tools/narrator-eval.ts`（`pnpm eval`）继续通过 `@cp/server/llm`（`FileDocStore`）读取本机 `config.json` 运行命令行测评，且保留 `config.ts` 中的 `apiKeyEnv` 以兼容 CLI 环境变量读取。
3. **评测用例草稿改为浏览器下载**：设置页「上下文（调试）」中的「存为评测用例」（`SaveAsCase`）不再写入服务端磁盘 `tools/evals/drafts/`，改为生成评测用例草稿 JSON 并直接触发浏览器 `.json` 下载（与导出存档一致）。
4. **Cloudflare Pages 部署**：`apps/web/wrangler.toml` 维持 `name = "cyberpunk"`（线上域名 `https://cyberpunk-am6.pages.dev`），完成改造并静态检查、构建通过后执行 `wrangler pages deploy` 部署。

---

## 实施步骤

### 步骤 1：移除前端双轨切换（`LOCAL_MODE`）与服务端模式残留
- `apps/web/src/api/transport.ts`：移除 `LOCAL_MODE` / `VITE_CP_BACKEND` 判断，直接初始化 Web Locks 与 `@cp/server/browser` 本地后端，不再保留 `fetch('/api...')` 路径。
- `apps/web/src/api/events.ts`：移除 `EventSource` SSE 分支，直接调用 `followLocalTurn`。
- `apps/web/src/api/client.ts`：移除 `LOCAL_MODE` 判断与服务器不可达报错分支；移除 `apiKeyEnv`；更新 `evalCase` 返回类型以接收草稿 JSON。
- `apps/web/src/app.tsx`：移除 `createBrowserRouter` 分支，固定使用 `createHashRouter`。
- `apps/web/vite.config.ts`：移除 `/api` 代理配置，保留 `BASE`（默认 `/`）与 dev/preview 配置。
- `apps/web/package.json`：移除 `dev:local` / `build:static` 双轨脚本，固定 `dev` 与 `build` 为纯静态。
- `apps/web/src/features/menu/MainMenu.tsx`、`ModelSettings.tsx`、`SpoilerBadge.tsx`、`StatusParts.tsx`、`StoryScreen.tsx`：移除 `LOCAL_MODE` 及服务端/本机服务分支文案；`SpoilerBadge` 仅依据本地偏好 `spoilers` 控制（移除 `health.dev` 依赖）。

### 步骤 2：移除 Node HTTP 服务端，评测用例草稿改为浏览器下载
- 删除仅服务于 Node HTTP 后端的文件：`apps/server/src/main.ts`、`apps/server/src/storage.ts`、`apps/server/src/authoring.ts`、`apps/server/src/authoring-search.ts`、`apps/server/src/authoring-ports.ts`、`apps/server/src/authoring-errors.ts`、`apps/server/src/routes/authoring.ts`、`apps/server/src/lore-library.ts`。
- `apps/server/src/app.ts`：移除 `fromLocalPage` 回环检查、`dev` / `evalDrafts` / `authoring` / `authoringText` / `lore` 参数与路由；移除 `health` 中的 `dev` 字段（或与前端同步清理）。
- `apps/server/src/game.ts` & `apps/server/src/routes/saves.ts`：`evalDraft(id, seq)` 不再依赖磁盘目录，改为直接构建并返回 `{ id, fileName, draft }`；移除 `saveRoutes` 中的 `dev` 参数。
- `apps/web/src/features/settings/SettingsScreen.tsx`：`SaveAsCase` 改为调用 `api.evalCase` 后在浏览器下载 `${fileName}`，并更新提示文案（补上 `expect` 和 `rubric` 后放入 `tools/evals/`）。
- `apps/server/package.json`：移除 `@hono/node-server` 依赖与 `dev` / `start` 脚本，保留 `./browser`、`./llm` 与 `typecheck`。
- `apps/server/src/config.ts`、`providers/index.ts`、`providers/http.ts`：更新面向用户的提示文案，移除“点「创建本机配置」”等旧服务端用语（保留 `llm.ts` 与 `FileDocStore` 供 `tools/narrator-eval.ts` 使用）。
- `biome.json`：更新 `@cp/server` 边界约束注释。

### 步骤 3：根目录脚本、工具与文档收敛
- `package.json`（根目录）：新增 `dev`、`build`、`preview`、`deploy` 脚本指向 `@cp/web`。
- `tools/assets/check.ts`：移除 `process.env.VITE_CP_BACKEND === "local"` 条件，统一按静态公开部署规则检查（`demo` 档素材仅提醒）。
- `README.md`：更新为纯静态架构说明、开发/构建/Cloudflare Pages 部署及 CLI 测评工具说明。

### 步骤 4：静态检查、构建与 Cloudflare Pages 部署
- 依仓库约定不主动运行单元测试/集成测试，仅执行静态检查与构建：`pnpm typecheck`、`pnpm lint`、`pnpm check-data`、`pnpm build`。
- 执行 `wrangler pages deploy apps/web/dist --project-name cyberpunk` 部署至 Cloudflare Pages（`https://cyberpunk-am6.pages.dev`）。
- 同步更新本计划文件状态为已完成并提交 Git 记录。
