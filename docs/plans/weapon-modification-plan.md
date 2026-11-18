# 武器改装与枪匠工坊系统设计方案

状态：**实施中（步骤 2/4）**  
日期：2026-11-18  
约束基准：严格遵循 `AGENTS.md`（制作阶段不做历史兼容、正文质量优先、文笔交给预设、代码改动后仅执行 `pnpm typecheck` / `pnpm lint` / `pnpm check-data`，不做测试运行）

---

## 一、现状基准与已暴露的结构性缺陷

### 1.1 当前已落地基线
- **状态与数据结构**（`packages/core/src/systems/inventory/schema.ts`）：
  - `InventoryStateSchema` 存在 `mods: Record<string, Partial<Record<ModSlot, string>>>`（槽位为 `ModSlotSchema`: `"muzzle" | "scope" | "plugin"`）、`tuned: Record<string, Rarity>` 与 `parts: number`。
  - `ItemDefSchema` 支持武器字段 `category`（`WeaponCategorySchema`）、`weaponType`（`WeaponTypeSchema`: `"power" | "tech" | "smart"`）、`attribute`、`iconic`、`rarity`、`ability`，以及改装件字段 `modSlot`、`modFits`。
- **操作与结算入口**（`packages/core/src/actions.ts`、`packages/core/src/systems/inventory/actions.ts`、`apply.ts`）：
  - 前端 UI 通过 `PlayerActionSchema` 中的 `ModWeaponActionSchema`（`type: "modWeapon"`）触发 `inventoryActions.modWeapon`，在非战斗状态转化为内部指令 `InventoryInternalSchemas["inventory.mod"]`，由 `applyMod` 完成同槽替换与拆装。
  - `parts` 与 `partsRules`（`packages/core/src/systems/inventory/prompt.ts`、`index.ts`）曾在「物品栏精简（方案 A）」时被移至 `internal` 且停止向模型注入，`tuned` 目前无任何在线升级入口。
- **内容与商店供给**（`packages/content/src/items.ts`、`shops.ts`、`merchant-sites.ts`）：
  - 已配置 9 件 `kind: "mod"` 改装件：`strix-silencer`、`alecto-silencer`（`muzzle`），`kanetsugu-scope`、`saika-scope`、`gaki-scope`（`scope`），`big-mag`、`kneel-mod`、`bleedout-mod`、`parallax-mod`（`plugin`），分别上架于 `wilson`（威尔逊的枪店）、`kabuki-arms`（阿涛的摊子）及 `poiShops` 的 `gun` 武器店。
- **前端界面入口**（`apps/web/src/features/story/NeuralPages.tsx`、`StoryScreen.tsx`）：
  - `InventoryPage` 在武器详情卡片中展示 `.gearMods` / `.modDetach`（内联 `×` 按钮直接拆下，无确认弹窗），在改装件详情卡片中通过 `inventory.modTargets` 渲染 `.modTargetList`（`装到<武器>`）；`StoryScreen.tsx` 在非忙碌/非战斗/未结束时传递 `onMod` 调用 `act({ type: "modWeapon", action, weapon, mod }, "gear")`。

### 1.2 核心结构缺陷与缺失
1. **按目录 ID 键值导致的同款武器串模冲突**
   - `InventoryStateSchema.mods` 与 `tuned` 均以目录 `weaponId`（如 `"liberty"`）为键。玩家背包同时携带多把同款武器时共用同一套改装件与精调稀有度，既无法区分不同配置，也无法在商店回收、战利品或 NPC 转交时独立流转；`trade.ts` `quoteTrade` 目前只能在 `carried === 1` 时粗暴拦截带配件武器出售。
2. **留置（`placed`）孤立引用与虚假失去提示 Bug**
   - `applyPlaceItem("leave")`（`packages/core/src/systems/inventory/apply.ts`）通过 `takeFromPlayer` -> `take(draft, id)` 将武器移出 `backpack` 写入 `placed`，但未迁移或清理 `draft.mods[id]` / `draft.tuned[id]`。
   - 结果：武器放进安全屋或车后备箱后，`mods[id]` 成为孤立残留；`applyMod` 因检查 `draft.backpack[weaponId]` 无法对其操作；且 `inventoryEvents`（`packages/core/src/systems/inventory/events.ts`）因 `if (!counts.has(weapon)) continue;` 在玩家把带配件武器存入车厢/家中时误报「失去 `<mod>`」。
3. **粗糙的三槽位模型且缺少 `weaponType` / 单枪槽位门控**
   - 所有武器目前隐式拥有全部 `muzzle` / `scope` / `plugin`（仅由改装件的 `modFits` 校验 `WeaponCategory`），缺少按 `weaponType`（如 `tech` 电磁枪不宜加普通消音器、`smart` 智能枪无传统光学镜/枪口消音）、单把武器自身允许的槽位配置、不朽武器（`iconic`）固有组件锁定及出厂预装配件能力；且当前目录对 `blunt` 近战武器与 `smart` 智能武器的可买插件几乎空白。
