# 当前机制与玩法检查（2026-11-28）

## 检查范围与结论

检查当前工作区的 core、content、runtime、前端及实际开档界面。既有未提交修改纳入检查，未修改游戏代码。旧设计文档只用于定位线索，结论以当前实现为准。

当前最应优先补齐的是生死与救援、委托报酬兑现，以及多事件、多人物的后果结算。玩法扩展方面，任务信息可查阅性、调查操作提示、持续挑战与后期目标，比继续增加独立系统更能改善完整游玩体验。

下文区分确定的机制问题、玩法深度缺口和需要明确的设计边界。内存复现证明结算层的行为，不代表已用真实模型统计触发频率。

## 修复进度（2026-11-28）

本报告第一版记录的是修复前现状。其“一、应先修复的机制问题”中的 11 项均已完成修复：生死与银卡救援、委托延迟付款与分账、多事故伤势、同伴阵亡、休息时长、安全屋连续躲藏、潜网权限追加、NCPD 现场核验、结算收入展示及战斗留疤。连续休息被其他时钟推进打断、以及安全屋内非主线时钟推进清空躲藏计时这两个边界也一并处理。

二、玩法深度缺口与三、设计边界仍是后续可选的玩法改进方向，本轮未扩展这些玩法。

## 一、修复前发现的机制问题

### 1. P1：正常伤害没有通向死亡的生产入口

- **场景**：玩家遭受致命伤，未获救，随后继续受创或长时间推进。
- **当前行为**：致命伤只把状态置为 `dying`；后续致命伤仍是 `dying`。伤势恢复 tick 不负责判死。存在 `health.die`，但它是内部指令，没有生产代码发出，模型抽取也不能使用。
- **复现**：完整系统注册表中依次施加擦伤、重创、致命伤、再次致命伤，状态为 `up → up → dying → dying`；推进 100,000 分钟后仍为 `dying`。注册表的公开指令 schema 不包含 `health.die`。
- **影响**：正文可能写死亡，但存档仍是濒死；死亡终止、遗言与相应风险不能可靠落地。
- **建议**：明确致命危险、失能、抢救窗口、获救与死亡的状态转换；由已确认的事件驱动，保留玩家知情和因果边界，避免只靠时间无条件判死。
- **证据**：[致命伤仅置濒死](C:/cyberpunk-character-card/packages/core/src/systems/health/apply.ts:100)、[恢复流程](C:/cyberpunk-character-card/packages/core/src/systems/health/apply.ts:232)、[内部死亡入口](C:/cyberpunk-character-card/packages/core/src/systems/health/index.ts:50)、[内部指令不对模型开放](C:/cyberpunk-character-card/packages/core/src/kernel/system.ts:744)、[抽取仅接收公开指令](C:/cyberpunk-character-card/packages/core/src/narrator/turn.ts:1796)。

### 2. P1：银卡救援依赖正常受伤无法产生的状态

- **场景**：玩家购买银卡，受伤后呼叫创伤小组。
- **当前行为**：银卡仅救 `down`；`up` 被判生命稳定，`dying` 被判超出保障，`dead` 不能复活。但正常伤害只保持 `up` 或进入 `dying`，没有把玩家置为 `down` 的生产入口。
- **复现**：真实地点、有效银卡、无交战条件下，用完整注册表结算救援：重创后因 `up` 拒绝，致命伤后因 `dying` 拒绝。
- **影响**：正常新档可以买保单，但不能正常触发银卡的核心服务；健康时界面用假设倒下状态计算覆盖，容易给人可用的印象。
- **建议**：与上一项一起定义“倒下但可稳定救治”的真实条件，或调整银卡保障条件，确保付费服务对应可达状态。
- **证据**：[救援资格](C:/cyberpunk-character-card/packages/core/src/systems/trauma/apply.ts:52)、[受伤状态转换](C:/cyberpunk-character-card/packages/core/src/systems/health/apply.ts:100)、[覆盖展示的假设状态](C:/cyberpunk-character-card/packages/core/src/systems/trauma/view.ts:37)。

### 3. P1：先完成委托、后收款或分期付款没有正常闭环

- **场景**：交货时完成委托，雇主下轮转账；或先给部分款、后给尾款。
- **当前行为**：协议要求未到账时 `paid:0`，但 `jobEnd` 当场关闭任务，队员也按本次到账数标成已分账；后续再次结算被拒绝，没有独立补款入口。
- **复现**：`clean / paid:0` 成功，次日 `clean / paid:5000` 返回“已经结束，不能再重复结算”。
- **影响**：实收、欠款与队员分账不能跟随剧情更新；用临时零钱事件绕行也不能修正任务账本。
- **建议**：分开任务结果与收款状态，记录应收、实收、尾款及分账；后续到账使用独立幂等凭证。
- **证据**：[未到账规则](C:/cyberpunk-character-card/packages/core/src/systems/jobs/schema.ts:221)、[结束后禁止重结](C:/cyberpunk-character-card/packages/core/src/systems/jobs/apply.ts:240)、[状态关闭](C:/cyberpunk-character-card/packages/core/src/systems/jobs/apply.ts:266)、[队员标记已分账](C:/cyberpunk-character-card/packages/core/src/systems/jobs/apply.ts:302)、[报酬唯一结算路径](C:/cyberpunk-character-card/packages/core/src/systems/economy/prompt.ts:17)。

