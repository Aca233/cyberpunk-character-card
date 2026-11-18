# 回合阶段断点续跑与主角头像/立绘界面优化计划

状态：进行中（2026-11-18）

## 目标

1. **回合调用断点保存与续跑**：
   - 在一轮叙事的多个大模型调用阶段（① 判断 `judge` → ③ 正文 `narrate` → ④ 抽取 `extract` → ⑥ 场外推演 / ⑦ 场景摘要 / ⑤ 落盘）之间持久化保存已完成阶段的中间结果。
   - 当后续阶段报错（网络中断、上游 502/429、超时、安全过滤或抽取 JSON 解析失败等）或触发大额花费确认时，不丢失已完成的调用结果；重试或刷新页面后可直接从断点继续，无需从第 ① 步重头再来。
2. **修复局内人物面板立绘区域突兀感 & 放大展开后头像**：
   - 移除 `CharacterPage` 顶部与 `BiomonitorPanel` 风格割裂且重复展示角色名的 `.playerPortraitStrip`（青色竖条外框）。
   - 将主角立绘自然整合进 `BiomonitorPanel`（`KIROSHI OPTICS // BIOMONITOR`）左侧主视觉栏，采用与 `BiomonitorPanel` 一致的红色切角 `CellFrame` + `map.filterCell*` 框体，并将展开后的立绘放大至 `3:4` 大尺寸展示位（未生成立绘时显示 `portrait.unknown` 全息轮廓与待生成提示），点击可查看大图，下方紧跟紧凑的生成/重绘/恢复按钮。
3. **左上角生物监测常态显示主角头像**：
   - 在 `Corners.tsx` 的 `BioMonitor` 常态摘要（`.bioRow`）左侧展示切角头像格（优先显示已绑定/建档的主角立绘，未绑定时显示 `portrait.unknown` 全息轮廓），保留街头名声提示信息。

---

## 实施方案

### 步骤 1：核心层回合断点结构与阶段恢复（`packages/core`）
- 新增 `packages/core/src/narrator/checkpoint.ts` 并从 `packages/core/src/narrator/index.ts` 与 `packages/core/src/index.ts` 导出：
  - `TurnCheckpointStage`：`"prepared" | "narrated" | "extracted"`
  - `TurnCheckpoint` / `TurnCheckpointSummary` 类型与辅助方法 `checkpointSummaryOf`
  - `NarratorStageError`：区分在已保存断点后于 `narrate` / `extract` 失败的可重试错误
- 修改 `packages/core/src/narrator/turn.ts`：
  - `NarratorDeps` 增加可选 `checkpoint?: TurnCheckpoint`、`onCheckpoint?: (cp: TurnCheckpoint) => Promise<void> | void` 与 `inputKey?: string`。
  - 阶段 ①+②（判断 + 备料完成、构建好 `narrateMessages`）后立即触发 `onCheckpoint` 保存 `"prepared"` 断点（含 `confirmation` 报价信息，确认大额消费也无需重跑判断）。
  - 阶段 ③（正文完整生成）后立即触发 `onCheckpoint` 保存 `"narrated"` 断点。
  - 若 `narrate` 发生网络/上游异常（`narrativeError`），直接向上抛出错误以便保留 `"prepared"` 断点供重试（仅 `finishReason` 为 `length`/`MAX_TOKENS`/`tool_calls` 的截断保留草稿逻辑）。
  - 若 `extract` 失败（请求失败、安全拦截、JSON 无法修复、事件因果无法成立），抛出可重试的 `NarratorStageError`（或返回 `blocked`），保留 `"narrated"` 断点，不再强迫落盘死胡同草稿并重头生成。
  - 阶段 ④（抽取与规则结算完成后）触发 `onCheckpoint` 保存 `"extracted"` 断点，随后再执行 ⑥ 场外推演与 ⑦ 场景摘要。
  - 恢复执行时：按 `checkpoint.stage` 跳过已完成阶段（恢复 `b.auxUsage`、`b.repairs`、`b.notes`、`decided`、`narrateMessages`、已生成正文 `onText` 推送及已结算世界状态）。