4. **状态与裁决提示词信息盲区**
   - `inventoryStatus`（`packages/core/src/systems/inventory/status.ts`）仅输出 `装着 strix-silencer`（原始 ID），既不展示武器 `weaponType`/`category`，也不写配件名称与定性效果；而 `buildJudgePrompt`（`narrator/prompts/judge.ts`）与 `buildNarratorPrompt`（`narrator/prompts/narrate.ts`）均不调用 `extractCatalogDetails`（`narrator/prompts/catalogs.ts`）或 `catalogSection`，导致裁决与正文阶段无法直观获知配件带来的战术能力。
5. **关键物理、潜行与智能联锁未接通代码钩子**
   - `physicsSection`（`narrator/prompts/context.ts`）-> `evaluatePhysicsBoundaries`（`packages/core/src/physics.ts`）目前只消费 `loadoutSummary`（`weaponConcealment` 与 `isBulkyItem`）。
   - `systems/dice/schema.ts` 已定义 `WeaponNoiseSchema`（`silent | loud | explosive`）与 `WeaponTechSchema`，但运行时从未接入：`muzzle` 消音器装上后没有把武器声学状态喂给 `physicsSection` / `stealthRules`；`smart` 武器的「手部智能连接（`smart-link`）义体联锁」仅存在于 `catalogSection` 一句提示文本中，从未检查 `CyberwareState.installed` 与 `health.brokenChrome`；外挂大型消音器或高倍狙击镜也未影响 `weaponConcealment`。
6. **枪匠工坊服务流与单源报价体系缺失**
   - 改装件目前只能战外免费随手装卸，缺少枪匠付费深改/拆装、武器精调（`tuned` 升阶）与与 `commerce/quotes.ts`（`agreedQuote` / `checkNarratedPurchase` / `tradeEvidence`）打通的单一报价真源。

---

## 二、目标架构设计（全新直改，不做历史兼容）

遵循 `AGENTS.md`「制作阶段不做历史兼容」原则：直接替换 `InventoryStateSchema.mods`、`InventoryStateSchema.tuned` 以及遗留字段 `weapons` / `active`（同步移除 `absorbLegacyWeapons` 兼容包袱，并同步更新 `packages/core/src/narrator/scene-memory.ts` 中的 `itemCount` 与 `packages/core/src/state.ts` 中的 `loadoutSummary` 调用），建立以下五层清晰架构。

### 第 1 层：基于 `WorldObject` 扩展的「按需实例分离」数据模型

#### 方案对比与选型
- **备选 A（独立 `weaponInstances` 字典）**：在 `InventoryState` 另建 `weaponInstances` 表。缺点是 `backpack`、`placed`、`npc.body.gear`、`combat.carry`、`shops` 仍需同时适配目录物品 ID 与两套独立实例体系，代码分叉多。
- **选定方案 B（统一扩展 `InventoryState.objects: Record<string, WorldObject>` + 按需实例分离）**：
  - 标准未改装的量产武器继续以目录 ID 在 `backpack` 中叠加计数（如 `backpack["liberty"] = 2`），不制造多余对象。
  - **一旦发生定制化**（安装改装件、进行枪匠精调 `tunedRarity`、锁定槽位、自带出厂预装配件、或在剧情/战利品中获得独一无二的改枪），立即将其从堆叠数拆分并物化为一条独立 `WorldObject` 实例（ID 规范如 `wpn:<baseId>:<seq>`），`backpack` / `placed` / `npc.body.gear` 中直接持有该实例 ID。
  - **为什么天然统一？**
    1. `withWorldObjects`（`packages/core/src/systems/inventory/apply.ts`）已将 `objects[id].definition` 并入运行时 `itemCatalog`，所有现有视图与接口（`inventoryView`、`shopsView`、`npc/body.ts`、`combat/apply.ts`）天然通过实例 ID 查到完整 `ItemDef`。
    2. `applyPlaceItem` 与 `relocateVehiclePlaced`（`apply.ts`）本就会随 `leave`/`take` 与车辆移动自动同步 `WorldObject.holder` 和 `location`，**彻底消除 `placed` 孤立配件 Bug**。
    3. `applyItem`（`gain`/`lose` with `recipient`）本就支持将 `WorldObject` 在玩家、地面与 `npc.body.gear` 之间无损转交，带配件的枪送给 NPC 或被敌人捡走时，配件与枪体一体流转。

