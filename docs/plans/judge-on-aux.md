# 判断阶段切换至辅助模型方案

日期：2026-11-18  
状态：已完成

## 背景与目标

用户主模型（`narrator`）按请求次数计费，`aux` 可挂载廉价或免费通道。  
当前单轮主链为 `① 判断（narrator）→ ③ 写正文（narrator）→ ④ 抽取（aux）`，每轮消耗 2 次 `narrator` 请求。

在不修改前端界面、不牺牲正文质量与酒馆预设隔离的前提下，将 `① 判断` 从 `narrator` 切换至 `aux`，使每轮常规行动对 `narrator` 的调用降至固定 **1 次**（仅 `③ 写正文`）。

## 实施内容

1. **判断阶段路由到 `aux`**（[turn.ts](file:///c:/cyberpunk-character-card/packages/core/src/narrator/turn.ts)）
   - `runNarratorTurn` 中 `① 判断` 请求的 `purpose` 由 `"narrator"` 改为 `"aux"`。
   - 该次调用的 token 用量从计入 `usage`（`narrator`）改为计入 `b.auxUsage`（`aux`）。
   - 更新 `NarratorTurn` 与流程注释，与实际归属一致。
2. **提示词与服务端阶段模型归属同步**
   - 更新 [judge.ts](file:///c:/cyberpunk-character-card/packages/core/src/narrator/prompts/judge.ts) 注释说明。
   - 更新 [game.ts](file:///c:/cyberpunk-character-card/apps/server/src/game.ts) 中 `stageModel` 的 `"judge"` 分支，返回 `auxModel` 而非 `narratorModel`。
3. **测试桩与测评脚本对齐**
   - 更新 [combat.test.ts](file:///c:/cyberpunk-character-card/packages/core/src/narrator/combat.test.ts) 中 `fakeLlm` 的分支顺序，优先按 `responseFormat?.name === "judge"` / `JUDGE_TEMPERATURE` 匹配，避免因 `purpose === "aux"` 误返回抽取结果。
   - 更新 [scripted.ts](file:///c:/cyberpunk-character-card/tools/narrator-eval/scripted.ts) 中 `scriptedNarrator`，按 `responseFormat?.name === "judge"` 返回 `judged`，保留单次 `narrator` 返回 `narrative`。

## 验收方式

按项目约定执行静态类型检查与代码规范检查（`tsc` / `biome`），功能测试交由用户自行验收。
