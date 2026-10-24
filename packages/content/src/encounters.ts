import { travelRules } from "@cp/core";

/**
 * 路上的偶遇：换城区时代码按几率抽一条，叙事模型写成世界自己发生的事。
 * 全部本作改编：类别照策划书（有人求助、抢劫、黑市交易、撞见旧识、帮派火并、NCPD 盘查、有人认出你），
 * 具体情形是自拟的街头场面，不是原作任务。
 */
export const encounters = travelRules.EncounterCatalogSchema.parse([
  {
    id: "help-roadside",
    label: "有人求助",
    note: "路边有人挨了枪、或者车抛锚了，拦你帮忙；不管的话他可能被清道夫捡走",
    weight: 3,
  },
  {
    id: "mugging",
    label: "抢劫",
    note: "几个小混混堵住去路要钱；不给就动手，绕开要多走一段",
    periods: ["dusk", "night"],
    modes: ["walk"],
    weight: 3,
  },
  {
    id: "black-market",
    label: "黑市交易",
    note: "巷子里有人兜售来路不明的义体或武器，价钱便宜得可疑",
    districts: ["沃森", "太平洲", "圣多明戈", "狗镇"],
    weight: 2,
  },
  {
    id: "old-face",
    label: "撞见旧识",
    note: "认识你的人在路上叫住你；优先用已经有人物卡、有一阵没见的人",
    weight: 2,
  },
  {
    id: "gang-crossfire",
    label: "帮派火并",
    note: "前面街口两伙帮派正在交火，流弹乱飞；可以绕路、等，或者趁乱捞一把",
    periods: ["dusk", "night"],
    weight: 2,
  },
  {
    id: "ncpd-stop",
    label: "NCPD 盘查",
    note: "NCPD 设卡查人查车；身上有通缉时对方会多看你几眼",
    minHeat: 1,
    modes: ["walk", "metro", "car", "stolen"],
    weight: 3,
  },
  {
    id: "recognized",
    label: "有人认出你",
    note: "有人认出了你做过的事，可能是崇拜者、想雇你的人，也可能是来寻仇的",
    minCred: 10,
    weight: 2,
  },
  {
    id: "scavengers",
    label: "清道夫",
    note: "清道夫在附近的楼里拆人卖义体，有人在喊救命",
    districts: ["沃森", "太平洲", "圣多明戈"],
    periods: ["night"],
    weight: 1,
  },
  {
    id: "cyberpsycho-sighting",
    label: "赛博精神病出没",
    note: "前面有个义体失控的人在街上乱开枪，NCPD 已经叫了暴恐机动队",
    weight: 1,
  },
  {
    id: "trauma-team",
    label: "创伤小组出勤",
    note: "创伤小组的浮空车落在路中间救自家会员，枪口对着围观的人",
    districts: ["市政中心", "威斯特布鲁克", "海伍德"],
    weight: 1,
  },
  {
    id: "delamain-chatter",
    label: "出租车多话",
    note: "Delamain 的车一路聊城里的新闻，顺口提到一条可能有用的消息",
    modes: ["taxi"],
    weight: 2,
  },
  {
    id: "ncart-busker",
    label: "车厢里的人",
    note: "轻轨车厢里有人卖艺、传教或者偷钱包，乘客各看各的手机",
    modes: ["metro"],
    weight: 2,
  },
]);
