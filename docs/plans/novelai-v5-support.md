# NovelAI Diffusion V5 文生图接入计划

状态：已完成（2026-11-23）

## 目标

为文生图系统新增 **NovelAI Diffusion V5**（兼容 V4.5 / V4 / V3）提供方与协议支持，使玩家可在「设置 → 模型连接」中直接选择 NovelAI 官方或兼容中转接口，使用 Persistent API Token（`pst-...`）生成角色立绘、NPC 肖像与回合场景插图。

## 技术规格

1. **提供方类型与协议枚举**：
   - `ProviderTypeSchema` 新增 `"novelai"`；
   - `ImageProtocolSchema`、`ImageGenerationMetadataSchema` 新增 `"novelai"`；
   - `resolveImageProtocol(profile)`：当 `profile.type === "novelai"` 或模型名以 `nai-diffusion` 开头时自动识别为 `"novelai"`。
2. **NovelAI 接口与参数（V5 / V4.5 / V4 / V3）**：
   - 默认根地址：`https://image.novelai.net`（自动拼接 `/ai/generate-image`，兼容填写完整 `/ai/generate-image` 或 `/ai` 的地址）。
   - 认证方式：`Authorization: Bearer <API_Token>`（NovelAI 需要 API 密钥）。
   - 模型列表（`fetchProviderModels`）：内置返回 `nai-diffusion-5-full`（默认）、`nai-diffusion-5-curated`、`nai-diffusion-4-5-full`、`nai-diffusion-4-5-curated`、`nai-diffusion-4-full`、`nai-diffusion-4-curated-preview`、`nai-diffusion-3`。
   - 标准画幅尺寸（64 的整数倍，符合 Opus 单张免费像素上限 `<= 1,048,576`）：
     - `3:4` → `832x1216`
     - `4:3` → `1216x832`
     - `1:1` → `1024x1024`
     - `16:9` → `1280x704`
     - `9:16` → `704x1280`
   - V4 / V4.5 / V5 请求体：
     - `params_version`：`nai-diffusion-5*` 使用 `4`，`nai-diffusion-4*` 使用 `3`；
     - 同时构造 `v4_prompt` 与 `v4_negative_prompt`（含 `caption.base_caption`、`char_captions: []`、`use_coords: false`、`use_order: true`），以及 `negative_prompt`、`steps`（默认 28）、`scale`（默认 5.5）、`sampler: "k_euler_ancestral"`、`noise_schedule: "karras"`、`seed`。
3. **ZIP 响应流纯前端解压**：
   - NovelAI `/ai/generate-image` 返回二进制 ZIP（`application/x-zip-compressed` 或 `application/octet-stream`）；
   - 使用纯 Web API 解析 ZIP Central Directory / Local File Header，支持 STORED（`method = 0`）与 DEFLATE（`method = 8`，通过 `DecompressionStream("deflate-raw")` 解压）提取出 PNG/WebP 字节，再交由 `validateImageDataUrl` 完成校验与尺寸解析；若代理直接返回 PNG/JPEG/WebP 原始字节亦自动兼容。
4. **前端设置页与连接测试**：
   - `ModelSettings.tsx` 新增 `NovelAI（文生图）` 接入卡片（默认模型 `nai-diffusion-5-full`，默认地址 `https://image.novelai.net`）及 `NovelAI (/ai/generate-image)` 协议项；
   - `SettingsScreen.tsx`、`LlmRouter` 标记 `novelai` 为仅用于文生图的提供方，避免误设为叙事/辅助模型；
   - `routes/profiles.ts` 的 `POST /:name/test` 对 `novelai` 走生图连通测试。

## 实施步骤

1. **步骤 1**：更新 `packages/runtime`（`config.ts`、`images.ts`、`providers/index.ts`、`providers/models.ts`、`providers/image.ts`、`routes/profiles.ts`）接入 NovelAI V5 协议与 ZIP 解压 — 已完成
2. **步骤 2**：更新 `apps/web`（`api/client.ts`、`ModelSettings.tsx`、`SettingsScreen.tsx`）新增 NovelAI 预设与协议选择 — 已完成
3. **步骤 3**：执行 `pnpm typecheck`、`pnpm lint`、`pnpm check-data` 静态校验并更新计划状态 — 已完成
