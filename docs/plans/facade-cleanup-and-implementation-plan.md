# 全仓空壳、断链与残留机制收口策划案

2026-11-21｜面向 `packages/content`、`packages/core`、`apps/server`、`apps/web` 的系统化修复与清理设计

---

## 0. 背景与总原则

本项目在从“2d6 跑团数值框架 + 旧式全屏功能页”演进到“零骰子因果沙盒 + 2077 四角就地展开 HUD”的过程中，遗留了四类“表面看起来有、实际空转/断链/假数据”的结构债务：

1. **已做完后端却在前端断链或失真的真缺陷**（小队、全息来电、义体医生假人性计算与死筛选器、`editMemory(bond)`、`view.interactions`）；
2. **地图、服务与图鉴里的空壳站点、无效果服务和不可获取条目**（41 个空壳 POI、8/10 无状态效果服务、大量不可达物品/不朽义体、3 个死档 NPC、空细节超梦）；
3. **沙盒转型后残留的僵尸数值与未接线规则表**（5 维属性与属性点、开局后失效的人性 `tolerance`/`humanityCost`、残留的骰点/难度/护甲/穿甲 schema、`DISTRICT_LAWS`/`FIXER_TEMPERAMENTS`/`canonTimeline`/`WEEKLY_LIFESTYLE_BILLS`、纯日志黑客与装饰黑墙层）；
4. **明确未实现的桩代码与已弃用的死组件**（`embeddingModel` 向量检索、`anthropic` 原生 Provider、`ContactsPage`/`GigsPanel`/`Closeup`）。

### 设计总原则（对齐 `docs/sandbox-design-conflict-audit.md` 与 `AGENTS.md`）

- **不走回头路**：绝不把已废除的 2d6 骰点、属性门槛、稀有度锁货、数值 HP/人性扣减重新塞回主循环。凡是与“零骰子因果沙盒”冲突的旧壳，一律**彻底删除**而不是修成数值系统。
- **不保留空承诺**：地图上有图标、HUD 上有入口、设置里有选项的东西，要么接通真实玩法与状态反馈，要么从入口与目录中移除，不留“点进去啥也没有”的假门面。
- **不搞旧版兼容链**：制作期不留 legacy fallback，直接清理僵尸字段、无用组件与空返回值。
- **分波次、可独立验收**：按“玩家立刻卡壳的 UI 断链 → 世界交互空壳实装 → 沙盒规则接线与图鉴通达 → 僵尸代码与未实现桩彻底清零”四个阶段推进，每阶段都能单独通过 `tsc`、`biome` 和真实试玩验收。

---

## 一、全局分级总览

| 阶段 | 代号 | 核心目标 | 涉及包 | 处理策略 |
| --- | --- | --- | --- | --- |
| **P0** | 断链复通 & 假数清零 | 修好小队入口、全息来电接听/拒接、义体医生真实预览、关系记忆纠错 | `apps/web`, `packages/core` | **补齐前端接线 + 删除假计算** |
| **P1** | 地图空壳 & 服务/载具实装 | 解决 41 个空壳 POI、8 种空扣钱服务、42 个无坐标地标、车行/租房/杂货闭环 | `packages/content`, `packages/core`, `apps/web` | **实装真实终端或裁剪无效 POI** |
| **P2** | 世界规则接线 & 图鉴通达 | 接通地区法制/中间人脾气/生活账单/载具座位/黑客持久态；补全不可达物品、不朽义体、2075 人物与超梦细节 | `packages/content`, `packages/core`, `apps/web` | **因果化接入，不引入跑团数值** |
| **P3** | 僵尸系统 & 桩代码彻底清扫 | 删除 5 维属性、骰点/护甲残骸、死组件、`view.interactions` 废投影；实装或下线 `anthropic` 原生接入与 `embeddingModel` | 全仓 4 包 | **彻底删死码 + 明确能力边界** |

---

## 二、P0：前端断链复通与假 UI 清零（立即修复）

这一阶段全部针对**后端逻辑已完整、但前端要么没挂载要么在算假数**的硬伤。

### P0-1. 把小队管理重新接入现有四角 HUD，并清掉死掉的 `ContactsPage`

**现状问题**
- `packages/core/src/systems/squad/` 具备完整的招募提议（`offer`）、确认入队（`accept`）、回绝（`decline`）、发薪（`pay`）、解雇（`dismiss`）以及委托自动分成机制；`squad/prompt.ts:15-17` 明确要求玩家在面板确认入队和发薪。
- 但 `SquadPanel.tsx` 仅挂载在已废弃的 `ContactsPage`（`NeuralPages.tsx:466-534`）下，整个 `apps/web/src` 中 `ContactsPage` 0 处引用、`{ type: "squad" }` 0 处调用。

