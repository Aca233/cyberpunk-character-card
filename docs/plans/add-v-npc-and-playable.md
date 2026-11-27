# 将 V（瓦莱丽 / 文森特）加入夜之城计划

- **状态**：已完成（2026-11-27）
- **已确认设计决策**：
  1. **双重身份 + 自动去重**：V 既作为原作 NPC（`id: "v"`）活跃在夜之城，也可作为预设主角直接扮演；当玩家扮演 V 时，系统自动跳过 NPC 版 `v` 及其自指关系，绝不刷出两个 V。
  2. **NPC 版单卡一键切换**：世界里只有一个 `id: "v"`，默认**女 V（瓦莱丽）**；在建档「人脉与旧识」选中 V 时，顶栏可直接一键切换 **女 V（瓦莱丽）⇄ 男 V（文森特）**（复用 `board.npcOverrides` 与同一套关系网/支线）。
  3. **主角预设单卡合一 + 自由调配（不再塞多张重复 V 卡）**：角色库里只放 **1 张「V」预设角色卡**；点进建档工作台后，顶部直接提供 **「V 预设调配条」**，支持 **一键切换性别（女 V 瓦莱丽 / 男 V 文森特）× 一键切换三出身（街头小子 / 流浪者 / 公司员工）**，切完后仍可像普通角色一样自由微调外貌、义体、武器、载具与旧识。
  4. **时间线定位**：贴合 `2077-04-12` 偷货前夕——开局尚未装上 Relic、脑内还没有强尼；后续随大事件发酵或玩家介入，既可能演变成绀碧劫案与强尼风波，也能被玩家彻底改写。
  5. **纳入增强项**：#2 偷货前夕大事件联动、#3 标志装备 `终夜` 与 H10/老维赊账还原、#4 完整三出身（收拢进单张 V 卡一键切换）、#5 沃森/来生街头偶遇（不生成新立绘头像）。

---

## 一、详细实施内容

### 1. 原作 NPC 版 V + 男 V 变体 + 关系网 + 支线 + 偶遇（`packages/content`）
- **`packages/content/src/npcs.ts`**：
  - 新增 `id: "v"`（默认女 V 瓦莱丽，`alias: "V"`，23 岁，圈层 `merc`，常驻 `megabuilding-h10`，常去 `afterlife` / `viktor-clinic` / `el-coyote-cojo` / `lizzies-bar`），随身配招牌不朽手枪 `dying-night`（终夜）+ 实用街头装备与 `kiroshi-mk1` / `ballistic-coprocessor` 等基础义体。
  - 同处导出 `vMaleNpcVariant`（与 `v` 同 `id: "v"`，完整手写男 V 文森特的外貌、穿着、口吻与示范台词），供「人脉与旧识」一键切换。
- **`packages/content/src/npcTies.ts`**：
  - 建立 `v` 与 `jackie` / `viktor` / `misty` / `t-bug` / `wilson` / `mama-welles` / `dex` 的双向初始关系网。
- **`packages/content/src/arcs.ts`**：
  - 新增 `v` 的两条心事支线：
    - `v-heist-crossroads`（大联盟的敲门砖）：呼应杰克的 `jackie-bigjob` 与米丝蒂的 `misty-cards`，开放走向（接大单触发绀碧风波与 Relic 变局 / 被预警放弃 / 与玩家合作或抢单）。
    - `v-viktor-debt`（老维诊所的赊账单）：V 记挂着还清维克多垫付的义眼与接口费用。
- **`packages/content/src/lore.ts`**：
  - 在第 2 阶段（沃森收紧 / 德克斯回城）与第 4 阶段（绀碧惊变）的「幕后 / 交集」自然呼应杰克、T-Bug 与 V 这支新锐佣兵小队的动向（并明确：若玩家自己扮演 V 则由玩家主导，绝不强行照搬）。
