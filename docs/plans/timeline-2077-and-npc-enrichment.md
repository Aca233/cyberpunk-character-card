# 2077 时间线重构与预制 NPC 内容扩充计划

- **状态**：进行中（2026-11-21）
- **范围**：
  1. 以 **2077 自由沙盘**为核心重构时间线，修复游戏内天数重置与新闻错位 Bug，清理 2075 残留冲突。
  2. 升级 NPC 档案结构并全面深化现有 41 位 2077 预制 NPC（背景履历、秘密、年龄、常驻/出没地点、更多示范台词、开局近况）。
  3. 预置 2077 核心人物之间的双向初始关系网（`ties`），告别开局孤岛。
  4. 补齐 18 位关键 2077 预制 NPC（含已有店铺/诊所的具名店主与城内重要势力/剧情人物），并将店铺 `keeperNpc` 绑定。
- **遵循约束**：
  - 制作阶段不做历史兼容，直接收口为 2077 自由沙盘架构。
  - 不改动前端界面布局与样式；亲密/红灯区相关设定保持克制写实、不直写露骨细节。
  - 仅执行静态类型检查与代码规范检查（`tsc` / `biome`），测试交由用户验收。

---

## 一、2077 时间线重构与时钟修复

### 1.1 开局锚点校准
- 默认开局时间由 `2077-01-01 22:00` 调整为 **`2077-04-12 21:00`**（2077 年 4 月中旬，主线序章前约两周的暗流窗口）：
  - 与所有 2077 预制人物的即时状态完全吻合（赖宣刚携机密抵城住进绀碧大厦、三郎/华子/竹村尚在东京、梅瑞德斯追查沃森失窃军用货、罗伊斯刚篡位囚禁布里克、德克斯刚回城物色人手、帕南与索尔闹翻、李德/亚历克斯自 2070 年起潜伏满七年、三郎 158 岁）。
  - 《边缘行者》（2075–2076）为去年街头旧闻，彻底清理 `sandbox-2075`、`openingForStartTime`、`DEAD_BEFORE_2077` 及已故三人组（`rebecca`、`maine`、`faraday`）残留。

### 1.2 2077 世界大事件时间线（`lore.ts` + `schemas/lore.ts` + `canon.ts`）
- 升级 `CanonNodeSchema`：去掉仅限动画的 `episode`，改为面向 2077 夜之城世界进程的 `phase`（阶段标识）与 `order`（序号）。
- 在 `packages/content/src/lore.ts` 编写 **10 个 2077 世界演进节点**（覆盖开场后第 0 天至第 90 天）：
  1. `nc-april-undercurrents`（Day 0–4）：四月暗流与军工失窃
  2. `watson-security-tightening`（Day 5–10）：沃森治安收紧与帮派摩擦
  3. `arasaka-tokyo-delegation`（Day 11–16）：荒坂鲸鱼号航母抵港
  4. `konpeki-lockdown-rumors`（Day 17–22）：绀碧大厦突发安保封锁
  5. `mayor-rhyne-and-election`（Day 23–30）：市长暴毙与补选混战
  6. `pacifica-netwatch-standoff`（Day 31–38）：太平洲网络异常与动物帮进驻
  7. `badlands-convoy-and-kangtao`（Day 39–46）：恶土空域事故与康陶车队
  8. `japantown-dashi-parade`（Day 47–54）：日本街荒魂祭彩排与全息游行
  9. `dogtown-airspace-incident`（Day 55–64）：狗镇空域坠机与幽冥犬戒严
  10. `nc-summer-power-shift`（Day 65–90）：盛夏格局重排
- 明确提示词边界：玩家不是 V，时间线只是“无人插手时的世界参考大势”；一旦玩家插手或本局已有冲突事实，严格以本局已发生事实为准，不硬拉回原作、不剧透未来节点。

### 1.3 时钟与新闻推送 Bug 修复
- `WorldClockStateSchema` 新增 `startedAt?: number` 字段，在 `newGameWorld()` 初始化写入 `meta.startTime`。
- 修复 `packages/core/src/systems/world/view.ts` 中 `phaseClockOf(world.time, clock.sceneStartedAt)` 导致每次切场景“第 X 天”重置为第 1 天的问题，改为使用 `clock.startedAt ?? clock.sceneStartedAt`。
- 在 `packages/core/src/systems/world/status.ts` 输出包含 `第 X 天` 的明确时间行。
- 统一 `packages/core/src/systems/world/feed.ts` 与 `packages/core/src/narrator/canon.ts` 的天数计算口径，均基于 `startedAt` 计算开场后第几天，避免非 1 月 1 日开局瞬间刷出未来新闻。

