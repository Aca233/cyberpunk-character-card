import { hackingRules } from "@cp/core";

/** 名称和类别照原作 2.x，中文名取自官方文本库；改为电子战入侵程序芯片目录（含热负荷、破冰前置与物理硬件破坏效果） */
const SOURCE =
  "原作依据：《赛博朋克 2077》2.x 快速破解与《赛博朋克：红》边缘行者电子战设定（名称、类别）；物理与热负荷机制为本作整理；https://cyberpunk.fandom.com/wiki/Cyberpunk_2077_Quickhacks";

/** 快速破解程序芯片目录：实战只能调用接入仓槽位内已插装的程序；受算力热负荷与个人黑冰约束，效果落在物理硬件层面 */
export const quickhacks = hackingRules.QuickhackCatalogSchema.parse([
  {
    id: "ping",
    name: "定位",
    category: "covert",
    load: "light",
    requiresFoothold: false,
    targetRequirement: "目标或其周边接入同一局域网/开放无线端口",
    effect:
      "向本地子网发送低功率回波探针，顺着无线链路标出同网连线的人员神经端口与安保终端位置，并顺带摸清个人黑冰轮廓",
    source: SOURCE,
  },
  {
    id: "sonic-shock",
    name: "音波震冲",
    category: "covert",
    load: "light",
    requiresFoothold: false,
    targetRequirement: "目标装有听觉义体或内嵌无线通讯模块",
    effect:
      "向目标听觉义体与内嵌通讯模块灌入高频白噪并切断外呼信道，短时间内听不清周遭动静也发不出无线求援信号",
    source: SOURCE,
  },
  {
    id: "memory-wipe",
    name: "记忆擦除",
    category: "covert",
    load: "medium",
    requiresFoothold: false,
    targetRequirement: "目标装有带缓冲区的视觉/记忆协同芯片且处于无线可达范围",
    effect:
      "覆写目标义眼视觉缓存与近期感官日志，令其眼前闪花失焦、一时间接不上刚才目击的画面，并阻断正在回传的追踪数据包",
    source: SOURCE,
  },
  {
    id: "reboot-optics",
    name: "重启义眼",
    category: "control",
    load: "light",
    requiresFoothold: false,
    targetRequirement: "目标装有电子义眼（纯肉眼无效）",
    effect: "强制向目标义眼驱动发送异常中断，触发光学固件冷重启，数秒内视野雪花黑屏彻底失明",
    source: SOURCE,
  },
  {
    id: "cripple-movement",
    name: "阻碍移动",
    category: "control",
    load: "medium",
    requiresFoothold: false,
    targetRequirement: "目标装有义肢伺服电机或脊柱运动协处理器",
    effect: "劫持目标下肢义体伺服与脊柱运动总线并锁死关节阻尼，让腿部义肢原地僵死拖不动步子",
    source: SOURCE,
  },
  {
    id: "weapon-glitch",
    name: "武器故障",
    category: "control",
    load: "light",
    requiresFoothold: false,
    targetRequirement: "目标手持带无线/智能芯片或电控击发的现代枪械（纯机械老式土枪与冷兵器无效）",
    effect: "向联网枪械的火控芯片与电子击针注入错乱时序，导致供弹卡壳、智能锁敌飘移或强制退弹匣",
    source: SOURCE,
  },
  {
    id: "overheat",
    name: "过热",
    category: "damage",
    load: "heavy",
    requiresFoothold: false,
    targetRequirement: "目标体内装有带电源与散热阀的电子义体（纯肉体或物理离线端口无效）",
    effect:
      "强行关停目标义体散热阀并把供电推至超频上限，金属壳体与皮下接口瞬间滚烫灼伤血肉，逼迫对方痛苦失衡甚至烧毁散热件",
    source: SOURCE,
  },
  {
    id: "short-circuit",
    name: "电磁短路",
    category: "damage",
    load: "heavy",
    requiresFoothold: false,
    targetRequirement: "目标装有义肢、斯安威斯坦、外骨骼或重型电子义体",
    effect:
      "绕过稳压保护向目标核心义体灌入瞬时高压电涌，直接击穿一条义肢、斯安威斯坦或安保机体的电路板，当场冒烟半身瘫痪",
    source: SOURCE,
  },
  {
    id: "contagion",
    name: "连带传染",
    category: "damage",
    load: "heavy",
    requiresFoothold: false,
    targetRequirement: "目标装有开放无线端口的代谢/内循环义体并与附近同网目标互通",
    effect:
      "劫持目标内循环过滤芯片释放失调激素并沿共享子网横向蠕虫扩散，令连网目标接连出现剧烈恶心、抽搐与神经失调",
    source: SOURCE,
  },
  {
    id: "cyberpsychosis",
    name: "赛博精神病",
    category: "ultimate",
    load: "extreme",
    requiresFoothold: true,
    targetRequirement: "需先捅穿目标个人黑冰建立立足点，且目标装有高负荷战斗义体与神经协处理器",
    effect:
      "接管目标边缘系统与战斗义体敌我识别模块，持续灌入极端应激脉冲令其彻底丧失敌我分辨、狂乱攻向身边一切活物；施放者接入仓瞬间飙至过载高温",
    source: SOURCE,
  },
  {
    id: "suicide",
    name: "自我了断",
    category: "ultimate",
    load: "extreme",
    requiresFoothold: true,
    targetRequirement: "需先捅穿目标个人黑冰建立立足点，且目标装有神经运动总线与义肢接口",
    effect:
      "深度劫持目标脊柱运动总线与持械义臂驱动，强行覆盖自主意识逼其将枪口或利刃转向自己要害；极高算力负载会令施放者接入仓与脑神经直冲过载临界",
    source: SOURCE,
  },
  {
    id: "system-collapse",
    name: "系统崩溃",
    category: "ultimate",
    load: "extreme",
    requiresFoothold: true,
    targetRequirement: "需先捅穿目标个人黑冰建立立足点，且目标高度依赖全身义体与神经操作系统",
    effect:
      "向目标中枢操作系统写入致命内核死锁，强制触发全身义体与神经总线同步断电休克，目标如断线木偶当场昏厥倒地；接入仓随之剧烈积热",
    source: SOURCE,
  },
]);