- **`packages/content/src/encounters.ts`**：
  - 新增 2 条沃森/来生街头风味偶遇（如老维诊所外或来生门口撞见 V 与杰克收活拌嘴 / 聊大买卖），注明仅在世界存在 NPC 版 V 且主角并非 V 时触发。
- **`packages/content/src/openings.ts` & `packages/core/src/narrator/canon.ts`**：
  - 移除硬编码的「主角不是 V」文案，改为中性的自由沙盘声明。

### 2. 单张统一 V 预设主角卡 + 2×3 一键调配（`packages/content` + `apps/web`）
- **`packages/content/src/characters.ts`（并从 `packages/content/src/index.ts` 导出）**：
  - 新增 `buildVCharacterCard(gender: "female" | "male", origin: "street-kid" | "nomad" | "corpo")`，覆盖 2 性别 × 3 出身的完整外貌、背景故事、性格、口吻、特长、主板模块、基础义体、开局行装（含招牌手枪 `dying-night` 与匹配载具）、H10 起步与旧识（杰克/维克多/米丝蒂/T-Bug/威尔逊；公司出身保留与杰克多年老交情、流浪出身贴合刚进城搭伙）。
  - `sampleCharacters` 只新增 **1 张** 预设 V 卡（默认 `buildVCharacterCard("female", "street-kid")`），绝不刷屏角色库。
- **`apps/web/src/features/characters/CharacterCreator.tsx`**：
  - 当正在编辑的角色卡 `replacesNpcId === "v"` 时，在第一步（身份与出身）顶部展示紧凑的 **「V 预设快速调配」** 条：
    - 性别：`女 V · 瓦莱丽` | `男 V · 文森特`
    - 出身：`街头小子` | `流浪者` | `公司员工`
  - 一键切换即同步替换对应组合的完整文案、主板模块、装备、义体与旧识，切完后仍可继续自由改任何细节，点开局直接生效。

### 3. 扮演 V 去重 & NPC 端一键切男/女 V（`packages/core` + `packages/runtime` + `apps/web`）
- **`packages/core/src/schemas/character.ts` & `save.ts`**：
  - `CharacterCardSchema` 与 `SaveCharacterSchema` 新增可选字段 `replacesNpcId?: string`（V 预设卡标记 `"v"`）。
- **`packages/core/src/game.ts`**：
  - `newGameWorld` 检测 `meta.character.replacesNpcId`（并对玩家手写名叫 `V` / `瓦莱丽` / `文森特` 或代号 `V` 做兜底识别 `"v"`），自动从 `cast`、`npcOverrides`、`acquaintances`、`initialTies` 中排除 `"v"`，确保绝不出现两个 V。
  - 偶遇/世界背景里同步尊重去重结果（无 NPC `v` 时自然不触发 NPC 版 V 偶遇）。
- **`packages/runtime/src/routes/characters.ts` & `apps/web/src/api/client.ts`**：
  - `GET /api/characters/board/npcs/:npcId` 支持 `?variant=male` 拉取 `vMaleNpcVariant`。
- **`apps/web/src/features/characters/CreatorLife.tsx`**：
  - 接收当前 `replacesNpcId`：扮演 V 时在「人脉与旧识」中自动隐藏 NPC `v` 防自选；
  - 扮演非 V 角色并选中 `id === "v"` 时，详情卡顶栏直接显示 **「切为男 V（文森特）」⇄「切回女 V（瓦莱丽）」** 一键切换按钮。

---

## 二、验证计划

- `biome lint packages apps tools functions`（0 error / 0 warning）
- 全量 6 份 `tsc --noEmit`
- `tsx tools/check-data.ts`
- `tsx` 冒烟验证：
  1. 原创角色开新档：NPC 版 `v`（默认女 V 与切换男 V 覆写）正确入局，与杰克/维克多/米丝蒂/T-Bug/德克斯双向关系生效；
  2. 6 种 V 主角组合（2 性别 × 3 出身）全部通过 `CharacterCardSchema` + `boardStart` + `newGameWorld`，自动去重 NPC 版 `v` 且无自指关系。