### 4. P2：不同事故的伤势被整轮防重复规则互相吞掉

- **场景**：同一轮先被玻璃划伤左腿，撤离时再被子弹打中右臂。
- **当前行为**：整轮只有一个主裁决 ID，身体伤害按此 ID 只允许登记一次，第二处真实伤势被视为重复。战斗伤口经 `health.hit` 也会进入该限制。
- **复现**：主裁决允许重创，先登记擦伤成功，再登记另一部位重创仍被拒绝。若两条属于同一事务，失败会撤销该组；若为独立事件，则保留第一处并拒绝第二处，出现未完整结算。
- **影响**：正文的多次交锋、多部位受伤无法完整落账，复杂行动更容易产生账文不符。
- **建议**：按具体事件或伤势来源去重，同时保留伤害上限验证；不要直接移除防重复保护。
- **证据**：[整轮裁决 ID](C:/cyberpunk-character-card/packages/core/src/narrator/turn.ts:2121)、[整轮伤害去重](C:/cyberpunk-character-card/packages/core/src/systems/health/apply.ts:72)、[战斗伤害同样核验](C:/cyberpunk-character-card/packages/core/src/systems/health/apply.ts:171)。

### 5. P2：同伴阵亡错误绑定主角的致命风险

- **场景**：主角在装甲掩体内无伤，同伴在外被狙杀。
- **当前行为**：判断里的 `harm` 明确描述玩家角色风险，但随行同伴死亡也要求这个字段为 `lethal`。正确判断主角无伤，反而不能登记同伴死亡。
- **影响**：人物各自的处境不能独立结算；为让同伴死亡落账而把主角也写成致命危险，会污染后续伤害边界。
- **建议**：给实际目标分别记录风险与已发生后果，复用已有事件依赖机制。此项由完整调用链确认，未运行真实模型场景。
- **证据**：[harm 的主角限定](C:/cyberpunk-character-card/packages/core/src/narrator/stages.ts:159)、[同伴死亡入口](C:/cyberpunk-character-card/packages/core/src/systems/npc/apply.ts:668)、[复用主角风险](C:/cyberpunk-character-card/packages/core/src/systems/dice/facts.ts:55)。

### 6. P2：零分钟休息即可清空疲劳

- **场景**：抽取把“坐下歇一会”记成休息，遗漏耗时，或仅休息很短时间。
- **当前行为**：只要 `activity:rest` 就清零全部清醒时段和分钟，不要求时间推进。
- **复现**：从 `phasesAwake:6 / awakeMinutes:350` 提交无时间的休息，返回成功、没有推进时间、疲劳全清。
- **影响**：长期熬夜与休息安排缺少可靠代价。
- **建议**：区分短歇与充分睡眠，依据实际耗时和休息条件结算恢复。
- **证据**：[时间可省略](C:/cyberpunk-character-card/packages/core/src/systems/world/schema.ts:138)、[无条件清零](C:/cyberpunk-character-card/packages/core/src/systems/world/apply.ts:163)。

### 7. P2：安全屋躲藏效果随回合拆分改变

- **场景**：同样连续在家躲六小时，玩家一次写完，或分两轮各写三小时。
- **复现**：从四星开始，单次六小时降到三星；连续两次三小时仍为四星。
- **原因**：安全屋额外消星只看单次时间跨度是否达到六小时，没有累计持续躲藏时长。
- **建议**：记录躲藏开始、持续时间和暴露中断；同样的世界行为应有同样的结果。
- **证据**：[单次跨度判断](C:/cyberpunk-character-card/packages/core/src/systems/heat/apply.ts:548)。

### 8. P2：已入侵网络不能逐步扩大权限

- **场景**：先拿下公司内网摄像头，之后再拿同一网络的门禁或数据权限。
- **当前行为**：只要同地点、同名网络已有记录，后续 `breach` 就整体拒绝，不合并新增 `gains`。
- **复现**：先取得 `cameras`，再申请同一网络的 `doors/data` 被判“已经入侵过了”，既有权限不变。
- **影响**：分步骤电子战被迫一次拿齐权限，或另编网络名称；潜入过程中扩大控制范围缺少账本支持。
- **建议**：对已有权限防重复，对新权限验证前置后追加；保留接入点、防线、热负荷和来源记录。
- **证据**：[网络重复拦截](C:/cyberpunk-character-card/packages/core/src/systems/hacking/apply.ts:642)。

