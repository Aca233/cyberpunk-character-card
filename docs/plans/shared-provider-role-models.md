# 单连接多角色独立模型分配（免重复建连接）实施计划

## 痛点

同一家中转站（同一个 `baseUrl` + 同一个 `apiKey`）如果想给叙事、辅助、文生图、向量检索、语义重排分别指定不同模型，当前必须反复「复制连接 → 起不同的纯英文连接名 → 改模型名 → 保存 → 再分配角色」，维护密钥和切换模型极其繁琐。

## 方案设计

在保持 `config.json` 完全向后兼容的前提下，引入角色级模型覆写 `roleModels`，让**同一个连接（中转站/服务商）可以直接同时承担多个角色、且每个角色独立指定不同模型 ID**：
- [x] **阶段一：运行时配置与路由器支持 `roleModels`（`packages/runtime`）**
  - `packages/runtime/src/config.ts`：
    - `ConfigSchema` 新增可选 `roleModels?: { narrator?, aux?, image?, embedding?, reranker? }`；
    - `RolesSchema` 与 `setRoles()` 支持按角色更新或清空（`null`）对应模型 ID；切换连接或停用角色时自动清理过期的旧角色模型覆写；
    - `overview()` 返回 `roleModels`；
    - 顺手放开 `ProfilePatchSchema` 允许传 `null` 清空 `temperature` / `maxOutputTokens`，告别「不支持通过留空删除温度」报错。
  - `packages/runtime/src/providers/index.ts`、`packages/runtime/src/providers/image.ts`、`packages/runtime/src/routes/profiles.ts` & `packages/runtime/src/app.ts`：
    - `LlmRouter.resolve("narrator" | "aux")`、`resolveEmbeddingTarget()`、`resolveRerankerTarget()` 与 `ImageRouter.resolve()` 优先采用 `config.roleModels[role]`，未设置时回退到连接默认 `model`；
    - 连接测试与诊断报告 `/api/diagnostics` 同步体现 `roleModels`。
- [x] **阶段二：设置页交互减负（`apps/web/src/features/settings/ModelSettings.tsx` & `model-settings.module.css`）**
  - `apps/web/src/api/client.ts`：同步扩展 `ProfilesOverview`、`setRoles`、`ProfilePatch` 类型。
  - 顶部 5 个角色槽位（叙事 / 辅助 / 文生图 / 向量 / 重排）升级为**可直接在槽位内切换连接与独立选模型**的交互卡片：
    - 下拉直接选已有连接（可选槽位支持「未启用」）；
    - 直接填写或点「换模型」从该连接已拉取的模型列表里搜索点选（同一连接的模型列表自动在页面内缓存复用，拉取一次即可给 5 个槽位分别挑不同模型，零重复请求、零复制连接、零起英文名，并为向量/重排/文生图提供一键筛选标签）。
  - 表单顺手将 NovelAI 预设默认模型改为通用的 `nai-diffusion-4-5-full`，并支持留空清除温度/最大输出限制。
- [x] **阶段三：静态检查与验证**
  - 已全部通过：`biome lint .`（698 文件 0 报错）、5 包 `tsc --noEmit`、`tsx tools/check-data.ts` 与 CSS Module 覆盖检查（107/107 类）。
