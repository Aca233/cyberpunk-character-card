import { ComboSchema } from "@cp/core";

/**
 * 预设联动：requires 里每一项要有一块模块的 id 或标签对上，至少两块不同的模块参与。
 * 自写模块由模型解读时也可以提议联动；这里只放常见的组合
 */
export const combos = ComboSchema.array().parse([
  {
    id: "defector",
    label: "叛逃者",
    requires: ["公司", "荒坂", "背叛"],
    ability: "知道公司怎么追查叛逃者：会换身份、躲扫描、走没人查的地下通道",
    hook: "荒坂派了一个专门处理叛逃者的清道夫，这个人已经到了夜之城",
  },
  {
    id: "dirty-cop",
    label: "黑警",
    requires: ["警察", "帮派"],
    ability: "两边都吃得开：知道警方什么时候扫街，也知道帮派怎么给警察塞钱",
    hook: "当年收钱的账本还在某个人手里",
  },
  {
    id: "wheelman",
    label: "车手",
    requires: ["走私", "车"],
    ability: "追车、冲检查站、在车流里穿行的老手，开着车什么货都敢运",
    hook: "海关有个人一直在找当年冲卡的那辆车",
  },
  {
    id: "street-doc",
    label: "巷子里的医生",
    requires: ["医疗", "义体"],
    ability: "能在巷子里给人取子弹、接上断掉的义体线路；街坊受了伤会先来找你",
    hook: "你救过一个不该救的人，他的仇家知道是你",
  },
  {
    id: "ghost",
    label: "幽灵",
    requires: ["黑客", "潜入"],
    ability: "进门之前先黑掉摄像头，出门之后抹掉记录，没人知道你来过",
    hook: "网络监察注意到同一个手法在好几起案子里出现过",
  },
  {
    id: "go-between",
    label: "天生中间人",
    requires: ["街头", "谈判"],
    ability: "两头都说得上话：街上的人信你，公司的人也愿意听你开价",
    hook: "有中间人觉得你在抢他的生意",
  },
  {
    id: "brawler",
    label: "狠角色",
    requires: ["格斗", "近战"],
    ability: "近身缠斗的狠角色，赤手空拳也能放倒拿刀的人",
    hook: "拳场老板想请你回去打最后一场",
  },
]);
