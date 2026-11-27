# 上下文机制与提示缓存精准优化计划

- **状态**：已完成（2026-11-27）
- **目标**：不改存档结构、不改 UI、不牺牲正文质量与人物记忆，消除当前最大的未缓存 token 浪费与 32K 辅助模型溢出风险。

## 优化项

1. **修复 `npcEquipmentReference` 分桶缺失与大段展开**（`packages/core/src/narrator/prompts/npc-equipment.ts`）：
   - 服装按 `clothingStyle:budget` 分桶（各部位保留风格×预算代表，不再按 `item.id` 全量铺开 68 件）；
   - 随身杂项/药剂/手雷/消耗品按用途子类×预算分桶（不再按 `item.id` 全量铺开 ~65 件）；
   - 全部候选项能力改用 `summarizeAbility(..., 36)` 精简单行说明，显著降低未缓存 `user` 体积并提升信噪比。
2. **统一三阶段常驻模块进 `system` 缓存层**（`context.ts` / `narrate.ts` / `judge.ts` / `extract.ts`）：
   - 抽离共享 `ALWAYS_ON_MODULE_IDS`（14 个非 OOC 常驻模块），`narrate` 与 `judge` 与 `extract` 一致将常驻模块静态缓存进 `system`，仅把动态激活的场景模块留在 `user`。
3. **精简 `extract` 重复字段说明 & 补齐 `auxContextWindow` 两级兜底**（`npc/schema.ts` / `extract.ts` / `turn.ts`）：
   - 精简 19 条人物指令复用的 `ExistingNpcIdSchema` 字段提示（保留防自造 slug 约束）；
   - `extract` 超出 `auxBudget` 时先撤 `includeNpcEquipment`，若仍超再撤可选长说明 `includeCatalogDetails`（保留系统层完整 ID 基表）。

4. **补充收尾（2026-11-27）**：
   - 补齐 `jobAccept/jobNote/jobCrew/jobEnd`、`thread/threadTold`、`ncpd`、`home`、`sidegig`、`deadline` 共 10 条指令的 `id` 字段描述，杜绝同类 `id` 填错；
   - `npcEquipmentReference` 服装分桶收紧为 `armored/casual × budget`，进一步压低单轮未缓存体积。

## 验收标准
- `biome lint packages apps tools functions` 0 错误 / 0 警告；
- 6 份 `tsc --noEmit` 与 `tsx tools/check-data.ts` 全绿；
- 实测 `judge` / `narrate` / `extract` 优化前后 token 占用与 `system` 缓存占比显著改善。