#### 具体数据结构调整（`packages/core/src/systems/inventory/schema.ts`）
- **新增 `WeaponInstanceStateSchema`（挂载于 `WorldObjectSchema` 可选字段 `weaponState`）**：
  ```ts
  export const WeaponInstanceStateSchema = z.object({
    /** 目录模板 ID（如 "liberty"）；用于图标映射 itemArtOf(baseId)、商店识别与还原拆堆 */
    baseId: z.string().min(1),
    /** 已安装的改装件：槽位 -> 改装件目录 ID */
    mods: z.partialRecord(ModSlotSchema, z.string().min(1)).default({}),
    /** 无法在战外随手拆下的槽位（如枪匠焊死/定制组件、不朽武器固有改装） */
    lockedSlots: z.array(ModSlotSchema).default([]),
    /** 枪匠精调后的稀有度档位（高于模板默认 rarity） */
    tunedRarity: RaritySchema.optional(),
  });
  ```
- **扩展 `WorldObjectSchema`**：
  - 增加 `kind: z.enum(["story", "customized"]).default("story")`（区分「剧情独有物件」与「由目录武器拆出改装的定制实物」）。
  - 增加 `weaponState: WeaponInstanceStateSchema.optional()`。
- **清理 `InventoryStateSchema`**：
  - 删除 `mods`、`tuned`，以及历史兼容字段 `weapons`、`active`；新增 `nextWeaponSeq: z.number().int().min(1).default(1)` 用于生成确定性实例 ID。
  - 保留 `parts` 仅作为可选扩展（具体见第五节待确认决策）。
- **关键边界规则与一致性保证**：
  1. **拆完还原与防误报通知**：
     - 当 `object.kind === "customized"` 且玩家拆下全部配件、无 `lockedSlots` 且无 `tunedRarity` 时，自动把 `backpack[instanceId]` 折叠回 `backpack[baseId]` 并清理该 `WorldObject`。
     - 在 `inventoryEvents`（`packages/core/src/systems/inventory/events.ts`）中，将 `wpn:<baseId>:<seq>` 归一化回 `weaponState.baseId` 统计总持枪数，并把 `WorldObject.weaponState?.mods` 计入随身配件总件数；这样初次拆堆或拆光还原时**不会误报**「失去 自由手枪 ×1 + 获得 自由手枪 ×1」，留置时也可准确反映整枪（含配件）存入状态。
  2. **提示词与入库校验**：
     - `inventory/index.ts` 的 `持续物件` section 仅展示 `kind === "story"` 的独立物件，不与 `随身武器` 重复打印常规改枪；`catalogSection`（`inventory/prompt.ts`）仅列出静态目录模板，不把 `wpn:*` 克隆体塞进系统物品表。
     - `applyItem("gain")` 在接纳带 `weaponState` 的新物件时，必须用 `itemCatalog` + `canAttachMod` 校验所有 `weaponState.mods`，防止模型捏造非法配件 ID。
     - `safehouse/index.ts`（`住处与留置物品`）格式化留在车内/家中的 `placed` 物品时，若指向带 `weaponState` 的 `WorldObject`，一并展示已装配件与精调档位摘要。
  3. **商店回购、多点位置与动态估值（`packages/core/src/systems/inventory/trade.ts`）**：
     - **动态估值对称**：定制武器的回收价（`sell`）与商店回购价（`buy`）共用同一估值基数：`基础件参考价 + 已装配件参考价总和 + 精调升阶附加价`（其中对未标 `price` 的 `iconic` 武器，至少能按已装配件与精调价值核算，或允许先一键拆下可拆配件再出售），保证不会出现「回购价低于回收价」或「无价不朽武器带高价配件无法报价」。
     - **多地点商店回购校验**：像 `wilson`（同时关联 `megabuilding-h10` 与 `poi:wat_lch_gunsmith_01`）这类跨多地点的商店，收购定制 `WorldObject`（`holder = shop.id`）后，在 `quoteTrade` 校验位置时必须使用 `merchantAt(data, party.id, objectLocation, location)`（或将店持实物 `object.location` 置为 `null`），避免玩家从同一商店的另一关联入口进入时被误判 `仍在别处，不能隔空取得`。

---

### 第 2 层：槽位规则、`weaponType` 兼容矩阵与隐蔽度联动

#### 2.1 `ItemDefSchema` 扩展（`packages/core/src/systems/inventory/schema.ts`）
- **武器可选字段**：
  - `modSlots?: ModSlot[]`：显式覆盖该武器开放的槽位集合；未填写时由纯函数 `defaultWeaponSlots(def)` 按 `category` + `weaponType` 自动推导，避免逐一硬改约 100 条武器目录数据。
  - `preInstalledMods?: Partial<Record<ModSlot, string>>` 与 `lockedModSlots?: ModSlot[]`：支持出厂预装或剧情/不朽武器自带不可随手拆下的专属结构件（首次取得时物化为 `WorldObject`）。
