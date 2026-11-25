# NPC 与预设角色义体配置同步升级计划

> 状态：已完成

## 目标

配合自由义体架构（物理互斥组 + 18 款 2077/RED 世界观新义体 + 去抽象耐受档位）：
1. 放宽 `NPC_CHROME_MAX`（`8 → 14`）并同步更新 `npc/schema.ts` 与 `npc/prompt.ts` 中关于义体物理互斥的规则说明。
2. 为 74 位原作 NPC 中符合设定的 58 位核心人物补齐原作标志性改造（如亚当·重锤的 `dragoon-fbc-chassis` + 双臂重武装 + 军用斯安威斯坦，利琪·薇兹与宋素美的 `gemini-fbc-frame`，帕南/米契/蝎子的 `neural-sync-bridge`，云顶/莫克斯/偶像圈的时尚/感官/亲密义体，特工/中间人/记者的音频/测谎/隐蔽链路与暗格），同时严守克莱尔、米丝蒂、威尔斯太太、德拉曼零植入原作设定。
3. 升级 6 位官方预设角色卡：清理残留“低耐受/高耐受”文案，并按各自人设搭配新款世界观义体与无上限叠加组合（如强化肌腱 + 猞猁爪、多功能技师工具指、音频套件、军用外骨骼等）。

## 分阶段任务

- [x] **阶段一：更新 `packages/core/src/systems/npc/` 义体上限与提示词**
  - `schema.ts`：`NPC_CHROME_MAX` 从 `8` 调至 `14`，更新 `NpcChromeSchema` 说明。
  - `prompt.ts`：更新 `npcRules` 中关于义体互斥与生活/感官义体的说明。
- [x] **阶段二：升级 74 位原作 NPC 义体配置**
  - `packages/content/src/npcs.ts`、`npcsExtra.ts` & `everydayLife.ts`：共更新 58 位原作人物，按原作设定补齐 FBC、外骨骼、双臂重武、神经直连、感官/时尚/亲密与暗格工具义体。
- [x] **阶段三：升级 6 位预设角色卡**
  - `packages/content/src/characters.ts`：`chrome()` 透传 `exclusiveGroup`，清理残留“低/高耐受”文案，按流派配置新款世界观义体。
- [x] **阶段四：全仓校验**
  - 通过 `biome lint .`（0 error / 0 warning）、5 包 `tsc --noEmit` 与 `tsx tools/check-data.ts`（含全部 74 NPC 开局校验与 6 预设角色校验）。
