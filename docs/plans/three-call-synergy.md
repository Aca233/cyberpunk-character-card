# 三次调用协同增质与上下文深度减负计划

- **状态**：已完成（2026-11-27）
- **核心目标**：在不牺牲正文质量、人物立体度、知情边界与长线记忆的前提下，打通 `① 判断 → ③ 正文 → ④ 抽取` 三次调用的协作分工，并去掉常态下冗余的未缓存噪音。

## 实施方案

1. **① `judge` 升级（导演便笺 + 新人物预判 + 精准旧记忆摘要）**（`stages.ts` / `judge.ts` / `context.ts`）：
   - `JudgeDocSchema` 新增轻量可选字段 `npcPulse`（人物潜台词与暗线便笺，仅喂给正文主笔，不泄漏给抽取）与 `newNpcLikely`（本轮是否可能出场未建卡新人物）；
   - `judge` 的【可调的旧记忆】展示前 24 条并附 28 字短摘要，提升召回精度；`turn.ts` 同时兼容纯标题与「标题｜摘要」匹配；
   - 从 `judge` 移除仅用于正文背景创作的 `【2077 世界时间线】`。
2. **③ `narrate` 降噪增质**（`narrate.ts` / `turn.ts`）：
   - `npcEquipmentReference` 改为按需挂载（仅当 `judge.newNpcLikely === true` 或现场存在未定型旧识时挂载）；
   - `【转折和两难素材】` 与 `【后果参考表】`（2,235 token）不再无条件常驻 `narrate.sys`，改为仅在未启用预设且处于高烈度或有硬裁决时按需挂载，避免日常对话被诱导硬加狗血冲突；
   - `foes` 与 `npcPulse` 仅喂给 `narrate`，不再混入 `extract` 的 `decided`（避免抽取把创作指引误当已发生事实）。
3. **④ `extract` 轻量精准记账**（`inventory/prompt.ts` / `cyberware/prompt.ts` / `extract.ts` / `turn.ts`）：
   - `catalogSection(data, false)` 与 `cyberwareSection(data, false)` 改为按分类紧凑索引（`分类：id 名称、id 名称…`），去掉对抽取无用的稀有度/参考价列，100% 保留全部 ID；
   - `jobTemplateSection`（1,178 token）移出 `extract.sys`，改为输入/正文涉及委托派单时按需放进 `user`；
   - `extract` 的 `npcEquipmentReference` 改为仅当 `newNpcLikely`、存在未定型旧识或正文疑似出现新人物时才按需挂载。
4. **在场人物卡按阶段分流 + 收场三路并行**（`systems/npc/prompt.ts` / `narrator/turn.ts`）：
   - `fullCard(npc, stage, npcs)` 按 `stage.stage` 分流：
     - `narrate`：保留 100% 完整演出卡（`look`、`wearing`、`voice`、`samples`、`bio`、`want`、`limit`、`fixerTemperaments`、`secret`、`scanTacticalProfile` 等）；
     - `judge`：省略纯表演字段（`look`、`voice`、`samples`、`bio`），保留 `wearing`、`want`、`limit`、`fixerTemperaments`、`secret`、身体/护甲/扫描情报与关系/记忆/账本；
     - `extract`：只保留记账必需字段（头部+未定型标记、`wearing`、身份事实、`bodyLine`、已扫描简标、行为芯片、关系/人脉/玩家已知/人情账本/共同记忆/最近/经历），同时隐藏 `bio` 与 `secret` 彻底避免抽取剧透；
   - 收场阶段原已并行执行「宏观局势 + 人物社交」双轨，进一步把回退的「⑦ 整理场景摘要」并入同一次 `Promise.all`（三路均读取结算态、互不串味），最后按原固定顺序（`macro` → `social` → `memory/summary`）合并落盘。

## 验收标准
- `biome lint packages apps tools functions` 0 错误 / 0 警告；
- 6 份 `tsc --noEmit` 与 `tsx tools/check-data.ts` 全绿；
- 实测常规回合、新人物回合与多人同场（3 名原作 NPC 在场）下 `judge` / `narrate` / `extract` 的 token 占用与边界隔离，确认所有 ID 索引与演出字段完整保留。
