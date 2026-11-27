# 同行搭档小队作战与委托分账闭环计划（复用原 NPC 机制版）

- **状态**：已完成（2026-11-27）
- **核心原则**：**绝不在 `combat` 里另起一套重复的同伴状态或指令**。同伴的随行（`following`）、受伤（`npcHurt`）、治疗（`npcHeal`）、生死（`npcDeath`）、武装（`body.gear` / `body.cyberware`）与欠账/仇怨（`ledger`）全部继续以原本的 **`npc` 系统为唯一真相源**，只把 `combat` 和 `jobs` 真正接通到 `npc` 上。

---

## 一、小队并肩作战（纯直连原 `npc` 机制，零新指令、零状态副本）

1. **战斗视图与状态实时直读 `npc`（`combat/view.ts` & `combat/status.ts`）**
   - 不在 `CombatState` 中重复存储 `allies` 副本，也不新增 `combat ally` 指令；
   - 开战期间，`combatView` 与 `combatStatus` 直接从 `world.slices.npc` 实时投影当前 `following && alive`（且未列入 `foes`）的同行搭档，展示其名字、行当、**实时武装/义体摘要**与**当前伤情（来自 `npcHurt`）**。
2. **开战反水防呆（`combat/apply.ts`）**
   - `combat start` 若发现某位原本 `following === true` 的 NPC 被列入 `foes`（当场反水），自动发出 `npcCompanion(following: false)` 解除随行。
3. **战斗提示词明确复用原 `npc` 指令（`combat/prompt.ts`）**
   - Judge：裁决交火优势时，明确将当前同行搭档（`npc.following`）的武器、义体、人数及现有伤情算进我方真实战力，不写成主角单刷；
   - Narrate / Extract：同伴在战斗中受伤、重伤倒地、阵亡或中途撤离，**直接发原本的 `npcHurt`、`npcDeath`、`npcCompanion(following: false)`**，与非战斗场景完全统一。
4. **前端战斗角标透出（`apps/web/src/features/story/Corners.tsx`）**
   - 战斗中在状态角标里直接显示同行参战搭档名字与实时伤情警示（直接取自 `combatView` 投影）。

---

## 二、委托入伙与分账（轻挂 `jobs` + 复用原 `npc` 的 `ledger` 与 `memory`）

1. **委托成员与分成协议（`jobs/schema.ts`、`jobs/apply.ts`、`jobs/index.ts`）**
   - `JobSchema` 新增轻量 `crew: JobCrewMemberSchema[]`（`npc` / `name` / `role` / `cutPercent: 0–80` / `paid` / `status: "joined" | "paid" | "shorted" | "left"`）与 `settlement.playerNet`；
   - 新增 `jobCrew`（`join` / `leave`）：校验人物已结识、存活、无未解死仇（`grudge`）、总分成不超过 `90%`。
2. **`jobEnd` 自动分账 + 直接写入原 `npc` 账本**
   - `jobEnd.paid` 仍记这单总回款，代码按在队成员的 `cutPercent` 自动算分成，玩家钱包精确入账扣除分成后的净到手金额；
   - 若剧情中玩家故意克扣/黑吃黑（可选传 `crewPayouts` 低于约定份额），系统自动将该成员标为 `shorted`，并**直接发出原 `npc` 系统的 `ledger(kind: "youOwe")` 与 `memory`** 写入该 NPC 原本的欠账与记忆，不另造欠账系统。
3. **提示词与委托面板透出（`jobs/prompt.ts`、`jobs/view.ts`、`apps/web/src/features/story/NeuralPages.tsx`）**
   - 【委托】上下文与局内委托卡展示每单的入伙搭档、分工、分成% 与结单后的总回款/净到手明细。

---

## 三、拟改动文件清单（待确认后动工）

- `packages/core/src/systems/combat/apply.ts`（仅反水解除随行）
- `packages/core/src/systems/combat/prompt.ts`（提示词直连原 `npcHurt` / `npcDeath` / `npcCompanion`）
- `packages/core/src/systems/combat/status.ts` & `view.ts`（实时直读 `npc` 随行者与武装/伤情）
- `packages/core/src/systems/jobs/schema.ts`、`apply.ts`、`index.ts`、`prompt.ts`、`view.ts`（`jobCrew` + `jobEnd` 自动分账联动原 `npc` `ledger`/`memory`）
- `apps/web/src/features/story/Corners.tsx` & `NeuralPages.tsx`（战斗同伴徽章 + 委托分账展示）

## 四、验证计划

- `biome lint packages apps tools functions`（0 error / 0 warning）
- 全量 6 份 `tsc --noEmit` + `tsx tools/check-data.ts`
- `tsx` 冒烟验证：
  1. 杰克/V 随行时 `combat start` → `combatView` 实时投影其武装与 `npcHurt` 伤情（零副本状态）；反水入 `foes` 时自动解除 `following`；
  2. `jobCrew join` 拉杰克（30%）与 T-Bug（20%）入伙 → `jobEnd(paid: 10000)` 玩家净入账 `5000 €`；少给钱（`crewPayouts`）时自动写入原 `npc` 的 `ledger(youOwe)` 与 `memory`。
