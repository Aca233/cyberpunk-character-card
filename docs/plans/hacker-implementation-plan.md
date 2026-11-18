# 黑客（潜网行者 / Netrunner）系统完整实现与闭环方案

- **状态**: 规划中（2026-11-18）
- **目标**: 基于当前零骰点定性因果架构与原子事件结算框架，打通黑客玩法从「建档起步 → 商店/掉落获取 → 快速破解/入侵/潜网执行 → 拓扑与敌我反制 → 前端状态反馈」的完整闭环，同时严守既有设计铁律与精简原则。

---

## 1. 现状基线与核心设计约束

### 1.1 已有模块与基础资产

项目当前已在核心层、内容库与前端界面的多个位置落地了黑客基础结构，并非从零开始：

1. **核心状态与指令（`packages/core/src/systems/hacking/`）**
   - 状态结构 `HackingStateSchema`（`schema.ts`）：包含 `deck`（当前完好接入仓 ID）、`ramMax`（运行容量上限）、`programs`（已装配程序 ID 列表）、`breachedNetworks`（已攻破局域网，上限 `BREACH_KEEP = 20`）、`dive`（潜网状态 `{ layer, startedAt, chair, guard }`）、`resolvedNpcHacks`（防敌方快速破解重复结算）。
   - 指令集：`HackCommandSchema`（`use | learn | drop`）、`BreachCommandSchema`（`network`, `via?`, `gains: ("doors" | "cameras" | "turrets" | "data" | "alarms")[]`）、`DiveCommandSchema`（`start | deeper | surface`，共 5 层 `DIVE_LAYERS`：`本地子网 → 城区网络 → 公司数据堡垒 → 网络监察巡查带 → 黑墙边缘`）、`NpcHackCommandSchema`（`id`, `program`, `target`）。
   - 容量与同步：`deckOf` / `syncDeck` / `npcDeckOf`（`apply.ts`）从完好义体计算 `deck`、`ramMax`（累加各完好义体 `ram` 字段）与 `slots`（读取 `os` 义体的 `programSlots`），并响应 `"cyberware.changed"` 信号；`hackingView`（`view.ts`）向 `PlayerView.hacking` 投影，`hackingStatus`（`status.ts`）向 `【当前状态】` 输出。
2. **物理拓扑校验与关联系统**
   - `packages/core/src/netrunning.ts`：`AccessVectorSchema`（`directLink | localSubnet | wireless`）、`evaluateHackTopology(HackTopologyCheckInput)`、`hasSubnetAccess`。
   - `packages/core/src/physics.ts`：`evaluatePhysicsBoundaries` 已接入 `hackCheck`。
   - 关联枚举与态势：`WorldClockStateSchema` 的 `ActivitySchema` 已含 `"quickhack"` / `"breach"`；`heat/schema.ts` 的 `EVENT_KINDS` 已含 `"publicHack"`；`combat/schema.ts` 的 `ArchetypeSchema` 已含 `"netrunner"`；`tension/schema.ts` 的 `TensionModeSchema` 已含 `"deepDive"`，且 `TensionSiteSchema` 已具备 `scannedEnemyChrome` / `disabledEnemyChrome` / `backupEtaMinutes`。
3. **内容库资产（`packages/content/src/`）**
   - `hacking.ts`：12 个 `quickhacks`（`ping`、`sonic-shock`、`memory-wipe`、`reboot-optics`、`cripple-movement`、`weapon-glitch`、`overheat`、`short-circuit`、`contagion`、`cyberpsychosis`、`suicide`、`system-collapse`），含 `category`（`covert | control | damage | ultimate`）、`ram`（1–5）与 `effect`。
   - `cyberware.ts`：7 款 `os` 网络接入仓（`militech-paraline`、`biotech-sigma`、`raven-microcyber`、`arasaka-deck`、`tetratronic-rippler`、`militech-canto` 及不朽 `netwatch-netdriver`），以及 `ram-upgrade`、`ex-disk`、`memory-boost`、`camillo-ram-manager`、`self-ice`、不朽 `ram-reallocator`、`cox2-optimizer` 等脑部辅助义体（注：部分额叶皮质/皮肤/骨骼义体亦有 RAM 相关 `ability` 文案，如 `cogito-lattice`、`feen-x`、`ram-recoup`）。
   - `modules.ts` & `loadouts.ts`：包含出身 `origin-netrunner`、`origin-arasaka-netrunner`，过往 `netrunner-self-taught`，特长 `quickhacking`，以及背景行装 `netrunner`（`netrunner-suit` + `militech-paraline` + `["ping", "reboot-optics", "short-circuit"]`）。
   - `npcs.ts`：多名原作黑客 NPC 已配齐接入仓与 `self-ice`（如 `t-bug`、`nix`、`carol`、`brigitte`、`songbird`）。
   - `servicePoints.gen.ts`：地图生成数据已包含 7 个 `kind: "netrunner"` 服务点（如 `wat_kab_netrunner_01`「边缘网络」、`hey_rey_netrunner_01_mp`、`wbr_jpn_netrun_01`、`wbr_jpn_netrun_02`、`pac_cvi_tech_01`、`cz_stadium_netrunner_01`、`ne3_aldecaldos_camp_chang`）。
