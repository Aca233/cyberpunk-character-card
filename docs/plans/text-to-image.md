# 文生图功能实施计划（Text-to-Image）

状态：已完成（2026-11-18）

## 目标与确认需求

为纯静态前端《赛博朋克 2077 角色卡》实现完整的**文生图**能力，覆盖以下三个已确认的应用场景、四类模型协议及提示词策略：

1. **应用场景**：
   - **角色立绘/头像**：建卡工作台（Step 01 身份铭牌、右侧实时档案摘要、Step 05 总览）、角色库卡片与局内人物档案面板展示与生成角色肖像。
   - **未预设头像的 NPC 肖像**：人物档案浮层/详情页支持为已照面（尤其是无原作预设立绘）的 NPC 生成肖像，并同步在在场列表、全息来电与手机联系人头像中展示。
   - **剧情回合插图**：剧情记录支持为任意已完成回合手动点击「生成插图」，并支持在「叙事偏好」中开启「回合自动配图」在每轮叙事结束后自动生成场景插画。
2. **生图协议（均支持浏览器直连 CORS）**：
   - **OpenAI 兼容文生图接口**：`POST /v1/images/generations`（兼容 OpenAI `dall-e-3` / `gpt-image-1` 及各类中转站）。
   - **OpenAI Chat / Responses 模态生图**：`POST /v1/chat/completions`（兼容通过对话接口返回 Markdown 图片链接、Data URL 或 `images` 字段的中转/多模态生图模型）。
   - **Gemini 原生生图 & Imagen**：`POST /models/{model}:generateContent`（`responseModalities: ["TEXT", "IMAGE"]`）与 `POST /models/{model}:predict`（Imagen 系列）。
   - **本地 Stable Diffusion WebUI / ComfyUI**：SD WebUI `POST /sdapi/v1/txt2img` 与 ComfyUI `POST /prompt` + 轮询 `/history/{id}` + `/view`（支持自定义工作流模板 JSON 与默认文生图工作流）。
3. **提示词生成与设置自定义**：
   - 由**辅助模型（`aux`）**自动提炼英文赛博朋克生图提示词（同时提供无 `aux` 时的确定性本地拼接兜底），在文生图弹窗中支持用户**手动编辑、补充风格要求或直接输入**后再发起生成。
   - 玩家可在**设置 → 叙事偏好**中自定义并保存**肖像画风提示词**、**场景插图画风提示词**、**默认反向提示词**及**辅助模型提炼指令**（支持一键恢复默认），对手动与自动生图均生效。

---

## 架构设计

### 1. 配置与模型路由（`apps/server`）
- `apps/server/src/config.ts`：
  - `ProviderTypeSchema` 扩展为 `["gemini", "anthropic", "openai", "ollama", "sdwebui", "comfyui"]`。
  - `tunables` 增加 `imageProtocol`（`"auto" | "openai-images" | "openai-chat" | "gemini-native" | "gemini-imagen" | "sdwebui" | "comfyui"`）与可选 `comfyWorkflow`（自定义 ComfyUI API 工作流 JSON 模板）。
  - `ConfigSchema` / `RolesSchema` 增加 `image` 角色（与 `narrator`、`aux` 并列），`removeProfile` 同步校验 `image` 占用；`publicProfile` 对 `ollama` / `sdwebui` / `comfyui` 标记 `keyStatus: "notNeeded"`。
- `apps/server/src/providers/models.ts`：
  - 支持拉取 `sdwebui`（`/sdapi/v1/sd-models`）与 `comfyui`（`/object_info/CheckpointLoaderSimple`）本地模型列表，并在 Gemini 模型列表中保留支持 `generateContent` 或 `predict` 的生图模型。
- `apps/server/src/providers/image.ts` & `apps/server/src/providers/index.ts`：
  - 实现 `ImageRouter` 与统一 `generateImage(profile, apiKey, request, signal)`，涵盖四大协议与 `auto` 智能路由、远程图片 URL 自动转存为本地 `dataUrl`（CORS 受限时降级保留原 URL）、安全拦截与中文错误提示。
- `apps/server/src/routes/profiles.ts`：
  - 连接测试 `POST /:name/test` 兼容 `sdwebui` / `comfyui` 及图像模型校验。

### 2. 图片存储与存档绑定（`apps/server` & `packages/core`）
- **IndexedDB 存储分离**：大体积图片数据不写入回合日志（`LOG`）或快照（`SNAPSHOTS`），统一存入 `DocStore`：
  - `images/items/<imageId>.json`：存 `{ id, dataUrl, mimeType, prompt, negativePrompt?, revisedPrompt?, width?, height?, createdAt }`。
  - `images/bindings/<saveId>.json`：存 `{ turns: Record<string, string>, npcs: Record<string, string> }`（按回合 `seq` 与 `npcId` 绑定图片 ID）。
