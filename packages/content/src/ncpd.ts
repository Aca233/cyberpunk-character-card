import { ncpdRules } from "@cp/core";

/**
 * NCPD 警情模板：扫描器上能接的街头案子（原作依据 2.0 的 NCPD 扫描器委托：处理完拿赏金）。
 * 具体情形、赏金和危险程度都是本作改编；狗镇和恶土 NCPD 管不到，代码不往那里挂
 */
export const ncpdAlerts = ncpdRules.AlertCatalogSchema.parse([
  {
    id: "street-assault",
    label: "当街袭击",
    note: "几个混混在街角围殴一个路人，周围的人只敢远远看着",
    reward: 400,
    risk: 1,
    weight: 3,
  },
  {
    id: "armed-robbery",
    label: "持械抢劫",
    note: "一伙人刚抢了便利店，还在附近分赃，店主报了警",
    reward: 500,
    risk: 1,
    weight: 3,
  },
  {
    id: "gang-deal",
    label: "帮派交易",
    note: "帮派在仓库后面交货，NCPD 想要人或者证据",
    districts: ["沃森", "海伍德", "圣多明戈", "太平洲"],
    gangRelated: true,
    reward: 800,
    risk: 2,
    weight: 2,
  },
  {
    id: "hostage",
    label: "劫持人质",
    note: "有人把店员扣在后屋要钱，手里有枪，情绪不稳",
    reward: 1000,
    risk: 2,
    weight: 1,
  },
  {
    id: "gang-stash",
    label: "帮派藏货点",
    note: "线报说一间公寓里藏着赃物和军火，门口有人守",
    gangRelated: true,
    reward: 900,
    risk: 2,
    weight: 2,
  },
  {
    id: "hijacked-van",
    label: "货车被劫",
    note: "一辆公司货车在路上被拦下，司机还被扣在驾驶室里",
    reward: 700,
    risk: 2,
    weight: 1,
  },
  {
    id: "drug-lab",
    label: "地下毒品作坊",
    note: "有人在地下室熬药，门口有人放哨，里面气味呛人",
    gangRelated: true,
    reward: 800,
    risk: 2,
    weight: 1,
  },
  {
    id: "scavenger-den",
    label: "清道夫窝点",
    note: "清道夫在废楼里关着人，正准备摘义体",
    districts: ["沃森", "圣多明戈", "太平洲"],
    faction: "scavengers",
    gangRelated: true,
    reward: 1500,
    risk: 3,
    weight: 1,
  },
]);