4. **前端界面既有钩子（`apps/web/src/features/`）**
   - `Corners.tsx`（`BioMonitor`、`Banner`）、`BiomonitorPanel.tsx`（Card 3 `LINK` 中的 `DECK ONLINE` 与 `deckMeterTrack`）、`DivePanel.tsx`（5 层潜网侧栏）、`NeuralPages.tsx`（`CyberwarePage` 的 `os` 槽位展示 `view.hacking.programs`）、`BreachMatrix.tsx`（5×5 矩阵破冰组件）及 `CharacterCreator.tsx` / `CreatorSteps.tsx` / `creator.ts`（`originEcosystem` `"net"` 与 `freePrograms` 预览）。

### 1.2 必须遵守的设计铁律与项目约定

1. **制作阶段不做历史兼容（`AGENTS.md`）**：直接演进或替换数据结构与接口，不保留旧格式双轨兜底或迁移层。
2. **零骰点与定性因果裁决（`JudgeRulingSchema`、`docs/sandbox-cleanup-delivery.md`、`docs/causal-settlement-design.md`）**：
   - 不恢复 `2d6` 属性掷骰或属性点数门槛；可行性与代价由 `Judge` 结合物理拓扑与硬件条件作出 `possible | costly | blocked` 裁决（`rulingFact`），提取阶段通过 `EventPlanSchema`（`$action` 及前置事件依赖）原子提交或回滚。
3. **黑客系统已验证的四大规则不变量（`packages/core/src/systems/hacking/integration.test.ts`）**：
   - **禁止场景级 RAM 配额**：`ramMax` 是单次上传的硬件运行容量上限，上传结束立即释放，不得演变为每场耗尽、切场重置的法力条（`HackingState` 禁止出现按场扣除的 `ram` 余额字段）。
   - **禁止自我 ICE 次数配额**：`self-ice` 不得做成「每场自动免伤 1 次」的计数器（禁止 `selfIceSpent` 类字段），敌方破解能否命中必须遵循本轮真实攻防与链路裁决。
   - **禁止终极破解自动扣人性**：施放或承受 `ultimate` 类程序不得自动扣除 `humanity` 分数；仅记录真实发生的神经症状或硬件/身体伤势。
   - **禁止切场或休息自动清空网络状态**：切换场景、结束战斗或休息不得自动重置 `dive` 或清除 `breachedNetworks`。
4. **提示词质量与预设文风边界（`AGENTS.md`）**：
   - 正文文笔交由写作预设，`hackingRules.narrate` 仅保留世界事实、物理因果与知情边界，不叠加感官描写配额或通用修辞模板。
5. **UI 精简与零角落膨胀原则（`docs/plans/` 近期系列方案）**：
   - 不新增顶部/角落常驻卡片与悬停陷阱，复用 `NineSlice`、`CellFrame`、`Panel` 与既有抽屉/详情页承载黑客交互。
6. **测试边界（`AGENTS.md`）**：
   - 代码修改完成后仅运行 `pnpm typecheck`（`tsc`）、`pnpm lint`（`biome`）及 `pnpm check-data` 等静态检查，不主动执行单元测试/集成测试/浏览器测试，交由用户自行验收。

---

## 2. 现存关键缺口（为何当前尚未闭环）

结合核心机制、叙事提示词与前端/内容库审计，当前黑客系统处于「有骨架、缺闭环」状态，主要卡在以下 10 个真实代码缺口：

1. **物理拓扑前置校验未完整接通（`narrator/prompts/context.ts`）**：
   - `physicsSection` 直接读取 `hacking.data.deck !== null`，**未通过 `deckOf` 过滤 `health.brokenChrome`**，导致接入仓被打坏时前置物理提示仍误判为可用；
   - `physicsSection` 传给 `evaluatePhysicsBoundaries` 的 `hackCheck` 仅包含 `vector`、`hasCyberdeck`、`breachedSubnets`，**从未传入 `targetAirGapped`、`requiredSubnet`、`targetUnchromed`、`hardenedIce`**，导致 `evaluateHackTopology` 的核心物理阻断分支在真实回合中几乎处于休眠态。
2. **抽取阶段缺少快速破解目录索引（`narrator/prompts/context.ts` & `catalogs.ts`）**：
   - `tablesOf()` 仅包含 `items`、`cyberware`、`jobTemplateSection`；`extractCatalogDetails()` 也只展开 `items` 与 `cyberware`。`quickhackCatalog` 仅在 `hackingStatus` 中列出「玩家已装程序」，导致模型在执行 `hack learn` 或敌方 `npcHack` 时缺少完整 12 个快速破解的 ID 与容量参照。
