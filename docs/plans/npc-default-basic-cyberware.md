# NPC 常配基础义体调整计划

- 状态：已完成
- 日期：2026-11-21
- 范围：`packages/core` 提示词口径、装备选型候选保底、义体名称容错解析及旧识初始 `body` 定型补位（不改 UI 与布局，不引入硬编码职业强制注入）。

## 背景与根因

1. 提交 `68f8fc8` 移除按职业自动注入义体后，`NewNpcSchema` 中 `body` 可选且 `cyberware` 默认 `[]`。
2. `extract.ts`、`npc-equipment.ts`、`systems/npc/prompt.ts`、`systems/npc/schema.ts` 四处提示词过度收紧（“工作确实依赖才装、没有需求才留空”“不用义眼填空”），叠加低温抽取“不夸大”原则，导致抽取模型大量生成 `cyberware: []`。
3. `npc-equipment.ts` 按部位+预算桶轮换代表，常用基础件（如 `kiroshi-mk1`、`biomonitor`）被轮换掉后，候选里只剩排爆/战术向义体，模型更难为普通市民与日常 NPC 选型。
4. `sanitizeNpcBody` 仅接受精确 `id` 或精确 `name`，模型写出“岐路司义眼”“生物监测器”等简称时会被静默剔除为空。
5. 主板/自定义旧识首次 `npcUpdate` 若改掉了 `look`/`voice` 却漏传 `body`，后续 `npcUpdate` 的 `body` 会被直接忽略，永久保持空体。

## 实施步骤

1. **常驻基础义体候选与提示词口径统一**
   - `packages/core/src/narrator/prompts/npc-equipment.ts`：常驻保留夜之城常见基础义体（`kiroshi-mk1`、`biomonitor`、`syn-lungs`、`clutch-padding`、`prosthetic-arms`、`prosthetic-legs`、`subdermal-armor`、`smart-link`），同步更新 `lead` 说明为“夜之城大多数人物常配 1–3 件贴合身份与财力的基础或常见义体，仅明确无植入/信仰排斥/极端拮据时留空”，同时保持部位多样、避免千篇一律。
   - `packages/core/src/narrator/prompts/extract.ts`：同步 `EXTRACT_STAGE` 中新建/定型 NPC 的 `body.cyberware` 要求。
   - `packages/core/src/systems/npc/prompt.ts`：同步 `npcRules.narrate` 与 `npcRules.text` 的义体口径。
   - `packages/core/src/systems/npc/schema.ts`：同步 `NpcBodyCardSchema.shape.cyberware` 描述。
2. **名称容错与旧识空体补齐**
   - `packages/core/src/systems/npc/body.ts`：在 `sanitizeNpcBody` 中补充归一化匹配与常见基础义体简称别名解析（仅在目录存在对应 `id` 时生效），减少静默误删。
   - `packages/core/src/systems/npc/apply.ts`：在 `npcUpdate` 中允许未扫描且 `body` 仍完全为空的非原作人物补齐一次初始 `body`。
3. **静态检查与提交**
   - 执行 `tsc` 与 `biome` 静态检查（不运行自动化测试，由用户自行验收）。
   - 更新本计划状态为“已完成”，仅暂存本次改动并提交。
