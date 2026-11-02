import type { GameOpening } from "@cp/core";
import { RADAR_ANCHORS } from "./radar";

/** 新存档默认用的开场 */
export const DEFAULT_OPENING = "lizzies-2077";

export const openings: readonly GameOpening[] = [
  {
    // 2077 开局：《边缘行者》已经过去，引导委托换成 2077 年还活着的人
    id: "lizzies-2077",
    title: "丽姿酒吧的一块芯片",
    location: "lizzies-bar",
    // 前三个是引导委托用的；其余原作人物开局有卡但没见过，不代表全在开场现场，也不要求都有 arcs.ts 条目。
    // 2026-11-02 用户选择"全部放进开局"：新增 29 人，共 41 人；海外角色的位置见人物卡。
    // 不种已死的边缘行者人物；强尼、德拉曼、奥特、蓝眼睛先生按用户选择暂不建卡。
    cast: [
      "judy",
      "regina",
      "viktor",
      "jackie",
      "misty",
      "rogue",
      "wakako",
      "dex",
      "padre",
      "panam",
      "river",
      "kerry",
      "dino",
      "el-capitan",
      "dakota",
      "mr-hands",
      "takemura",
      "evelyn",
      "hanako",
      "yorinobu",
      "saburo",
      "hellman",
      "t-bug",
      "dum-dum",
      "royce",
      "placide",
      "brigitte",
      "mama-welles",
      "meredith",
      "claire",
      "nix",
      "lizzy-wizzy",
      "smasher",
      "saul",
      "mitch",
      "carol",
      "songbird",
      "reed",
      "myers",
      "hansen",
      "alex",
    ],
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

/** 地图锚点的说法：没有原作店名的服务点只有类别名，写成“一处义体医生”这样，不编店名 */
function anchorWords(id: string): string {
  const anchor = RADAR_ANCHORS.find((a) => a.id === id);
  if (!anchor) return id;
  return anchor.kind !== null && anchor.name === anchor.kind ? `一处${anchor.kind}` : anchor.name;
}

/**
 * 存档用的开场设定；旧存档没有开场。
 * startLocation 是建档时在地图上选的开局地点（用户定的，2026-10-30："可以选择地点开局"，"在地图上选择"）：
 * 和开场自带的地点不同时，在原设定后面补一段，交代玩家眼下在哪、第一轮从哪切进去；
 * 引导委托、出场人物照旧，交货的约定地点仍是开场地点。没选或选的就是开场地点时原样返回，旧存档的提示词不变
 */
export function openingPremise(
  id: string | undefined,
  startLocation?: string | undefined,
): string | undefined {
  const opening = id === undefined ? undefined : openings.find((o) => o.id === id);
  if (!opening) return undefined;
  if (startLocation === undefined || startLocation === opening.location) return opening.premise;
  const here = anchorWords(startLocation);
  const home = anchorWords(opening.location);
  return `${opening.premise}
开局地点改了：玩家角色眼下在${here}（地点 ${startLocation}），不在${home}。上面写的“从${home}开始”“从酒吧里的一个具体瞬间切进去”，改成从${here}的一个具体瞬间切进去；委托照旧，约好的交货地点仍是${home}，玩家角色得自己过去。`;
}