3. **规则触发过宽且触发词重复（`hacking/prompt.ts` & `context.ts`）**：
   - `hackingRules.when` 只要 `state.deck !== null` 就每轮无条件注入约 2.3k 字符的骇入规则（包括普通酒吧闲聊回合），造成提示词膨胀；
   - `hacking/prompt.ts` 的 `HACK` 正则与 `context.ts` 的 `HACK_ATTEMPT` 正则各自维护、口径不一致（例如后者不含 `RAM`/`ICE`/`破解` 等词）。
4. **接入仓与专业黑客义体仅有纯文本差异**：
   - `cyberware.ts` 中 7 款接入仓（如潜行向 `arasaka-deck`、传播向 `raven-microcyber`、输出向 `tetratronic-rippler`、黑墙向 `militech-canto`、网监 `netwatch-netdriver`）与 `self-ice`、`memory-boost` 等的特色机制目前全靠 `ability` 字符串描述，缺少结构化特征标签供代码/裁决稳定识别。
5. **缺少程序获取经济闭环（`inventory/schema.ts`、`systems/world/merchant-sites.ts`、`content/src/merchant-sites.ts`、`content/src/shops.ts`）**：
   - `ItemKindSchema` 不含程序/芯片品类；`servicePoints.gen.ts` 已存在 7 个 `kind: "netrunner"` POI，但 `packages/core/src/systems/world/merchant-sites.ts` 的 `MerchantSiteSchema`（`kind` 枚举）、`packages/content/src/merchant-sites.ts` 的 `ShopKind` 与 `Shop.tsx` 的 `SHOP_POI_ICON` 均漏掉 `"netrunner"`，导致夜之城没有任何黑客商店可买程序或黑客工具，`hack learn` 只能靠模型剧情随缘赠送。
6. **玩家无法在界面管理或调整已装快速破解（`actions.ts`、`NeuralPages.tsx`、`CreatorSteps.tsx`）**：
   - `PlayerActionSchema` 没有任何黑客操作，玩家在非战斗时无法在 `CyberwarePage` / `BiomonitorPanel` 自行卸载、替换或从已拥有程序库中装入快速破解；创角 Step 3（`chrome_kit`）的 `LoadoutPicker` 也仅将 `freePrograms` 当作只读文本展示，玩家无法在建档时查看效果或自选初始程序。
7. **目标与场景缺少瞬时黑客状态效应与网络拓扑记录**：
   - 控制/隐蔽/持续伤害类破解（如 `reboot-optics` 致盲、`cripple-movement` 定身、`weapon-glitch` 卡壳、`ping` 标出联网单位、`overheat` 灼烧、`contagion` 传染）在 `NpcVitals`、`ActiveFoeSchema` 或 `HackingState` 中无状态落点；`LocationDefSchema` / `SavedPlaceSchema` 也无场所网络拓扑（子网名、气隙、冰墙等级）数据。
8. **`Judge` 单一 `ruling` 与敌方 `npcHack` 的耦合风险（`narrator/stages.ts` & `turn.ts`）**：
   - `docs/causal-settlement-design.md` 已指出每轮仅有一份 `facts.ruling`。当玩家本轮执行物理/潜入行动（可能 `blocked` 或 `harm: "none"`），而同回合敌方黑客发动 `npcHack` 时，单一 `ruling` 同时被 `applyHack`/`applyBreach` 和 `applyNpcHack` 读取，容易导致敌我攻防裁决相互干扰。
9. **非战斗/战斗黑客数据孤立与掉落空白（`combat/apply.ts`、`Profile.tsx`）**：
   - `combat/schema.ts` 虽有 `archetype: "netrunner"`，但 `drawLoot` 仅掉枪支和通用消耗品，不掉黑客程序芯片或加密数据；`Profile.tsx` / `PresentPerson` 扫描面板仅列出 `scan.chrome`，未突出显示敌方接入仓 / `self-ice` 威胁。
10. **前端既有投射与交互组件沉睡（`Corners.tsx`、`StoryScreen.tsx`）**：
    - `hackingView` 已投射当前地点的 `breaches`，但前端界面完全未渲染已攻破网络；`BreachMatrix.tsx` 已实现且 `map.poi.netrunner` 素材已生成，但 `StoryScreen.tsx:812` 硬编码 `matrix={false}`，且新零骰点模式下旧 `CheckBar` 已不再触发。

---

## 3. 分模块落地方案

### A. 核心数据模型与确定性机制（`packages/core`, `packages/content`）