- **改装件可选字段**：
  - `modTypes?: WeaponType[]`：限制适用的武器技术体系（例如仅适用 `"power"` 的动能消音/跳弹枪口，或仅适用 `"smart"` 的智能握把/校准插件）；不写表示兼容该 `category` 下的全部远程体系。
  - `concealmentShift?: number`（或 `bulkyMod?: boolean`）：标识会改变携行体积的配件（如长消音管、大型狙击镜）。
  - `grantsSmartLink?: boolean`：标记该武器内置或加装了自主智能靶向握把/外置校准模块（可替代手部 `smart-link` 义体或作为应急校准）。

#### 2.2 默认槽位矩阵与目录覆盖（`packages/content/src/items.ts`）
`defaultWeaponSlots(def)` 与 `canAttachMod(weaponDef, modDef, instanceState)` 作为唯一校验真源：
- **近战武器（`blade` / `blunt`）**：仅开放 `["plugin"]`（`ItemDefSchema.superRefine` 已禁止近战使用 `muzzle`/`scope`）。
- **威能远程（`power`）**：
  - `pistol` / `revolver` / `smg` / `assaultRifle` / `precisionRifle`：`["muzzle", "scope", "plugin"]`（`lmg`、`shotgun` 默认 `["scope", "plugin"]`，重型 `sniperRifle` 视枪型开放 `["scope", "plugin"]` 或 `muzzle`）。
- **技术电磁（`tech`）**：
  - 电磁导轨武器（如 `kenshin`、`omaha`、`burya`、`achilles`、`satara`、`nekomata`）无常规气体消音枪口：默认开放 `["scope", "plugin"]`。
- **智能制导（`smart`）**：
  - 智能武器依赖电子锁敌与微陀螺弹药，不装配常规机械消音器与传统光学瞄具（重型智能步枪可按单枪 `modSlots` 特例开放 `scope`）：默认开放 `["plugin"]`。
- **目录补全要求**：目前 `packages/content/src/items.ts` 尚无适用于 `"blunt"` 的插件，且若对现有插件收紧 `modTypes` 可能导致 `"smart"` 武器无配件可用；实施第 2 步时须补充适配 `smart`（如智能锁敌加速/靶向握把插件）与 `blunt`（如配重减震/电击冲击插件）的改装件并放入对应枪店/黑客商店货架。

#### 2.3 隐蔽度与大件计算联动（`effectiveConcealment`）
- 在 `packages/core/src/systems/inventory/schema.ts` 新增纯函数 `effectiveConcealment(def, weaponState, catalog)`：
  - 基础隐蔽度取 `weaponConcealment(def.category, def.id)`（`"pocket" | "coat" | "open" | "heavy"`）。
  - 若 `pocket` 级手枪装有 `muzzle`（外接长消音器）或大型战术瞄具（如 `saika-scope`、`gaki-scope`），隐蔽度上浮一档变为 `"coat"`（无法再塞进晚宴紧身礼服口袋过高端会所毫米波安检，但穿风衣/夹克仍可遮掩）。
  - `loadoutSummary` 接收 `inventory.objects` 解析改装后隐蔽度（同步更新 `packages/core/src/state.ts` 中的调用），使 `physicsSection` -> `evaluateDistrictSecurityCheck`（`packages/core/src/worldClock.ts`）真实反映改装后的武器体积。

---

### 第 3 层：双层改装流（战外即时拆装 + 枪匠工坊服务）

#### 3.1 为什么不照搬 `cyberware.service` 预约手术状态机
- `cyberware.service`（`packages/core/src/systems/cyberware/service.ts`）面向需要麻醉、医生排班、耗时数小时且可能被紧急事件打断的「外科义体手术（`book -> start -> interrupt -> resume -> complete`）」。
- 给枪械拧上全息瞄准镜、换上插件，在世界观中是数秒到数分钟内的机械作业；即便交给枪匠做精调或永久锁定改装，也是当场立等可取或普通订货交接，强行引入多阶段预约队列只会制造无谓操作摩擦。

#### 3.2 Tier A — 战外随手拆装（Field-Swap，免费即时，0 LLM 调用）
- **适用范围**：非 `lockedSlots` 的常规 `muzzle`、`scope`、`plugin` 配件。
- **操作入口**：保留并升级 `ModWeaponActionSchema`（`packages/core/src/systems/inventory/actions.ts` & `packages/core/src/actions.ts`）-> `InventoryInternalSchemas["inventory.mod"]` -> `applyMod`：
  - 校验 `!inCombat(world)`（交战中不许在菜单里无代价白嫖拆装）。
  - `weapon` 参数支持随身武器实例 ID（或唯一模板 ID，拆装时自动执行物化拆分生成独立 `WorldObject`）。
  - 校验 `canAttachMod`（槽位开放、类型匹配、非 `lockedSlots`）。
  - 同槽旧配件自动退回 `backpack`；若全部配件清空且无精调/锁定，自动折叠还原为常规堆叠。