**策划方案**
1. **入口落位**：在左角 `BioMonitor` 钉住后的页签栏（`StoryScreen.tsx` 的 `characterTabs`）或右角 `Track`（委托/日程）中新增「小队」页签；**推荐放在左角 `BioMonitor` 页签组**（`档案 / 义体 / 小队 / 编年史`），与人物状态、义体同属“团队与自身状况”，并在有待处理招募 `view.squad.offers.length > 0` 或欠薪成员时在角标与页签上显示警示计数。
2. **交互闭环**：在 `StoryScreen.tsx` 接入 `onSquad={(action, npc) => act({ type: "squad", action, npc }, "squad")}`，透传至 `SquadPanel`；确认解雇、发薪、入队分成提示沿用现有 `<Dialog>` / `<ActionButton>` 与 2077 视觉规范。
3. **死码清理**：彻底删除 `NeuralPages.tsx` 中未挂载的 `ContactsPage`（以及仅服务于它的无用辅助类型）。

**验收标准**
- LLM 触发 `squad offer` 后，左上角出现小队提醒角标，展开后可一键确认入队或回绝；雇佣型队员欠薪时可直接发薪扣款并更新状态，解雇后立即离队。

---

### P0-2. 补齐全息来电（`HoloCall`）的接听 / 拒接完整交互

**现状问题**
- 离屏系统可发起 `phone.call`，后端具备 `answerCall` 动作（`packages/core/src/systems/phone/actions.ts:11-22`）及响铃超时转未接逻辑。
- 前端 `Corners.tsx:1720-1784` 的 `HoloCall` 点击只跳到消息页；`Phone.tsx` 不渲染 `view.calls.incoming`，全仓 0 处调用 `{ type: "answerCall" }`。

**策划方案**
1. **HUD 即时接听/拒接**：在 `Corners.tsx` 的 `HoloCall` 卡片上直接提供两个按钮——**「接通」**与**「挂断」**（调用 `act({ type: "answerCall", id: call.id, answer: true | false }, "call")`），同时保留点击主体展开通讯录详情。
2. **通讯面板同步展示**：在 `Phone.tsx`（`PhoneBody` 顶部，以及空联系人分支）新增 `IncomingCallBanner`：当 `view.calls.incoming` 存在时置顶显示来电者头像/姓名、来电时间、接通/挂断按钮；接通后在对应联系人对话流顶部插入系统提示条（“全息通话已接通 — 可直接在行动栏与对方对话”），方便玩家自然续写通话剧情。
3. **响铃状态与并发保护**：当 `busy` 为真时禁用接通/挂断按钮；若来电者中途身亡，后端已返回拒绝原因，前端用 `Toast` 提示并允许点挂断清掉。

**验收标准**
- 出现 `view.calls.incoming` 时，无需翻找即可在左角 `HoloCall` 或通讯面板中点击接通/挂断；状态立即切为 `answered`/`declined`，叙事上下文能读到 `phone/sections.ts:21-22` 的已接通来电来意。

---

### P0-3. 清理义体医生（`Ripperdoc.tsx`）的假人性计算与失效筛选器

**现状问题**
- `cyberware/ripperdoc.ts:105,125` 和 `cyberware/view.ts:59` 已把 `humanityCost`、`replacesHumanityCost` 写死为 `0`，且 `cyberware/apply.ts:94` 已将单件解锁锁写死为 `const locked = null`。
- `Ripperdoc.tsx` 却仍在渲染“人性变化 / 术后上限 X→100 / 人性占用 −0”以及形同虚设的「仅看已解锁」开关。

**策划方案**
1. **移除假数值预览**：
   - 从 `Ripperdoc.tsx`、`cyberwareMeta.ts`、以及后端 `cyberware/ripperdoc.ts` / `cyberware/view.ts` 中彻底删去 `humanityCost`、`replacesHumanityCost`、`projectHumanityCap`、`sumHumanityCost`、`entersGlitch`。
   - 改为展示**真实的沙盒装机信息**：
     - 部位冲突与替换提示（“将替换当前已装的「XXX」”）；
     - 实际手术条件（诊所营业状态、主刀医生是否在岗、设备是否支持、库存剩余件数）；
     - 当前神经定性状态提示（若玩家已存在 `detached`/`unstable`/`edge`/`crisis` 症状，在确认弹窗给出定性医疗风险提醒，而非编造数字）。
2. **改造筛选器**：
   - 删除「仅看已解锁」（`onlyUnlocked`）；
   - 替换为真正有用的 **「仅看有现货」**（`inStock > 0`）或 **「仅看可负担」**（`price <= eddies + availableCredit`）。