#### A1. 接入仓与黑客义体结构化特性（`packages/core/src/systems/cyberware/schema.ts` & `packages/content/src/cyberware.ts`）
- 在 `CyberwareDefSchema` 补充可选结构化黑客标签 `deckTraits`（如 `z.array(z.enum(["stealth", "spread", "combat", "blackwall", "netwatch", "antiIce", "recovery"]))`），并在 `packages/content/src/cyberware.ts` 为对应接入仓与脑部黑客义体补标：
  - `arasaka-deck` → `["stealth"]`；`biotech-sigma` → `["stealth", "antiIce"]`；`raven-microcyber` → `["spread"]`；`tetratronic-rippler` → `["combat"]`；`militech-canto` → `["blackwall", "spread"]`；`netwatch-netdriver` → `["netwatch", "antiIce"]`；`self-ice` → `["antiIce"]`；`memory-boost` / `camillo-ram-manager` / `ram-reallocator` → `["recovery"]`。
- `deckOf` 与 `npcDeckOf`（`packages/core/src/systems/hacking/apply.ts`）同步返回 `traits` 与 `selfIce: boolean`（检查完好已装义体是否含 `self-ice`），供 `hackingView`、`hackingStatus`、NPC 扫描投影和 `physicsSection` 直接消费，无需每次靠文本匹配猜测硬件特性。

#### A2. 真实网络拓扑与 `physicsSection` 完整接通（`packages/core/src/systems/world/schema.ts`, `systems/hacking/schema.ts`, `narrator/prompts/context.ts`）
- **地点/场所网络元数据**：在 `LocationDefSchema`（`world/schema.ts`）及 `SavedPlaceSchema` 增加可选 `network` 字段：
  ```ts
  NetworkTopologySchema = z.object({
    subnet: z.string().min(1),
    ice: z.enum(["open", "street", "corp", "military"]).default("street"),
    airGapped: z.boolean().default(false),
    devices: z.array(z.enum(["doors", "cameras", "turrets", "alarms", "terminals"])).optional(),
  })
  ```
  在 `packages/content/src/locations.ts` 为关键企业区/高安防地点补齐典型 `network` 定义（未知新地点默认缺省，由场景事实补充）。
- **修复 `physicsSection`（`narrator/prompts/context.ts`）**：
  - 改用 `deckOf(installed.filter(c => !broken.includes(c.id)), safeData)` 判断 `hasCyberdeck`，确保接入仓损坏时准确拦截；
  - 读取当前 `place.network`、`breachedNetworks` 以及场上扫描/已知 NPC 身体状态（若输入指向某位纯肉体 NPC 且无电子义体可标 `targetUnchromed`），将 `requiredSubnet`、`targetAirGapped`、`hardenedIce`（`ice === "corp" || ice === "military"`）真实喂给 `evaluatePhysicsBoundaries({ hackCheck })`。

#### A3. 合规的「追踪 / 神经过载压力」机制（严守无配额铁律）
- **严禁做每场消耗型 RAM 池**：保持 `ramMax` 作为单次程序运行容量上限，保留 `integration.test.ts` 对 `not.toHaveProperty("ram")` 的契约。
- **以「反追踪警戒 / 过载热负荷」替代资源配额**（扩展 `HackingStateSchema`）：
  - 新增 `traces: z.record(z.string(), TraceStateSchema)`（按地点/网络或子网记录：`active: boolean`、`stage: "none" | "pinged" | "locating" | "locked"`、`source: string`、`startedAt: number`、`reason: string`）与 `neuralHeat: z.object({ level: z.enum(["cool", "warm", "overheated"]), reason: z.string(), at: number }).nullable()`。
  - **机制边界**：普通低烈度破解不蓄槽；只有在强闯企业/军用硬化冰墙、触发敌方黑客溯源、潜网深潜第 3–5 层或极限超频（如 `militech-canto` 黑墙网关）时，由 `Extract` 或 `npcHack` 写入真实的「正在被反追踪 / 神经发烫」定性态势；脱离网络、切掉链路（或消耗时间散热/物理断开）才能解除，绝不按「本场已用次数」自动触发。

#### A4. 轻量化瞬时破解状态效应（`packages/core/src/systems/hacking/schema.ts` & `combat` / `tension` 联动）
- 为让 `reboot-optics`（致盲）、`cripple-movement`（锁腿）、`weapon-glitch`（武器卡壳）、`sonic-shock`（断联）、`overheat`（灼烧）、`ping`（网络透视）在后续回合保持因果一致性，在 `HackingStateSchema` 中增加轻量 `activeEffects`（最多保留 16 条）：
  ```ts
  QuickhackEffectSchema = z.object({
    id: z.string().min(1),
    program: z.string().min(1),
    target: z.string().min(1),       // 杂兵/NPC id 或设备描述
    npc: z.string().nullable(),
    location: z.string().nullable(),
    appliedAt: z.number().int(),
    expiresAt: z.number().int().nullable(), // 控制/隐蔽类通常 1–5 分钟或本场冲突内
    note: z.string().min(1),
  })
  ```
