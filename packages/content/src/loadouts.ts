import type { Loadout } from "@cp/core";

/** 角色卡的出身对不上任何一套时用这一套；自写出身以后改成由模型解读后提议、玩家确认 */
export const DEFAULT_LOADOUT = "street-kid";

/**
 * 开局行装：照策划书，每个出身一整套（开局欧元 500–3,000，人人都有一只基础岐路司义眼），
 * 带黑客经历的再补一个基础接入仓。装备里最后装上的武器拿在手里，所以主武器放在副武器后面
 */
export const loadouts: readonly Loadout[] = [
  {
    id: "street-kid",
    label: "街头小子",
    kind: "origin",
    keywords: ["街头", "街童", "street kid"],
    gear: [
      { id: "knife", equip: true, slot: 2 },
      { id: "lexington", equip: true, slot: 1 },
      { id: "bounce-back", equip: true },
      { id: "street-jacket" },
    ],
    eddies: 800,
    cyberware: ["kiroshi-mk1"],
  },
  {
    id: "nomad",
    label: "流浪者",
    kind: "origin",
    keywords: ["流浪者", "游牧", "恶土", "nomad"],
    gear: [
      { id: "knife", equip: true, slot: 2 },
      { id: "satara", equip: true, slot: 1 },
      { id: "bounce-back", equip: true },
      { id: "nomad-duster" },
    ],
    eddies: 500,
    cyberware: ["kiroshi-mk1"],
  },
  {
    id: "corpo",
    label: "公司员工",
    kind: "origin",
    keywords: ["公司", "corpo", "荒坂", "军用科技", "康陶", "生物技术"],
    gear: [
      { id: "unity", equip: true, slot: 1 },
      { id: "maxdoc", equip: true },
      { id: "corpo-suit" },
      { id: "corpo-badge" },
    ],
    eddies: 3000,
    cyberware: ["kiroshi-mk1"],
  },
  {
    id: "netrunner",
    label: "黑客经历",
    kind: "background",
    keywords: ["黑客", "潜网", "网络行者", "netrunner", "入侵协议", "快速破解"],
    gear: [{ id: "netrunner-suit" }],
    cyberware: ["militech-paraline"],
  },
];
