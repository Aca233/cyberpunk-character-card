# 义体系统自由化重构计划（物理互斥组 + 世界观扩展 + 纯事实负荷 + 自创义体）

> 状态：已完成

## 目标

彻底解除“死板 2077 电子游戏部位格数上限”和生硬的“低/普通/高生理耐受三选一”，改造成贴合赛博朋克 2020 / RED / 2077 世界观的自由义体架构：
1. **取消部位总格数上限，改为物理互斥组（`exclusiveGroup`）**：支持接入仓 + 斯安威斯坦/狂暴双中枢、左右双臂混搭、腿部主驱 + 静音脚掌/暗格叠加，其余生活/感官/额叶/循环/手部/表皮辅助义体不限件数。
2. **扩充 2077 / RED 世界观义体（全部归入现有 10 个解剖部位）**：补齐感官与音频、时尚与生活义体（0 负荷）、亲密与双人感官同步义体、潜入暗格与工具指、外骨骼与全身义体化（FBC）。
3. **移除「低/普通/高耐受」三选一，切换纯事实神经负荷**：以实际装机的高压核心、双中枢并发、全身义体化 + 角色自身特质/缺陷 + 局内真实压榨/创伤/维护与心理锚点共同驱动神经状态。
4. **解剖图动态展示 + 创角内置「＋ 自创义体」**：`CyberDoll` 按实际已装义体动态展开绝不截断；创角义体货架支持直接手写、编辑、删除本地自创义体并即时装配生效。

## 分阶段任务

- [x] **阶段一：`packages/core` 重构义体物理互斥组并移除抽象耐受档位**
  - `systems/cyberware/schema.ts`：新增 `EXCLUSIVE_GROUPS`、`EXCLUSIVE_GROUP_LIMIT`、`EXCLUSIVE_GROUP_LABELS`、`exclusiveGroup` 字段与智能推断 `cyberwareExclusiveGroup(def)` + 冲突校验 `cyberwareConflicts(...)` + 事实负荷分析 `cyberwareLoadProfile(...)`。
  - `systems/cyberware/apply.ts`、`quote.ts`、`ripperdoc.ts`、`status.ts`、`prompt.ts`、`view.ts`：全量从 `SLOT_CAPACITY` 切到 `cyberwareConflicts`，输出纯事实神经负荷与双中枢/FBC 说明。
  - `systems/humanity/`：移除 `ToleranceSchema`、`TOLERANCE_LABELS`、`TOLERANCE_EFFECTS`、`SetToleranceSchema`、`humanity.setTolerance` 与 `tolerance` 字段，提示词改为结合高压义体负荷、角色背景与真实诱因裁决神经症状。
  - `systems/npc/body.ts`、`schemas/board.ts`、`schemas/character.ts`、`schemas/save.ts`、`game.ts`：同步移除 `tolerance` 并切到物理互斥校验；支持 `StartCyberware.exclusiveGroup` 与 `START_CYBERWARE_MAX = 64`。
- [x] **阶段二：`packages/content` 扩充世界观义体并清理预设角色 `tolerance`**
  - `packages/content/src/cyberware.ts`：新增感官音频、时尚生活、亲密与双人感官同步、工具指与暗格、外骨骼与全身义体化（FBC）等 18 款原作经典世界观义体（归入现有 10 部位，维克多自动上架，查尔斯同步补货）。
  - `packages/content/src/ripperdocs.ts` & `characters.ts`：查尔斯补货、移除 6 张预设角色卡的 `tolerance` 字段。
- [x] **阶段三：`apps/web` 更新动态解剖图、货架互斥交互、自创义体与纯事实负荷面板**
  - `features/story/CyberDoll.tsx` & `neural.module.css`：改为动态展示全部已装义体（自动换行不截断），`eyes` 显示「面部与感官」。
  - `features/characters/creator.ts`、`CustomCyberwareForm.tsx`、`CreatorSteps.tsx`、`CharacterCreator.tsx`、`characters.module.css`：移除「生理耐受 低/普通/高」三选一改展示纯事实负荷概览；义体货架改为物理互斥判定并新增「＋ 自创义体」（支持创建、编辑、删除并随角色卡保存生效）。
  - `features/story/Ripperdoc.tsx` & `view.ts` & `api/client.ts`：同步更新视图类型、互斥替换提示与神经状态说明。
- [x] **阶段四：全仓校验**
  - 通过 `biome lint .`（0 error / 0 warning）、5 包 `tsc --noEmit` 与 `tsx tools/check-data.ts`。
