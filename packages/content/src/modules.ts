import { BoardModuleSchema } from "@cp/core";

/**
 * 角色主板的模块库：包含出身、过往、特质与负面缺陷；模块自由组合，不设点数上限。
 * 人物名是自创的，不用原作角色。
 */
export const boardModules = BoardModuleSchema.array().parse([
  // 出身（打破原版 3 出身局限，扩充为 17 种鲜活夜之城单层出身背景，均 0 点免费，自带家底、故人 NPC 与身世钩子）
  {
    id: "street-kid",
    slot: "origin",
    label: "街头小子",
    tags: ["街头", "帮派"],
    ability:
      "夜之城的水泥迷宫是你的摇篮：清楚每条暗巷归属的帮派领地、哪家当铺收赃不问来路，深谙如何用街头黑话与亡命之徒打交道",
    hook: "海伍德与沃森的老街坊依然记得你当年欠下的人情与惹下的烂摊子",
    checks: ["cool"],
  },
  {
    id: "nomad",
    slot: "origin",
    label: "恶土部族流浪者",
    tags: ["恶土", "家族", "车"],
    ability:
      "在恶土干燥的风沙与柴油味中长大：熟谙荒原走私捷径与恶劣天气规律，精通恶劣环境下的载具维护，身上流着部族抱团求生的血",
    hook: "当年促使你脱离家族车队孤身进入夜之城的隐秘恩怨，至今尚未画上句号",
    checks: ["tech"],
  },
  {
    id: "corpo",
    slot: "origin",
    label: "企业雇员",
    tags: ["巨企", "公司"],
    ability:
      "曾跻身巨型跨国企业的摩天大楼：洞悉企业内部暗算晋升的潜规则与商业协议漏洞，能一眼看穿高管的虚张声势，懂得在冷酷博弈中周旋自保",
    hook: "前东家的企业安保与反情报卷宗里，依然保留着关于你的监控评估档案",
    checks: ["cool"],
  },
  {
    id: "origin-arasaka-ex",
    slot: "origin",
    label: "荒坂反情报弃子",
    tags: ["巨企", "公司", "荒坂"],
    ability:
      "曾任职于荒坂塔反情报外围行动组：熟悉企业安保巡查机制、加密通信暗号与部门派系倾轧，手头作废的旧员工密钥或许还能在紧急关头发挥奇效",
    hook: "派系清洗后你虽侥幸保命，但荒坂反情报部的猎犬至今仍将你标在离职监控清单上",
    people: [{ name: "佐藤真", role: "荒坂反情报部现任专员，私下欠过你一条命的旧同事" }],
    checks: ["intelligence", "cool"],
  },
  {
    id: "origin-ex-ncpd",
    slot: "origin",
    label: "前 NCPD 巡警",
    tags: ["巨企", "警察", "枪"],
    ability:
      "曾在夜之城警局穿过防弹警服巡逻高危街区：深谙警队无线电通联暗语、现场勘查与出警战术规程，分局档案室内尚有旧部人脉",
    hook: "当年因触碰权贵黑幕被迫脱下警服时，你悄悄扣下了一桩涉企凶杀悬案的绝密卷宗",
    people: [
      { name: "卡斯蒂略", role: "昔日巡警时期的巡逻搭档，为人正直固执，信守旧情但恪守底线" },
    ],
    checks: ["cool"],
  },
  {
    id: "origin-trauma-medic",
    slot: "origin",
    label: "创伤小组前外勤医护",
    tags: ["巨企", "公司", "医疗"],
    ability:
      "曾随创伤小组浮空装甲车深入交火区抢救白金会员：精通战场止血、神经除颤与高压火力下的战术掩护，一眼便知伤者还能撑几分钟",
    hook: "一次救援任务中你违抗「放弃无保平民」的指令被公司除名，当时的车载黑匣子录音仍在某处流转",
    people: [{ name: "琳达·陈", role: "创伤小组资深航电调度员，仍能在暗中为你调阅急救档案" }],
    checks: ["tech"],
  },
  {
    id: "origin-corpo-pr",
    slot: "origin",
    label: "企业危机公关猎犬",
    tags: ["巨企", "公司", "谈判"],
    ability:
      "专门替公司高管擦屁股、封口目击者与操纵媒体舆情的幕后白手套：精于抓人软肋、伪造不在场证明与体面威胁",
    hook: "你亲手压下的某桩企业实验室泄漏丑闻正在死灰复燃，知情者接连离奇暴毙",
    people: [{ name: "维克多·索恩", role: "游走于各大企业法务部的善后掮客，手握不少高管黑料" }],
    checks: ["cool"],
  },
  {
    id: "origin-war-vet",
    slot: "origin",
    label: "公司战争退伍老兵",
    tags: ["巨企", "战斗", "枪"],
    ability:
      "从企业代理战争的焦土战壕里爬出来的活口：习惯在硝烟与弹片中冷静判断火力死角，对制式军用枪械与爆破物了如指掌",
    hook: "退役时军方承诺的神经修复补贴被层层克扣，当年同排战友的抚恤金下落不明",
    people: [
      { name: "老铁砧", role: "同在一个战壕扛过轰炸的退伍军士长，如今在河谷区经营黑市靶场" },
    ],
    checks: ["body"],
  },
  {
    id: "origin-clinic-apprentice",
    slot: "origin",
    label: "黑诊所学徒",
    tags: ["街头", "医疗", "义体"],
    ability:
      "混迹于无照黑诊所的消毒水与血腥气味中长大：擅长枪伤缝合与紧急断肢止血，认得市面各大厂商的义体翻新成色与走私货源",
    hook: "你曾帮一名满身弹孔的神秘客取出一枚带军用级追踪信标的芯片，麻烦随之找上门来",
    people: [
      { name: "泰勒医生", role: "脾气暴躁但手艺过硬的黑诊所义体医生，曾手把手教你拆解神经插座" },
    ],
    checks: ["tech"],
  },
  {
    id: "origin-gang-runner",
    slot: "origin",
    label: "帮派底层奔卒",
    tags: ["街头", "帮派"],
    ability:
      "曾在街头帮派底层充当生死线上的跑腿马仔：熟记弱肉强食的帮规，认得各堂口头目的嘴脸，深谙在枪口下何时该闭嘴",
    hook: "当年经手的一批黑市神经芯片半路失窃，幕后堂口至今仍把这笔烂账记在你的头上",
    people: [{ name: "老秦", role: "带你混迹街头的帮派老油条，如今掌管着两条街道的地下盘口" }],
    checks: ["cool"],
  },
  {
    id: "origin-pit-fighter",
    slot: "origin",
    label: "地下铁笼拳手",
    tags: ["街头", "格斗"],
    ability:
      "在地下黑市铁笼拳赛的血泊与欢呼声中搏过命：抗击打神经早已被粗暴磨砺，擅长贴身缠抱与致命关节锁",
    hook: "在那场被资本操控的假拳决赛里你拒绝倒下，输得倾家荡产的庄家正四处悬赏你的双拳",
    people: [{ name: "铜牙", role: "地下铁笼拳赛的退役经纪人，熟知各区黑拳庄家的底细" }],
    checks: ["body"],
  },
  {
    id: "origin-bd-editor",
    slot: "origin",
    label: "黑超梦剪辑师",
    tags: ["街头", "超梦", "技术"],
    ability:
      "曾混迹于歌舞伎区地下超梦产业的非线性编辑台：精通神经调谐装置与痛觉/快感波形解析，能捕捉常人无法察觉的潜意识感官痕迹",
    hook: "你曾亲手剪辑过一段涉及市政高层丑闻的未删减黑超梦原片，原片买主正在灭口知情人",
    people: [{ name: "零度", role: "歌舞伎区地下超梦作坊的神经调音师，手头总有稀奇古怪的原片" }],
    checks: ["intelligence"],
  },
  {
    id: "origin-fixer-protege",
    slot: "origin",
    label: "中间人跑腿学徒",
    tags: ["街头", "谈判"],
    ability:
      "从小在老牌中间人手下递送加密芯片、踩点接应与清点佣金：熟悉夜之城各区地下委托的行规与佣兵身价，懂得如何与各方势力体面传话",
    hook: "领你入行的老联络人突然神秘失踪，只留给你一部存满未结悬赏的加密终端",
    people: [{ name: "宋叔", role: "半隐退的沃森区老牌联络人，曾教你如何识别委托人的谎言" }],
    checks: ["cool"],
  },
  {
    id: "origin-netrunner",
    slot: "origin",
    label: "野狐禅潜网黑客",
    tags: ["潜网", "黑客"],
    ability:
      "在暗网黑客论坛的碎片代码中野蛮自学成才：懂得破译数据矩阵的入侵协议，能在网络接入仓支持下发起底层快速破解",
    hook: "早年潜网演练时曾在某企业子网留下专属黑客签名，如今已有高阶网监节点在追踪该代号",
    people: [{ name: "幽灵回声", role: "只在加密BBS上露面的暗网领路人，曾救过被黑冰锁死的你" }],
    checks: ["intelligence"],
  },
  {
    id: "origin-arasaka-netrunner",
    slot: "origin",
    label: "荒坂叛逆潜网客",
    tags: ["潜网", "黑客", "公司", "荒坂"],
    ability:
      "曾是荒坂子网的受训潜网员，携一份加密冷备份叛逃出局：深谙企业级冰墙架构与反追踪协议，能在高危子网中冷静周旋",
    hook: "脑后神经插槽里仍藏着半截未破译的旧网密钥，暗网买家与荒坂猎犬都在搜寻你的信号",
    people: [{ name: "雾岛", role: "同样从荒坂子网逃出来的潜网同僚，如今隐姓埋名靠倒卖密钥维生" }],
    checks: ["intelligence"],
  },
  {
    id: "origin-merc-survivor",
    slot: "origin",
    label: "雇佣兵战术组幸存者",
    tags: ["佣兵", "战斗", "枪"],
    ability:
      "曾跟随正规雇佣兵小队接过无数脏活：通晓潜入踩点、交叉掩护撤离与黑市分赃流程，在实战交火的腥风血雨中见过生死大场面",
    hook: "小队在最后一次突袭行动中惨遭伏击覆灭，侥幸活下来的你仍在追查究竟是谁出卖了撤退坐标",
    people: [{ name: "灰狼", role: "当年小队覆灭之夜负责外围接应的狙击手，至今仍在追查内鬼" }],
    checks: ["reflexes"],
  },
  {
    id: "origin-badlands-smuggler",
    slot: "origin",
    label: "荒原边境走私客",
    tags: ["恶土", "走私", "车"],
    ability:
      "常年驾车在恶土哨卡与城郊隔离墙之间运送违禁暗货：熟悉边境联合检查站的巡逻盲区与改装夹层藏匿技巧，拥有稳定的地下黑市销赃网络",
    hook: "最后一次边境运送中整箱高价军火被巡逻队扣押，幕后货主至今仍在追索这笔高额赔付",
    people: [{ name: "达科塔·小杰", role: "恶土边境中继站的改装技师，专门帮走私车改暗格与假车牌" }],
    checks: ["cool", "tech"],
  },
  // 过往
  {
    id: "arasaka-ex",
    slot: "past",
    label: "荒坂前员工",
    tags: ["公司", "荒坂"],
    ability:
      "熟悉荒坂塔内的安保巡查机制、加密通信暗号与部门派系倾轧，手头作废的旧员工密钥或许还能在紧急关头发挥奇效",
    hook: "荒坂反情报部的猎犬至今仍将你标在离职监控清单上，不定期排查风险",
    people: [{ name: "佐藤真", role: "荒坂反情报部现任专员，私下欠过你一条命的旧同事" }],
    checks: ["intelligence", "cool"],
  },
  {
    id: "betrayed-arasaka",
    slot: "past",
    label: "荒坂叛逆者",
    tags: ["荒坂", "背叛"],
    ability:
      "从荒坂机密数据库中带出过一份致命的加密冷备份，深谙如何在企业特工的地毯式猎杀下隐匿生存",
    hook: "数据碎片唯有结合荒坂内网密钥方能完整破译，各方暗网买家均在觊觎你藏身何处",
    checks: ["cool"],
  },
  {
    id: "gang-runner",
    slot: "past",
    label: "帮派底层奔卒",
    tags: ["帮派", "街头"],
    ability:
      "曾在帮派底层充当生死线上的跑腿马仔：熟记街头弱肉强食的帮规，认得各堂口头目的嘴脸，深谙在枪口下何时该闭嘴",
    hook: "当年运送的一批黑市神经芯片半路失窃，幕后债权人至今仍把这笔烂账算在你的头上",
    people: [{ name: "老秦", role: "带你混迹街头的帮派老油条，如今掌管着两条街道的地下盘口" }],
    checks: ["cool"],
  },
  {
    id: "clinic-apprentice",
    slot: "past",
    label: "黑诊所学徒",
    tags: ["医疗", "义体"],
    ability:
      "曾混迹于无照黑诊所的消毒水气味中：擅长枪伤缝合与紧急断肢止血，认得市面各大厂商的义体翻新成色，知晓走私货源的接头点",
    people: [
      { name: "泰勒医生", role: "脾气暴躁但手艺过硬的黑诊所义体医生，曾手把手教你拆解神经插座" },
    ],
    checks: ["tech"],
  },
  {
    id: "netrunner-self-taught",
    slot: "past",
    label: "野狐禅黑客",
    tags: ["黑客", "潜网"],
    ability:
      "在暗网黑客论坛的碎片代码中野蛮自学成才：懂得破译数据矩阵的入侵协议，能在网络接入仓支持下发起底层快速破解",
    hook: "早年潜网演练时曾在某企业子网留下专属黑客签名，如今已有高阶网监节点在追踪该代号",
    checks: ["intelligence"],
  },
  {
    id: "ex-ncpd",
    slot: "past",
    label: "前警局巡警",
    tags: ["警察", "枪"],
    ability:
      "曾在夜之城警局（NCPD）穿过防弹警服巡逻街道：深谙警队无线电通联暗语与出警战术规程，枪法硬朗，分局档案室内尚有旧部人脉",
    hook: "当年辞职脱离警队时，你悄悄扣下了一桩涉企凶杀悬案的绝密调查卷宗",
    people: [
      { name: "卡斯蒂略", role: "昔日巡警时期的巡逻搭档，为人正直固执，信守旧情但恪守底线" },
    ],
    checks: ["cool"],
  },
  {
    id: "merc-crew",
    slot: "past",
    label: "雇佣兵战术组",
    tags: ["佣兵", "战斗"],
    ability:
      "曾跟随正规雇佣兵小队接过几单脏活：通晓潜入踩点、掩护撤离与黑市分赃流程，在实战交火的腥风血雨中见过生死大场面",
    hook: "小队在最后一次突袭行动中惨遭覆灭，幸存的旧队员始终怀疑是你出卖了撤退路线",
    checks: ["reflexes"],
  },
  {
    id: "braindance-editor",
    slot: "past",
    label: "超梦剪辑师",
    tags: ["超梦", "技术"],
    ability:
      "曾混迹于地下超梦产业的非线性编辑台：精通神经调谐装置与生化神经编码解析，能捕捉常人无法察觉的潜意识感官痕迹",
    hook: "你曾亲手剪辑过一段涉及高层政要丑闻的黑超梦原片，而受害者与施暴者仍在城中活跃",
    checks: ["intelligence"],
  },
  {
    id: "pit-fighter",
    slot: "past",
    label: "地下拳赛斗士",
    tags: ["格斗", "街头"],
    ability:
      "在地下黑市铁笼拳赛的血泊中搏过命：抗击打神经早已被粗暴磨砺，擅长贴身缠抱与致命关节锁，拳场庄家对你的打法了如指掌",
    hook: "在当年那场被资本操控的假拳赛中，某个重注赌徒输得倾家荡产，如今正四处探寻你的踪迹",
    checks: ["body"],
  },
  {
    id: "smuggler",
    slot: "past",
    label: "荒原走私客",
    tags: ["走私", "车"],
    ability:
      "常年在恶土哨卡与城郊隔离墙之间运送暗货：熟悉边境联合检查站的巡逻盲区与改装夹层藏匿技巧，拥有稳定的地下黑市销赃网络",
    hook: "最后一次边境运送中整箱高价军火被企业巡逻队扣押，幕后货主至今仍在追索这笔高额赔付",
    checks: ["cool"],
  },
  // 角色特质 · 身心禀赋与处事作风（CK3 式个人先天/性格特质，带「禀赋」标签）
  {
    id: "pain-editor-nerve",
    slot: "skill",
    label: "痛觉钝化",
    tags: ["禀赋", "体质"],
    ability:
      "天生痛觉阈值异于常人或经历过残酷脱敏磨砺，中弹、骨折或遭受电击时仍能面不改色地强行搏命",
    checks: ["body"],
  },
  {
    id: "ice-veins",
    slot: "skill",
    label: "绝对冷静",
    tags: ["禀赋", "心智"],
    ability:
      "哪怕被大口径枪口顶住额头或身处交叉火力网中心，心率也稳如死水，任何威逼利诱都休想让你露出破绽",
    checks: ["cool"],
  },
  {
    id: "danger-sense",
    slot: "skill",
    label: "危险直觉",
    tags: ["禀赋", "感知"],
    ability: "后颈寒毛比战术雷达更灵，总能在红外狙击线锁定、埋伏圈合拢或合约陷阱触发前半秒察觉杀机",
    checks: ["reflexes", "intelligence"],
  },
  {
    id: "silver-tongue",
    slot: "skill",
    label: "八面玲珑",
    tags: ["禀赋", "社交"],
    ability:
      "天生自来熟与察言观色的高手，见人说人话、见鬼说鬼话，无论在帮派堂口还是高管酒会都能迅速混熟套出底牌",
    checks: ["cool"],
  },
  {
    id: "lone-wolf",
    slot: "skill",
    label: "孤狼信条",
    tags: ["禀赋", "作风"],
    ability: "习惯独来独往、从不把后背交给外人；单兵潜入与孤身绝境突围时专注力拉满，反应快人一步",
    checks: ["reflexes"],
  },
  {
    id: "chrome-junkie",
    slot: "skill",
    label: "铬金狂热",
    tags: ["禀赋", "义体"],
    ability:
      "对精密义体与机械结构有着近乎偏执的迷恋，仅凭伺服电机的微弱嗡鸣就能听出对手装了哪家厂商的植入物",
    checks: ["tech"],
  },
  {
    id: "eidetic-memory",
    slot: "skill",
    label: "过目不忘",
    tags: ["禀赋", "心智"],
    ability: "扫过一眼的安保巡逻表、复杂门禁拓扑图与数据流结构都能在脑海里分毫不差地精准复刻",
    checks: ["intelligence"],
  },
  {
    id: "bloodlust-rush",
    slot: "skill",
    label: "嗜血肾上腺",
    tags: ["禀赋", "战斗"],
    ability: "见血越狠、神经兴奋度越高，近身厮杀进入白热化时爆发力与出招速度惊人，气势如虹",
    checks: ["body", "reflexes"],
  },
  // 角色特质 · 战斗与技艺专长
  {
    id: "driving",
    slot: "skill",
    label: "特种驾驶",
    tags: ["车"],
    ability: "无论在夜之城拥挤的高架立交还是恶土碎石荒野中都能从容操舵，精通高速追击与战术规避",
    checks: ["reflexes"],
  },
  {
    id: "lockpick",
    slot: "skill",
    label: "安防与门禁破解",
    tags: ["技术", "潜入"],
    ability: "熟练应对机械弹子锁、企业加密电子门禁及低权限监控终端，擅长无痕潜入与物理破拆",
    checks: ["tech"],
  },
  {
    id: "mechanic",
    slot: "skill",
    label: "机械与工程改造",
    tags: ["技术", "车"],
    ability: "精通各类内燃机与电池载具、工业发电机及民用安保无人机的维修、故障排查与结构拆解",
    checks: ["tech"],
  },
  {
    id: "smart-weapon-mod",
    slot: "skill",
    label: "智能武器校准",
    tags: ["技术", "武器"],
    ability: "擅长微调智能武器的微推进弹道轨迹与目标锁定算法，并能一眼识别枪械是否被植入后门或暗桩",
    checks: ["tech"],
  },
  {
    id: "marksman",
    slot: "skill",
    label: "枪械射击",
    tags: ["枪", "战斗"],
    ability: "熟练掌握手枪与突击步枪的射击要领，高压交火中弹着点稳定，心理素质过硬",
    checks: ["cool"],
  },
  {
    id: "blades",
    slot: "skill",
    label: "冷兵器搏杀",
    tags: ["近战", "战斗"],
    ability: "出刀精准狠辣，擅长近身格挡拆招与无声暗杀，刀尖过处绝不拖泥带水",
    checks: ["reflexes"],
  },
  {
    id: "brawling",
    slot: "skill",
    label: "近身肉搏",
    tags: ["近战", "格斗"],
    ability: "熟稔街头徒手肉搏与关节技，擅长在贴身缠斗中破防击倒并护住致命要害",
    checks: ["body"],
  },
  {
    id: "corpo-negotiation",
    slot: "skill",
    label: "商务交涉",
    tags: ["谈判", "公司"],
    ability: "深谙企业高管与人事部门的心理弱点及商业黑话，在利益博弈中懂得如何争取最大筹码",
    checks: ["cool"],
  },
  {
    id: "streetwise",
    slot: "skill",
    label: "黑市渠道",
    tags: ["街头"],
    ability: "深谙夜之城底层地下规则，知晓各类情报线人、黑市走私商与销赃渠道，消息灵通",
    checks: ["cool"],
  },
  {
    id: "first-aid",
    slot: "skill",
    label: "战术急救",
    tags: ["医疗"],
    ability:
      "熟练使用创伤止血剂、快速凝胶与肾上腺素注射，能在重伤濒死状态下吊住伤者性命直至送抵诊所",
    checks: ["tech"],
  },
  {
    id: "stealth",
    slot: "skill",
    label: "潜伏隐匿",
    tags: ["潜入"],
    ability: "脚步轻无声息，精通红外视野与监控死角穿插，擅长在重兵把守的安保区域神不知鬼不觉地进出",
    checks: ["reflexes", "cool"],
  },
  {
    id: "quickhacking",
    slot: "skill",
    label: "网络快速破解",
    tags: ["黑客"],
    ability:
      "通过网络接入仓在视线范围内对敌方网络节点与植入体实施快速入侵：致盲摄像头、武器故障锁定或过载义体电路",
    checks: ["intelligence"],
  },
  {
    id: "intimidation",
    slot: "skill",
    label: "威慑施压",
    tags: ["威慑"],
    ability: "懂得如何在言语和肢体间散发致命危险信号，在审讯、逼供或街头对峙中迅速击溃对方心理防线",
    checks: ["cool"],
  },
  // 负面经历：点数是返还的
  {
    id: "debt",
    slot: "flaw",
    label: "高利贷沉疴",
    tags: ["债务"],
    ability: "深陷地下放贷机构的高利滚雪球，每天都有令人窒息的滞纳利息在跳动",
    hook: "放贷团伙的打手全天候巡视街区，月底还不上本金就会被送去黑诊所拆卸义体",
    people: [
      { name: "胖子马可", role: "笑面虎高利贷放贷人，旗下养着一帮专拆人义体抵债的收数打手" },
    ],
  },
  {
    id: "enemy",
    slot: "flaw",
    label: "宿怨死敌",
    tags: ["仇家"],
    ability: "有人对你恨之入骨，正在动用所有眼线和悬赏搜寻你的下落",
    hook: "对方在暗网悬赏你的定位，任何街头混混都可能为了赏金将你出卖",
  },
  {
    id: "old-wound",
    slot: "flaw",
    label: "陈旧神经创伤",
    tags: ["伤病"],
    ability:
      "腿部曾遭受大口径贯穿伤或劣质义体神经回火，剧烈冲刺或阴冷潮湿天气下神经突触剧烈刺痛、动作迟滞",
  },
  {
    id: "addiction",
    slot: "flaw",
    label: "神经药物依赖",
    tags: ["成瘾"],
    ability:
      "长期依赖军用级免疫抑制剂或刺激神经的合成药物，一旦断药会出现神经颤抖、剧烈幻觉与焦虑暴躁",
    hook: "掌控药源的黑市药贩握着你的私人据点坐标，随时可能以此敲诈要挟",
  },
  {
    id: "wanted",
    slot: "flaw",
    label: "警局通缉通报",
    tags: ["通缉", "警察"],
    ability:
      "NCPD系统内挂有名副其实的公开通缉档案，一旦被街头巡警或天眼探头扫描确认，将立即引发战术警力围捕",
    hook: "多名以此为生的雇佣赏金猎人时刻紧盯着通缉数据流，企图用你的脑袋换取赎金",
  },
  {
    id: "corpo-blacklist",
    slot: "flaw",
    label: "企业联合封杀",
    tags: ["公司", "黑名单"],
    ability:
      "被巨型跨国企业列入最高级防务与信贷黑名单：企业管区严禁通行，旗下商业终端拒止服务，安保网络自动触发驱逐预警",
    hook: "指令背后站着某位位高权重的企业高管，时刻谋划着让你从夜之城彻底人间蒸发",
  },
]);