- `applyHack`（`use`）执行控制/隐蔽/持续伤害类程序且未受 `blocked` 时，自动登记或刷新对应 `activeEffects`（也可联动 `tension` 的 `disabledEnemyChrome` 记录被黑停的义体/炮塔/摄像头）；`tickHacking` 随 `world.time` 推进清理过期效果（遵循时间流逝而非切场清空）。`hackingStatus` 将当前地点未过期的生效状态（如「门卫义眼重启中」「全网单位已被定位」）简要写入 `【当前状态】`。

#### A5. 程序芯片物品、黑客商店与 `PlayerAction` 闭环
- **软件程序库与背包芯片（`packages/core/src/systems/inventory/schema.ts`, `systems/hacking/schema.ts`, `systems/world/merchant-sites.ts`）**：
  - 在 `HackingStateSchema` 增加 `library: z.array(z.string()).default([])`（玩家已掌握/购买/拷贝拥有的快速破解程序 ID 库，`programs` 为当前接入仓热插拔激活的槽位列表；`newGameWorld` 初始程序同时写入 `library` 与 `programs`）。
  - 在 `ItemKindSchema` 新增 `"quickhack"`（或 `"program"`）品类，支持绑定 `programId: z.string().optional()`；在 `packages/content/src/items.ts` 为 12 个 `quickhacks` 生成对应的快速破解芯片条目（注：`packages/core/src/authoring/prices.ts` 的 `contentPriceIssues` 当前仅校验 `weapon`/`mod`/`cyberware`；可同步在 `prices.ts` 增设 `QUICKHACK_PRICES` 档位或按稀有度设定芯片参考价，如 `common` 500–1,500€、`ultimate`/`legendary` 25,000–45,000€），并在 `combat/apply.ts` 的 `drawLoot` 中让 `archetype === "netrunner"` 敌人概率掉落芯片与普通情报数据，不再只掉手枪和手雷。
  - 在 `packages/core/src/systems/world/merchant-sites.ts` 的 `MerchantSiteSchema`（`kind` 枚举）及 `packages/content/src/merchant-sites.ts` 的 `ShopKind` 同步加入 `"netrunner"`，配置黑客商贩的 `SHOP_SEEDS`（售卖 `quickhack` 芯片、`netrunner-suit`、EMP 手雷及电子零件），自动激活 `servicePoints.gen.ts` 中已有的 7 个夜之城黑客服务点并通过 `worldRules.MerchantSiteSchema.parse` 校验；同时允许在 `shops.ts` 为来生/歌舞伎区增设特色黑客商贩或补货路线。
- **新增玩家直接操作（`packages/core/src/actions.ts` & `systems/hacking/actions.ts`）**：
  - `LoadQuickhackActionSchema`（`type: "loadQuickhack"`, `program: string`）：非战斗时从 `library` 装入接入仓空槽，受 `deckOf().slots` 与 `def.ram <= ramMax` 校验；
  - `UnloadQuickhackActionSchema`（`type: "unloadQuickhack"`, `program: string`）：非战斗时从 `programs` 卸下回到 `library`；
  - `LearnQuickhackChipActionSchema`（`type: "learnQuickhackChip"`, `item: string`）：在背包中使用 `quickhack` 芯片，消耗芯片并将对应 `programId` 永久收录进 `library`（若有空槽可顺手装入）。
  - 保留模型 `hack` 指令的 `learn` / `drop`（用于剧情中从终端/NPC 直接拷走或临时腾槽），与 `library` 同步一致。

---

### B. AI 提示词与四阶段因果结算（`judge -> context -> narrate -> extract`）

#### B1. 确定性与 LLM 的清晰职责边界
| 环节 | 确定性代码负责（`packages/core`） | LLM 负责（`Judge / Narrate / Extract`） |
|---|---|---|
| **硬件与拓扑门槛** | 完好接入仓存在性（过滤 `brokenChrome`）、`ramMax >= def.ram`、`programs` 槽位与已装校验、NPC `npcDeckOf` 与存活校验、`evaluateHackTopology` 硬阻断（无仓/纯肉体/气隙/未破子网） | 判断非标准化现场条件：信号遮挡、肉身掩体、是否来得及直插连接线、企业/军用 ICE 具体强度与反制策略 |
| **攻防与伤害结算** | `applyNpcHack` 校验 NPC 接入仓与容量、`resolvedNpcHacks` 去重、按 `ruling.harm` 原子派发 `head` 神经伤害、`harmfulHackEvents` 阻止重复 `damage`/`combat wound` | `Judge` 结合双方接入仓 `deckTraits`、是否装有完好 `self-ice`、是否断链规避，定性给出本次 `ruling` 与 `foes` 反制意图 |
| **状态持久化与因果** | `breachedNetworks`（按地点留存）、`dive`（5 层持续状态）、`activeEffects`（按时间过期）、`EventPlanSchema`（`$action` 失败阻断下游收益，保留独立代价/报警/伤势） | `Extract` 将正文事实准确归组（如 `breach` → `loot`/`shard`，失败只记 `alert`/`damage`/`traces`） |