### 9. P2：NCPD 现场结案只校验到城区

- **场景**：玩家在同城区家中，警情实际发生在另一地点。
- **当前行为**：只核对城区一致，未核对警情地点或到场处理事实，就可以结案、发奖和降星。
- **复现**：内存结算中不同地点、同城区的 `clear` 成功，发出 1,000 欧元赏金及降星指令。
- **影响**：模型漏写移动或误判完成时，规则层挡不住远程结案。它不是当前界面直接提供的自动领赏按钮。
- **建议**：核验现场及完成依据，也允许已经在本回合确实办完后离场的情况，避免简单比较终点位置误伤正常结案。
- **证据**：[仅核对城区](C:/cyberpunk-character-card/packages/core/src/systems/ncpd/apply.ts:179)、[降星与发奖](C:/cyberpunk-character-card/packages/core/src/systems/ncpd/apply.ts:192)。

### 10. P2：组队委托结算弹窗混淆总报酬和净收入

- **场景**：任务到账 10,000，队友分走 3,000。
- **当前行为**：钱包增加 7,000，但弹窗仍显示“报酬 10,000”。追踪板已经能正确区分净额。
- **建议**：统一展示总报酬、队员实付与玩家净到手。
- **证据**：[弹窗使用总额](C:/cyberpunk-character-card/apps/web/src/features/story/Settlement.tsx:22)、[实际净入账](C:/cyberpunk-character-card/packages/core/src/systems/jobs/apply.ts:307)、[追踪板正确实现](C:/cyberpunk-character-card/apps/web/src/features/story/TrackerPanel.tsx:533)。

### 11. P2：战斗留疤条件在正常伤势流程中不可达

- **当前行为**：重创和致命伤未经治疗没有愈合时间；治疗后又会标为已治疗。留疤分支却要求“未经治疗的重伤已经愈合”。此外，health 先删除愈合伤势，combat 发现镜像不存在就直接删除伤口，跳过留疤分支。
- **影响**：有疤痕结构和展示，但正常战斗/治疗/恢复流程不能积累这一长期后果。此项依据伤势状态转换与系统调用顺序确认，未跑真实模型场景。
- **建议**：在伤势恢复时统一结算是否留疤及其来源，明确不同医疗处理的长期影响，避免镜像删除吞掉后果。
- **证据**：[重伤无愈合时间](C:/cyberpunk-character-card/packages/core/src/systems/combat/apply.ts:418)、[治疗标记](C:/cyberpunk-character-card/packages/core/src/systems/combat/apply.ts:435)、[删除镜像与留疤条件](C:/cyberpunk-character-card/packages/core/src/systems/combat/apply.ts:627)。

## 二、已经能玩，但闭环或深度不足

