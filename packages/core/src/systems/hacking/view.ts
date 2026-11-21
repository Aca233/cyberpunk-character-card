import type { ViewContext } from "../../kernel/system";
import { CyberwareStateSchema, DECK_TRAIT_LABELS } from "../cyberware";
import { HealthStateSchema } from "../health";
import { formatGameTime, WorldClockStateSchema } from "../world";
import { deckOf, quickhackCatalog } from "./apply";
import {
  BREACH_GAIN_LABELS,
  CATEGORY_LABELS,
  DIVE_LAYERS,
  DIVE_MAX,
  HackingStateSchema,
} from "./schema";

/** 接入仓的定性硬件状态、活跃破解效果、潜网连接与当前地点已攻破内网；损坏的接入仓不提供可用状态。 */
export function hackingView({ world, data }: ViewContext) {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const { installed } = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  const broken = HealthStateSchema.parse(world.slices.health).brokenChrome;
  const found = deckOf(installed, data, broken);
  if (!found?.deck) return null;
  const state = HackingStateSchema.parse(world.slices.hacking ?? {});
  const catalog = quickhackCatalog(data);
  const blackwallCapable = found.traits.includes("blackwall");
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
  return {
    deck: found.deck,
    deckName: found.deckName ?? found.deck,
    profile: found.profile,
    traits: found.traits,
    traitLabels: found.traits.map((t) => DECK_TRAIT_LABELS[t]),
    selfIce: found.selfIce,
    blackwallCapable,
    programs: state.programs.map((id) => ({
      id,
      name: catalog.get(id)?.name ?? id,
    })),
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
