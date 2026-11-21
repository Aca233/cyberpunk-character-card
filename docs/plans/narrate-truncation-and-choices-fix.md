# 正文截断草稿与选项缺失修复计划

状态：执行中

## 问题与根因定位

### 1. 频繁出现「本轮未完成记账（草稿）：正文未完整生成，已保存草稿；本轮未推进世界，请重新生成。」
- **主因（输出上限被硬顶在 4000–8000）**：
  - `packages/core/src/narrator/budget.ts` 中 `SMALL.reply = 4000`、`LARGE.reply = 8000`。
  - `packages/core/src/narrator/turn.ts` 使用 `Math.min(budget.parts.reply, deps.maxOutputTokens ?? budget.parts.reply, sampling.maxOutputTokens ?? budget.parts.reply)` 强行封顶，导致即使模型连接设为 128K+ 上下文、配置了更大的 `maxOutputTokens` 或酒馆预设指定了 `65535`，最终发出的 `max_tokens` 仍被砍死在 8000（32K 窗口更是 4000）。
  - 实测存档（`s-mwm0a69j-160140`）显示：使用思考/推理模型叠加长篇与思维链预设时，仅 1291 字正文就消耗 4744 output tokens；稍长正文或较长思考即触发 `length` / `max_tokens` 截断，进入草稿。
- **次因（结束原因大小写与诊断信息缺失）**：
  - `packages/core/src/narrator/completion.ts` 对 `finishReason` 严格区分大小写（未对 `"END_TURN"` / `"Stop"` 等归一化）。
  - `turn.ts` 吞掉了 `event.finishReason` 与实际输出 token 数，界面无法区分是超输出上限截断还是中转站/工具调用异常结束。
  - `apps/server/src/providers/anthropic.ts` 默认 `DEFAULT_MAX_TOKENS = 4096` 偏低，在未传 `maxOutputTokens` 时（如抽取/判断）易截断。

### 2. 有时不会生成建议选项
- **主因（提示词与 Schema 明确诱导对话时返回 `[]`）**：
  - `packages/core/src/narrator/block.ts` 与 `packages/core/src/narrator/prompts/extract.ts` 写明「0–3 个，最多 5 个；对话正进行时通常写 `[]`」。
  - 实测最近 6 个存档中有 5 个在 NPC 抛出钩子/提问的正常回合里模型按规则直接返回 `choices: []`（`droppedChoices` 为空）。
- **次因（选项提案校验过严导致静默丢弃）**：
  - `ChoiceBaseSchema.strict()` 遇到模型输出 `source: null`、`source: ""`、多余字段、纯字符串或稍长文本时直接校验失败并本地丢弃（不走修复），容易将整批选项静默清空。

## 实施步骤

- [ ] **Step 1：放宽输出上限预算与完善完成判定/报错诊断**
  - `packages/core/src/narrator/budget.ts`：将 `LARGE.reply` 提升至 `16000`，新增 `replyTokenCap(budget)`（按窗口 25% 上限计算安全回复上限，范围 `budget.parts.reply` 至 `65536`，128K 窗口允许最高 32000，32K 窗口允许最高 8000）。
  - `packages/core/src/narrator/completion.ts`：`completeFinish` 归一化大小写与空白；新增 `isLengthFinish(reason)` 识别 `length` / `max_tokens`。
  - `packages/core/src/narrator/turn.ts`：允许连接或预设在 `replyTokenCap` 范围内使用更大的 `maxOutputTokens`，仅在必需输入裁剪到底仍超窗时温和回退预留额度；未完整结束时在草稿说明中明确写出 `finishReason` 与输出 token / 上限信息。
  - `apps/server/src/providers/anthropic.ts`：`DEFAULT_MAX_TOKENS` 由 `4096` 提升至 `8192`。
  - 同步更新 `packages/core/src/narrator/budget-preset.test.ts` 等受影响测试断言。
- [ ] **Step 2：修复建议选项默认留空与过严校验丢弃**
  - `packages/core/src/narrator/block.ts`：更新 `ExtractDocSchema.choices` 描述，明确正常回合（含对话进行中）均给出 2–4 个方向性建议；放宽 `text`（≤120 字）与 `source`（≤40 字）长度，新增 `normalizeChoiceProposal` 清洗 `source: null / "" / "无"`、字符串简写与多余键。
  - `packages/core/src/narrator/prompts/extract.ts`：更新 `【建议选项】` 规则，移除「对话正进行时通常写 `[]`」，明确每轮（含对话进行中）给出 2–4 个不同方向的行动/回应建议，仅死亡或完结时写 `[]`。
  - `packages/core/src/narrator/turn.ts`：在校验每条 choice 前先经 `normalizeChoiceProposal` 归一化，避免无害格式差异误杀选项。
- [ ] **Step 3：静态检查与 Git 提交**
  - 按步骤分别提交 `git`；执行 `pnpm typecheck` 与 `pnpm lint` 验收（遵循项目约定，不主动执行单测/集成测试，交由用户验收）。
  - 更新本计划文档状态为已完成。
