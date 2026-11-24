# 黑客电子战攻防平衡与反制深度升级计划

## 问题诊断（来自实战试玩反馈）

1. **原住民与帮派角色普遍「裸奔无冰」**：77 名原作 NPC 中仅有 9 人带 `self-ice`，虎爪帮、漩涡帮、暴恐/公司保镖、顶级佣兵与中间人（甚至亚当·重锤、小田、竹村、罗伊斯、普拉西德、库尔特·汉森等）均缺少 `self-ice` / `grounding-plating` / `fireproof-coating`，导致黑客起手畅通无阻。
2. **「过热」「电磁短路」文案过强，无视义体档次与抗性**：`packages/content/src/hacking.ts` 里两项伤害破解直接写成「当场击穿斯安威斯坦/义肢电路冒烟瘫痪」，未区分民用义体与军用/传说级冗余散热、稳压熔断及防护镀层，导致入门接入仓也能一发炸缸顶级义体。
3. **帮派据点缺少常态防火墙与黑客对垒**：`factions.ts`、`hacking/prompt.ts` 与 `npc/prompt.ts` 未明确虎爪帮、漩涡帮、巫毒帮及公司据点的电子战编组常态（本地子网防火墙 + 驻场/连线脏黑客 + 自我 ICE 骨干），导致连做多个虎爪帮/漩涡帮委托都很少遇到黑客对垒与反制。
4. **代码级拓扑判定（`context.ts` + `netrunning.ts`）过于宽松**：
   - `hardenedIce` 仅检查点名目标自身有无 `deck/self-ice`，忽略了**在场其他敌方黑客的子网协防**、目标的**接地/防火镀层**、**史诗/传说高阶战斗义体自带的军用级稳压/散热冗余**，以及**高技术帮派/公司势力的常态防线**；
   - 未将玩家自身的**接入仓档次**（入门民用 vs 专业 vs 顶级军用）纳入对抗参考，默认一律提示「无线端口可达、破冰阻力低」。
5. **新人物常驻选型表缺少电子战防具**：`npc-equipment.ts` 的 `STAPLE_CHROME_IDS` 不包含 `self-ice`、`grounding-plating`、`fireproof-coating` 与常规接入仓，模型新建帮派骨干/黑客时容易忽略配置电子战防线。

## 实施方案

- [x] **阶段一：原作角色与常驻配装升级（`packages/content/src/npcs.ts`、`npcsExtra.ts`、`npc-equipment.ts`）**
  - 为亚当·重锤、小田、竹村、华子、赖宣、三郎、罗格、和歌子、舞子、木头人（补配 `fuyutsuki-deck` 与 `self-ice`）、罗伊斯、布里克、杜姆杜姆、普拉西德、梅瑞狄斯、李德、亚历克斯、迈尔斯、库尔特·汉森、萨斯夸奇、枪手、瑞吉娜、神父、戴诺、达科塔、老船长、埃默里克、韦兰等 28 名原作角色补齐 `self-ice` / `grounding-plating` / `fireproof-coating` / 接入仓（严格遵守各部位容量与 `NPC_CHROME_MAX = 8` 上限），原作带 `self-ice` 角色由 9 人提升至 37 人、带防电涌/防火镀层重装首领增至 7 人。
  - 在 `npc-equipment.ts` 的 `STAPLE_CHROME_IDS` 纳入 `self-ice`、`grounding-plating`、`fireproof-coating`、`biotech-sigma`、`fuyutsuki-deck`，让新建帮派骨干与黑客稳定拥有对应硬件选项。
- [x] **阶段二：快速破解与势力电子战定位重塑（`packages/content/src/hacking.ts`、`factions.ts`）**
  - 重写 `overheat` 与 `short-circuit` 文案（满足 `<=140` 字符 Schema 约束）：明晰对民用/杂兵义体有效，但面对 `self-ice`、接地/防火镀层及军用/传说级冗余散热/稳压义体时，入门单发多被拦下、分流或仅致高温警报与短暂降频/抽搐卡顿，绝不一发直接炸缸报废，须先破冰并凭高阶接入仓/持续强攻压垮。
  - 在 `factions.ts` 为漩涡帮、虎爪帮、巫毒帮、幽冥犬、荒坂、军用科技、康陶补齐各自的电子战与黑客编组特征。
- [x] **阶段三：代码级电子战物理与拓扑加固（`packages/core/src/netrunning.ts`、`packages/core/src/narrator/prompts/context.ts`）**
  - `HackTopologyCheckInput` 新增 `targetSelfIce`、`targetSurgeShielded`（接地镀层抗短路）、`targetThermalShielded`（防火涂层抗过热）、`targetHighTierChrome`（史诗/传说战斗义体稳压散热冗余）、`enemyNetrunnerPresent`（在场敌方黑客协防）、`hardenedFaction`（高技术帮派/公司常态防线）、`playerDeckTier`（入门/专业/顶级接入仓档次）。
  - `physicsSection` 自动识别在场敌方黑客、高技术帮派/公司势力（虎爪帮、漩涡帮、巫毒帮、荒坂、军用科技、康陶、幽冥犬、暴恐、网监）、目标镀层与高阶义体，输出具体对抗指令而非笼统的「破冰阻力低」。
- [x] **阶段四：电子战与新人物建卡提示词升级（`packages/core/src/systems/hacking/prompt.ts`、`packages/core/src/systems/npc/prompt.ts`）**
  - 在 `hackingRules`（`judge` / `narrate`）明确「帮派与公司电子战常态」「反黑客对垒与高噪破解立刻触发 `counterHack` / 反向追踪」「义体档次与单发不秒杀原则」。
  - 在 `npcRules`（`narrate` / `text`）明确虎爪帮、漩涡帮、巫毒帮、公司与高危委托现场的敌人编组应常态配备 1 名驻场/连线网络黑客，头目与重装打手常配 `self-ice` 及接地/防火镀层。
- [x] **阶段五：全量校验与收口**
  - `biome check`（9 个改动文件 0 报错）+ `biome lint .`（全仓 692 文件 0 报错）通过。
  - `tsc --noEmit`（`@cp/content`、`@cp/core`、`@cp/runtime`、`@cp/web`、`@cp/tools` 全量 5 包）通过。
  - `tsx tools/check-data.ts` 通过（77 人物、12 快速破解、20 势力等全量 schema 与槽位校验通过）。