#### B2. 按需注入规则与目录瘦身（`hacking/prompt.ts`, `context.ts`, `catalogs.ts`）
1. **收紧 `hackingRules.when` 触发条件**：
   - 统一提取一份共享意图探测（合并 `hacking/prompt.ts` 的 `HACK` 与 `context.ts` 的 `HACK_ATTEMPT` 为公共导出函数 `mentionsHacking(text)`）。
   - 修改 `hackingRules.when(state, input)`：仅当 `state.dive !== null`、`state.traces` 存在活跃追踪、`state.activeEffects` 非空、或 `input.mode !== "ooc" && mentionsHacking(input.text)` 时才注入完整 `hackingRules`（日常买菜、纯肉搏对话不再因为玩家装有接入仓而白白携带 2.3k 规则文本；`hackingStatus` 仍常驻几行轻量概要，确保模型始终知道玩家有接入仓和已装程序）。
2. **精简 `hackingRules.narrate` 遵守预设边界**：
   - 移除 `narrate` 中偏向特定文风修饰的形容词要求，只保留硬事实规则：程序效果不得越界（控制类≠洗脑失忆）、未成功上传不得写烧脑成功、严禁泄露未扫描子网/ICE 陷阱或 NPC 隐藏秘密、不得替玩家自动插线/发起破解/强行上浮。
3. **补齐按需 `quickhacks` 目录供抽取使用（`catalogs.ts` & `extract.ts`）**：
   - 不在每轮 `tablesOf()` 无条件全量倾倒 12 个程序；调整 `packages/core/src/narrator/prompts/extract.ts`（先计算 `modules` 或将 `plan.input` 传入 `extractCatalogDetails`）与 `packages/core/src/narrator/prompts/catalogs.ts`（`extractCatalogDetails`），当本轮激活了 `hacking` 规则模块（或复用 `hackingRules.when` / `mentionsHacking`）或正文/输入提及任何程序名/黑客/NPC `npcHack` 时，注入紧凑的 `【本轮相关快速破解表】`（`id 名称｜类别｜RAM｜效果`），使 `hack learn` 与 `npcHack` 拥有 100% 准确的 ID 核对依据。

#### B3. `Judge` 敌我裁决解耦（解决单一 `ruling` 耦合）
- 在 `JudgeDocSchema`（`packages/core/src/narrator/stages.ts`）中为敌方网络反击增加可选轻量字段 `counterHack`（仅当场上有敌方黑客对玩家上传攻击性/控制性快速破解时填写，含 `outcome`、`harm: "none" | "graze" | "heavy" | "lethal"`、`blockedBySelfIce?: boolean`、`reason`），否则 `null`。
- 在 `packages/core/src/systems/dice/facts.ts` 新增 `npcHackRulingFact(facts)`（读取 `facts.npcHackRuling`），由 `packages/core/src/narrator/turn.ts` 在存在 `judge.counterHack` 时写入独立裁决 ID（如 `turn.${records.length}.npcHack`）的 `facts.npcHackRuling`，并在 `packages/core/src/systems/hacking/apply.ts` 的 `applyNpcHack` 中优先读取 `npcHackRulingFact(ctx.facts) ?? rulingFact(ctx.facts)`（玩家自身的 `applyHack`/`applyBreach`/`applyDive` 仍读取主行动 `facts.ruling`）。这样即使玩家本轮物理开枪或破门成功（主行动 `harm: "none"`），敌方黑客同时暗中上传 `overheat`（`counterHack.harm: "heavy"`）也能各自精准结算并写入 `resolvedNpcHacks`，互不覆盖。

---

### C. 前端交互与创角/商店体验（`apps/web`）

遵循既有精简计划（零新增角落卡片、零悬停陷阱、全部复用 `NineSlice` / `CellFrame` / `Panel`）：

1. **接入仓与快速破解装配（`NeuralPages.tsx` & `BiomonitorPanel.tsx`）**：
   - 在 `CyberwarePage`（`NeuralPages.tsx`）选中 `"os"` 槽位且当前装有接入仓时，将原本只读的 `deckPrograms` 列表升级为「已载入程序槽位（`programs.length / slots`） + 已掌握程序库（`library`）」双区交互列表：非战斗状态下点击即可触发 `loadQuickhack` / `unloadQuickhack` `PlayerAction`（超容量或满槽时在卡片内显示明确锁定提示）。
   - 在 `InventoryPage`（`NeuralPages.tsx`）支持 `"quickhack"` 芯片品类筛选（或归入 `usable` 分类），非战斗时提供「写入程序库」按钮（触发 `learnQuickhackChip`）。
   - `BiomonitorPanel.tsx` Card 3（`LINK`）保持现有布局，新增 `traces` 追踪告警徽标（若有活跃反追踪）与点击跳转 `CyberwarePage` 管理程序的快捷入口；`Corners.tsx` `BioMonitor` 保持紧凑展示 `ramMax` 容量与过载/追踪状态提示。
