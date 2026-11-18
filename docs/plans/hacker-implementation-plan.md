# 黑客（潜网行者 / Netrunner）系统去跑团化与因果沙盘收敛方案

状态：**已完成**  
日期：2026-11-18  
基准：严格对齐 [无跑团沙盘方向·一致性审查](../sandbox-design-conflict-audit.md) 与 [物品、车辆与住所收敛设计方案](inventory-vehicle-safehouse-simplification.md) 的五条原则

---

## 一、核心诊断与方向评估

黑客在赛博朋克世界里是**依赖硬件、物理链路与现场情报的固件入侵和网络攻防**，不是“凑槽位、算 RAM 格子、按技能表放法术、挂 2 分钟 debuff、玩 5×5 破冰小游戏”。

对照《物品、车辆与住所收敛设计方案》，当前代码（`packages/core/src/systems/hacking/`、`apps/web/`）与旧版方案存在三层核心错位：
1. **把黑客做成了跑团/RPG 的“法术槽与数值门槛”**：
   - `applyHack` 与 `applyNpcHack`（`packages/core/src/systems/hacking/apply.ts`）强制校验 `def.ram > draft.ramMax`、`draft.programs.length >= slots`、`!draft.programs.includes(def.id)`，把 12 个 `quickhacks` 当成“必须先装进 3 个槽位才能用的法术白名单”；
   - 接入仓与脑部辅助义体的差异被简化成“几格 RAM、几个槽（`programSlots`）”，而荒坂隐蔽仓、渡鸦群控仓、四相强攻仓、军用科技黑墙仓的真实硬件特化只停留在纯文本；
   - 前端与请求层还残留 `BreachMatrix.tsx`（5×5 破冰矩阵小游戏）、`Pending.matrix`（旧检定钩子）以及创角/面板中的 `freePrograms` / `programs` 槽位展示。
2. **真正决定沙盘因果自洽的物理链路与敌我裁决反而没接通**：
   - `narrator/prompts/context.ts` 的 `physicsSection` 直接读取 `hacking.data.deck !== null`，**未通过 `deckOf` 过滤 `health.brokenChrome`**，接入仓被打坏时仍误判为可用；且传给 `evaluatePhysicsBoundaries` 的 `hackCheck` 从未填入 `targetAirGapped`、`requiredSubnet`、`targetUnchromed`、`hardenedIce`，导致 `evaluateHackTopology` 的物理阻断分支在真实回合中几乎休眠；
   - 玩家主行动与敌方黑客 `npcHack` 共用单一 `facts.ruling`（`narrator/stages.ts` & `turn.ts`），当玩家本轮执行物理行动而敌方黑客同时反击时，敌我裁决互相干扰。
3. **规则与状态无条件常驻导致正文与 Token 失焦**：
   - `hackingRules.when`（`packages/core/src/systems/hacking/prompt.ts`）只要 `state.deck !== null` 就每轮无条件塞入约 2.3k 字符的骇入规则（哪怕玩家只是在酒吧喝酒闲聊）；
   - `hackingStatus`（`packages/core/src/systems/hacking/status.ts`）每轮把槽位计数、RAM 数字和所有已装程序的效果说明全量平铺进 `【当前状态】`。

---

## 二、五条原则的对照与落地设计

### 原则 1：黑客动作合并自然结算，取消程序槽位与白名单手续

> 玩家只要装有完好的网络接入仓，任何符合现场硬件与链路逻辑的黑客动作（关监控、锁义眼、卡武器、黑门禁、伪造通讯、拷数据）都能一次行动自然结算，无需在面板里倒腾“装载/卸载程序”。
- **现状卡点**：
  - `applyHack` 要求 `command.program` 必须先通过 `hack learn` 装进 `draft.programs`（受 `slots` 限制），满了还要 `hack drop` 腾格子；不在 `draft.programs` 里的手段直接报错拦截。
  - 创角（`creator.ts` / `CreatorSteps.tsx`）和义体面板（`NeuralPages.tsx`）把 `programs` 当作类似技能槽的配置项。
- **收敛方案**：
  - **废除程序槽位与装载限制**：移除 `HackingStateSchema.programs`、`CyberwareDefSchema.programSlots`（或不再作为槽位门槛）、以及 `applyHack` 中 `draft.programs.length >= slots`、`!draft.programs.includes(def.id)`、`action: "learn" | "drop"` 的槽位管理手续；**不新增** `library` vs `programs` 槽位装卸 UI 或 `loadQuickhack` / `unloadQuickhack` 操作。
  - **12 个 `quickhacks` 退回“常见黑客手段词典/参考”**：保留 `packages/content/src/hacking.ts` 作为赛博朋克典型黑客手段的定性效果参考（如义眼重启、武器故障、短路、过热、定位、记忆擦除、系统崩溃等），同时允许 `hack` / `breach` 直接结算任何符合现场电子设备与义体逻辑的入侵行动，一次输入内完成“切入子网→关监控→锁死守卫义眼”的连贯动作。

