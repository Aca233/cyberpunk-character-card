# 抽取与结算正确率提升方案

- **状态**：已完成（2026-11-27）
- **背景**：基于当前 `① 判断 → ③ 正文 → ④ 抽取 + 规则结算` 管线核查，定位了影响记账正确率、事件成功率与场景记忆留存率的 6 个核心瓶颈。
- **兼容性注记**：经核查 `packages/runtime/src/providers/gemini.ts`，Gemini 原生 `responseSchema` 会过滤未在 `properties` 显式声明的动态键；因 `events[].changes` 承载 60+ 异构指令，`extract` 继续使用 JSON mode（`responseJsonSchema("extract")`）以防 Gemini 截断指令字段，改为由内嵌事件结构 + `events` 定向自修 + 规则前 ID 自修在全模型商侧兜底。

## 一、低改高收益（不改数据结构、零破坏）

1. **降低结构化阶段采样温度**（`prompts/extract.ts` / `prompts/judge.ts`）：
   - `EXTRACT_TEMPERATURE` 从 `0.2` 降至 `0`（纯客观记账不需要随机性，直接减少幻觉 ID、自造事件 slug 与字段飘移）；
   - `JUDGE_TEMPERATURE` 从 `0.3` 降至 `0.15`（提升物理/社会裁决与旧记忆召回的稳定性）。
2. **`sceneMemory` 证据核验做标点/空白归一化 + 逐条容错**（`narrator/scene-memory.ts`）：
   - 当前 `source.includes(entry.evidence.quote)` 严格逐字匹配，模型把 `「」` 写成 `“”`、把 `——` 写成 `—` 或增减空格就会失败；且**只要 1 条锚点失败，整份 `sceneMemory`（含提要和其他合法锚点）整包丢弃**；
   - 改为核验时对引号/破折号/空白做无损归一化，并改为逐条跳过不合法锚点（保留合法提要与合法锚点），大幅提高记忆留存率。
3. **唯一精确名称自动归一化（确定性兜底，不猜模糊匹配）**（`systems/registry.ts` / `systems/npc/schema.ts` 等）：
   - 当模型把在场/已有 NPC 的中文名或外号（如 `"罗伊斯"`、`"维克多"`）或目录中物品/地点/势力的精确名称误填进 `id` 字段时，若在当前世界/目录中**存在唯一精确命中**，在 `normalizeProposal` 自动映射为规范 `id` 并记入 `notes`（重名或模糊不猜，保证安全）。
4. **规则前 ID 预检 + 语义定向自修（复用 1 次 RepairBudget，零常态开销）**（`narrator/turn.ts`）：
   - 目前 `validateBatch` 只修 Zod 格式错，不修 `events` 因果清单错和规则级 ID 错误（例如把 `learn`/`memory` 的 `id` 错填成事件 slug `royce-shipment-order`），导致直接报错或级联连坐；
   - 补两处精准自修：
     - `readEventPlan` 失败时，把 `changes`/`messages` 摘要 + `events` + 精确报错送 1 次定向修复，不再直接抛 `NarratorStageError` 中断记账；
     - `applyEventCommands` 前做轻量规则预检（核对 NPC / 地点 / 物品 / 义体 `id` 是否存在），若仅因错填 `id` 失败，把报错条目与当前在场/相关合法 `id` 候选清单打包送 1 次定向修复再落盘。
5. **`$scene-end` 与非关键旁枝事件解耦**（`narrator/turn.ts`）：
   - 当前 `$scene-end` 写死 `requires: events.map((e) => e.id)`，导致哪怕只是一条支线 `learn`/`memory` 填错 id，也会连坐拦掉 `$scene-end`、场景摘要和场外推演；
   - 改为 `$scene-end` 仅强依赖涉及状态推进/移动/交易/主行动/战斗的核心事件，避免旁枝记忆条目报错卡死整场收尾。

## 二、结构级治本（显著降低模型出错概率）

6. **把 `events` 改为“内嵌指令组”结构，彻底消灭手数 `changes[i]` 下标**（`narrator/event-plan.ts` / `narrator/block.ts` / `prompts/extract.ts` / `narrator/turn.ts`）：
   - 现状：模型需先平铺写 `changes: [...]`，再在后面另建 `events` 数组手数 `"changes[0]"`, `"changes[1]"`……且必须严格单调递增；一旦单轮有 6–10 条指令，极易漏标、重标或乱序；
   - 改进：直接改为 `events: [{ id, requires, changes: [...], messages?: [...] }]`（每条指令天生归属所在事件，不可能漏归属、重复归属或下标错位），同时给 `extract` 的 `responseFormat` 传入顶层 `ExtractDocSchema` 让原生 Structured Outputs 在解码层硬约束顶层结构。

## 验收标准
- `biome lint packages apps tools functions` 0 错误 / 0 警告；
- 6 份 `tsc --noEmit` 与 `tsx tools/check-data.ts` 全绿；
- 实测典型错填案例（如错填事件 slug、错填中文名、引号差异导致 `evidence.quote` 失败、多事件下标错位）均能自动恢复或精准隔离，不连坐整场收尾。
