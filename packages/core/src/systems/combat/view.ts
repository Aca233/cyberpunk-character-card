import type { ViewContext } from "../../kernel/system";
import { HealthStateSchema } from "../health";
import {
  defaultInstanceStateFromDef,
  formatWeaponWithMods,
  InventoryStateSchema,
  itemCatalog,
  withWorldObjects,
} from "../inventory";
import type { NpcState } from "../npc";
import {
  BODY_PART_LABELS,
  CombatStateSchema,
  DRIFT_LABELS,
  FOE_STATE_LABELS,
  HOLDER_LABELS,
  type LootItemSpec,
  MOURNER_LABELS,
} from "./schema";

const FOE_TIER_LABELS: Readonly<Record<string, string>> = {
  street: "街头杂兵",
  veteran: "老练打手",
  elite: "精锐重装",
  legend: "传奇人物",
};

/** 玩家可见的战斗：谁在场、倒下的人身上有什么；案底里的死者、伤、疤、流言、录像 */
export function combatView({ world, data }: ViewContext) {
  const combat = CombatStateSchema.parse(world.slices.combat);
  const health =
    world.slices.health === undefined ? undefined : HealthStateSchema.parse(world.slices.health);
  const injuries = new Map(health?.injuries.map((injury) => [injury.id, injury]) ?? []);
  const active = combat.active;
  const now = world.time;
  const here = (world.slices.world as { location?: string | null } | undefined)?.location ?? null;
  const npcs = (world.slices.npc as NpcState | undefined)?.npcs ?? {};
  const stillCarried = (npc: string | null, ids: readonly string[]) => {
    if (npc === null) return ids;
    const card = npcs[npc];
    if (!card || (card.location !== null && card.location !== here)) return [];
    return ids.filter((id) => card.body?.gear.includes(id));
  };
  const invParsed =
    world.slices.inventory !== undefined
      ? InventoryStateSchema.safeParse(world.slices.inventory)
      : undefined;
  const objects = invParsed?.success ? invParsed.data.objects : {};
  const effectiveData =
    data.items !== undefined && Object.keys(objects).length > 0
      ? withWorldObjects(data, objects)
      : data;
  const catalog = effectiveData.items === undefined ? undefined : itemCatalog(effectiveData);
  const named = (ids: readonly string[], specs: Readonly<Record<string, LootItemSpec>> = {}) =>
    ids.map((id) => {
      const spec = specs[id];
      const obj = objects[id];
      const def = spec?.definition ?? catalog?.get(id) ?? obj?.definition;
      const ws =
        spec?.weaponState ??
        obj?.weaponState ??
        (def ? defaultInstanceStateFromDef(def) : undefined);
      const baseName = def?.name ?? (ws ? catalog?.get(ws.baseId)?.name : undefined) ?? id;
      const name = ws ? formatWeaponWithMods(baseName, ws, catalog ?? new Map()) : baseName;
      const baseId = ws?.baseId;
      return {
        id,
        ...(baseId && baseId !== id ? { baseId } : {}),
        name,
      };
    });
  const lootable = (state: string) => state === "down" || state === "dead";
  return {
    active: active && {
      district: active.district,
      foes: active.foes.map((f) => ({
        id: f.id,
        npc: f.npc,
        name: f.name,
        gang: f.gang,
        tier: f.tier,
        tierLabel: FOE_TIER_LABELS[f.tier] ?? f.tier,
        state: f.state,
        stateLabel: FOE_STATE_LABELS[f.state],
        carry: lootable(f.state) ? named(stillCarried(f.npc, f.carry), f.carrySpecs) : [],
      })),
    },
    loot: combat.groundLoot
      .filter((l) => l.location === here && l.items.length > 0)
      .map((l) => ({
        from: l.from,
        name: l.name,
        items: named(stillCarried(l.npc, l.items), l.itemSpecs),
      }))
      .filter((l) => l.items.length > 0),
    dead: combat.dead.map((d) => ({
      ...d,
      mournerLabel: MOURNER_LABELS[d.mourner],
    })),
    wounds: combat.wounds.map((w) => {
      const injury = injuries.get(w.id);
      const healsAt = injury ? injury.healsAt : w.healsAt;
      return {
        ...w,
        treated: injury?.treated ?? w.treated,
        healsAt,
        partLabel: BODY_PART_LABELS[w.part],
        /** 还要几天长好，向上取整 */
        daysLeft: healsAt === null ? 0 : Math.max(0, Math.ceil((healsAt - now) / 1440)),
      };
    }),
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