### 原则 2：不做倒计时 Buff 表，只记跨回合留存的持久事实

> 瞬时干扰直接在当轮正文中演出并结算结果；后台只安静记录真正跨回合留存的世界事实。
- **现状卡点**：
  - 若为致盲、定身、卡壳、反追踪进度条专门增设带分钟倒计时的 `activeEffects` 或 `traces` 进度槽，会把沙盘重新拉回回合制 RPG 的状态栏管理。
- **收敛方案**：
  - **瞬时效果当轮结清**：闪瞎几秒（`reboot-optics`）、武器卡壳（`weapon-glitch`）、一时失聪断联（`sonic-shock`）等瞬时干扰，直接在当轮 `Judge` / `Narrate` 中体现为战术得失与当下战果，**不建立** `activeEffects` 倒计时 Buff/Debuff 表。
  - **后台只记录四类真正跨回合持续存在的世界事实**：
    1. **哪些局域网/权限已被攻破（`breachedNetworks`）**：在某地点已拿下的门禁（`doors`）、摄像头（`cameras`）、炮塔（`turrets`）、数据（`data`）、警报（`alarms`）权限，跨回合与切场持续有效；
    2. **哪些设备/义体被彻底烧毁瘫痪（`tension.disabledEnemyChrome` / `health.brokenChrome`）**：被过热/短路彻底烧坏的敌方义体或玩家自身受损的硬件，在修复前持续失效；
    3. **是否正处于潜网深潜（`dive`）**：当前所处潜网层级（1–5 层）、潜网椅位置（`chair`）与肉身看守人（`guard`），未主动上浮或断开前跨回合保持；
    4. **入侵引发的真实后果**：暴露行踪触发的现场警戒（`tension.alert` / 增援）、公开骇入留下的追查线索（`heat`），以及敌方黑客顺链路反击或深潜黑冰反噬造成的头部/神经伤势（`health.injuries`）与神经症状。

### 原则 3：平时安静，相关时才注入提示词与状态

> 装了接入仓不代表每轮都在黑客攻防；平时安静记录，只有处于潜网、当前地点有已破内网或本轮涉及黑客与电子设备攻防时才进入上下文。
- **现状卡点**：
  - `hackingRules.when` 因 `state.deck !== null` 在所有回合常驻注入 2.3k 字符；
  - `hackingStatus` 每轮输出冗长的 `已装程序 x/y：...（运行需要 N 容量：...）`；
  - `hacking/prompt.ts` 的 `HACK` 正则与 `context.ts` 的 `HACK_ATTEMPT` 正则各自维护、口径不一。
- **收敛方案**：
  - **收紧 `hackingRules.when` 按需激活**：
    - 合并 `hacking/prompt.ts` 与 `context.ts` 的意图探测为共享函数 `mentionsHacking(text)`（覆盖骇入、黑进、接入仓、潜网、摄像头、门禁、炮塔、终端、芯片、义体锁死、ICE、黑墙等电子攻防语义）；
    - `hackingRules.when(state, input)` 改为：仅当 `state.dive !== null`（正在潜网中）、或 `input.mode !== "ooc" && mentionsHacking(input.text)`（本轮行动涉及黑客/电子入侵）时才加载 `hackingRules`。日常对话、纯肉搏、买东西回合不再白白塞入 2.3k 字符规则。
  - **极简化 `hackingStatus`**：
    - 平时仅输出极简一行硬件事实（如 `网络接入仓：荒坂 Mk.4（公司隐蔽型，配完好自我 ICE）`），完全去掉 `硬件运行容量 X` 与 `已装程序 X/Y` 列表；
    - 仅当 `dive !== null` 时输出潜网行；仅当当前地点存在 `breachedNetworks` 时输出 `这里已控制的网络：...`。
  - **按需提供手段参考与遵守预设边界**：
    - 在 `extractCatalogDetails`（`narrator/prompts/catalogs.ts`）中，仅当本轮触发黑客规则或正文发生黑客攻防时，按需附带紧凑的 12 项常见快速破解 ID 对照表，供 `hack` / `npcHack` 准确归类；
    - 精简 `hackingRules.narrate`，严格遵守 `AGENTS.md`“文笔交给预设”，只保留世界事实、物理拓扑约束与知情边界。