**验收标准**
- 义体医生界面不再出现任何 `−0` 或 `→ 100` 的假人性数字；切换库存/负担筛选能准确过滤货架。

---

### P0-4. 收口 `editMemory(bond)` 与废投影 `view.interactions`

**现状问题**
- `EditMemoryActionSchema` 支持 `scene` 和 `bond`，前端 `SettingsScreen.tsx:277` 只接了 `scene`。
- `packages/core/src/game.ts:807` 每轮计算 `view.interactions`，前端 0 处使用。

**策划方案**
1. **补齐人物关系纠错**：在 `SettingsScreen.tsx` 的剧透上下文查看器里，为「人物关系/羁绊记忆」列表补上与 `scene` 一致的编辑保存入口，调用 `{ type: "editMemory", what: "bond", ... }`，确保记忆纠错功能完整无半截。
2. **删除无消费的 `view.interactions`**：核查确认当前背包、义体、武器改装全部通过专用操作入口驱动，不再需要泛化的 `view.interactions` 提示列表；从 `game.ts`、`cyberware/interactions.ts`、`inventory/interactions.ts` 移除该死投影链路，减少每轮视图构建开销。

---

## 三、P1：地图空壳 POI、无效果生活服务与房产/载具闭环

这一阶段解决玩家“按图索骥跑过去、或者花钱买了服务，结果什么都没发生”的体验断层。

### P1-1. 41 个空壳服务 POI 分类收口（实装 vs 合并 vs 清理）

**现状盘点**（`packages/content/src/mapShapes.ts` 保留 12 类服务，但 `merchant-sites.ts` 只生成 7 类商店 + 义体医生）：

| POI 类别 | 数量 | 当前状态 | 策划处置 |
| --- | --- | --- | --- |
| `autofixer`（好车中间人终端） | 15 | 无车行、无买车 UI | **实装：接入“好车中间人”购车终端** |
| `rent`（租/购公寓点） | 4 | ID 与 `safehouses.ts` 对不上 | **实装：对齐 4 套原作 EZ 地产可购公寓** |
| `apartment`（公寓安全屋） | 11 | 与 `safehouses.ts` 脱钩 | **收口：仅映射玩家已拥有/可购安全屋，其余非玩家房产移出可交互服务点** |
| `junk`（杂货摊） | 11 | 无商店生成 | **实装：纳入 `SHOP_SEEDS`，补建杂货/零件/日常小物商店** |

**详细设计**

1. **好车中间人（`autofixer`，15 处）—— 实装载具购买与提车终端**
   - **后端**：新增 `travel` 动作 `buyVehicle`（`{ type: "buyVehicle", id: string }`），校验当前地点是否为 `autofixer` POI（或 `merchantSites` 中标注了 `autofixer` 服务），校验余额与未重复购买（或允许买多辆不同车型），扣款后将车辆停放在当前 POI 位置，并立即可在地图/物品栏后备箱使用。
   - **货架分区**：按区域（市政中心/威斯特布鲁克主卖豪车跑车，沃森/圣多明戈/海伍德主卖经济/实用车，恶土/狗镇主卖越野/武装车）从 `packages/content/src/vehicles.ts` 分配在售清单，每个终端都有库存与车况描述。
   - **前端**：在 `Zone` 角块（与商店、义体医生同级）新增「好车中间人终端」按钮，打开基于统一 `<Panel>` + `<CellFrame>` 的购车抽屉（复用 `vehicle-art.ts` 车型图，展示厂牌、速度档、座位数、后备箱容量、售价）。
   - **关于“车库”**：不做数值车库扩容，明确以“载具实停位置 + 呼叫/定位”规则运作——玩家在地图上可见所有名下车辆的停放点，位于同城公路可达点时支持「呼叫车辆开到附近」（消耗少量时间，不瞬移进封闭室内/狗镇封锁区）。

2. **EZ 地产公寓（`rent`，4 处）与安全屋（`apartment`，11 处）—— 统一地点 ID 与购房闭环**
   - 补齐 `packages/content/src/safehouses.ts` 中注释提到但未补的 **北区（沃森，10,000€$）** 与 **格伦（海伍德，40,000€$）** 两套原作公寓，与日本街（30,000€$）、公司广场（110,000€$）共构成 **4 套标准可购公寓**。
   - 为每套公寓增加 `poiIds`（或统一使用 `merchant-sites.ts` 同款位置映射表 `merchantAt`），把地图上 4 个 `rent` POI（`city_centre`/`glen`/`japantown`/`nid`）精确绑定到这 4 套公寓；玩家走到 `rent` POI 或对应主街区地点时，HUD 都能弹出「查看/购置公寓」入口（复用现有 `buyHome` 动作与确认弹窗）。
   - 清理 11 个无归属的 `apartment` 图钉：
     - 与开局住所（`home-h10`、`home-nomad-trailer`、`home-corpo-flat`）及 4 套可购公寓对应的，合并/标注为真实安全屋入口（带床、衣柜、存放箱）；
     - 其余属于剧情 NPC 或无对应实体的普通民宅图钉，在 `mapShapes.ts` 中过滤移出服务 POI（或降级为纯地图背景地标，不再冒充“可交互服务点”）。

