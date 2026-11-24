# 提示词缓存命中率全面排查与修复计划

## 背景与根因诊断

经逐层排查 `packages/core/src/narrator` 与 `packages/runtime/src/providers`，导致提示词缓存命中率为 0% 或极低的根因集中在五个方面：

1. **OpenAI 兼容接口（`providers/openai.ts`）未向中转站上的 Claude / OpenRouter Gemini 发送显式 `cache_control`**
   - 经 New API / One API / OpenRouter / LiteLLM 等 OpenAI 兼容通道调用 `claude-*` 时，Anthropic 协议要求显式 `cache_control: { type: "ephemeral" }`，否则命中率恒为 0%。
   - OpenRouter 调用 `gemini-*` 时亦需 `cache_control` 启用显式缓存。
2. **三家适配层的 SSE `usage` 统计存在归零覆盖与字段漏读**
   - `anthropic.ts` 的 `absorbUsage` 在 `message_delta` 携带 `cache_read_input_tokens: 0` / `cache_creation_input_tokens: 0` 时会直接覆盖 `message_start` 报出的真实缓存命中数，导致前端显示 0%。
   - `openai.ts` 在多 chunk 返回 `usage` 时会整体覆盖前值，且漏读部分中转站字段（`prompt_tokens_details.cache_read_tokens`、`cache_read_input_tokens`、`input_tokens_details.cached_tokens`、`cached_tokens` 等），且未对仅计未命中部分的 Anthropic 风格 `prompt_tokens` 做口径归一化。
   - `gemini.ts` 合并 `usageMetadata` 时未对各 token 计数取最大值，尾包若发 `0` 会冲掉前值。
3. **大量纯静态提示词被塞在每轮未缓存的 `user` 消息中**
   - `npcEquipmentReference`（`narrate` 约 10.9K 字、`extract` 约 13K 字）因掺入了 `${world.time}:${npcs.length}` 随机种子，每轮变动并放在 `user` 侧，无法进入静态前缀缓存。
   - `judge` 与 `narrate` 将 14 个常驻规则模块（约 4.5K 字）全部放在 `user` 消息；`extract` 亦未将全部常驻模块（如 `shops`、`safehouse` 等静态可复用部分）纳入静态基线。
4. **酒馆写作预设（`narrator/preset.ts`）破坏静态前缀与历史前缀**
   - 前置 `head` 条目若含 `{{lastUserMessage}}` / `{{random:...}}` / `{{roll:...}}` 等动态宏，每轮都会改动第 0 个 token，击穿整条缓存链。
   - `inChat` 深度条目按 `out.length - 1 - depth` 插进历史消息中间，每新增一轮都会后移 2 条消息，导致多轮历史前缀每轮变化；`depth: 0` 的 `assistant` 条目在 Anthropic 合并同角色消息时会直接粘到上一轮 `assistant` 历史末尾，破坏历史缓存断点。
5. **Anthropic / Claude 历史缓存断点策略不够稳健**
   - 仅在 `turns.length - 2` 打单断点，部分未实现 20-block lookback 的代理/中转层无法命中上一轮写入的 `turns.length - 4` 缓存；同时若相邻同角色消息合并，未在块级边界保留独立断点。

## 实施步骤

- [x] **阶段一：静态层收敛至 `system`（`packages/core/src/narrator/prompts/`）**
  - `npc-equipment.ts`：拆分 `staticNpcEquipmentReference(data, includeIds)`（按静态目录 `WeakMap` 缓存，固定确定性种子，零随回合漂移）与轻量的 `npcEquipmentRepeatHint(world, data)`（仅保留 1 行近期重复提示在 `user` 侧）。
  - `layers.ts`：统一导出 `ALWAYS_ON_MODULE_IDS`（14 个所有常规回合恒定激活的规则模块），提供按阶段缓存的 `staticAlwaysOnModules(stage)` 与 `staticBaseData(data)`。
  - `judge.ts` / `narrate.ts` / `extract.ts`：将常驻规则模块与静态装备选型参考移入 `system` 静态前缀，`user` 侧仅留动态激活模块、当前局势、重复型号提示与本轮输入；确保所有阶段 `system` 100% 跨回合字节一致，并保持 `parts` 预算统计口径准确。
