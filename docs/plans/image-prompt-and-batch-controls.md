# 文生图提示词自定义、中英文控制与单轮正文多图计划

状态：已完成（2026-11-23）

## 问题与目标

针对用户反馈的三个痛点与澄清（「不是生成候选图，是一个正文里多个图片」）进行改造：
1. **生成的 Prompt 不太智能 & 入口不够直接**：原本辅助模型提炼的系统提示词（System Prompt）在代码中硬编码，玩家只能附加一句短指令。现将**辅助模型提炼主提示词（System Prompt）**与**通用自定义提示词（固定前缀 / 画质词 / 画师串）**在设置页与生图弹窗内直接开放给玩家填写、粘贴或替换。
2. **生成的 Prompt 中英混合 & 本地生图不友好**：原本本地拼接（`fallbackImagePrompt`）硬塞大量英文元指令与英文标签包裹中文设定，导致中英混杂；且缺少语言指定与通用自定义提示词。现新增：
   - **提示词语言与格式（`promptLanguage`）**：支持 `纯英文自然语言 (en)`、`纯英文 Tag 标签 (en-tags，适配 NovelAI V5 / SD)`、`纯中文描述 (zh)` 三档切换（设置页与生图弹窗内均可直接切换）。
   - **通用自定义提示词（`customPrompt`）**：支持配置固定前缀/画质词/画师串/LoRA 触发词（如 `masterpiece, best quality, very aesthetic`），本地拼接与辅助模型提炼均自动拼入。
   - **纯净本地拼接**：移除本地拼接中的冗长英文说教元指令；选纯中文时全程使用中文标签与中文默认画风，彻底消除中英混杂。
3. **一个正文里多个图片（单轮正文多插图控制与段落穿插）**：
   - 支持在**同一轮剧情正文内生成并穿插展示多张场景插图（1 ~ 4 张）**，按正文段落顺序将多张插图自然穿插在叙事段落之间，而非只堆在末尾。
   - 在设置页与回合生图弹窗中提供**单轮正文插图数量（1 ~ 4 张）**控制：当数量 > 1 时，自动将该轮剧情正文按段落切分为对应数量的连续分镜片段，每个分镜独立提炼/编辑提示词并生成插图，完成后按段落位置穿插进正文。
   - 支持对单轮正文中的每张插图单独点击放大、单独**重绘**、单独**移除**，以及在已有插图的回合底部点击**「＋ 追加插图」**继续往正文中增加插图。

## 实施步骤

1. **步骤 1**：升级 `packages/core/src/narrator/imagePrompt.ts`
   - 新增 `ImagePromptLanguageSchema`（`"en" | "en-tags" | "zh"`）、`DEFAULT_PORTRAIT_STYLE_ZH`、`DEFAULT_SCENE_STYLE_ZH`、`DEFAULT_AUX_SYSTEM_PROMPT`。
   - 新增 `splitTurnSceneSegments(sceneText, count)` 与 `buildTurnSegmentPromptInput(input, segmentIndex, totalSegments)`，将单轮正文按段落/句子切分为 `1~4` 个连续叙事分镜。
   - 重构 `fallbackImagePrompt` 与 `buildAuxMessages`：消除本地拼接的中英混杂与冗长元指令，严格遵循所选语言（纯英文 / 英文 Tag / 纯中文）并自动合入 `customPrompt`。
2. **步骤 2**：升级 `packages/runtime/src/images.ts`、`packages/runtime/src/routes/images.ts` 与 `apps/web/src/api/client.ts`
   - `SaveImageBindingsSchema` 新增 `turnLists: Record<string, string[]>`（同时保持 `turns[seq]` 同步指向首图以兼容现有读取）。
   - `BindTarget` 与 `UnbindTarget` 支持回合多图槽位（`slot?: number`、`append?: boolean`、`replaceAll?: boolean`、`imageId?: string`），支持按分镜槽位绑定、追加新插图、重绘指定插图与移除单张插图。
3. **步骤 3**：升级 `apps/web/src/features/settings/prefs.ts` 与 `NarrativeSettings.tsx`
   - 新增 `imagePromptLanguage`、`imageCustomPrompt`、`imageAuxSystemPrompt` 与 `imageBatchCount`（单轮正文插图数量 1~4 张）配置及设置界面控件。
4. **步骤 4**：升级 `apps/web/src/features/story/StoryLog.tsx`、`StoryScreen.tsx`、`apps/web/src/features/images/ImageGenModal.tsx`、`image-jobs.ts`、`image-drafts.ts`
   - `TurnBlock` 支持读取该轮的多张插图列表，按段落比例穿插渲染在正文段落之间，每张图独立支持重绘/移除，回合底部支持「＋ 追加插图」。
   - `StoryScreen` 回合自动配图支持按 `imageBatchCount`（1~4 张）分镜生成多张正文插图。
   - `ImageGenModal` 直接开放语言切换、通用自定义提示词、提炼主提示词入口，并在回合生图时支持 1~4 张分镜切换、分镜提示词独立编辑/一键提炼与连续生成穿插。
5. **步骤 5**：执行 `tsc`、`biome check`、`check-data` 静态检查并提交。
