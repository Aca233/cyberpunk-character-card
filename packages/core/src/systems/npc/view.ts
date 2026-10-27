import { z } from "zod";
import type { ViewContext } from "../../kernel/system";
import { CharacterStateSchema, effectiveAttributes as playerAttributes } from "../character";
import { formatGameTime, WorldClockStateSchema } from "../world";
import { deathKnown } from "./apply";
import { attributeSum, bodyView } from "./body";
import { onStage } from "./prompt";
import { KNOWN_SOURCE_LABELS, LEDGER_KIND_LABELS, NpcStateSchema } from "./schema";

/**
 * 只读宿敌名单里的人物 id：交过手的宿敌没见过面也要列出来。
 * nemesis 运行时引用 npc，这里不反过来引用 nemesis 入口，只取 id 这一个字段
 */
const NemesisIdsSchema = z.object({
  nemeses: z.array(z.object({ npc: z.string() })).default([]),
  ended: z.array(z.object({ npc: z.string() })).default([]),
});

/**
 * 见过的人、只听说过的人和宿敌（交过手）；诉求、底线和秘密只给模型看，不在这里。
 * 宿敌和心事两栏由各自系统的视图给，组合层按 id 拼上
 */
export function npcsView({ world, data }: ViewContext) {
  const npcs = NpcStateSchema.parse(world.slices.npc);
  // 旧存档没有宿敌系统
  const rivals = NemesisIdsSchema.parse(world.slices.nemesis ?? {});
  const character = CharacterStateSchema.parse(world.slices.character);
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const stage = { location: clock.location, sceneStartedAt: clock.sceneStartedAt };
  return Object.values(npcs.npcs)
    .filter(
      (n) =>
        n.met ||
        n.known.length > 0 ||
        rivals.nemeses.some((x) => x.npc === n.id) ||
        rivals.ended.some((x) => x.npc === n.id),
    )
    .sort((a, b) => (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1))
    .map((n) => ({
      id: n.id,
      name: n.name,
      alias: n.alias ?? null,
      pronoun: n.pronoun,
      /** 见过面没有；没见过的只是听说过，身份和样子不给 */
      met: n.met,
      role: n.met ? n.role : "只听说过",
      look: n.met ? n.look : "没见过",
      /** 玩家角色知道的这个人的事，旧的在前，带来源 */
      known: n.known.map((k) => ({
        text: k.text,
        sourceLabel: KNOWN_SOURCE_LABELS[k.source],
        at: formatGameTime(k.at),
      })),
      affinity: n.affinity,
      /** 玩家知道的生死：屏幕外死的，听说以前照旧显示活着 */
      alive: !deathKnown(n),
      here: onStage(n, stage),
      /** 最后一次见面的游戏时间；没见过面（只有消息往来）是 null */
      lastSeen: n.lastSeenAt === null ? null : formatGameTime(n.lastSeenAt),
      relation: n.relation?.text ?? null,
      /** 人情和仇：没了结的在前，各自旧的在前 */
      ledger: [
        ...n.ledger.filter((e) => e.settledAt === null),
        ...n.ledger.filter((e) => e.settledAt !== null),
      ].map((e) => ({
        kind: e.kind,
        label: LEDGER_KIND_LABELS[e.kind],
        text: e.text,
        at: formatGameTime(e.at),
        settled: e.settledAt === null ? null : formatGameTime(e.settledAt),
        how: e.how ?? null,
      })),
      memories: n.memories,
      /**
       * 身体：见过的人看伤势和装备；扫描过的再看档位、威胁、属性、生命、义体和人性阶段。
       * 人性数值只给叙事模型，这里没有；没见过的人是 null
       */
      body: n.met ? bodyView(n, data, world.time, attributeSum(playerAttributes(character))) : null,
    }));
}