#### 3.3 Tier B — 枪匠工坊与深度定制（Gunsmith / Workbench，镜像 `cyberware/quote.ts` 单源报价）
在 `packages/core/src/systems/inventory/` 新增 `gunsmith.ts`，**完整复刻 `cyberware/quote.ts` 与 `commerce/quotes.ts` 的单一真源和防绕过不变量**：
- **提供三类确定性服务**（仅限在 `wilson`、`kabuki-arms` 及 `poiShops` 中 `kind === "gun" | "melee"` 的武器店营业期间且人店同处时办理）：
  1. **枪匠安装 / 拆卸 / 换装**：可直接从商店货架买入配件并一步装到携带武器上，或由枪匠安全拆除 `lockedSlots` 内的固有锁定件（按配置收取工时费 `serviceRate`）。
  2. **武器精调升级（`tune`）**：重启并替代废弃的 `partsRules` 口径，将指定武器实例的 `tunedRarity` 逐档升阶（`common -> uncommon -> rare -> epic -> legendary`，参考店价阶梯 + `shop.priceFactor` + 店主 `shopMood` 修正）。
  3. **智能/特殊结构改造（`convert` / `lock`）**：例如为兼容武器加装外置智能靶向握把联锁模块（赋予 `grantsSmartLink`）或精工固定改装。
- **单一报价真源与 `commerce` / `narrator` 完整接通**：
  - UI（`Shop` 工坊页签）、确定性动作（`GunsmithActionSchema`：`type: "gunsmith"`）与 LLM 叙事购买流程共享同一个只读 `quoteGunsmith(world, data, request, options)` 函数。
  - **关键接线清单（避免运行时报错或报价绕过）**：
    1. 在 `packages/core/src/systems/commerce/schema.ts` 扩展 `QuoteTermsSchema.kind`（增加 `"gunsmith"`）、`action` 与 `OfferCommandSchema.superRefine`，同步更新 `packages/core/src/systems/commerce/quotes.ts` 的 `QuoteSelector` / `checkNarratedPurchase`。
    2. 在 `packages/core/src/systems/inventory/index.ts` 将公共 `gunsmith` 指令写入受管理的 `RuleModule`（否则 `extractRules()` 在 `packages/core/src/narrator/prompts/extract.ts` 启动校验会直接抛出 `这些指令没有写进任何规则模块`）。
    3. 在 `packages/core/src/narrator/stages.ts`（扩展 `BuyProposalSchema` 的 `.refine()`）、`packages/core/src/narrator/merchant-settlement.ts`（`purchaseQuote`、`purchaseCommand`、`commandProposal`）、`packages/core/src/narrator/turn.ts`（`KEY_ITEMS`）及 `JUDGE_STAGE`/`EXTRACT_STAGE` 提示词中接入 `"gunsmith"` 分支。

---

### 第 4 层：零掷骰定性战斗、潜行、物理与提示词集成

严格坚守「零掷骰定性裁决」与 `AGENTS.md`「文笔交给预设」原则，**不引入 HP、DPS、暴击率等 RPG 数值**，让改装件通过真实硬件属性改变物理边界与定性裁决：

1. **可读状态投影（`packages/core/src/systems/inventory/status.ts`）**
   - `inventoryStatus` 输出每把随身武器时，不再只写 `liberty（装着 strix-silencer）`，而是按可读硬件事实拼接：
     - 名称 + 区分标识（多把同款时显式带编号，如 `自由 #1`）、体系与品类（`威能手枪`）、当前品质（若已 `tunedRarity` 升阶则标注 `精调至稀有`）、有效隐蔽度（非 `pocket` 时标出 `需风衣遮掩` 或 `大件显眼`）、有效声学标签（装了枪口消音器标出 `已消音`）。
     - **已装配件逐条简述**：`[枪口] XC-10 施特里克斯（消音降噪）；[瞄准镜] 兼续（近距快瞄）`，保证 `judge` 与 `narrate` 无需翻目录表即可一眼读懂。