### 原则 4：取消 RAM 数值门槛，用“硬件档次、特化方向与物理链路”决定成败与后果

> 不算 RAM 格子比大小；拿街头廉价仓去撞公司数据堡垒或军用黑冰会被挡回、触发警报或反噬烧脑；断网主机必须走过去插个人连接线或先黑进局域网跳板。
- **现状卡点**：
  - `applyHack` 和 `applyNpcHack` 靠 `if (def.ram > draft.ramMax) return fail(...)` 做硬性数值拦截；
  - `cyberware.ts` 中 7 款接入仓与脑部黑客义体的档次和特化没有结构化定性摘要；
  - `context.ts` 的 `physicsSection` 未过滤损坏接入仓，也未将场景气隙、子网、纯肉体目标、硬化黑冰传入 `evaluateHackTopology`；
  - `Judge` 单一 `ruling` 同时被玩家行动与 `applyNpcHack` 读取，导致敌我裁决耦合。
- **收敛方案**：
  - **取消 RAM 数值比大小，改为“硬件档次与特化方向”定性约束**：
    - 移除 `applyHack` 与 `applyNpcHack` 中 `def.ram > draft.ramMax` 的报错阻断，移除 `HackingStateSchema.ramMax`（或不再作为数字门槛）；
    - 为接入仓与脑部黑客辅助义体提供清晰的定性档次与特化描述（`deckProfile` / `deckTraits`）：
      - **街头入门仓**（`militech-paraline` 军用科技平行线、`biotech-sigma` 生物科技 Σ）：应付街头摄像头、门锁、普通帮派义体绰绰有余；强闯公司/军用级黑冰极易被挡回或反追踪；
      - **荒坂隐蔽仓**（`arasaka-deck`）：擅长潜行渗透、抹除痕迹与低噪控制，不易触发内网警报；
      - **渡鸦群控仓**（`raven-microcyber`）：擅长局域网群发与多节点同步压制；
      - **四相强攻仓**（`tetratronic-rippler`）：高功率神经冲击与义体烧毁，正面压制力强；
      - **网监防护仓**（`netwatch-netdriver`）：深厚防火墙与反黑客溯源能力；
      - **军用科技黑墙仓**（`militech-canto`）：搭载黑墙边缘异质协议，破坏力极端但伴随着极高的神经灼烧与失控风险；
      - **关键防护与脑机配件**：是否装有完好 `self-ice`（自我 ICE）、`ex-disk` / `memory-boost` / `camillo-ram-manager` 等脑部散热与缓冲组件。 - `Judge` 结合双方硬件档次、特化方向与现场防线直接给出 `possible | costly | blocked` 因果裁决：拿街头仓硬黑军用黑冰不会弹出“RAM 差 2 格”的系统提示，而是真实演变为“破冰失败惊动敌方网络黑客，顺着链路反向烧灼你的视神经”。
  - **物理链路校验真实接通（`narrator/prompts/context.ts` `physicsSection`）**：
    - 使用 `deckOf(installed.filter(c => !broken.includes(c.id)), safeData)` 判定 `hasCyberdeck`，接入仓在 `health.brokenChrome` 中受损时无法无线脑机入侵；
    - 从当前场景/地点事实与在场目标义体状态提取 `targetAirGapped`（物理断网/气隙隔离）、`requiredSubnet`（尚未 `breach` 的封闭局域子网）、`targetUnchromed`（纯肉体无联网义体目标）、`hardenedIce`（公司数据堡垒/军用级黑冰），真实传入 `evaluatePhysicsBoundaries({ hackCheck })`；
    - 没装完好接入仓不能隔空快速破解；面对气隙隔离终端必须走到跟前拔出个人连接线直插（`directLink`），或先找到物理接入点攻破局域网（`breach`）。
  - **敌我裁决解耦（`stages.ts`, `turn.ts`, `dice/facts.ts`, `hacking/apply.ts`）**：
    - 在 `JudgeDocSchema`（`packages/core/src/narrator/stages.ts`）增加可选 `counterHack`（仅当场上敌方黑客本轮对玩家发起攻击/控制破解时填写，含 `outcome`、`harm: "none" | "graze" | "heavy" | "lethal"`、`reason`），平时为 `null`；
    - `turn.ts` 将其写入独立的 `facts.npcHackRuling`，`applyNpcHack` 优先读取 `npcHackRulingFact(ctx.facts)`，使玩家主行动（如开枪、翻窗、撬锁）与敌方黑客反击各自按真实攻防独立结算，互不覆盖。

### 原则 5：黑客设备、地点与界面的价值来自故事中的用途

