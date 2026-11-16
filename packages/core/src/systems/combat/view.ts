import type { ViewContext } from "../../kernel/system";
import { itemCatalog } from "../inventory";
import {
  BODY_PART_LABELS,
  CombatStateSchema,
  DRIFT_LABELS,
  FOE_STATE_LABELS,
  HOLDER_LABELS,
  MOURNER_LABELS,
} from "./schema";

/** 玩家可见的战斗：谁在场、倒下的人身上有什么；案底里的死者、伤、疤、流言、录像 */
export function combatView({ world, data }: ViewContext) {
  const combat = CombatStateSchema.parse(world.slices.combat);
  const active = combat.active;
  const now = world.time;
  const here = (world.slices.world as { location?: string | null } | undefined)?.location ?? null;
  const catalog = data.items === undefined ? undefined : itemCatalog(data);
  const named = (ids: readonly string[]) =>
    ids.map((id) => ({ id, name: catalog?.get(id)?.name ?? id }));
  const lootable = (state: string) => state === "down" || state === "dead";
  return {
    active: active && {
      district: active.district,
      foes: active.foes.map((f) => ({
        id: f.id,
        npc: f.npc,
        name: f.name,
        gang: f.gang,
        state: f.state,
        stateLabel: FOE_STATE_LABELS[f.state],
        carry: lootable(f.state) ? named(f.carry) : [],
      })),
    },
    loot: combat.groundLoot
      .filter((l) => l.location === here && l.items.length > 0)
      .map((l) => ({ from: l.from, name: l.name, items: named(l.items) })),
    dead: combat.dead.map((d) => ({
      ...d,
      mournerLabel: MOURNER_LABELS[d.mourner],
    })),
    wounds: combat.wounds.map((w) => ({
      ...w,
      partLabel: BODY_PART_LABELS[w.part],
      /** 还要几天长好，向上取整 */
      daysLeft: w.healsAt === null ? 0 : Math.max(0, Math.ceil((w.healsAt - now) / 1440)),
    })),
    scars: combat.scars.map((s) => ({ ...s, partLabel: BODY_PART_LABELS[s.part] })),
    rumors: combat.rumors.map((r) => {
      const latest = r.hops[r.hops.length - 1];
      return {
        ...r,
        latest,
        driftLabels: (latest?.drifts ?? []).map((d) => DRIFT_LABELS[d]),
      };
    }),
    footage: combat.footage.map((f) => ({ ...f, holderLabel: HOLDER_LABELS[f.holder] })),
    last: combat.last,
  };
}
