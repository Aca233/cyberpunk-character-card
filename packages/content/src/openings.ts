import type { GameOpening } from "@cp/core";

/** 新存档默认用的开场 */
export const DEFAULT_OPENING = "lizzies-2077";

export const openings: readonly GameOpening[] = [
  {
    // 2077 开局：《边缘行者》已经过去，引导委托换成 2077 年还活着的人
    id: "lizzies-2077",
    title: "丽姿酒吧的一块芯片",
    location: "lizzies-bar",
    cast: ["judy", "regina", "viktor"],
    premise: `这一档从沃森区的丽姿酒吧开始，2077 年刚开头的一个深夜。玩家角色已经接下中间人瑞吉娜·琼斯的一单（委托 regina-shard）：今晚有人会在丽姿酒吧把一块数据芯片（物品 shard）交给玩家角色，明晚十点前送到瑞吉娜手上，报酬两千欧元。交货人是谁、芯片里有什么、还有谁盯着这块芯片，都由你在正文里安排，随着剧情慢慢揭开。
《边缘行者》里的事已经过去了，是街头的旧闻：大卫、丽贝卡、曼恩一伙和中间人法拉第都死了，有人提起时照旧闻写，他们不会出场。
第一轮直接从酒吧里的一个具体瞬间切进去：声音、气味、一个人物主动开口或者递来东西。不要用旁白交代背景，不要列选项，也不要问玩家想做什么。玩家的第一句话已经写了自己在做什么，就顺着它接。
芯片交到玩家角色手上时发 item gain shard；见到瑞吉娜交了货、或者这单黄了，按实际结局发 jobEnd regina-shard。`,
    gear: [
      // 最后装上的武器拿在手里，所以手枪放在刀后面
      { id: "knife", equip: true, slot: 2 },
      { id: "lexington", equip: true, slot: 1 },
      { id: "bounce-back", equip: true },
    ],
    eddies: 300,
    cyberware: ["kiroshi-mk1"],
    deadlines: [],
    jobs: [
      {
        id: "regina-shard",
        title: "把芯片交给瑞吉娜",
        fixer: "regina",
        client: "瑞吉娜的客户（身份不明）",
        location: "lizzies-bar",
        risk: 1,
        reward: 2000,
        conflict: "瑞吉娜的客户想要芯片里的东西；芯片原来的主人想把它追回来，交货人夹在中间",
        afterMinutes: 22 * 60,
      },
    ],
  },
  {
    // 旧存档用的版本：法拉第派单，种的是《边缘行者》的三个人
    id: "lizzies-job",
    hidden: true,
    cast: ["rebecca", "maine", "faraday"],
    title: "丽姿酒吧的一块芯片",
    location: "lizzies-bar",
    premise: `这一档从沃森区的丽姿酒吧开始，深夜。玩家角色已经接下中间人法拉第的一单（委托 faraday-shard）：今晚有人会在丽姿酒吧把一块数据芯片（物品 shard）交给玩家角色，明晚十点前送到法拉第手上，报酬两千欧元。交货人是谁、芯片里有什么、还有谁盯着这块芯片，都由你在正文里安排，随着剧情慢慢揭开。
第一轮直接从酒吧里的一个具体瞬间切进去：声音、气味、一个人物主动开口或者递来东西。不要用旁白交代背景，不要列选项，也不要问玩家想做什么。玩家的第一句话已经写了自己在做什么，就顺着它接。
芯片交到玩家角色手上时发 item gain shard；见到法拉第交了货、或者这单黄了，按实际结局发 jobEnd faraday-shard。`,
    gear: [
      // 最后装上的武器拿在手里，所以手枪放在刀后面
      { id: "knife", equip: true, slot: 2 },
      { id: "lexington", equip: true, slot: 1 },
      { id: "bounce-back", equip: true },
    ],
    eddies: 300,
    cyberware: ["kiroshi-mk1"],
    deadlines: [],
    jobs: [
      {
        id: "faraday-shard",
        title: "把芯片交给法拉第",
        fixer: "faraday",
        client: "法拉第的客户（身份不明）",
        location: "lizzies-bar",
        risk: 1,
        reward: 2000,
        conflict: "法拉第的客户想要芯片里的东西；芯片原来的主人想把它追回来，交货人夹在中间",
        afterMinutes: 22 * 60,
      },
    ],
  },
  {
    // 旧存档用的版本：期限挂在世界时钟上，没有委托卡
    id: "lizzies-shard",
    hidden: true,
    cast: ["rebecca", "maine", "faraday"],
    title: "丽姿酒吧的一块芯片",
    location: "lizzies-bar",
    premise: `这一档从沃森区的丽姿酒吧开始，深夜。中间人法拉第发来消息派了一单：今晚有人会在丽姿酒吧把一块数据芯片（物品 shard）交给玩家角色，明晚十点前送到法拉第手上，报酬两千欧元。交货人是谁、芯片里有什么、还有谁盯着这块芯片，都由你在正文里安排，随着剧情慢慢揭开。
第一轮直接从酒吧里的一个具体瞬间切进去：声音、气味、一个人物主动开口或者递来东西。不要用旁白交代背景，不要列选项，也不要问玩家想做什么。玩家的第一句话已经写了自己在做什么，就顺着它接。
芯片交到玩家角色手上时发 item gain shard；见到法拉第交了货、或者这单黄了，发 deadline handle。`,
    gear: [
      // 最后装上的武器拿在手里，所以手枪放在刀后面
      { id: "knife", equip: true, slot: 2 },
      { id: "lexington", equip: true, slot: 1 },
      { id: "bounce-back", equip: true },
    ],
    deadlines: [{ id: "faraday-shard", label: "把芯片交给法拉第", afterMinutes: 24 * 60 }],
  },
];

/** 存档用的开场设定；旧存档没有开场 */
export function openingPremise(id: string | undefined): string | undefined {
  return id === undefined ? undefined : openings.find((o) => o.id === id)?.premise;
}