3. **杂货摊（`junk`，11 处）—— 补入 `SHOP_SEEDS` 与 `merchant-sites.ts`**
   - 将 `junk` 正式加入 `ShopKind`，为 11 处杂货摊生成真实商店（售卖空白芯片、日常消耗品、工具零件、街边小物、低价改装件，并允许玩家在此出售战利品杂物变现）。
   - 这同时直接盘活下文 P2-3 中一批原本买不到的日常/杂项物品。

---

### P1-2. 修复 42 / 171 个坐标为 `null` 的快速传送/地铁地标

**现状问题**
- `packages/content/src/fastTravel.gen.ts` 中有 42 个地标 `x: null, y: null`，在 `radar.ts:50-62` 被静默丢弃。

**策划方案**
- 建立校验脚本（供内容构建与测试阶段运行），区分两类无坐标点：
  1. **确有对应子区/原作位置的点**：在手工覆写表（`fastTravel.overrides.ts`，不直接手改 `.gen.ts`）补齐准确 `(x, y)` 坐标；
  2. **原作任务专属/未开放封闭区/无效导出点**：显式列进排除清单并在加载层剔除，同时输出清单记录。
- 确保上线数据中 `fastTravel` 的“声明数 = 地图可见数”，不存在 25% 静默蒸发。

---

### P1-3. 让 8 种“只扣钱不干活”的生活服务产生真实世界效果

**现状问题**
- `packages/core/src/systems/economy/schema.ts:70-96` 的 10 种 `SERVICES` 中，除 `bd-session`、`adult-service` 外，其余 8 种在 `inventory/trade.ts` 中只扣钱写账单，不改任何状态。

**策划方案**
结合零骰子因果沙盒原则，为 8 种服务各自接入**确定性的时间、位置、体征或事实后果**（在 `inventory/trade.ts` 或专用 `service-effects.ts` 中随交易事务原子生效）：

| 服务 ID | 价格 | 新增确定性状态后果 |
| --- | --- | --- |
| `meal`（吃一顿） | 15 | 推进 25 分钟；若存在疲劳/饥饿类轻量状态标签则清除；写入场景事实供叙事承接 |
| `drink`（一杯酒） | 10 | 推进 15 分钟；叠加短暂微醺/放松状态标签（供叙事与神经缓和上下文感知） |
| `lodging`（胶囊旅馆过夜） | 40 | 触发与安全屋休息同源的 `rest` 结算（推进 6–8 小时、按现有恢复规则缓和可休养伤势与神经紧绷，但**不凭空补满手雷/药物次数**） |
| `cab`（打车） | 30 | 与 `travel` 联动：支持指定目的地并按路程推进时间、移动玩家位置（类似“无车快速付费通勤”）；若未指定目的地则拒绝空扣钱 |
| `medical`（街头诊所看伤） | 300 | 检查玩家是否有未包扎/需诊治的伤势（`health` 切片）：有伤则标记对应伤势为“已处理/进入恢复期”并推进 45 分钟；若无伤则阻止白扣 300€$ |
| `info`（买情报） | 200 | 扣款时强制要求附带 `about`/情报主题，并将这条“已付费购买的情报线索”写入世界事实/线索列表（`memory`/`facts`），强制下一段叙事兑现干货 |
| `fine`（交罚款） | 500 | 联动通缉/治安状态（`wanted`/区域违规记录）：降低或清除低档通缉/治安追查记录；若当前无违规/罚款事由则拒绝空扣 |
| `favor`（打点/托人办事） | 100 | 扣款时登记一条针对目标 NPC/派系的“人情/打点记录”（写入事实与关系备注，供后续判定与离屏推进读取） |

同时为 3 种零效果消耗品（`nicola`、`hawtdawg`、`coffee`，`items.ts:1374-1376`）补全轻量定性效果（提神/解渴/充饥状态标记，推进或缓解疲惫感，使“使用”按钮名副其实）。

---

## 四、P2：世界规则接线、黑客实装与图鉴通达

这一阶段把“已经写得很细致的结构化内容”真正接入引擎，让它们从死文档变成活规则。

### P2-1. 把闲置的世界结构表接入因果引擎

