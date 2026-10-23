import type { GameOpening } from "@cp/core";

/** 新存档默认用的开场 */
export const DEFAULT_OPENING = "lizzies-shard";

export const openings: readonly GameOpening[] = [
  {
    id: "lizzies-shard",
    title: "莉齐酒吧的一块芯片",
    location: "lizzies-bar",
    premise: `这一档从沃森区的莉齐酒吧开始，深夜。中间人法拉第发来消息派了一单：今晚有人会在莉齐酒吧把一块数据芯片（物品 shard）交给玩家角色，明晚十点前送到法拉第手上，报酬两千欧元。交货人是谁、芯片里有什么、还有谁盯着这块芯片，都由你在戏里安排，随着剧情慢慢揭开。
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
