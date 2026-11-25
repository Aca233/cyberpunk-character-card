# 轻量级势力机制完善与「加入势力」实施计划

## 目标

在不引入复杂数值表与繁重面板的前提下，补齐势力系统的 7 处短板，保持「模型当主持人，代码管记账与硬约束」的轻量手感：
- [x] **阶段一：核心势力系统支持「加入 / 晋升 / 脱离」与盟友联动（`packages/core/src/systems/factions`）**
  - `schema.ts`：`FactionsState` 新增可选 `membership: { faction, rank, joinedAt, note } | null`（单归属，防止脚踏多船）；`FactionCommandSchema` 兼容扩展 `action?: "stance" | "join" | "rank" | "leave"`、`rank?`、`betrayal?`；新增内部开局初始化指令 `faction.seed`。
  - `apply.ts`：
    - `join`：须未隶属其他势力且该势力态度已达 `friendly` 或 `family`；入帮自动抬至 `family`，敌对势力拉至 `hostile`，中立盟友给面子升至 `friendly`。
    - `rank`：帮内晋升/调整头衔。
    - `leave`：和平退出或叛帮（`betrayal: true` 直接跌至 `kos`）；若成员态度被降至 `hostile`/`kos` 则自动除名。
    - `stance`：对头连带降档保留；恶化到 `kos` 时，其 `friendly`/`family` 盟友轻度连带降 1 档（最低到 `neutral`）。
  - `threats.ts` / `status.ts` / `view.ts` / `events.ts` / `prompt.ts`：区分 `friendly`、`family` 与正式 `member` 待遇与提示词文案；补强防漏记与入帮/退帮指引；事件播报支持加入、晋升、退帮/除名。
- [x] **阶段二：开局出身联动、成员店价与原作暗线关系**
  - `packages/content/src/factions.ts`：补齐荒坂↔虎爪帮等原作核心盟友关系。
  - `packages/core/src/game.ts`：`newGameWorld` 按角色开局出身发放轻量 `faction.seed` 初始态度（如流浪者→阿德卡多友好、叛逃企业网行者→荒坂敌对、前 NCPD→NCPD 友好、创伤小组前外勤→创伤小组友好、公司狗→荒坂友好等）。
  - `packages/core/src/systems/inventory/mood.ts`：正式成员在所属势力店主的店铺享有 `0.75` 折内部价（优于 `family` 0.8 折与 `friendly` 0.9 折）。
  - `packages/core/src/systems/jobs/prompt.ts`：区分所属势力正式成员与普通友好关系。
- [x] **阶段三：前端势力页轻量升级（`FactionsPanel.tsx` & `StoryScreen.tsx`）**
  - 顶部显示当前势力归属与头衔（或「自由佣兵」）；已加入势力卡高亮徽章；
  - 卡片底部提供轻量快捷草稿按钮（申请加入 / 找帮内照应 / 找门路摆平 / 打听动静），一键写入输入框不增加任何复杂弹窗。
- [x] **阶段四：静态检查与验证**
  - 运行 `biome lint .`、5 包 `tsc --noEmit` 与 `tsx tools/check-data.ts`（全部通过）。