1. **`DISTRICT_LAWS` 与 `NIGHT_CITY_SLICES`（`packages/content/src/slices.ts:21-94, 152-201`）**
   - **消除硬编码**：把创伤小组覆盖判断（`worldClock.ts:30` 原硬编码 `city-center || westbrook`）改为直接读取当前所在区的 `DISTRICT_LAWS[district].traumaCoverage`。
   - **接入裁决上下文**：在 `narrator/prompts/context.ts` 中，每次玩家换区或展开冲突/持械行动时，注入当前区的 `securityTier`、`forbidsOpenLongArms`、`patrolResponse` 等真实法制事实——比如在禁止明带长枪的高安保区扛着步枪进门，裁决模型直接收到“违反本区持械禁令 + 携带可见长枪”的双重事实，而不是靠运气记第 1 回合开场白。
   - **服装隐蔽与场景社交**：虽然 27 件服装不加数值护甲，但为其补上**定性标签**（`style`: 公司正装 / 街头便装 / 帮派标识 / 战术防弹外衣；`concealmentBonus` 或“便于藏匿小型武器”），注入 `inventory/status.ts` 上下文，让穿公司西装进荒坂楼和穿战术防弹衣进酒吧产生真实的因果差异。

2. **`FIXER_TEMPERAMENTS`（`packages/content/src/slices.ts:104-140`）**
   - 在 `jobs/status.ts` 与 `npc/status.ts` 中，凡是当前交互或发消息/派单的 NPC 属于中间人且命中 `FIXER_TEMPERAMENTS`，自动将其行事风格、忌讳、验货习惯注入 `judge` 与 `narrate` 上下文，直接影响接单谈判、交单验收和关系变动。

3. **`canonTimeline`（`packages/content/src/lore.ts:125`）**
   - 接入 `packages/content/src/index.ts` 的 `gameData`；在 `world/status.ts` 中按当前剧本年份（2075/2077 等）和当前日期筛选最近已发生/临近的大事件，注入新闻流（`world/feed.ts`）与时代背景上下文，避免 NPC 剧透未来或无视刚发生的大事。

4. **住房租金与夜之城阶级生活闭环（替换孤儿 `WEEKLY_LIFESTYLE_BILLS`）**
   - 删掉与现有系统脱节的旧静态表 `WEEKLY_LIFESTYLE_BILLS`（每周 500/2500/10000），改为贴合夜之城体感且与创伤小组、赊账、小队周薪形成“三笔固定生存压力”的因果模型：
     - **开局租住公寓**（如 H10 胶囊公寓）：标记为 `tenure: "rented"`，周期（如每 30 天 1,200€$）产生水电/房租账单并由楼管发简讯提醒；宽限期内未补交则门禁锁死（`locked: true`，暂停存取与休息，盘活 `lodging` 胶囊旅馆过夜），随时可缴清解锁；流浪者拖车免房租但偏远耗时；公司公寓在失去公司身份时可被收回锁门。
     - **EZ 地产 4 套可购公寓**（北区 / 日本街 / 格伦 / 公司广场）：沿用 2077 原作一次付清买断制（`tenure: "owned"`），摆脱房租压迫，实现真实的夜之城阶层跨越。
   - 同步把同文件 `worldClock.ts` 里闲置的 `evaluateDistrictSecurityCheck`（市政中心/威斯特布鲁克显眼长枪拦截、高端场所毫米波闸机、安全屋与后备箱豁免）改为基于 `DISTRICT_LAWS` 驱动，并正式接入出行与裁决上下文。

5. **`vehicles.ts` 的 `seats`（载具座位数）**
   - 在 `travel/apply.ts` 与 `travel/status.ts` 中读取所驾车辆的 `seats`，与当前同行人数（`1 + 同行小队/在场同行 NPC 数`）比对：
     - 若总人数 > `seats`，在出行规划/地图路线上明确标出“座位不足（需分车/打车/换大车）”，而不是让 4 个人挤进 2 座的蜗牛 P126。

---

### P2-2. 让黑客与潜网拥有真实状态闭环（不走数值 RAM 路线）

**现状问题**
- `quickhacks`（12 个快速破解）只是词表；`applyHack` 只记日志不改任何状态；`applyDive` 只改 `layer: 1..4`；`DivePanel.tsx:57-60` 底部还画了一行永远进不去的 `BW 黑墙 · 流窜 AI`。

**策划方案（契合零骰子沙盒，引入“真实链路与后果”而非魔力蓝条）**
1. **接入仓与程序库真实绑定**：
   - 将 `quickhacks` 接入网络黑客商铺（`netrunner` 商店）和任务掉落，玩家拥有一个真实的 **“已持有/已载入快速破解清单”**（存储在 `HackingState.programs`），而非全表默认白嫖。
   - 不同型号接入仓按定性硬件定位决定可运行类别（民用基础仓仅支持控制/干扰类；军用/黑客专精仓支持战斗/终极类；黑墙协议仅限 `blackwall` 特性原型仓）。
