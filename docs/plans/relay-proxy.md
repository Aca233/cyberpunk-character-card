# 服务端转发（CORS 中转）计划

状态：已实施（待线上实测）

## 背景

原架构是纯静态前端，模型请求由浏览器直连。部分上游（`ollama.com`、`casino.soliumbra.com` 中转站等）不返回 CORS 头，浏览器直连会 `Failed to fetch`，静态前端自身无法绕过。用户决定放弃“无后端”约定，增加一个最小的转发层。

## 方案

- 新增 Cloudflare Pages Function：`functions/api/proxy.ts`（仓库根目录，`pnpm deploy` 在根目录运行，wrangler 会从 `./functions` 读取）。
- 请求格式：`POST|GET|... /api/proxy`，目标地址放在请求头 `x-relay-target`，其余请求头（含 `authorization`）原样转发，请求体和响应体流式透传。
- 安全限制：
  - 只接受同源页面发起的请求（`Origin` 与站点一致，或 `sec-fetch-site: same-origin`），别人不能把它当公共代理。
  - 只允许 `http/https` 公网目标；拒绝 localhost、内网/回环/链路本地 IP、`.local`/`.internal`、本站自身。
  - 不转发 `cookie`、`origin`、`referer`、`cf-*`、`x-forwarded-*`；响应丢弃 `set-cookie`。
  - 函数不保存、不记录密钥或请求内容。
- 前端接入：`packages/runtime/src/providers/relay.ts` 提供 `relayFetch`，先直连；直连因网络/CORS 失败时自动改走转发，并记住该域名，之后优先转发。停止信号（Abort）不触发转发。
- 本地开发：`apps/web/vite.config.ts` 增加同样的 `/api/proxy` 中间件（复用同一份处理函数），保证 `pnpm dev` 行为一致。
- 本机地址（`127.0.0.1`、`localhost`）不会被转发，仍然浏览器直连（需要 `OLLAMA_ORIGINS`）。

## 约定变更

- `AGENTS.md`：架构边界由“无独立后端服务进程”改为“唯一服务端代码是 `functions/api/proxy.ts` 的无状态转发”。
- `README.md`：补充转发说明与部署要点。

## 步骤

- [x] 写 `functions/api/proxy.ts`
- [x] 写 `relay.ts` 并替换 runtime 里的 `fetch`
- [x] vite 开发中间件
- [x] 更新 AGENTS.md、README.md
- [x] `pnpm check`，部署后实测 `casino.soliumbra.com`
