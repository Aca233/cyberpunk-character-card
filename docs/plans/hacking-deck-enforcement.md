# 无网络接入仓禁止破解的硬约束修复计划

> 状态：进行中（2026-11-21）

## 根因
1. `hackingStatus` 在未装完好网络接入仓时返回空数组，`【当前状态】` 完全未声明“无接入仓”，LLM 容易把默认自带的岐路司义眼当成可放快速破解的硬件。
2. `HACK_MENTION` 关键词过窄，未覆盖 12 种快速破解名称与常见破解口语，漏匹配时 `hackingRules` 与 `evaluateHackTopology` 全链路不激活。
3. `evaluatePhysicsBoundaries` 的 `hasCyberdeck: false` 硬阻断只拼进提示词文本，`turn.ts` 未强制锁定 `ruling = blocked`，模型忽略即可写出“破解成功”。

## 实施步骤
- [ ] **状态显式声明**：
  - `packages/core/src/systems/hacking/status.ts`：未装完好接入仓时（含已损坏场景）在 `【当前状态】` 明确写出无可用网络接入仓，仅义眼不能发起快速破解/入侵协议/潜网。
  - `packages/core/src/systems/cyberware/status.ts`：义眼行明确注明“仅光学扫描，不自带快速破解能力”。
- [ ] **精确分层匹配**：
  - `packages/core/src/systems/hacking/prompt.ts`：扩充 `mentionsHacking` 覆盖全部快速破解手段与常见破解表述；新增严格口径 `attemptsHacking` 仅识别主动发起快速破解/黑客入侵/潜网的意图（排除纯观察摄像头、购置芯片、询问或物理拆除）。
- [ ] **代码级硬阻断**：
  - `packages/core/src/narrator/prompts/context.ts`：导出 `hardHackBlockReason(world, data, inputText)`，并在 `physicsSection` 中针对无接入仓玩家按 `attemptsHacking` 精确触发 `hackCheck`。
  - `packages/core/src/narrator/turn.ts`：在 `judge` 后、`narrate` 前检查 `hardHackBlockReason`（同时结合玩家输入与 `judge.read`），若确认无完好网络接入仓却尝试发起快速破解/入侵，代码直接强制锁死 `rulingSpec.kind = "blocked"`，确保 `narrate` 与 `extract` 绝不放行。
- [ ] **静态检查与收口**：运行 `tsc --noEmit` 与 `biome check`，更新本计划状态并提交。