2. **`applyHack` 产生真实持久状态**：
   - 每次成功执行 `applyHack` 后，在 `HackingState.activeEffects`（或 `tension`/`combat` 切片）写入可被后续回合读取的**真实目标状态**（如：`目标义眼重启中`、`炮塔已接管`、`通讯已静默`、`监控已致盲`、`目标进入追踪反制倒计时`），由 `hacking/status.ts` 喂给裁决和战斗系统，并在目标失效或撤离时自然结束。
   - 同时保留过热/反追踪（Trace）因果：高频对高安保网络释放攻击型破解，会触发对方网监/黑客反追踪记录，而非“放完就忘的日志”。
3. **潜网与 `DivePanel.tsx` 去装饰化**：
   - 给潜网 1–4 层分别绑定真实可读的阶段事实（已发现节点、已绕过冰墙、是否触发反制 ICE、已提取数据），并在 `DivePanel` 展示当前层的真实进展和风险，而不只是高亮第几行文字。
   - **修正 `BW 黑墙` 行**：正常潜网仅显示 1–4 层；仅当玩家确实持有黑墙相关原型接入仓或处于黑墙剧情事件时，才解锁并高亮显示黑墙边界警示（注明“不可常规进入的隔离边界”或触发专属黑墙剧情交互），不再作为无意义常驻装饰。

---

### P2-3. 打通图鉴死条目：物品、不朽义体、2075 人物与超梦内容

1. **65 / 191 件不可获取物品**：
   - 逐一归类分配真实获取途径（写一份自动化覆盖率测试 `catalog-reachability.test.ts`，校验非剧情限定条目全部有可达路径）：
     - 日常消耗/工具/杂物/服装 → 分配至 P1 新增的 `junk` 杂货摊、服装店、酒吧/餐饮店、药店；
     - 高端武器/配件/芯片 → 分配至对应帮派区域军火商、狗镇黑市与精英战利品表；
     - 31 件不朽物品与剧情证件（`corpo-badge`、`ncpd-badge`）→ 绑定到对应 NPC 随身持有、特定出身开局或专属委托奖励（`corpo-badge`/`ncpd-badge` 明确标记 `untradable: true` / 非市售证件，而非漏写 `price` 导致报错）。
2. **19 / 20 件不可获取的不朽义体**：
   - 保留 `ripperdocs.ts:17` “常规货架不摆不朽义体”的合理世界观设定，但打通**三种真实获取途径**：
     - 狗镇黑市义体医生与少数传奇义体医生（如维克多、手指哥等特定诊所）提供限量/需引荐的不朽特供库存；
     - 高风险委托与关键人物剧情交付（作为实物零件进入背包/安全屋，再带去任意有手术设备的义体医生处安装——现有 `safehouse/view.ts:162` 的“取回后交给医生检查安装”逻辑已存在，直接串通即可）；
     - 建档时高规格出身/特色模组可按设定携带对应原型件。
3. **2075 剧本缺失的 3 位人物（`rebecca`、`maine`、`faraday`）**：
   - 将三人补入 `packages/content/src/openings.ts` 中 2075 线（`openings[0].cast`）的出场名单与初始位置/关系，确保 2075 边缘行者时代世界里这三位核心人物真实存在并可交互、可收发消息。
4. **超梦内容补齐（`packages/content/src/braindance.ts`）**：
   - 为 4 卷商业/感官超梦补全真实的 `details`（场景片段、感官亮点、情绪基调），让在丽姿酒吧/歌舞伎市场花钱点播后有丰富的体验素材；
   - `sleeve-corner`（阿岚芯片小铺）明确保持“仅支持播放、不支持三层编辑分析”的商业试看定位，并在 UI 上清晰标出“商业试看设备（分析功能需前往专业工作站如丽姿酒吧地下室）”，把原本看似遗漏的 `analysis: []` 变成明确的玩法差异引导。

---

## 五、P3：僵尸系统、死组件与未实现桩代码彻底清理

这一阶段做减法，确保代码库与前端界面里不再有任何“已经废掉但还占着坑”的残留物。

### P3-1. 彻底清除 5 维属性、属性点与旧 2d6 检定残骸

1. **5 维属性与属性点**
   - 从 `packages/core/src/systems/character/`（`schema.ts`、`apply.ts`、`view.ts`）、`cyberware/apply.ts:116-130`（删除无意义的 `character.setBonuses` 联动）及角色卡 schema 中彻底移除 `attributes`、`bonuses`、`attributePoints`。
   - 核查建档器（`CharacterCreator.tsx` / `creator.ts`）是否还残留隐藏属性字段，一并清干净，能力完全由“出身 + 模组 + 义体 + 经历”表达。
