import type { ViewContext } from "../../kernel/system";
import { CyberwareStateSchema, DECK_TRAIT_LABELS } from "../cyberware";
import { HealthStateSchema } from "../health";
import { formatGameTime, WorldClockStateSchema } from "../world";
import { deckOf } from "./apply";
import { BREACH_GAIN_LABELS, DIVE_LAYERS, DIVE_MAX, HackingStateSchema } from "./schema";

/** 接入仓的定性硬件状态、潜网连接与当前地点已攻破内网；损坏的接入仓不提供可用状态。 */
export function hackingView({ world, data }: ViewContext) {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const { installed } = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  const broken = HealthStateSchema.parse(world.slices.health).brokenChrome;
  const found = deckOf(installed, data, broken);
  if (!found?.deck) return null;
  const state = HackingStateSchema.parse(world.slices.hacking ?? {});
  return {
    deck: found.deck,
    deckName: found.deckName ?? found.deck,
    profile: found.profile,
    traits: found.traits,
    traitLabels: found.traits.map((t) => DECK_TRAIT_LABELS[t]),
    selfIce: found.selfIce,
    /** 正在潜网：第几层、这一层叫什么、谁守着肉身；没在潜是 null */
    dive: state.dive && {
      layer: state.dive.layer,
      layers: DIVE_MAX,
      /** 每一层的名字，从浅到深 */
      layerLabels: DIVE_LAYERS,
      label: DIVE_LAYERS[state.dive.layer - 1] ?? "",
      chair: state.dive.chair,
      guard: state.dive.guard,
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
