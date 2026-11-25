# 高自由度势力沙盒三件套设计计划（全链路 NPC 真实联动版）

> 状态：已完成并通过全仓静态检查与数据校验

## 核心原则

1. **绝不空口无凭，全链路绑定真实 NPC**：入帮必须有活着的本势力引荐人/拍板人；帮规污点必须挂具体追责人；内部派系直接绑定真实领袖与骨干 NPC；关键人物死亡（`npc.died`）自动在代码里触发靠山失势、掌权派动荡与地盘震荡。
2. **高自由度、不逼打卡**：不设强制倒计时帮务；去掉「必须先刷到友好」的入帮硬锁（中立状态只要搞定该势力活人拍板即可入伙）；无论是否入帮都能搅动内部派系和抢地盘。

## 方案拆解

### 1. 架构打通：`factions` 依赖 `npc` + 监听 `npc.died`

- [x] `packages/core/src/systems/factions/index.ts`：
  - 将 `dependsOn` 设为 `["npc"]`（`npc` 仅依赖 `world`，无任何循环依赖）。
  - 注册 `on: { "npc.died": onNpcDied }` 信号处理器：每当任何有卡 NPC 死亡时自动检查：
    1. 若死者是玩家当前帮派的**引荐人/靠山（`membership.sponsor`）**：标记靠山已亡（`sponsorAlive: false`），并在状态与提示词中反映帮内失势/派系动荡；
    2. 若死者是某势力**当前掌权派系的领袖**（如 `royce`、`hansen`、`saul`、`brigitte`、`saburo`、`yorinobu`、`hanako`）：自动将该势力派系状态标记为「领袖身亡 · 权力真空/动荡」（`vacant: true`），提示模型下一轮可顺势触发内部争权、对立派上位或地盘易手。

### 2. 自由入帮（可选靠山联动）+ 轻量「帮规污点」账本

- [x] **松绑入帮门槛 + 可选靠山 `sponsor`**（`schema.ts`、`apply.ts`、`view.ts`）：
  - `join` 取消「必须先到 friendly」的硬锁，仅拦截 `hostile` / `kos`；
  - `sponsor` 设为**可选**（不强制同势力，不设硬性好感分数门槛）：
    - 若剧情是经熟人/老大/中间人引荐入伙，传入 `sponsor`（校验有卡且活着），自动绑定靠山关系；此后靠山死亡会通过 `npc.died` 触发「靠山已亡 · 帮内震荡」，且该 NPC 的提示词档案也会透出这层引荐关系；
    - 若剧情是走公司招聘、面试、签约或硬实力混进尚无预制人物卡的势力，可不填 `sponsor` 直接入伙，绝不卡死自由度。
- [x] **帮规污点账本 `strikes`（0–3）**（`schema.ts`、`apply.ts`、`status.ts`、`events.ts`、`prompt.ts`）：
  - `membership` 新增 `sponsor?: string`、`sponsorLost?: boolean`、`strikes: { at, reason, byNpc? }[]`；
  - 新增 `action: "strike"`（记一笔污点，可附追责人物 `byNpc`）与 `action: "clearStrike"`（立功/赔罪/打点消一笔污点，可附受理人 `byNpc`）；
  - 1 笔警告 / 2 笔最后通牒或盯梢 / 3 笔自动除名并打入 `kos`（清理门户，若有在世追责人/管事人则在提示词中点名由其带队清算）。

### 3. 大势力内部双派系 ↔ 真实领袖与骨干 NPC

- [x] **6 大势力双派系配置（直绑原作 NPC ID）**（`packages/content/src/factions.ts`）：
  - 荒坂：`hawk` 鹰派（`yorinobu`、`smasher`）vs `kiji` 雉派（`hanako`、`saburo`、`takemura`）
  - 阿德卡多：`saul-line` 稳健派（`saul`、`dakota`）vs `panam-line` 激进派（`panam`、`mitch`、`carol`）
  - 漩涡帮：`royce-line` 硬派（`royce`、`dum-dum`）vs `brick-line` 旧部（支持动态建卡 `brick` 等）
  - 巫毒帮：`brigitte-line` 深网派（`brigitte`）vs `placide-line` 强硬治安派（`placide`）
  - 幽冥犬：`hansen-line` 军管派（`hansen`）vs `pragmatist-line` 黑市务实派（支持动态建卡新话事人）
  - 虎爪帮：`elders-line` 元老堂口（`wakako`）vs `new-blood-line` 新派扩权（支持动态建卡新若头）
- [x] **派系掌权、站队与政变**（`schema.ts`、`apply.ts`、`status.ts`、`threats.ts`、`prompt.ts`）：
  - `FactionsState` 新增 `wings: Record<string, { ruling, leaderNpc?, vacant?, playerSide?, note, at }>`。
  - 新增 `action: "wing"`：记录玩家站队（`side`）或政变扶植新派掌权（`ruling` + 活着的 `leaderNpc`）；若指定掌权派的现有领袖全亡且未传入活着的接班 `leaderNpc`，代码拦截空口易主！
  - `packages/core/src/systems/npc/sections.ts`：在 NPC 提示词档案里透出该 NPC 与玩家的势力/派系关系（如「你的入帮引荐人」「同属荒坂·鹰派」「对立派系」），让对话与态度天然连贯。

### 4. 玩家主导的地盘争夺战（`turf` 直写 + 真人坐镇/斩首联动）

- [x] **地盘争夺账本**（`schema.ts`、`apply.ts`、`turf.ts`、`threats.ts`、`inventory/mood.ts`）：
  - `FactionsState` 新增 `contested: Record<string, { factions: string[], reason, triggerNpc?, at }>`，扩展 `faction` 指令支持 `action: "turf"`（`district`、`change: "contest" | "gain" | "lose"`、`leadNpc?`、`reason`）。
  - 玩家在某区端据点、拔掉该势力关键头目或带队进驻时，可直接把城区打成「火拼争夺中（`contested`）」或当场易主（`told: true`，并校验若带 `leadNpc` 须为真实有卡人物）。
  - 处于「火拼争夺中」的城区：地盘提示词进入高危戒严/交火余波氛围；该区商店因货路受阻全区微涨 `15%`（不锁交易）；易主后立刻切换巡逻势力、威胁与地盘红利。

### 5. 前端势力面板联动升级（`FactionsPanel.tsx` & `story.module.css`）

- [x] 势力卡片直接展示：
  - **所属关键人物芯片**（直接读取 `view.npcs` 里该势力的已识/在册 NPC，标出活/死、靠山徽章、派系归属）；
  - **内部派系现状条**（当前掌权派、是否领袖阵亡权力真空、玩家当前站队）；
  - **污点状态条**（若为正式成员且有污点，直观展示 `警告 1/3` 等）；
  - **城区争夺标记**（顶部栏与地盘行标出「火拼争夺中」）；
  - **点名真人的快捷草稿按钮**：如「找朱迪谈入伙」「帮帕南这派站队」「找索尔销污点」「策划端掉漩涡帮沃森据点」，让操作自然落在具体人物和具体地盘上。

### 6. 校验

- [x] 运行 `biome lint .`、5 包 `tsc --noEmit` 与 `tsx tools/check-data.ts`。