---

## 二、预制 NPC 体系深化与扩充

### 2.1 数据结构与系统能力升级（`packages/core`）
- 适度放宽 `NpcCardSchema` 字段长度上限（`role` 64、`look` 260、`outfit` 160、`voice` 240、`sample` 150、`samples` 最多 5 条、`want/limit` 220、`secret` 240）。
- `NpcCardSchema` 新增可选字段：
  - `bio?: string`（≤ 320 字）：人物生平履历、来历与性格底色（幕后资料，严格遵循知情边界，不直接透给玩家）。
  - `hangouts?: string[]`（≤ 4 处地点 id）：除 `home` 外的常出没地点，纳入 `localFaces()` 城区老面孔检索。
  - `initialDoing?: string`（≤ 120 字）：开局正在忙的活儿，由 `seedNpc()` 写入初始 `doing` 与 `timeline`（不写入 `knownDoing`，保持信息隔离）。
- `GameContent` 新增 `npcTies?: readonly InitialNpcTie[]`，在 `newGameWorld()` 种子人物入库后自动写入双向初始 `ties`（公开与暗地关系）。
- 同步更新 `npc/prompt.ts`（`fullCard`、`localFaces`）、`npc/sections.ts`（`formatEverydayCard`）、`narrator/offscreen.ts`（`card`）。

### 2.2 现有 41 位 2077 预制 NPC 全面深化
- `packages/content/src/npcs.ts`（清理 3 位 2075 已故人物，保留并全面重写深化 34 位 2077 原作人物）
- `packages/content/src/everydayLife.ts`（深化 7 位日常街坊与红灯区人物）
- 全员补齐：`age`、`adult`、`entity`、`bio`、`secret`、校准 `role`、更立体的 `look/outfit/voice`、至少 3 句差异化 `samples`、`home/hangouts`、`initialDoing`。

### 2.3 新增 18 位关键 2077 预制 NPC（总计 59 位）
- **常驻店主补卡（3 位，并绑定 `shops.ts` / `ripperdocs.ts` `keeperNpc`）**：
  - `wilson`（罗伯特·威尔逊 / H10 枪店）、`atao`（阿涛 / 歌舞伎黑市武器摊）、`needle`（针眼 / 歌舞伎黑市义体医生）
- **丽姿酒吧 / 云顶 / 扭扭街生态（5 位）**：
  - `susie-q`（苏西·Q / 莫克斯帮主）、`rita-wheeler`（丽塔·惠勒 / 丽姿门卫）、`maiko`（前田舞子 / 云顶管事）、`woodman`（木头人 / 云顶维护主管）、`fingers`（指头哥 / 扭扭街黑市义体医生）
- **帮派与黑市核心（4 位）**：
  - `brick`（布里克 / 漩涡帮前老大）、`sasquatch`（萨斯夸奇 / 动物帮首领）、`gunner`（枪手 / 六街帮新老大）、`cassius-ryder`（卡西乌斯·赖德 / 沃森老牌义体医生）
- **荒坂 / 市政 / 执法 / 城市标志（6 位）**：
  - `oda`（小田三太夫 / 华子贴身保镖）、`jefferson-peralez`（杰弗逊·佩拉莱斯 / 市长候选人）、`elizabeth-peralez`（伊丽莎白·佩拉莱斯 / 竞选智囊）、`bryce-mosley`（布莱斯·莫斯利 / 网监外勤探员）、`delamain`（德拉曼 / 出租车公司核心 AI）、`blue-moon`（蓝月亮 / 刚烈主唱）

### 2.4 预置双向初始关系网（`packages/content/src/npcTies.ts`）
- 覆盖沃森/海伍德街坊圈、丽姿与云顶生态、来生与中间人圈、荒坂帝国权力网、阿德卡多与恶土、漩涡帮/巫毒帮/动物帮/网监对峙、往日之影狗镇暗线、市政与演艺圈，共约 50 组公开与暗地双向关系。

---

## 三、实施步骤与进度追踪

- [x] Step 1：落盘计划文档并提交
- [ ] Step 2：升级 `packages/core` 时间线、时钟 Bug 修复、NPC Schema/Prompt/Seed/Ties 支持
- [ ] Step 3：重构 `packages/content` 2077 时间线、开场配置、商店/诊所店主绑定与 `apps/server` 接线
- [ ] Step 4：全面深化 41 位现有 NPC、新增 18 位关键 NPC、编写 `npcTies.ts` 并接入 `gameContent`
- [ ] Step 5：执行静态类型检查与代码规范检查（`tsc` / `biome`），更新计划文档状态并收口提交