2. **旧骰点 / 难度 / 护甲等级 / 穿甲残骸**
   - 清理 `packages/core/src/systems/dice/schema.ts` 中所有无用定义：`DifficultySchema`、`OPPONENT_TIERS`（`baseDv`）、`BonusPoolKindSchema`、`ModifierSchema`、`ArmorGradeSchema`、`WeaponPenetrationSchema`。
   - 清理 `packages/core/src/game.ts:592-650` 硬编码的空字段 `checks: []`、`rolled: null`、`gate: null`、`checkId: null`，以及 `apps/server/src/game.ts:1276` 硬编码的 `dice: []`，同步收窄前后端 DTO 类型。
   - 清理 `packages/content/src/cyberware.ts` 与 `modules.ts` 里仅用来贴标签的旧 `checks` 字段（若前端确实需要展示擅长领域标签，改为语义明确的 `tags` / `capabilities`，不再借尸还魂叫 `checks`）。
   - 处理 `packages/core/src/narrator/turn.ts:1530` 的 `facts.armor`：要么直接把已安装的护甲义体并入 `cyberware/status.ts` 的保护事实描述并删掉无人读取的 `facts.armor`，要么让 `judge` 上下文正式读取它——**推荐前者（直接合并到 `cyberware/status.ts` 现状摘要，删掉死变量 `facts.armor`）**。
3. **人性 `tolerance` 与开局 `humanityCost` 对齐**
   - 既然运行时已明确“义体安装不扣精神资源、神经状态由具体症状驱动”，有两种一致化方案（**推荐方案 A**）：
     - **方案 A（定性保留耐受度并真正生效）**：删除开局数字折算 `TOLERANCE_FACTOR` 与 `humanityCost`，把 `tolerance`（低/中/高神经耐受）写入 `humanity/status.ts` 给 `judge` 与 `narrate` 读取——耐受低的角色在高压/连续加速/重创下更容易出现 `NeuralSymptom`，耐受高的抗压更强；`baseline` 刻度条改为直接反映当前症状严重度，不再由开局乘法伪造。
     - **方案 B（彻底删除 `tolerance`）**：如果不需要耐受度设定，连同建档选项、schema 和视图一起移除。

### P3-2. 删除已弃用的死 UI 组件

| 文件/导出 | 状态 | 处置 |
| --- | --- | --- |
| `apps/web/src/features/story/NeuralPages.tsx` 中的 `ContactsPage` | 0 导入 | 删除（小队面板在 P0-1 迁入主 HUD） |
| `apps/web/src/features/story/GigsPanel.tsx` | 0 导入 | 核对是否有独立委托面板需要：若支线委托已归口至 `Track` + `MapPanel`，则**删除 `GigsPanel.tsx`**；若要支持“在委托页直接追踪/接单/定位”，则迁入 `Track` 页签并删掉孤儿文件 |
| `apps/web/src/features/story/Closeup.tsx`（`CloseupQueue`） | 直接 `return null`，0 导入 | 直接删除 |

### P3-3. 处理两处明确未实现的后端桩代码

1. **`anthropic` 原生 Provider（`apps/server/src/config.ts:9`、`apps/server/src/providers/index.ts:55-59`）**
   - **推荐方案：直接实装 `apps/server/src/providers/anthropic.ts`**（工作量小、收益高）。
   - 实现标准的 Anthropic Messages API 流式客户端（`/v1/messages`，`x-api-key` + `anthropic-version: 2023-06-01`，处理 `system` 顶层字段、`content_block_delta` SSE、结构化 JSON 输出与 token 统计），在 `LlmRouter` 中替换掉报错占位符，并移除 `ModelSettings.tsx:80` 的“原生接入还没做好”警告。
2. **向量记忆检索（`embeddingModel`）**
   - **二选一落地**：
     - **方案 A（实装 OpenAI 兼容 Embeddings）**：新增 `apps/server/src/providers/embedding.ts`（调用 `/v1/embeddings`），在 `ModelSettings.tsx` 补上可选的 Embedding 模型配置项，在 `packages/core/src/narrator/retrieve.ts:214` 接入真实余弦相似度评分（未配置时平滑降级为现有关键词/时间/实体召回）。
     - **方案 B（轻量收口）**：若当前纯关键词 + 实体 + 场景召回已够用，则从 `apps/server/src/config.ts`、`apps/web/src/api/client.ts`、`ModelSettings.tsx` 和 `retrieve.ts` 中整体移除未实现的 `embeddingModel` 字段与死注释，避免配置结构留坑。
   - **策划建议**：先随 P3 落 **方案 A**（仅需补一个轻量的 OpenAI `/v1/embeddings` 客户端 + 设置页一个可选输入框，就能把 `retrieve.ts` 已预留好的混合检索公式真正跑起来）。

