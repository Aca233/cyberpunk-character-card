import { hackingRules } from "@cp/core";

/** 名称和类别照原作 2.x，中文名取自官方文本库；退回为常见黑客手段词典，不含容量或槽位门槛 */
const SOURCE =
  "原作依据：《赛博朋克 2077》2.x 快速破解（名称、类别）；手段词典为本作整理；https://cyberpunk.fandom.com/wiki/Cyberpunk_2077_Quickhacks";

/** 常见黑客手段词典：供模型归类 hack / npcHack，不是需要装载的法术表 */
export const quickhacks = hackingRules.QuickhackCatalogSchema.parse([
  {
    id: "ping",
    name: "定位",
    category: "covert",
    effect: "顺着目标的网络标出附近联网的人和设备，隔着墙也看得见",
    source: SOURCE,
  },
  {
    id: "sonic-shock",
    name: "音波震冲",
    category: "covert",
    effect: "扰乱目标的听觉，一阵子听不见动静，也没法用通讯求援",
    source: SOURCE,
  },
  {
    id: "memory-wipe",
    name: "记忆擦除",
    category: "covert",
    effect: "让起疑的目标忘掉刚才看见的东西，回到没察觉的状态",
    source: SOURCE,
  },
  {
    id: "reboot-optics",
    name: "重启义眼",
    category: "control",
    effect: "目标的义眼重启，几秒内什么都看不见",
    source: SOURCE,
  },
  {
    id: "cripple-movement",
    name: "阻碍移动",
    category: "control",
    effect: "锁住目标的运动神经，原地动弹不得",
    source: SOURCE,
  },
  {
    id: "weapon-glitch",
    name: "武器故障",
    category: "control",
    effect: "目标手里的联网武器卡壳、准星乱飘",
    source: SOURCE,
  },
  {
    id: "overheat",
    name: "过热",
    category: "damage",
    effect: "目标体内的义体过热，烧伤并持续灼烧",
    source: SOURCE,
  },
  {
    id: "short-circuit",
    name: "电磁短路",
    category: "damage",
    effect: "电流击穿目标的义体，对机器人和重度义体的人格外狠",
    source: SOURCE,
  },
  {
    id: "contagion",
    name: "连带传染",
    category: "damage",
    effect: "毒性程序在目标身上发作，还会跳到附近联网的人身上",
    source: SOURCE,
  },
  {
    id: "cyberpsychosis",
    name: "赛博精神病",
    category: "ultimate",
    effect: "目标陷入狂乱，攻击身边的任何人",
    source: SOURCE,
  },
  {
    id: "suicide",
    name: "自我了断",
    category: "ultimate",
    effect: "逼目标对自己下手",
    source: SOURCE,
  },
  {
    id: "system-collapse",
    name: "系统崩溃",
    category: "ultimate",
    effect: "目标全身的义体一齐停摆，当场倒下",
    source: SOURCE,
  },
]);