- **`packages/core` 类型扩展**：
  - `CharacterCardSchema` 增加可选 `portrait?: string`（`ImageStore` ID）。
  - `SetCharacterSchema` / `CharacterStateSchema` / `SaveCharacterSchema` 增加可选 `portrait?: string`，建档时将角色立绘带入存档并在 `PlayerView.character.portrait` 中投影。
  - `packages/core/src/narrator/imagePrompt.ts`：提供角色肖像、NPC 肖像、回合场景插图三类英文提示词辅助模型提炼函数及无模型兜底构造器。
- **服务端路由（`apps/server/src/routes/images.ts` & `apps/server/src/images.ts`）**：
  - `POST /api/images/prompt`：提炼角色 / NPC / 回合场景英文提示词。
  - `POST /api/images/generate`：调用 `ImageRouter` 生图、写入 `ImageStore`，并支持直接绑定到存档回合或 NPC。
  - `GET /api/images/:id` / `DELETE /api/images/:id`：读取与删除单张生成图片。
  - `GET /api/saves/:id/images` / `PUT /api/saves/:id/images` / `DELETE /api/saves/:id/images`：读取、绑定或解绑存档内的回合插图与 NPC 肖像。

### 3. 前端界面集成（`apps/web`）
- **设置页**：
  - `ModelSettings.tsx`：新增 `SD WebUI 本地` 与 `ComfyUI 本地` 接入预设、连接角色 `文生图模型`（`设为文生图模型`）、高级参数中的 `生图协议` 与 `ComfyUI 工作流模板`。
  - `prefs.ts` & `NarrativeSettings.tsx`：新增 `autoTurnImage`（回合自动配图）与 `autoImageUseAux`（使用辅助模型提炼生图提示词）开关。
- **通用文生图组件**：
  - `apps/web/src/components/GeneratedImage.tsx`（或 `apps/web/src/features/images/GeneratedImage.tsx`）：通过 `api.getImage(id)` + React Query 缓存展示 IndexedDB 中的图片，支持点击放大灯箱预览。
  - `apps/web/src/features/images/ImageGenModal.tsx`：通用文生图弹窗（自动调用提示词提炼、手动编辑 Prompt / Negative Prompt / 补充要求 / 画幅比例、生成中可取消、结果预览与确认应用/重新生成）。
- **角色创建与角色库**：
  - `CharacterCreator.tsx`：在 Step 01、右侧栏 Hero 与 Step 05 展示角色肖像位，提供「生成立绘 / 重绘 / 清除」；`CharactersScreen.tsx` 角色库列表显示角色缩略头像；`NeuralPages.tsx`（`CharacterPage`）展示主角立绘。
- **NPC 肖像**：
  - `SaveImagesProvider` / `useSaveImages(saveId)` 供 `StoryScreen` 内组件读取与更新 `turns` / `npcs` 图片绑定。
  - `Profile.tsx`（`NpcPortrait` & `ProfileHead`）、`Phone.tsx`（`Avatar`）优先渲染自定义生成的 NPC 肖像；`ProfileHead` 提供「AI 生成肖像 / 重绘 / 恢复默认」入口。
- **剧情回合插图**：
  - `StoryLog.tsx`（`TurnBlock`）：支持展示回合场景插图、点击放大查看、「生成插图 / 重绘插图 / 移除」按钮。
  - `StoryScreen.tsx`：当开启 `autoTurnImage` 且已配置 `image` 模型时，在回合完成落库后后台异步提炼提示词并生成本轮场景插图（不阻塞玩家输入，支持取消）。

---

## 实施步骤

1. **步骤 1：扩展 `packages/core`（角色卡/人物状态肖像字段 + 三类生图提示词提炼器）** — 已完成
2. **步骤 2：扩展 `apps/server` 配置、四大生图协议提供方、模型列表与图片存储/接口** — 已完成
3. **步骤 3：前端 API 客户端、模型连接设置（`image` 角色与协议）及叙事偏好开关** — 已完成
4. **步骤 4：前端通用图片组件与文生图弹窗 + 角色工作台/角色库/局内主角立绘接入** — 已完成
5. **步骤 5：剧情界面 NPC 肖像与回合手动/自动场景插图接入 + 静态检查与构建验证** — 已完成