- [x] **阶段二：酒馆预设缓存保护（`packages/core/src/narrator/preset.ts`）**
  - 检测单条预设是否引用每轮变动的动态宏（`lastUserMessage`、`random`、`roll` 或依赖它们的 `getvar`）。
  - 静态 `head` 条目仍留在最前，动态 `head` 条目下沉至最终 `user` 消息前且不以 `system` 角色上浮污染顶层系统提示。
  - `inChat` 条目保持原有相对顺序但统一锚定在历史对话末尾、最终 `user` 消息之前（不再穿插改写历史对话中间层），避免每轮位移击穿历史 KV 缓存。
- [x] **阶段三：三家模型适配层缓存标记与用量修复（`packages/runtime/src/providers/`）**
  - `openai.ts`：
    - 合并连续前导 `system` 消息为单条 `system` 消息（消除酒馆预设拆出 20+ 条 `system` 引发的协议转换不一致）。
    - 向 OpenAI 官方及各类兼容中转站（New API / One API / Sub2API / `agg-direct` / OpenRouter 等）透传 `prompt_cache_key` 与 `user`（对齐 Codex 粘性会话路由机制，仅排除 Ollama 与严格拒收未知字段的 Google 官方 OpenAI 兼容端点，并内置 400 拒绝字段记忆自动降级保护）。
    - 对 `claude` 模型（以及 OpenRouter 上的 `gemini` 模型）在连续前导 `system` 末尾与最近两轮历史断点消息（`last-2`、`last-4`）自动附加 `cache_control: { type: "ephemeral" }`；全面补齐各家/中转站缓存命中与写入字段解析，跨 chunk 取最大值不归零覆盖。
  - `anthropic.ts`：`absorbUsage` 改用 `Math.max` 防 `message_delta` 归零覆盖；支持最多 3 个缓存断点（`system` + `turns[len-2]` + `turns[len-4]`）；同角色合并时保留分段 text block；附带 `metadata.user_id`（对齐 Claude Code 粘性会话路由）。
  - `gemini.ts`：`usageMetadata` 各计数改用 `Math.max` 合并，防止尾包 `0` 覆盖 `cachedContentTokenCount`。
- [x] **阶段四：按完整消息边界切片缓存 + 上下文查看器分阶段缓存明细（`context.ts` / `judge.ts` / `extract.ts` / `turn.ts` / `SettingsScreen.tsx`）**
  - `splitStateSummary` / `splitSituation`：将每轮跳变的 `时间：` 行与动态尾部分离，使 `judge` 与 `extract` 按完整消息边界输出 `[system(静态规则与表), user(半静态世界与人物), assistant(固定确认), user(本轮动态输入/正文)]`，同时兼容按完整消息块缓存的网关/Claude 与隐式前缀缓存的 Gemini/OpenAI。
  - `stageUsage`：新增 `① 判断 / ③ 写正文 / ④ 抽取 / 其他` 分阶段 token 与缓存命中明细，落盘于 `TurnRecord.stageUsage` 并在「设置 → 上下文查看器」直接展示，一目了然定位各阶段命中率。
- [x] **阶段五：校验与收口**
  - 实测 Turn 0 系统层静态可缓存占比：`judge` 41% → **57%**、`narrate` 21% → **72%**、`extract` 63% → **80%**；含动态宏与深度注入的酒馆预设跨回合共享前缀从 0% 恢复至 100% 覆盖静态头与全部历史轮次。
  - 已通过 `core` / `runtime` / `web` 全量 `tsc --noEmit` 与 `biome check`（0 error / 0 warning）。

## 预期收益

- **Claude（原生 & 中转站 OpenAI 兼容）**：从 0% 恢复正常显式缓存命中，系统前缀 + 多轮历史前缀命中率可达 70%–85%+。
- **Gemini（原生 & 中转站） / OpenAI / DeepSeek / 通义 / 火山**：系统可缓存前缀占比从约 21%–63% 提升至 **62%–83%+**（加上多轮对话历史后可达 80%–90%+），且酒馆预设不再击穿缓存。
- **用量统计准确**：修复中转站与尾包归零覆盖问题，上下文查看器真实反映每轮缓存命中率与写入量。