2. **物理、潜行与智能武器非阻塞定性钩子（`packages/core/src/narrator/prompts/context.ts` & `packages/core/src/physics.ts`）**
   - **重要设计约束（避免误封死 `ruling`）**：`evaluatePhysicsBoundaries`（`packages/core/src/physics.ts`）一旦收到 `input.ballisticMismatch` 就会将 `blocked` 设为 `true` 强制阻断行动，而当前 `ActiveFoeSchema` 与 `NpcSchema` 并不存储结构化 `ArmorGrade`；同时，没装手部智能连接握持智能武器仍可当作低效常规火器扣动扳机，不应硬性 `blocked`。因此，**声学特征、智能连接检查与枪械/插件穿甲特化均作为非阻塞客观物理事实（non-blocking factual directives）注入 `physicsSection`**，交由 `judge` 结合现场护甲/距离/掩体给出 `possible` / `costly` / `blocked` 定性裁决；`blocked = true` 仅保留给确定性硬约束（如城区长枪安检、`HIGH_END_VENUE` 门禁、缺接入仓）。
   - **声学特征钩子（`effectiveWeaponNoise`）**：近战武器与装配 `muzzle` 消音器的兼容武器判定为 `silent`，未消音枪械为 `loud`。在 `physicsSection` 注入当前随身武器消音情况，供 `judge` 与 `stealthRules`（`packages/core/src/systems/stealth/prompt.ts`）决定开火是否触发 `alert` / `witnesses` / `heat`。
   - **智能武器联锁校验（`smartLinkCheck`）**：当玩家携带 `smart` 武器时，`physicsSection` 纯硬件级检查 `CyberwareState.installed`（过滤掉 `health.brokenChrome`）是否含 `"smart-link"`，或武器实例是否自带/加装了 `grantsSmartLink` 模块（不依赖 `CharacterState.traits` 硬编码内容模块 ID，因 `packages/core/src/systems/character/schema.ts` 中 `TraitSchema` 仅保存 `{ slot, label, ability }`）。缺失或损毁时注入明确物理提示：「微陀螺弹头无法激活电子自导，只能作普通低精度直瞄使用」。
   - **隐蔽度与安检（`loadoutSummary` -> `evaluateDistrictSecurityCheck`）**：接通 `effectiveConcealment`，使外接消音器/长镜改变高安区与高端会所安检通过性。

3. **NPC 持械与战利品独立隔离（`packages/core/src/systems/combat/`、`packages/core/src/systems/npc/body.ts`）**
   - **`combat` 与 `inventory.objects` 解耦**：`combat/apply.ts` 仅修改 `CombatState`（`startCombat` 阶段不能写 `InventoryState.objects`，且提前注册会造成敌人逃跑/未拾取时残留 `"world"` 孤儿对象）。改为在 `ActiveFoeSchema` / `LeftLootSchema`（`combat/schema.ts`）中允许战利品条目附带可选定制规格或待物化定义（供 `combatView` 正确显示改造后名称），仅当玩家实际执行 `loot()` 拾取时才在 `item gain` 指令中携带 `definition`（含 `weaponState`）与 `origin` 一并写入 `InventoryState.objects`。
   - **NPC 持械展示**：`npc/body.ts` 的 `gearDetails` 直接读取 `items.get(id)?.name`，因此物化生成 `WorldObject` 时应在 `definition.name` 或 `bodyLine` 中清晰体现改造后名称与所装配件（例如 `自由（消音·全息镜）`），同时通过 `baseId` 保留原图映射。

---

### 第 5 层：UI 与交互流程设计

严格复用项目 2077 视觉规范（`Panel frame`、`CellFrame`、`NineSlice`、`fx.grid`、`--rar-*`、`--cp-yellow` / `--cp-cyan`、`useLayer` 栈、`Dialog` 确认弹窗），不破坏现有 HUD 角落折叠布局。

#### 5.1 全界面实例名称、图标与底图统一映射
- **名称防泄漏**：`InventoryPage` 通过 `view.names.items[id] ?? id` 解析名称（`NeuralPages.tsx`），因此 `namesView`（`packages/core/src/systems/inventory/names.ts`）与 `inventoryView` 必须覆盖所有 `wpn:*` 物化实例（多把同款时带区分标识如 `自由 #1`），严禁原始 ID `wpn:<baseId>:<seq>` 出现在任何界面。
- **4 处原图/图标解析统一接入 `baseId`**：`ITEM_ART` 与 `weaponHudIconOf`（`apps/web/src/features/story/art.ts`）目前只匹配目录模板 ID。后端视图投影须在 `inventoryView.details`、`carriedWeapons`、`shopsView.shelf`、`shopsView.sell` 以及 NPC `body.gear` 中透出 `baseId`（或直接由前端工具封装解析 `baseId ?? id`），覆盖以下全部 4 个界面入口：
  1. `Corners.tsx`（`Weapon` 块调用 `weaponHudIconOf(w.baseId ?? w.id, ...)`）
  2. `NeuralPages.tsx`（`InventoryPage` 调用 `itemArtOf(detail?.baseId ?? id)`）
  3. `Shop.tsx`（`ShopCatalogCard` 与 `ShopInspector` 展示 `sell[]` 与回购 `shelf[]` 时调用 `itemArtOf(item.baseId ?? item.id)`）
  4. `Profile.tsx`（`BodySection` 展示 `body.gear` 时调用 `itemArtOf(item.baseId ?? item.id)`）