2. **已攻破网络与现场威胁反馈（`Corners.tsx` & `Profile.tsx`）**：
   - `Zone`（`Corners.tsx`）：直接消费 `view.hacking?.breaches`（当前已投射但未渲染），在 `zoneThreats` 下方以紧凑内联胶囊列出当前地点已拿下的网络及权限图标（如 `漩涡帮内网 · 门禁/监控`），无侵入时完全不占位。
   - `PresentPerson`（`Corners.tsx`）与 `Profile.tsx`（`BodySection`）：基于 `scan.chrome` 自动识别敌方 `os` 接入仓与 `self-ice`，在已扫描对象卡片上追加醒目的轻量标签（如「黑客 · 接入仓」「硬化自我 ICE」），强化情报扫描的价值。
3. **激活 7 个黑客商店与商店终端（`apps/web/src/features/story/Shop.tsx` & `api/client.ts`）**：
   - 在 `Shop.tsx` 的 `SHOP_POI_ICON` 映射表中补全 `netrunner: "map.poi.netrunner"`，复用已生成的 `ids.gen.ts` 资产；
   - 在 `Shop.tsx` 分类与检视台（Inspector）中适配 `"quickhack"` 品类标签（显示类别 `covert/control/damage/ultimate`、所需 `RAM` 与效果说明），若玩家未装接入仓或程序已掌握则在检视台内提示，但不阻塞买下芯片收藏。
4. **创角 Step 3 初始程序定制（`apps/web/src/features/characters/creator.ts` & `CreatorSteps.tsx`）**：
   - 在 Step 3（`chrome_kit`）的 `CyberwareShelf` / `LoadoutPicker` 中，当角色 `"os"` 槽位装配了接入仓（`programSlots > 0`）时，直接在当前面板内展开「初始快速破解槽位」：默认勾选出身/黑客履历附带的免费程序（`ping`、`reboot-optics`、`short-circuit`），允许玩家在基础入门程序池中自由勾选/替换至多 `programSlots` 个程序并查看每项 `RAM` 与效果说明（若换回斯安威斯坦/狂暴则自动收起并清空程序配置）。
   - 在 `BoardSchema` / `StartKitSchema`（`packages/core/src/schemas/board.ts`）补充可选 `startingPrograms?: string[]`（或 `kit.programs`），由 `game.ts` `applyBoardKit` 与 `resolveStartKit` 统一校验并写入初始存档。
5. **可选 `BreachMatrix` 矩阵破冰开关（`schemas/turn.ts`、`prompts/context.ts`、`settings/prefs.ts`、`NarrativeSettings.tsx`、`BreachMatrix.tsx`、`StoryScreen.tsx`）**：
   - 移除对旧 `openCheck` / `CheckBar` 的依赖，在 `prefs.ts` 与 `NarrativeSettings.tsx` 增加「入侵矩阵小游戏（默认关闭）」开关，并清理 `BreachMatrix.tsx` 中遗留的旧掷骰文案（将 `加成 +2`、`难度 −2`、`掷骰时一起算` 等替换为定性破冰进度描述）；
   - 在 `TurnInputSchema`（`packages/core/src/schemas/turn.ts`，`z.strictObject`）补充可选 `breachMatrix: z.object({ solved: z.number().int().min(0).max(3) }).optional()`，并在 `formatInput`（`packages/core/src/narrator/prompts/context.ts`）格式化为战术前置标签；
   - 开启开关后，当玩家在 `InputBar` 选择「入侵/骇入辅助」或 `Zone` 触发本地入侵交互时，可按需弹出 `BreachMatrix` 面板，完成后将破解结果附带进 `TurnInput.breachMatrix` 作为本轮定性裁决的有利战术依据；关闭时零打断，纯文字无缝流转。

---

## 4. 分阶段实施路线图与静态检查项

### Phase 1 · 核心契约、网络拓扑与程序库底座（`packages/core`, `packages/content`）
- **改动范围**：
  - `packages/core/src/systems/cyberware/schema.ts`、`packages/content/src/cyberware.ts`（接入仓与黑客义体 `deckTraits`）
  - `packages/core/src/systems/world/schema.ts`、`packages/content/src/locations.ts`（地点 `network` 拓扑）
  - `packages/core/src/systems/hacking/`（`schema.ts`, `apply.ts`, `view.ts`, `status.ts`, `actions.ts`, `index.ts`：新增 `library`、`traces`、`neuralHeat`、`activeEffects`、时间推进过期 `tickHacking` 与 `loadQuickhack`/`unloadQuickhack`/`learnQuickhackChip`）
  - `packages/core/src/actions.ts`、`packages/core/src/game.ts`、`packages/core/src/schemas/board.ts`、`packages/core/src/schemas/turn.ts`（接入 `PlayerAction`、开局初始程序定制与 `TurnInputSchema.breachMatrix`）