---

## 六、实施顺序与里程碑排期

建议分 **4 个独立可验证的批次** 依次落地，每批完成后跑 `tsc --noEmit` + `biome check` + 关键场景手测：

### 第 1 批（P0 — 立即可见的前端真缺陷修复）
- [ ] `StoryScreen.tsx` + `BioMonitor` 挂载 `SquadPanel`，打通 `{ type: "squad" }` 全 4 动作，删除 `ContactsPage`
- [ ] `Corners.tsx`（`HoloCall`）+ `Phone.tsx`（`PhoneBody`）接入来电接听/拒接 `{ type: "answerCall" }`
- [ ] `Ripperdoc.tsx` + `cyberware/ripperdoc.ts` + `cyberware/view.ts` 删除假人性数值计算与死锁筛选，改为现货/可负担筛选与真实医疗风险提示
- [ ] `SettingsScreen.tsx` 补齐 `editMemory(bond)`；全仓删除死投影 `view.interactions`

### 第 2 批（P1 — 世界空壳 POI 与服务闭环）
- [ ] `packages/core/src/systems/travel/` 新增 `buyVehicle` 动作与 `autofixer` 货架；前端新增好车中间人购车终端 UI
- [ ] `safehouses.ts` 补齐北区/格伦两套公寓，4 处 `rent` POI 精确绑定，`apartment` POI 清理非玩家空壳点
- [ ] `merchant-sites.ts` 将 11 处 `junk` 杂货摊纳入 `SHOP_SEEDS` 生成真实商店
- [ ] `fastTravel.gen.ts` 42 个空坐标点补坐标覆写或显式剔除
- [ ] 8 种生活服务（`meal`/`drink`/`lodging`/`cab`/`info`/`medical`/`fine`/`favor`）与 3 种空消耗品补全真实状态效果

### 第 3 批（P2 — 规则引擎接线、黑客闭环与图鉴通达）
- [ ] `DISTRICT_LAWS`（含创伤小组覆盖替换硬编码）、`FIXER_TEMPERAMENTS`、`canonTimeline`、服装定性标签、载具 `seats` 校验接入核心状态与提示词上下文；`WEEKLY_LIFESTYLE_BILLS` 按最终决定接入或清理
- [ ] 黑客系统实装 `programs` 持有/商店购买 + `activeEffects` 持续状态 + `DivePanel` 真实层信息与黑墙条件显示
- [ ] 补通 65 件物品与 19 件不朽义体的真实获取渠道、把 `rebecca`/`maine`/`faraday` 加入 2075 线、补全 4 卷超梦 `details` 与 `sleeve-corner` 提示

### 第 4 批（P3 — 僵尸数值清零、死组件删除与 Provider/Embedding 补齐）
- [ ] 删除 5 维属性/`attributePoints`/`character.setBonuses`、删除旧骰点/难度/护甲/穿甲 schema 与硬编码空字段、清理 `checks` 字段与死变量 `facts.armor`
- [ ] 统一 `humanity.tolerance` 为定性神经耐受并接入 `humanity/status.ts`（删除开局数值乘法伪装）
- [ ] 删除死组件 `GigsPanel.tsx`（或并入 `Track`）与 `Closeup.tsx`
- [ ] 实装 `anthropic` 原生流式 Provider；实装 `embeddingModel` OpenAI 兼容向量检索与设置页输入项

---

## 七、全局防回归守护项

为防止后续迭代再长出“表面花架子”，策划案配套增加 4 条静态/单测守护（不改运行时，仅在内容与 schema 测试中校验）：

1. **POI 交互覆盖校验**：`MAP_POIS` / `SERVICE_POINTS` 中每一个保留的服务类型，必须在 `merchant-sites` / `safehouses` / `autofixer` 中有对应处理入口，出现未映射种类直接报错。
2. **地标坐标完整性校验**：`fastTravel` 导出列表中不允许存在静默 `x: null || y: null` 的未声明条目。
3. **图鉴可达性校验**：`items`、`cyberware`、`vehicles`、`apartments` 中，除显式标记 `storyOnly` / `untradable` 外，其余条目必须至少存在于一处商店、开局出身、NPC 装备或掉落表中。
4. **Action 全量消费校验**：核心注册表暴露的每一个 `PlayerAction`（`squad`、`answerCall`、`buyVehicle`、`editMemory` 等）在前端应有明确调用入口，避免“后端写完前端没接”。