#### 5.2 `InventoryPage`（`apps/web/src/features/story/NeuralPages.tsx`）— 武器中心化槽位面板
1. **武器详情页「槽位检视器」**：
   - 将当前零散的 `.gearMods` 小标签升级为**结构化槽位栏**（遍历该武器允许的 `modSlots`）：
     - **已装配槽位**：展示配件小图、名称、稀有度色条、一句能力摘要，并提供 `拆下` / `更换` 操作（若属 `lockedSlots` 则显示锁定标签与「需前往枪匠工坊改动」说明）。
     - **空余槽位**：内联展开或点击打开背包中所有兼容该武器该槽位的可用配件列表，一键调用 `onMod("attach", weaponId, modId)`；无兼容配件时提示「背包暂无可用`<槽位>`配件」。
     - **不支持槽位**：灰显提示客观原因（如「技术电磁武器不支持机械消音器」或「智能武器无光学瞄具导轨」）。
2. **配件详情页保留反向快捷装枪**：
   - 保留 `inventory.modTargets`，目标按钮文本使用区分实例后的名称（如 `装到 自由（未改装）` / `替换 自由 #1 的消音器`）。

#### 5.3 `Shop` 枪匠工坊页签（`apps/web/src/features/story/Shop.tsx` + `shop.module.css` + `StoryScreen.tsx`）
- **交互入口与门禁对齐**：
  - 在 `Shop.tsx` 中针对 `shop.kind === "gun" || shop.kind === "melee"`（及 `wilson`、`kabuki-arms`）增加第 3 个主模式页签 `武器工坊`（与 `买进货架`、`出手回收` 并列），复用商店头部、好感折扣、黑市标识、`eddiesBadge` 与 `useLayer(onClose, !confirming)`。
  - 在 `StoryScreen.tsx` 中为 `onGunsmith` 施加与 `onMod` 一致的严格门禁（`!busy && !offers?.rolled && !view.death && !view.ended && !view.combat.active`），当战斗中或骰检/回合挂起时，`武器工坊` 页签内明确显示禁用原因。
- **双栏工坊与透明确认**：
  - **左栏（武器与服务对象列表）**：列出随身携带的武器实例，展示稀有度色条、已装槽位概览与可升级档位标记。
  - **右栏（粘性 `Inspector`）**：展示 `fx.grid` 展台、品类/体系标签、改装前后隐蔽度与声学变化预览；支持「精调升阶」与「货架直装/锁定槽位拆改」，实时显示「配件费 + 工时费 = 实际应付」及余额预览。
  - **交易摘要对齐**：`ShelfItem` 与 `SaleItem` 均透出 `weaponState` 摘要（已装配件与精调档位），在 `ShopInspector` 与 `Dialog` 确认框中明确列出随枪配件与价格明细。

---

## 三、分步实施计划

每完成一个步骤均执行静态检查与 `git` 单独提交（按 `AGENTS.md` 不运行单元测试或集成测试）。

1. **步骤 1：核心数据模型重构与槽位兼容规则（`packages/core/`）**
   - 修改 `packages/core/src/systems/inventory/schema.ts`：新增 `WeaponInstanceStateSchema`，扩展 `WorldObjectSchema` 与 `ItemDefSchema`（`modSlots`、`modTypes`、`preInstalledMods`、`lockedModSlots`、`grantsSmartLink`），删除 `InventoryStateSchema` 中的旧 `mods` / `tuned` / `weapons` / `active`，新增 `defaultWeaponSlots`、`canAttachMod`、`effectiveConcealment`、`effectiveWeaponNoise`。
   - 修改 `packages/core/src/systems/inventory/apply.ts` 与 `events.ts`：重写 `applyMod`、`applyPlaceItem`、`applyItem`（校验 incoming `weaponState.mods`）、`lose` 与 `inventoryEvents`（归一化 `baseId` 防误报），实现按需物化拆分、拆空折叠还原，移除 `absorbLegacyWeapons`。
   - 同步更新所有 `InventoryState.weapons`/`mods`/`loadoutSummary` 调用方以保证静态类型闭环：`packages/core/src/narrator/scene-memory.ts`（`itemCount`）、`packages/core/src/state.ts`（传入 `objects`）、`packages/core/src/systems/safehouse/index.ts`（`住处与留置物品` 透出 `weaponState`）。
   - 更新 `packages/core/src/systems/inventory/view.ts`（`inventoryView`）、`names.ts`（`namesView`）与 `shops.ts`（`shopsView`），透出 `baseId`、`weaponState` 与完整实例命名。
   - 核验 `pnpm typecheck` 与 `pnpm check-data`，提交 git。

