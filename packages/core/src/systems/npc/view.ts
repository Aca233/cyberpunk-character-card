import { z } from "zod";
import type { ViewContext } from "../../kernel/system";
import { behaviorChipSummary, cyberwareCatalog } from "../cyberware";
import { formatGameTime, locationCatalog, WorldClockStateSchema } from "../world";
import { currentOutfit, deathKnown } from "./apply";
import { bodyView } from "./body";
import {
  KNOWN_SOURCE_LABELS,
  LEDGER_KIND_LABELS,
  NO_FACTION,
  NO_FACTION_LABEL,
  NPC_UNDECIDED_PREFIX,
  NpcStateSchema,
} from "./schema";

/**
 * 所属势力的中文名（用户 2026-10-31："npc加个所属势力 没有就填无"）：直接读内容数据的 factions 取 name，
 * 不引 factions 系统免得互相依赖；none 显示「无」，表里查不到的照 id 显示
 */
function factionName(faction: string, data: Readonly<Record<string, unknown>>): string {
  if (faction === NO_FACTION) return NO_FACTION_LABEL;
  const raw = data.factions;
  if (Array.isArray(raw)) {
    for (const f of raw) {
      if (typeof f !== "object" || f === null) continue;
      const { id, name } = f as { id?: unknown; name?: unknown };
      if (id === faction && typeof name === "string") return name;
    }
  }
  return faction;
}

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
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const places = locationCatalog(data);
  const chromeCatalog = cyberwareCatalog(data);
  /** 地点 id 换成中文名；表外的地点只有本身是中文时才当名字，同 inventory 的 namesView */
  const placeName = (id: string | null | undefined) =>
    id == null ? null : (places.get(id)?.name ?? (/[㐀-鿿]/.test(id) ? id : null));
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
      /** 所属势力的中文名，不属于任何势力是「无」；没见过的人和身份一样不给 */
      faction: n.met ? factionName(n.faction, data) : null,
      look: n.met
        ? n.look.startsWith(NPC_UNDECIDED_PREFIX)
          ? "初见时未细看长相，待正式照面后写入档案"
          : n.look
        : "没见过",
      /** 现在穿什么（用户定的，2026-11-02："长相 + 当前穿着"）；没见过面、或旧卡衣着还在 look 里时是 null */
      outfit: n.met ? (currentOutfit(n) ?? null) : null,
      /** 玩家角色知道的这个人的事，旧的在前，带来源 */
      known: n.known.map((k) => ({
        text: k.text,
        sourceLabel: KNOWN_SOURCE_LABELS[k.source],
        at: formatGameTime(k.at),
      })),
      affinity: n.affinity,
      /** 玩家知道的生死：屏幕外死的，听说以前照旧显示活着 */
      alive: !deathKnown(n),
      /** 是否正与玩家结伴同行 */
      following: n.met && !deathKnown(n) && Boolean(n.following),
      here:
        n.met &&
        !deathKnown(n) &&
        (Boolean(n.following) ||
          (n.lastSeenAt !== null &&
            n.lastSeenAt >= clock.sceneStartedAt &&
            (n.lastKnownLocation === null || n.lastKnownLocation === clock.location))),
      /** 最后一次见面的游戏时间；没见过面（只有消息往来）是 null */
      lastSeen: n.lastSeenAt === null ? null : formatGameTime(n.lastSeenAt),
      /** 最后出现的地点和常在的地点（中文名），人物档案信息栏用；没见过面的人不给 */
      lastPlace: n.met ? placeName(n.lastKnownLocation) : null,
      homePlace: n.met ? placeName(n.home) : null,
      /**
       * 玩家最后确认的地点 id；场外移动不会自动刷新地图。
       * 没见过面、位置未知或玩家知道已经死了的人不给。
       */
      placeId: n.met && !deathKnown(n) ? n.lastKnownLocation : null,
      relation: n.relation?.text ?? null,
      doing: n.met ? (n.knownDoing?.text ?? null) : null,
      /**
       * 认识的人（用户 2026-10-31："npc也有自己的生活，也有认识的npc"）：只给公开的、两边玩家都见过的；
       * 私下的关系只给模型看。生死照玩家知道的显示，新的在前
       */
      ties: n.met
        ? n.ties
            .filter((t) => t.open && npcs.npcs[t.id]?.met === true)
            .map((t) => {
              const other = npcs.npcs[t.id];
              return other
                ? { id: other.id, name: other.name, text: t.text, alive: !deathKnown(other) }
                : null;
            })
            .filter(
              (t): t is { id: string; name: string; text: string; alive: boolean } => t !== null,
            )
            .reverse()
        : [],
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
       * 身体：见过的人看伤势和装备；扫描过的看义体配置与精神/人性状态。没见过的人是 null
       */
      body: n.met ? bodyView(n, data, world.time) : null,
      /** 行为芯片当前状态（仅装有行为芯片且见过/已显露时返回） */
      behaviorChip: n.met
        ? behaviorChipSummary(n.body?.cyberware ?? [], n.behaviorChips, chromeCatalog)
        : null,
    }));
}
