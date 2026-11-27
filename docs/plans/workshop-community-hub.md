# 创意工坊社区广场实施计划（方案一：Cloudflare Pages Functions + D1）

- **状态**：已完成（2026-11-26）
- **目标**：重新启用本地创意工坊，并基于当前 Cloudflare Pages 架构新增**社区创意工坊广场**，支持玩家在网页内直接浏览、搜索、筛选、一键下载安装他人上传的 v2 内容包，以及一键上传发布、凭管理密钥更新/下架自己的内容包。

## 架构选型

- **存储层选用 Cloudflare D1 单库方案（零信用卡要求、免费额度 5GB / 500 万读/日 / 10 万写/日）**：
  - 内容包单包体积上限 `512 KB`（远低于 D1 单行 2 MB 限制），将元数据、搜索索引、下载计数、哈希化管理密钥与已校验的 JSON 本体统一存入 `workshop_packs` 表，天然具备事务一致性，无需额外开通 R2 计费或维护双端孤儿文件。
- **零第三方依赖的服务端函数**：
  - `functions/api/community-workshop/core.ts` 使用纯 Web 标准 API（`Request`/`Response`/`crypto.subtle`）实现严格结构校验、同源校验、管理密钥 SHA-256 校验与限流；
  - `functions/api/community-workshop/[[path]].ts` 挂载到 Cloudflare Pages Functions 并绑定 `env.WORKSHOP_DB`；
  - `apps/web/vite.config.ts` 复用同一份 `handleCommunityWorkshop()` 处理函数与本地 `.run/community-workshop.json` 存储，使 `pnpm dev` / 本地预览完整可用。
- **鉴权与安全**：
  - 无需注册账号：首次上传成功时由服务端生成一次性 `editToken`，库内只存 SHA-256 哈希；前端自动把密钥缓存在本机 `localStorage` 并提示作者复制备份，后续更新或下架通过 `x-workshop-token` 校验。
  - 可选环境变量 `WORKSHOP_ADMIN_TOKEN` 供站长执行违规包下架。
  - 所有内容包为纯数据 JSON，服务端做结构/体积/键白名单/限流校验，客户端安装前再走完整 `WorkshopPackSchema` + `workshopPackIssues` 目录引用校验。

## 实施清单

1. **Core 协议与本地打包补齐**
   - [packages/core/src/schemas/workshop.ts](file:///c:/cyberpunk-character-card/packages/core/src/schemas/workshop.ts)：为 `namespaceWorkshopPack` 补上 `cyberware.variantGroup` 命名空间；新增 `WORKSHOP_PACK_MAX_BYTES`、`workshopPackSummary()` 及社区工坊 API 响应 schema。
   - [apps/web/src/features/characters/creator.ts](file:///c:/cyberpunk-character-card/apps/web/src/features/characters/creator.ts)：`exportLocalWorkshopPack` 补全 v2 数据驱动义体字段透传。
2. **服务端接口、D1 迁移与本地开发中间件**
   - [migrations/0001_workshop_hub.sql](file:///c:/cyberpunk-character-card/migrations/0001_workshop_hub.sql) 与 [wrangler.toml](file:///c:/cyberpunk-character-card/wrangler.toml)：声明 D1 表结构（`workshop_packs`、`workshop_rate_limits`）与 Pages 绑定说明。
   - [functions/api/community-workshop/core.ts](file:///c:/cyberpunk-character-card/functions/api/community-workshop/core.ts)、[d1.ts](file:///c:/cyberpunk-character-card/functions/api/community-workshop/d1.ts)、[[[path]].ts](file:///c:/cyberpunk-character-card/functions/api/community-workshop/%5B%5Bpath%5D%5D.ts)：实现 `GET /packs`、`GET /packs/:id`、`POST /packs`、`PUT /packs/:id`、`DELETE /packs/:id`。
   - [apps/web/vite.config.ts](file:///c:/cyberpunk-character-card/apps/web/vite.config.ts)：挂载 `/api/community-workshop` 开发中间件（持久化至 `.run/community-workshop.json`）。
3. **重新启用本地创意工坊入口**
   - [packages/runtime/src/browser.ts](file:///c:/cyberpunk-character-card/packages/runtime/src/browser.ts)：恢复 `workshop: new WorkshopStore(docs)`。
   - [apps/web/src/app.tsx](file:///c:/cyberpunk-character-card/apps/web/src/app.tsx)：恢复 `/workshop` 路由指向 `WorkshopScreen`。
   - [apps/web/src/features/menu/MainMenu.tsx](file:///c:/cyberpunk-character-card/apps/web/src/features/menu/MainMenu.tsx)：解除「创意工坊」按钮禁用并提供已安装包计数与一键进入面板。
4. **前端社区广场与上传/下载交互**
   - [apps/web/src/api/communityWorkshop.ts](file:///c:/cyberpunk-character-card/apps/web/src/api/communityWorkshop.ts)：封装同源 `/api/community-workshop/*` 请求与本机管理密钥持久化。
   - [apps/web/src/features/workshop/WorkshopScreen.tsx](file:///c:/cyberpunk-character-card/apps/web/src/features/workshop/WorkshopScreen.tsx) 与 [workshop.module.css](file:///c:/cyberpunk-character-card/apps/web/src/features/workshop/workshop.module.css)：
     - 新增「社区广场」主视图（搜索、按条目类型筛选、按热门/最新/最近更新排序、查看详情条目、一键下载并安装/更新到本地）；
     - 为本地内容包新增「上传到社区 / 更新云端版本」流程、一次性管理密钥保存与复制弹窗、手动输入管理密钥下架/更新支持。

- **验收与上线配置说明**
  - 已补充**内容包封面图（16:9 自动压缩 WebP ≤ 180 KB）**：新增 `workshop_covers` D1 表、`GET/PUT/DELETE /api/community-workshop/packs/:id/cover` 二进制接口（魔数严格校验 WebP/PNG/JPEG 拒绝 SVG、`X-Content-Type-Options: nosniff`、`immutable` 强缓存、下架内容包时级联删除封面）、发布弹窗自动压缩预览与社区广场 16:9 封面缩略图展示。
  - 通过 Biome、全部 5 个包 + `tsconfig.node.json` 类型检查、`check-data` 及社区接口端到端冒烟验证。
  - 附带 Cloudflare Pages 绑定 D1 的极简操作步骤（创建 D1 库、执行迁移 SQL、在 Pages 后台绑定 `WORKSHOP_DB`）。


## 收口补充（2026-11-26）

- [x] **封面图上传支持**：后端 `workshop_covers` 表 + `GET/PUT/DELETE /api/community-workshop/packs/:id/cover`，前端 `<canvas>` 自动裁切压缩为 16:9 WebP（≤ 180 KB）。
- [x] **外壳动态主题适配**：`/workshop` 纳入 `isShellThemedPath`，挂载 `<ShellBackdrop variant="workshop" />`，全页面板令牌化，支持 4 套外壳主题与主题 BGM。
- [x] **零 JSON 可视化创作台**：新增 `WorkshopPackBuilder.tsx`，支持可视化表单直接新建义体、武器/物品、出身/特质/过往/缺陷、原创 NPC、创角人脉与超梦/芯片，支持一键上架诊所/商店、一键合并角色工作台自创内容、填入示例内容，以及「保存并上传社区」一步到位。