2. **步骤 2：枪匠单源报价、商业/叙事接线与内容扩充（`packages/core/` + `packages/content/`）**
   - 新建 `packages/core/src/systems/inventory/gunsmith.ts`（`quoteGunsmith`、`applyGunsmith`、`GunsmithCommandSchema`、`GunsmithActionSchema`），接入 `packages/core/src/actions.ts`。
   - 改造 `packages/core/src/systems/inventory/trade.ts`：支持定制 `WorldObject` 的对称回收/回购定价及多地点商店（`merchantAt`）位置校验。
   - 扩展 `packages/core/src/systems/commerce/schema.ts`（`QuoteTermsSchema.kind`、`OfferCommandSchema.superRefine`）与 `quotes.ts`；在 `packages/core/src/systems/inventory/index.ts` 为公共 `gunsmith` 注册 `RuleModule` 文档；更新 `packages/core/src/narrator/stages.ts`（`BuyProposalSchema`）、`merchant-settlement.ts`、`turn.ts`（`KEY_ITEMS`）及 `judge.ts` / `extract.ts` 提示词。
   - 扩充 `packages/content/src/items.ts` 与 `shops.ts`：为现有 9 件改装件补充 `modTypes` / `concealmentShift`，补齐适用于 `smart` 与 `blunt` 武器的插件，保证 `pnpm check-data` 零告警。
   - 核验 `pnpm typecheck`、`pnpm lint`、`pnpm check-data`，提交 git。

3. **步骤 3：物理、潜行、智能联锁与战利品集成（`packages/core/`）**
   - 升级 `packages/core/src/systems/inventory/status.ts`（`inventoryStatus`）输出可读武器体系、品质、隐蔽度、声学与配件能力摘要；收紧 `inventory/index.ts` `持续物件` section 过滤 `kind === "customized"`。
   - 改造 `packages/core/src/narrator/prompts/context.ts`（`physicsSection`）与 `packages/core/src/physics.ts`：接入 `effectiveConcealment` 安检联动，并以**非阻塞客观物理指令**形式注入 `weaponNoise` 声学事实、纯硬件 `smart-link` 义体/模块联锁检查与武器/插件战术能力参考。
   - 更新 `packages/core/src/narrator/prompts/catalogs.ts`（`extractCatalogDetails` 解析 `baseId` 与实例配件）、`packages/core/src/systems/combat/schema.ts` / `apply.ts` / `view.ts`（待物化战利品规格随 `loot()` 发出 `definition` + `origin`，不在 `startCombat` 污染 `objects`）以及 `packages/core/src/systems/npc/body.ts`（定制名称展示）。
   - 核验 `pnpm typecheck`、`pnpm lint`，提交 git。

4. **步骤 4：前端界面升级（`apps/web/src/features/story/`）**
   - 更新 `apps/web/src/features/story/art.ts`、`Corners.tsx`、`Profile.tsx` 与 `NeuralPages.tsx`，全量接入 `baseId ?? id` 原图/图标解析及实例区分显示，并在 `InventoryPage` 落地「武器中心化槽位检视器」（补齐 `story.module.css`）。
   - 扩展 `apps/web/src/features/story/Shop.tsx`、`shop.module.css` 与 `StoryScreen.tsx`，为武器/近战商店增加 `武器工坊` 页签，接入 `quoteGunsmith`、`weaponState` 摘要、`Dialog` 确认与严密门禁。
   - 运行 `pnpm typecheck`、`pnpm lint` 与 `pnpm check-data` 全量静态检查，提交 git，交由用户实机体验验收。

---

## 四、已确认的产品决策（2026-11-18 拍板：全部采用选项 A）

1. **Tier B「武器精调升级（`tunedRarity`）」的资源口径 — 已确认：选项 A**
   - 在枪匠处**纯欧元付费**精调（符合当前「物品栏精简·方案 A」已隐藏 `parts` 的方向，零多余收集资源负担）。
2. **Tier A「战外随手拆装」的自由度边界 — 已确认：选项 A**
   - 常规 `scope` / `muzzle` / `plugin` 保持战外随时免费装卸（不消耗回合）；仅高阶精调、解锁焊死槽位或智能联锁改装需找枪匠付工时费。
3. **是否引入武器损耗与维修（`condition`） — 已确认：选项 A**
   - 保持武器**免耐久损耗**（仅靠黑客 `weapon-glitch` 卡壳或剧情重击脱手等当轮/现场事件体现），避免给玩家增加频繁修枪的琐碎负担。
4. **自由文本（LLM 回合）的改装指令权限 — 已确认：选项 A**
   - 随手拆装继续放在 UI（`catalogSection` 保持「装卸在界面上做」），但对**枪匠交易/定制升级/剧情获赠预改枪**开放公共 `gunsmith`（与 `item.gain` `weaponState`）指令并经 `checkNarratedPurchase` 校验，兼顾流畅操作与自由叙事。
