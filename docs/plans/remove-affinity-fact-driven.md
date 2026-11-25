# 移除数字好感度、全面切换纯事实关系驱动改造计划

> 状态：已完成

## 目标

彻底移除 `-100 ~ +100` 数字好感度（`affinity`）、加减分指令与好感进度条，让所有人际关系完全由**真实事实**驱动：
- **共同经历**（`memories`）：你们一起干过什么事、他亲眼见过你怎么做人；
- **人情与仇怨账本**（`ledger`）：谁欠谁人情（`owesYou` / `youOwe`）、谁记着你的仇（`grudge`）、是否已结清；
- **关系定性**（`relation`）：当下你们是什么关系的一句话自然描述；
- **知情边界**（`known` / `learn`）：他实际知道你干过哪些事、握着什么底细；
- **人际网与势力立场**（`ties` + `factions`）。

## 分阶段任务

- [x] **阶段一：`packages/core` 核心移除 `affinity`**
  - `systems/npc/`：移除 `Npc.affinity`、`affinity` 指令与提案、`AFFINITY_MIN/MAX/STEP_CAP`；提示词明确要求模型基于 `relation`、`memories`、`ledger`、`known` 判断对方态度，不再依赖好感分；场外推演 `offscreen-social.ts` 同步改用纯事实 `relationBrief`。
  - `systems/arcs/`：`ArcUnlock` 去掉 `affinity` 门槛，改为仅基于共同记忆条数（`memories`）且对玩家无未解死仇（`grudge`），由模型按实际关系决定何时交心。
  - `systems/jobs/`：去掉 `trustNote(affinity)` 与 `FixerCard.affinity`，中间人提示词与视图直接透出真实 `relation`、未结 `ledger`（人情/仇怨）与共同记忆数量。
  - `systems/phone/` & `phone-chat.ts`：彻底移除繁琐的「单场私信防刷好感预算」与 `affinity` 抽取，保留 `memory` / `relation` / `ledger` / `learn` 等纯事实抽取。
  - `systems/economy/`、`inventory/`、`cyberware/`、`fallout/`、`factions/`：移除 `Keeper.affinity`、`keeperAffinity`、交易自动发 `affinity +1`（改记事实 `memory`）；`fallout` 改以记入 `ledger(grudge)` 作关系后果触发；`ledger.ts` 去掉好感数值追踪。
  - `schemas/`（`board.ts`、`character.ts`、`save.ts`）、`authoring/schema.ts`、`game.ts`：开局旧识不再转成 `+30 / -30` 分数，直接映射为初始 `relation`（如「老朋友」「点头之交」「前任」）与初始 `ledger`（人情/旧仇）。
- [x] **阶段二：`packages/content` 与 `tools/` 同步清理**
  - `packages/content/src/arcs.ts`：去掉 12 份心事种子的 `unlock.affinity`。
  - `packages/content/src/npcs.ts` & `npcsExtra.ts`：清理残留 `affinity` 字段。
  - `tools/action-baseline.ts` & `tools/objectives-check.ts`：同步清理。
- [x] **阶段三：`apps/web` 前端界面升级为纯事实关系展示**
  - `Profile.tsx`：移除 `AffinityMeter`、`formatAffinity`、`affinityTone`；新增基于真实事实（`relation` + 未结 `ledger` + `memories` + 宿敌）的 `npcRelationTag` 与关系摘要胶囊。
  - `Corners.tsx`、`TrackerPanel.tsx`、`Phone.tsx`、`Settlement.tsx`、`Shop.tsx`、`Ripperdoc.tsx`、`view.ts`、`CreatorLife.tsx`：全部移除好感度数字/进度条展示，改为呈现真实 `relation` 定性、人情/仇怨徽标与共同经历。
- [x] **阶段四：全仓校验**
  - 通过 `biome lint .`（0 error / 0 warning）、5 包 `tsc --noEmit` 与 `tsx tools/check-data.ts`。
