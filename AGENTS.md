# 开发约定

## 架构边界

- 本仓库为前端静态应用，部署产物为 `apps/web`；无独立后端服务进程。服务端代码仅包含 Cloudflare Pages Functions：`functions/api/proxy.ts`（无状态 CORS 转发，只处理同源请求、只放行公网 http(s) 目标、不保存或记录密钥与请求内容）与 `functions/api/community-workshop/*`（社区创意工坊纯数据 JSON 内容包的浏览、上传、更新与下载，由 Cloudflare D1 持久化）；`pnpm dev` 由 `apps/web/vite.config.ts` 复用同一份处理函数。
- `packages/core` 与 `packages/content` 保持纯逻辑，不依赖 React、Hono 或 `node:*` 模块。
- `packages/runtime` 封装浏览器端内存虚拟路由（Hono `app.fetch`）、IndexedDB 事务存储与多模型直连适配；`apps/web` 仅通过 `apps/web/src/api/transport.ts` 导入 `@cp/runtime/browser`。
- 跨包与跨系统边界由 `biome.json` 中的 `noRestrictedImports` 与 `noNodejsModules` 强制校验。

## 静态检查与验收

- 代码修改完成后必须通过静态检查与数据校验：`pnpm typecheck`、`pnpm lint`、`pnpm check-data`（等价于 `pnpm check`）。
- 仓库不维护自动化单元测试，不新增 `*.test.ts` 或测试框架依赖；功能与交互验收由人工实际运行应用确认。

## 数据结构与存档

- 当前处于快速开发阶段，数据结构、存档 schema、角色卡结构与内部接口以当前最新设计为准，不保留过期的多版本兼容层。
- 每次调整结构都必须保证当前版本的保存、读档、JSON 导出/导入重放与失败恢复可靠；遇到旧格式或损坏数据时给出明确错误提示，不静默丢弃。

## 提示词工程

- 正文质量优先于调用次数和 token 节省；人物口吻、关系与知情边界、世界因果与长线记忆不可为省 token 随意裁剪。
- 启用用户写作预设时，文风、篇幅、节奏、修辞与描写技法交给预设控制，内置层不叠加冲突的文风指示；内置层负责世界事实、玩家控制权、人物身份边界、已定结算结果与输出协议。
- 提示词优化默认不改动现有界面布局与交互面板，除非任务明确要求。

## 上游模型异常与安全拦截

- 各模型 provider（OpenAI / Anthropic / Gemini）在遇到上游 `refusal`、`content_filter`、安全拦截或空回复时，统一映射为 `blocked` 或明确错误事件，不得静默当作成功，也不自动重试。

## Git 提交

- 按功能或修复主题做清晰的原子提交，避免刷无意义的文档状态 commit。
- 改动前先核对 `git status`，不覆盖工作区已有未提交变更。