| 玩法           | 当前缺口与影响                                                                           | 建议方向                                                               | 证据                                                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 委托追踪       | 没有独立的公开简报、已知目标、交付条件；新委托进展为空，隔几轮回来需要翻旧正文或短信。   | 优先补公开简报和当前已知目标，勿公开隐藏转折。                         | [任务结构](C:/cyberpunk-character-card/packages/core/src/systems/jobs/schema.ts:99)、[新单笔记为空](C:/cyberpunk-character-card/packages/core/src/systems/jobs/apply.ts:118)、[待办只取最后笔记](C:/cyberpunk-character-card/packages/core/src/systems/jobs/objectives.ts:20) |
| 超梦调查       | 有播放、进度、编辑与三层扫描机制，档案页主要是查看状态和线索，缺少继续调查的直观操作。   | 提供播放/退出、切模式、三层扫描的行动草稿按钮和设备条件说明。          | [超梦页仅接收视图](C:/cyberpunk-character-card/apps/web/src/features/story/NeuralPages.tsx:1167)、[三层状态展示](C:/cyberpunk-character-card/apps/web/src/features/story/NeuralPages.tsx:1194)                                                                                |
| 拳赛与赛车     | 共六场；每场赢过后永久不能再赛，缺少卫冕、巡回或新对手。                                 | 在时间、势力和新对手条件成立后提供后续挑战，控制奖金来源。             | [赛事内容](C:/cyberpunk-character-card/packages/content/src/sidegigs.ts:7)、[获胜永久关闭](C:/cyberpunk-character-card/packages/core/src/systems/sidegigs/apply.ts:116)                                                                                                       |
| 大票筹备       | 已有队员、分工与分账；情报、踩点、接应和撤离安排主要靠通用笔记，缺少便于核对的准备事实。 | 加轻量筹备事实清单，记录来源、可用条件与是否兑现，保留自由行动。       | [通用进展](C:/cyberpunk-character-card/packages/core/src/systems/jobs/schema.ts:121)、[现有小队](C:/cyberpunk-character-card/packages/core/src/systems/jobs/schema.ts:136)                                                                                                    |
| 房产与后期消费 | 已有买房、交租、锁门与储物；房屋能力差异和建设玩法较少。                                 | 增加能改变实际行动条件的医疗、潜网、改装或车库设施，并与现有服务联动。 | [房屋状态](C:/cyberpunk-character-card/packages/core/src/systems/safehouse/schema.ts:52)                                                                                                                                                                                      |
| 长线目标与收官 | 只有自由沙盘开局；有退休/停止故事入口，但缺少可选阶段目标及与经历相连的收官内容。        | 提供可选野心、专题开局与尾声；不强制线性主线或等级刷取。               | [唯一开局](C:/cyberpunk-character-card/packages/content/src/openings.ts:11)、[结束类型](C:/cyberpunk-character-card/packages/core/src/systems/chronicle/schema.ts:31)、[结束仅写状态](C:/cyberpunk-character-card/packages/core/src/systems/chronicle/apply.ts:35)            |
| 玩法说明       | 首轮有行动引导，缺少当前规则的随时查阅页；仓库机制总览仍有已废弃的属性、骰点和 HP 描述。 | 补简短的当前玩法手册，以及首次受伤、接单、潜网时的情境说明。           | [首轮引导](C:/cyberpunk-character-card/apps/web/src/features/story/OpeningGuide.tsx:230)、[旧机制说明](C:/cyberpunk-character-card/docs/gameplay-mechanics.md:51)                                                                                                             |

## 三、需要明确的设计边界

普通玩法与作者编辑权限存在交叉：已结识 NPC 可以手工修改关系；直接同行仅要求有关系文本或共同记忆、没有未解仇；同行后可以取走其随身装备。于是填写任意关系文本也能间接打开招募与装备转移。

这不直接定性为 bug：如果允许玩家随时共同创作人物关系，行为可能符合产品目标；但如果要维持 NPC 自主意愿和装备经济，需要把“玩家备注/作者改设定”“NPC 同意同行”“装备赠与/借用权限”分别记录。

证据：[关系编辑](C:/cyberpunk-character-card/apps/web/src/features/story/Profile.tsx:1315)、[招募条件](C:/cyberpunk-character-card/packages/core/src/systems/npc/actions.ts:83)、[装备取回](C:/cyberpunk-character-card/packages/core/src/systems/npc/actions.ts:134)。

## 四、建议处理顺序

1. **生死与保障**：一起修复倒下、濒死、救援和死亡转换，确保买得到的会籍真的能用。
2. **经济兑现**：拆开任务完成与到账，补尾款/分期/欠款/分账，再统一结算反馈。
3. **事件与人物**：按来源去重伤势，给不同人物独立后果，延续现有因果事务保护。
4. **行动一致性**：修休息耗时、持续躲藏、网络权限追加与 NCPD 完成核验。
5. **易用性**：先补任务简报、超梦行动提示和现行规则说明。
6. **长期耐玩**：再增加赛事后续、筹备成果、房屋设施及可选长线目标。

## 五、验证记录与边界

- 修复后重新运行 `pnpm check`：类型检查、Biome（771 个文件）和 `check-data` 全部通过。数据校验报告的 283 个译名提示不影响通过。
- 已做完整注册表内存复现：伤害/濒死/时间推进/死亡指令可达性、银卡救援；另对延迟付款、零耗时休息、回合多伤、躲藏分段、网络权限与 NCPD 到场校验进行了规则层内存复现。未新增自动化测试文件或依赖。
- 修复后完整注册表场景复核覆盖生死救援、伤害去重、同伴死亡、伤疤恢复、累计收款及分账幂等、连续休息、持续躲藏、权限追加与 NCPD 结案；关键状态通过 JSON 往返检查。结算弹窗已用隔离浏览器上下文检查渲染。
- 已在本地实际创建临时存档并查看开场、追踪与六场赛事入口，临时存档已删除。未使用真实模型进行付费长局游玩，因此不对自然语言触发频率、叙事质量和长局节奏作实测保证。
- 活源看板、地图入口、队员分工与分账已经实现；旧计划中相应“尚未实现”描述不再适用。NCPD 已有刷新机制，不能把赛事不可重赛扩展为“整个游戏没有可重复活动”。
- 本报告未改变应用代码、已有未提交修改或部署状态。
- 工作区在检查期间存在其他并行修改；静态检查结果对应执行时的工作区状态，源码行号也可能随后续编辑移动。
