import type { Command } from "../kernel/system";
import { type Closeup, effectiveTurns, type LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { itemCatalog } from "../systems/inventory/apply";
import { NpcStateSchema } from "../systems/npc";
import { locationCatalog, WorldClockStateSchema, weatherAt } from "../systems/world";

/** 这个星级以上的委托挂出来时弹特写 */
export const BIG_JOB_RISK = 4;
/** 这些档位的有卡敌人现身时弹特写 */
const BOSS_TIERS: ReadonlySet<string> = new Set(["elite", "legend"]);

function clockText(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 场景标题卡：城区 · 地点 · 时间，不调用模型；还没有地点时为 undefined */
export function sceneTitle(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
): string | undefined {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  if (clock.location === null) return undefined;
  const def = locationCatalog(data).get(clock.location);
  const place = def ? `${def.district} · ${def.name}` : clock.location;
  return `${place} · ${clockText(world.time)} · ${weatherAt(world.time, def?.district ?? null).label}`;
}

/** 这一轮该不该弹特写卡：按生效的指令认；同一个场景已经弹过就不再弹 */
export function closeupFor(
  accepted: readonly Command[],
  world: WorldState,
  records: readonly LogRecord[],
  data: Readonly<Record<string, unknown>>,
): Closeup | undefined {
  const scene = WorldClockStateSchema.parse(world.slices.world).scene;
  if (effectiveTurns(records).some((t) => t.scene === scene && t.closeup !== undefined)) {
    return undefined;
  }
  const items = data.items === undefined ? undefined : itemCatalog(data);
  const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
  for (const raw of accepted) {
    const c = raw as Record<string, unknown> & { type: string };
    if (c.type === "item" && c.action === "gain" && typeof c.id === "string") {
      const def = items?.get(c.id);
      if (def?.iconic) return { kind: "iconic", title: def.name, detail: "获得不朽物品" };
    }
    if (c.type === "jobOffer" && typeof c.risk === "number" && c.risk >= BIG_JOB_RISK) {
      return {
        kind: "bigJob",
        title: String(c.title),
        detail: `${"★".repeat(c.risk)} · ${Number(c.reward).toLocaleString("en-US")} 欧元 · 雇主 ${String(c.client)}`,
      };
    }
    if (c.type === "combat" && c.action === "start" && Array.isArray(c.foes)) {
      const boss = (c.foes as { npc?: unknown; tier?: unknown }[]).find(
        (f) => typeof f.tier === "string" && BOSS_TIERS.has(f.tier),
      );
      if (boss && typeof boss.npc === "string") {
        return { kind: "boss", title: npcs[boss.npc]?.name ?? boss.npc, detail: "首领现身" };
      }
    }
  }
  return undefined;
}