> 激活地图上已有的 7 个 `netrunner` 服务点买卖实物硬件与情报芯片，不做“法术技能书商店”或“程序槽管理面板”，彻底清理破冰矩阵小游戏残留。
- **现状卡点**：
  - `servicePoints.gen.ts` 已有 7 个 `kind: "netrunner"` 服务点，但 `MerchantSiteSchema`、`merchant-sites.ts` 与 `Shop.tsx` 均未接通 `"netrunner"`；
  - `BreachMatrix.tsx` 与 `Pending.matrix` 仍残留在代码库中；
  - `Zone` 未展示当前地点已攻破的内网权限，人物扫描未突出显示敌方接入仓与 `self-ice` 威胁。
- **收敛方案**：
  - **彻底移除破冰矩阵小游戏与旧检定残留**：
    - 删除 `apps/web/src/features/story/BreachMatrix.tsx`，清理 `StoryScreen.tsx` 中 `BreachMatrix` 的引用与 `matrix={false}` 传参；
    - 清理 `packages/core/src/schemas/turn.ts`、`packages/core/src/narrator/turn.ts`、`packages/core/src/narrator/block.ts`、`apps/server/src/game.ts`、`apps/web/src/api/client.ts` 等处遗留的 `matrix` / `Pending.matrix` 旧检定钩子。
  - **自然激活 7 个 `netrunner` 黑客服务点**：
    - 在 `packages/core/src/systems/world/merchant-sites.ts`（`MerchantSiteSchema`）、`packages/content/src/merchant-sites.ts`（`ShopKind` 与 `SHOP_SEEDS`）及 `apps/web/src/features/story/Shop.tsx`（`SHOP_POI_ICON`）补齐 `"netrunner"`；
    - 黑客服务点售卖的是**世界内的真实物件**：黑客连体服（`netrunner-suit`）、冷却/脑机配件、EMP 手雷、加密情报芯片/数据载体等实物，以及作为义体安装渠道的接入仓与 `self-ice` 硬件，**不卖“+1 法术技能书”**。
    - 击败 `archetype === "netrunner"` 敌人时（`combat/apply.ts` `drawLoot`），可自然掉落加密数据芯片或电子配件。
  - **界面低调自然衔接（零新增浮窗、零槽位管理面板）**：
    - **`Zone`（`Corners.tsx`）**：当玩家所处地点有已攻破内网（`view.hacking?.breaches` 非空）时，在地点信息下低调显示已控制权限（如 `漩涡帮仓库内网 · 门禁/摄像头`），无侵入时不占位；
    - **人物扫描（`Corners.tsx` `PresentPerson` & `Profile.tsx`）**：当扫描结果 `scan.chrome` 含有接入仓或 `self-ice` 时，自然标出「接入仓」「自我 ICE」识别标签，让玩家在动手前知晓对方是网络黑客或有防黑硬件；
    - **义体与生物监测面板（`NeuralPages.tsx` & `BiomonitorPanel.tsx` & `CreatorSteps.tsx`）**：`CyberwarePage` 与 `BiomonitorPanel` 只展示当前接入仓名称、硬件档次/特化说明与完好状态，去掉 `programs` 槽位列表与 `ramMax` 格子条；创角 Step 3 同步去掉 `freePrograms` 静态槽位预览。

---

## 三、清理与改造清单对照

| 维度               | 彻底清理的跑团/RPG残留                                                                                             | 保留并补齐的因果沙盘机制                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **容量与门槛**     | 删去 `def.ram > draft.ramMax` 数字比大小报错；不在状态与 UI 强调“几格 RAM”                                         | 用接入仓定性档次、硬件特化方向（隐蔽/群控/强攻/网监/黑墙）与完好 `self-ice` 参与 `Judge` 因果裁决                                                                  |
| **程序与槽位**     | 删去 `programs` 槽位上限拦截、`!programs.includes` 白名单阻断、`hack learn/drop` 腾槽手续；不做 `library` 装卸面板 | 装有完好接入仓即可按现场条件执行黑客动作；12 个 `quickhacks` 作为常见黑客手段词典供模型归类参考                                                                    |
| **小游戏与旧检定** | 删除 `BreachMatrix.tsx` 5×5 小游戏；清理 `Pending.matrix` 及请求层 `matrix` 分支                                   | 入侵协议（`breach`）直接按现场接入条件（直插终端、接入点、摄像头跳板）与防线强度在故事中自然结算                                                                   |
| **状态持久化**     | 不建 `activeEffects` 倒计时 Buff/Debuff 表；不做 `traces` 进度条                                                   | 只记跨回合持久事实：`breachedNetworks`（已破内网权限）、`disabledEnemyChrome`/`brokenChrome`（瘫痪硬件）、`dive`（深潜状态）、`alert`/`injuries`（警戒与神经伤势） |
| **物理拓扑与裁决** | 改变 `physicsSection` 盲目传 `deck !== null` 且漏传拓扑参数的现状                                                  | `deckOf` 过滤损坏义体；接通气隙隔离 `targetAirGapped`、子网 `requiredSubnet`、纯肉体 `targetUnchromed`、硬化黑冰 `hardenedIce`；新增 `counterHack` 解耦敌我裁决    |
| **提示词与商店**   | 取消 `state.deck !== null` 每轮常驻 2.3k 规则；不做“买芯片写进法术书”                                              | `hackingRules` 仅在潜网或本轮涉及黑客攻防时激活；`hackingStatus` 极简一行；激活 7 个 `netrunner` 服务点买卖实物装备与数据芯片                                      |

