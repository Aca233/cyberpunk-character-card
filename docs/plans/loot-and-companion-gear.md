# 战后战利品一键拾取 + 同行搭档装备交接计划

- **状态**：已完成（2026-11-27）
- **目标**：
  1. 补齐战后现场战利品的前端可视化与零模型开销一键拾取（复用现有 `combat loot` 与 `combat.groundLoot`）；
  2. 补齐与身边同行搭档（`npc.following`）的原子装备/物品交接（复用现有 `item(lose/gain)` + `npcGear(add/remove)`，完整保留改装枪配件与物件归属）。

---

## 一、战后现场战利品可视化与一键拾取（`combat` + 物品栏/角标）

### 1. 核心操作与视图（`packages/core/src/systems/combat/`）

- **`combat/view.ts`**：丰富 `combatView.loot` 每件掉落物的信息，补充 `kind`、`rarity`、`iconic`、`ability`（继续复用 `formatWeaponWithMods` 展示已装配件名）。
- **`combat/actions.ts`（新增，挂到 `combat/index.ts` 的 `actions`）**：
  - `lootCombatItem`（`{ type: "lootCombatItem", from: string, item: string }`）：校验非战斗（或战斗中目标已倒地且在原地）、玩家意识清醒（`health.condition === "up"`），直接发出 `{ type: "combat", action: "loot", target: from, item }`；
  - `lootCombatAll`（`{ type: "lootCombatAll", from?: string }`）：一键拾取当前地点指定目标或全部未拾取战利品，逐件转为 `combat loot` 原子结算（不调用模型、自动同步扣除 NPC 随身 `npcGear`）。

### 2. 前端界面（`apps/web/src/features/story/`）

- **`Corners.tsx`**：当当前地点存在未拾取战利品时，在右下角物品栏卡片上显示醒目的「战利品 N」提示徽章，点击直达物品栏。
- **`InventoryPage.tsx`**：当 `view.combat.loot.length > 0` 时，在物品栏内直接展示 **「现场战利品」区块**：
  - 按倒地/阵亡敌人分组列出可拾取武器（带稀有度色、改装配件名与效果说明）、治疗品、手雷与电子物件；
  - 支持每件点击 **「拾取」**，以及顶部 **「一键全部拾取」**（战斗中禁用并提示在行动里描述）。

---

## 二、同行搭档装备与物品交接（`npc` + `inventory` + 物品栏）

### 1. 核心原子交接操作（`packages/core/src/systems/npc/actions.ts`）

- 新增 `npcExchangeGear`（`{ type: "npcExchangeGear", id: string, action: "give" | "take", item: string }`）：
  - **前置校验**：非战斗状态、玩家清醒（`health.condition === "up"`）、目标 NPC 存活且 `following === true` 且在当前现场（`onStage`）；
  - **`give`（递给同伴）**：校验玩家背包持有该物品且同伴 `body.gear.length < NPC_GEAR_MAX` 且尚未持有同 id 物件，原子发出：
    1. `{ type: "item", action: "lose", id: item, recipient: npc.id, reason: "交给同行同伴" }`（同步转移定制改装武器 `worldObjects.holder` 到 `npc.id`）；
    2. `{ type: "npcGear", id: npc.id, action: "add", item }`（写入同伴 `body.gear`，自动反映到战斗同行武装摘要；若失败整笔事务原子回滚，不丢物品）。
  - **`take`（从同伴取回）**：校验同伴 `body.gear.includes(item)`，原子发出：
    1. `{ type: "npcGear", id: npc.id, action: "remove", item }`；
    2. `{ type: "item", action: "gain", id: item, reason: "从同行同伴处取回" }`（定制武器归属同步切回 `"player"`）。

### 2. 前端界面（`apps/web/src/features/story/InventoryPage.tsx` & `StoryScreen.tsx`）

- **`StoryScreen.tsx`**：接通 `onLootCombatItem`、`onLootCombatAll`、`onExchangeCompanionGear` 三个即时动作回调（走统一的 `api.act` 即时动作通道）。
- **`InventoryPage.tsx`**：
  - 在「随身物品」详情动作栏中：若身边有同行同伴，提供 **「交给 [同伴名]」** 按钮（多同伴时直接列出对应按钮）；
  - 在物品栏顶部容器切换栏中：若有身边同行同伴，新增 **「同行 · [同伴名]」** 视角标签，点开即可直接看到该同伴当前的随身武器/装备并一键 **「取回背包」**，直观完成小队换装与补给分配。

---

## 三、拟改动文件清单（待确认后动工）

- `packages/core/src/systems/combat/actions.ts`（新增）
- `packages/core/src/systems/combat/index.ts`
- `packages/core/src/systems/combat/view.ts`
- `packages/core/src/systems/npc/actions.ts`
- `packages/core/src/ui-actions.ts`（若行动联合类型自动从 `registry` 派生则核对是否需同步）
- `apps/web/src/features/story/Corners.tsx`
- `apps/web/src/features/story/InventoryPage.tsx`
- `apps/web/src/features/story/StoryScreen.tsx`

## 四、验证计划

- `biome lint packages apps tools functions`（0 error / 0 warning）
- 全量 6 份 `tsc --noEmit` + `tsx tools/check-data.ts`
- `tsx` 冒烟验证：
  1. 战斗结束后 `lootCombatItem` / `lootCombatAll` 正确将带改装配件的武器与消耗品收入背包并清空对应 `groundLoot`；
  2. `npcExchangeGear(give)` 将带改装件的定制武器交给同行杰克，`worldObjects.holder` 切为 `"jackie"` 且进入 `jackie.body.gear` 与战斗同行武装摘要；`npcExchangeGear(take)` 无损取回玩家背包且保留原配件。