- **完成标准**：`HackingState` 仍严格无按场次扣除的 `ram` 或 `selfIceSpent` 字段；所有 schema 校验完备；`pnpm typecheck && pnpm lint && pnpm check-data` 通过。

### Phase 2 · 经济掉落闭环（`packages/core`, `packages/content`）
- **改动范围**：
  - `packages/core/src/systems/inventory/schema.ts`、`apply.ts`、`shops.ts`（支持 `"quickhack"` 芯片品类及商店投影字段）
  - `packages/core/src/systems/world/merchant-sites.ts`（`MerchantSiteSchema` 的 `kind` 枚举新增 `"netrunner"`）
  - `packages/core/src/authoring/prices.ts`（可选增设 `QUICKHACK_PRICES` 价格校验区间）
  - `packages/content/src/items.ts`、`merchant-sites.ts`、`shops.ts`（补充 12 个破解芯片数据、激活 `ShopKind: "netrunner"` 与 7 个 POI 黑客商店）
  - `packages/core/src/systems/combat/apply.ts`（`drawLoot` 为 `netrunner` 原型补充黑客芯片/消耗品掉落）
- **完成标准**：7 个 `netrunner` POI 均拥有合法库存与供货路线并通过 `MerchantSiteSchema` 校验；`pnpm typecheck && pnpm lint && pnpm check-data` 通过。

### Phase 3 · 提示词按需瘦身与敌我裁决解耦（`packages/core/src/narrator/`, `systems/hacking/`, `systems/dice/`）
- **改动范围**：
  - `packages/core/src/systems/hacking/prompt.ts`（收紧 `when` 条件、精简 `narrate` 守则）
  - `packages/core/src/narrator/prompts/context.ts`（修复 `physicsSection` 过滤损坏接入仓并完整传入拓扑字段；复用 `mentionsHacking`；`formatInput` 支持 `breachMatrix`）
  - `packages/core/src/narrator/prompts/catalogs.ts`、`packages/core/src/narrator/prompts/extract.ts`（调整调用顺序/入参，按需注入 `quickhacks` 索引与详情）
  - `packages/core/src/systems/dice/facts.ts`、`packages/core/src/systems/hacking/apply.ts`、`packages/core/src/narrator/stages.ts`、`packages/core/src/narrator/turn.ts`（`JudgeDocSchema` 增补可选 `counterHack`，通过 `facts.npcHackRuling` + `npcHackRulingFact` 解耦玩家主行动 `ruling` 与 `applyNpcHack` 裁决）
- **完成标准**：非黑客常规对话回合不再注入冗长 `hackingRules`；存在敌方反击破解的混合回合不再与玩家主行动裁决互冲；`pnpm typecheck && pnpm lint` 通过。

### Phase 4 · 前端交互、商店与创角闭环（`apps/web`）
- **改动范围**：
  - `apps/web/src/api/client.ts`、`apps/web/src/features/story/view.ts`（同步新 `PlayerView.hacking` 与 `PlayerAction` 类型）
  - `apps/web/src/features/story/NeuralPages.tsx`、`BiomonitorPanel.tsx`（`CyberwarePage` 程序槽位装卸、`InventoryPage` 芯片写入、`LINK` 卡追踪警告）
  - `apps/web/src/features/story/Corners.tsx`、`Profile.tsx`（`Zone` 渲染 `breaches`、扫描面板高亮接入仓/`self-ice`）
  - `apps/web/src/features/story/Shop.tsx`（`SHOP_POI_ICON` 补 `"netrunner"` 与 `"quickhack"` 卡片/检视台）
  - `apps/web/src/features/characters/creator.ts`、`CreatorSteps.tsx`（Step 3 初始程序自选）
  - `apps/web/src/features/settings/prefs.ts`、`apps/web/src/features/settings/NarrativeSettings.tsx`、`apps/web/src/features/story/BreachMatrix.tsx`、`apps/web/src/features/story/StoryScreen.tsx`、`apps/web/src/features/story/InputBar.tsx`（可选 `BreachMatrix` 开关、清理旧掷骰文案与新触发入口，剥离旧 `openCheck` 耦合）
- **完成标准**：无新增角落常驻浮窗，全部新按钮/卡片沿用 `NineSlice` / `CellFrame`；`pnpm typecheck && pnpm lint` 全绿，打包构建无类型报错；按项目约定不主动运行测试，由用户实机验收。