---

## 四、调用与 Token 策略

- **LLM 调用次数**：保持 **0 额外调用**。玩家黑客行动、局域网权限获取、潜网深潜与敌方 `counterHack` 反制全部在既有四阶段（`Judge -> Context -> Narrate -> Extract`）与确定性结算内核中一次完成。
- **上下文 Token 降噪**：
  - 非黑客相关的日常、跑路、肉搏、社交回合不再注入 2.3k 字符的 `hackingRules`；
  - `hackingStatus` 从多行程序槽位与 RAM 说明压缩为单行定性硬件状态（未装接入仓时完全为空）。

---

## 五、分步实施顺序（待确认后执行）

1. **步骤 1（清理跑团/RPG残留与重构接入仓定性模型）**：
   - 在 `packages/core/src/systems/hacking/`（`schema.ts`、`apply.ts`、`view.ts`、`status.ts`）中移除 `programs` 槽位限制、`hack learn/drop` 手续与 `def.ram > draft.ramMax` 数字门槛；保留 `breachedNetworks`、`dive` 与 `resolvedNpcHacks` 持久事实；
   - 在 `packages/core/src/systems/cyberware/schema.ts` 与 `packages/content/src/cyberware.ts` 为接入仓和黑客脑部义体补充定性特化描述（`deckTraits` / 定性档次），由 `deckOf` / `npcDeckOf` 过滤 `brokenChrome` 后输出定性硬件摘要与 `selfIce: boolean`；
   - 清理 `packages/core/src/schemas/turn.ts`、`narrator/turn.ts`、`narrator/block.ts`、`apps/server/src/game.ts` 中的 `matrix` 旧检定分支，并更新相关 schema/导出。
2. **步骤 2（物理链路接通、敌我裁决解耦与提示词按需降噪）**：
   - 修复 `packages/core/src/narrator/prompts/context.ts` 的 `physicsSection`：用 `deckOf` 过滤损坏接入仓，并将 `targetAirGapped`、`requiredSubnet`、`targetUnchromed`、`hardenedIce` 真实接入 `evaluateHackTopology`；
   - 在 `packages/core/src/narrator/stages.ts`、`turn.ts`、`systems/dice/facts.ts`、`systems/hacking/apply.ts` 中新增可选 `counterHack` / `facts.npcHackRuling`，解耦玩家主行动与敌方 `npcHack` 裁决；
   - 改造 `packages/core/src/systems/hacking/prompt.ts`、`status.ts` 与 `narrator/prompts/catalogs.ts`：收紧 `hackingRules.when` 为潜网中或本轮涉及黑客/电子设备攻防时按需激活，极简化 `hackingStatus`，按需提供 12 项快速破解手段参考，并严守预设文风边界。
3. **步骤 3（激活 7 个黑客服务点与前端界面自然收口）**：
   - 在 `packages/core/src/systems/world/merchant-sites.ts`、`packages/content/src/merchant-sites.ts`、`packages/core/src/systems/combat/apply.ts` 与 `apps/web/src/features/story/Shop.tsx` 激活 7 个 `netrunner` 服务点与黑客敌方实物/数据芯片掉落；
   - 删除 `apps/web/src/features/story/BreachMatrix.tsx` 并清理 `StoryScreen.tsx`、`CreatorSteps.tsx`、`creator.ts`、`NeuralPages.tsx`、`BiomonitorPanel.tsx` 中的矩阵小游戏与程序槽位展示；
   - 在 `Corners.tsx`（`Zone` 低调显示当前地点已攻破内网权限、`PresentPerson` 标出接入仓/`self-ice`）与 `Profile.tsx` 完成自然状态衔接；运行 `pnpm typecheck` 与 `pnpm lint` 检查并分步提交。
