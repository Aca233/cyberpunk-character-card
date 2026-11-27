import type { ViewContext } from "../../kernel/system";
import { CyberwareStateSchema, DECK_TRAIT_LABELS } from "../cyberware";
import { HealthStateSchema } from "../health";
import {
  InventoryStateSchema,
  itemCatalog,
  summarizeGearEffects,
  withWorldObjects,
} from "../inventory";
import { formatGameTime, WorldClockStateSchema } from "../world";
import {
  deckOf,
  effectiveHeatAt,
  quickhackCatalog,
  STARTER_DECK_PROGRAMS,
  thermalLevelOf,
} from "./apply";
import {
  BREACH_GAIN_LABELS,
  CATEGORY_LABELS,
  DIVE_LAYERS,
  DIVE_MAX,
  HACK_LOAD_LABELS,
  HackingStateSchema,
  THERMAL_LABELS,
  THERMAL_MAX_HEAT,
} from "./schema";

/** 接入仓的硬件状态、已插装程序芯片、热负荷、破冰立足点、活跃破解效果、潜网连接与当前地点已攻破内网 */
export function hackingView({ world, data }: ViewContext) {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const { installed } = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  const broken = HealthStateSchema.parse(world.slices.health).brokenChrome;
  const found = deckOf(installed, data, broken);
  if (!found?.deck) return null;
  const state = HackingStateSchema.parse(world.slices.hacking ?? {});
  const catalog = quickhackCatalog(data);
  const blackwallCapable = found.traits.includes("blackwall");
  const hasRecovery = found.traits.includes("recovery");

  // 兼容旧存档与尚未触发 syncDeck 的初始视图：按与 ensureStarterPrograms 相同规则推算已插装与芯片盒列表
  const starterIds = STARTER_DECK_PROGRAMS.filter((id) => catalog.size === 0 || catalog.has(id));
  const hasExisting =
    state.starterSeeded ||
    state.programs.length > 0 ||
    state.ownedPrograms.some((id) => starterIds.includes(id));
  const ownedIds = hasExisting
    ? [...new Set([...state.ownedPrograms, ...state.programs])]
    : [...new Set([...state.ownedPrograms, ...starterIds])];
  const loadedIds = hasExisting
    ? state.programs.slice(0, found.slots)
    : ownedIds.slice(0, found.slots);
  const spareIds = ownedIds.filter((id) => !loadedIds.includes(id));

  const formatProg = (id: string) => {
    const def = catalog.get(id);
    return {
      id,
      name: def?.name ?? id,
      category: def?.category ?? null,
      categoryLabel: def ? CATEGORY_LABELS[def.category] : null,
      load: def?.load ?? null,
      loadLabel: def ? HACK_LOAD_LABELS[def.load] : null,
      requiresFoothold: def?.requiresFoothold ?? false,
      targetRequirement: def?.targetRequirement ?? null,
      effect: def?.effect ?? null,
    };
  };

  let thermalRelief = 0;
  if (data.items !== undefined && world.slices.inventory !== undefined) {
    const inv = InventoryStateSchema.parse(world.slices.inventory);
    const catalogItems = itemCatalog(withWorldObjects(data, inv.objects));
    thermalRelief = summarizeGearEffects(inv, catalogItems).netThermalRelief;
  }

  const heat = effectiveHeatAt(state.thermal, world.time, {
    hasRecovery,
    inDiveChair: state.dive !== null,
    thermalRelief,
  });
  const thermalLevel = thermalLevelOf(heat);

  const activeEffects = state.activeEffects
    .filter((e) => e.location === null || e.location === location)
    .map((e) => ({
      program: e.program,
      label: e.label,
      categoryLabel: e.category ? CATEGORY_LABELS[e.category] : null,
      target: e.target,
      effect: e.effect,
      at: formatGameTime(e.at),
    }));

  const breachedTargets = state.breachedTargets
    .filter((b) => b.location === null || b.location === location)
    .map((b) => ({
      target: b.target,
      npc: b.npc ?? null,
      via: b.via ?? null,
      at: formatGameTime(b.at),
    }));

  return {
    deck: found.deck,
    deckName: found.deckName ?? found.deck,
    profile: found.profile,
    slots: found.slots,
    traits: found.traits,
    traitLabels: found.traits.map((t) => DECK_TRAIT_LABELS[t]),
    selfIce: found.selfIce,
    blackwallCapable,
    programs: loadedIds.map(formatProg),
    sparePrograms: spareIds.map(formatProg),
    thermal: {
      heat,
      maxHeat: THERMAL_MAX_HEAT,
      level: thermalLevel,
      label: THERMAL_LABELS[thermalLevel],
      overloadCount: state.thermal.overloadCount,
    },
    breachedTargets,
    activeEffects,
    traceAlert:
      state.traceAlert &&
      (state.traceAlert.location === null || state.traceAlert.location === location)
        ? {
            target: state.traceAlert.target,
            at: formatGameTime(state.traceAlert.at),
          }
        : null,
    /** 正在潜网：本次目标内的接入深入档位、已确认进展与肉身看护；没在潜是 null。 */
    dive: state.dive && {
      layer: state.dive.layer,
      layers: DIVE_MAX,
      /** 当前目标内部接入深入程度的五档显示，不代表全网物理层。 */
      layerLabels: DIVE_LAYERS,
      label: DIVE_LAYERS[state.dive.layer - 1] ?? "",
      chair: state.dive.chair,
      guard: state.dive.guard,
      notes: state.dive.notes,
      blackwallVisible: blackwallCapable,
    },
    /** 这个地点入侵过的网络，最近的在前 */
    breaches: state.breachedNetworks
      .filter((n) => n.location === location)
      .reverse()
      .map((n) => ({
        name: n.name,
        at: formatGameTime(n.at),
        gains: n.gains.map((g) => BREACH_GAIN_LABELS[g]),
      })),
  };
}