### 步骤 2：服务端断点持久化、API 与清理（`apps/server`）
- 新增 `apps/server/src/checkpoints.ts`：基于 `DocStore` 实现 `TurnCheckpointStore`（存储路径 `turn-checkpoints/<saveId>.json`），与 `ImageStore` 保持同一读写锁与格式校验风格；若未注入 `DocStore` 时提供安全内存兜底。
- 在 `apps/server/src/app.ts` 与 `apps/server/src/browser.ts` 接入 `TurnCheckpointStore`。
- 修改 `apps/server/src/game.ts`：
  - `submit` 时比对 `checkpoint.baseVersion === version` 与归一化 `inputKey`（忽略 `spendOk`），命中则传入 `runNarratorTurn`，同时将 `approvedSpend` 与断点内 `confirmation.quoteKey` 兼容衔接。
  - `commit` 成功以及 `action` / `phoneChat` / `restart` / `regenerate` / `rewrite` 推进日志版本后清除对应存档的断点。
  - `state` 返回中若有有效断点（`baseVersion === version`），附带 `checkpoint` 摘要；新增 `clearCheckpoint(id)`。
  - 捕获 `NarratorStageError` 并推送可重试 `error` 事件，提示已保存的阶段信息。
- 修改 `apps/server/src/routes/saves.ts`：新增 `DELETE /:id/checkpoint` 接口。

### 步骤 3：前端断点续跑交互与错误提示（`apps/web`）
- 修改 `apps/web/src/api/client.ts` 与 `apps/web/src/features/story/view.ts`：扩展 `View` 可选 `checkpoint` 字段及 `api.clearCheckpoint(saveId)`。
- 修改 `apps/web/src/features/story/store.ts`：在提交失败或刷新后支持断点感知，重试时保持一致输入并透传。
- 修改 `apps/web/src/features/story/StoryScreen.tsx` 与 `StoryLog.tsx`：
  - 存在可恢复断点时，在输入框上方展示简洁恢复提示条（显示已完成步骤与输入摘要，提供「从断点继续」与「丢弃断点」按钮）；若已生成正文（`narrated` / `extracted`），在日志底部展示已保存的正文预览。
  - 错误弹窗/提示条在存在断点时明确告知已保存进度，提供「从断点重试」和「清除断点重头生成」。

### 步骤 4：左上角常态头像与展开后生物监测融合立绘（`apps/web`）
- 修改 `apps/web/src/features/story/Corners.tsx` 与 `corners.module.css`：
  - `BioMonitor` 常态 `.bioRow` 左侧改为切角头像框（`map.filterCellBg` + `map.filterCellFg` 红色框线，约 `48×58px`），优先渲染主角立绘 `GeneratedImage`，未绑定时渲染 `portrait.unknown` 全息轮廓，保留街头名声提示。
  - 适度拓宽 `.bio[data-diag]` 展开宽度（如 `min(680px, ...)`）以容纳左侧立绘+人体扫描双模块列与右侧三张遥测卡。
- 修改 `apps/web/src/features/story/BiomonitorPanel.tsx`、`biomonitor.module.css`、`NeuralPages.tsx`、`story.module.css`：
  - 移除 `NeuralPages.tsx` 中突兀的 `.playerPortraitStrip`（以及 `story.module.css` 中对应样式）。
  - 在 `BiomonitorPanel` 左侧列（`.leftCol`）顶部融入「SUBJECT // 宿主肖像」Kiroshi 框体卡片，提供 `3:4` 大尺寸立绘展示（约 `168×224px`），点击可灯箱查看大图，未生成时显示 `portrait.unknown` 全息轮廓与状态标牌；按钮紧凑放置在框底（「AI 生成立绘 / AI 重绘」与「恢复建档」），与下方 `VITAL-MAP` 共享同一套红色赛博监测语言。

### 步骤 5：静态类型与代码规范检查及 Git 提交
- 运行 `tsc` 与 `biome` 检查确保零类型和 lint 错误。
- 更新本计划文档状态，并执行 Git 提交。
