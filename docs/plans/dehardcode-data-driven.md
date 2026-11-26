# 数据驱动去硬编码改造计划（第一梯队 + 第二梯队）

- **状态**：已完成（2026-11-26）
- **目标**：消除 `packages/core`、`packages/runtime` 与 `apps/web` 中按官方固定 ID 写死的业务规则，改为由 `packages/content` 数据目录与创意工坊/自建对象上的声明式字段驱动；顺带修复两处由硬编码 ID 遗漏导致的真实逻辑 Bug。

## 第一梯队：义体系统全链路数据驱动 + 修复 2 个真实 Bug

1. **`CyberwareDefSchema` 与 `StartCyberwareSchema` 补齐声明式能力字段**（[schema.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/cyberware/schema.ts)、[board.ts](file:///c:/cyberpunk-character-card/packages/core/src/schemas/board.ts)）
   - `defaultArmSide?: ArmSide`（替代 `SINGLE_ARM_IDS`）
   - `capacityBonus?: number`、`safeLineBonus?: number`（替代 `chrome-compressor`、`auto-suppressant-injector`、`mood-stabilizer` 的 ID 特判）
   - `chassisProfile?: { hardCap, safeCap, constantOverload?, torsoBonus?, extremityBonus? }`（替代 `dragoon-fbc-chassis` / `gemini-fbc-frame` 的 ID 特判）
   - `variantGroup?: string`、`variantKey?: ElementVariantKey`（替代 `CYBERWARE_VARIANT_FAMILIES` 硬编码表）
   - `smartLink?: boolean`（修复 Bug #1：`tyger-claws-tattoo` 与自定义智能连接在 `context.ts` 武器建议中失效）
   - `carryBonus?: number`（修复 Bug #2：`linear-frame-sigma` 与 `dragoon-fbc-chassis` 未计入 `bulkyLimit` 负重上限）
   - `defenses?: readonly ("surge" | "thermal" | "ice")[]`（替代 `SURGE_SHIELD_IDS`、`THERMAL_SHIELD_IDS`、`ICE_DEFENSE_IDS`、`SELF_ICE` 等分散硬编码）
2. **清理 `core/systems/cyberware/schema.ts` 中的 10 组官方 ID 集合**
   - 将 `LIFESTYLE_IDS`、`SENSORY_IDS`、`CAPACITY_CORE_IDS`、`SKIN_STEALTH_IDS`、`PAIN_OVERRIDE_IDS`、`FOOT_TREAD_IDS`、`EXOSKELETON_FRAME_IDS`、`LEG_DRIVE_IDS`、`MAIN_OPTICS_IDS`、`SINGLE_ARM_IDS` 的语义下沉为 [cyberware.ts](file:///c:/cyberpunk-character-card/packages/content/src/cyberware.ts) 中的显式 `category`、`exclusiveGroup`、`defaultArmSide` 与能力字段。
3. **贯通叙事上下文、黑客防冰、NPC 扫描、背包负重与前端视图**
   - [context.ts](file:///c:/cyberpunk-character-card/packages/core/src/narrator/prompts/context.ts)、[status.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/inventory/status.ts)、[apply.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/hacking/apply.ts)、[body.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/npc/body.ts) 全部改读目录字段。
   - `bulkyLimit()` / `loadoutSummary()` 改读义体目录的 `carryBonus`。
   - [view.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/cyberware/view.ts)、[ripperdoc.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/cyberware/ripperdoc.ts)、[characters.ts](file:///c:/cyberpunk-character-card/packages/runtime/src/routes/characters.ts) 与 `apps/web` 透传新字段，并用 `variantGroup`/`variantKey` 折叠变体、用 `exclusiveGroup === "skinStealth"` 替代 `part.id === "optical-camo"`。

## 第二梯队：武器隐蔽度、枪匠标记、压制剂能力标记与诊所头像映射

1. **武器隐蔽度声明式化**
   - `ItemDefSchema` 新增 `concealment?: WeaponConcealment`；在 [items.ts](file:///c:/cyberpunk-character-card/packages/content/src/items.ts) 为紧凑/中型近战武器标明 `concealment`（并补全不朽小刀的 `pocket` 隐蔽度）。
   - 移除 [inventory/schema.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/inventory/schema.ts) 中的 `POCKET_MELEE_WEAPONS`、`COAT_MELEE_WEAPONS` 以及 `saika-scope`/`gaki-scope` 旧回落。
2. **枪匠工坊标记**
   - `ShopSchema` 新增 `gunsmith?: boolean`；在 [shops.ts](file:///c:/cyberpunk-character-card/packages/content/src/shops.ts) 为 `wilson`、`kabuki-arms` 标明 `gunsmith: true`；[gunsmith.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/inventory/gunsmith.ts) 改为优先读 `shop.gunsmith`。
3. **压制剂能力标记**
   - `ItemDefSchema` 新增 `suppressant?: boolean`；[items.ts](file:///c:/cyberpunk-character-card/packages/content/src/items.ts) 为 `psycho-suppressant` 标明 `suppressant: true`。
   - [psychosis/actions.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/psychosis/actions.ts)、[psychosis/apply.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/psychosis/apply.ts)、[inventory/view.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/inventory/view.ts)、[InventoryPage.tsx](file:///c:/cyberpunk-character-card/apps/web/src/features/story/InventoryPage.tsx) 与 [NeuralPages.tsx](file:///c:/cyberpunk-character-card/apps/web/src/features/story/NeuralPages.tsx) 统一按 `suppressant` 识别，支持自定义/工坊压制剂。
4. **义体医生头像泛化**
   - [ripperdoc.ts](file:///c:/cyberpunk-character-card/packages/core/src/systems/cyberware/ripperdoc.ts) 透传 `keeperNpc`，[Ripperdoc.tsx](file:///c:/cyberpunk-character-card/apps/web/src/features/story/Ripperdoc.tsx) 改用 `portraitOf(doc.keeperNpc ?? doc.id)`，替换 `doc.id === "viktor"` 特判。

## 验收标准

- `biome lint packages apps tools` 零错误、零警告。
- 5 个工作区包（`core` / `content` / `runtime` / `web` / `tools`）`tsc --noEmit` 全部通过。
- `tsx tools/check-data.ts` 通过，且抽检脚本验证所有 187 件义体分类/互斥组/承载配置一致，且 2 个历史 Bug（`tyger-claws-tattoo` 智能联锁、`linear-frame-sigma` & `dragoon-fbc-chassis` 负重加成）均已生效。
