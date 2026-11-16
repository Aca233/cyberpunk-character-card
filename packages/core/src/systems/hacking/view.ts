import type { ViewContext } from "../../kernel/system";
import { CyberwareStateSchema, cyberwareCatalog } from "../cyberware";
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

/** 设备容量供现有界面显示；没有场景余额，损坏设备不提供运行容量。 */
export function hackingView({ world, data }: ViewContext) {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const { installed } = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  const broken = HealthStateSchema.parse(world.slices.health).brokenChrome;
  const found = deckOf(
    installed.filter((c) => !broken.includes(c.id)),
    data,
  );
  if (!found?.deck) return null;
  const state = HackingStateSchema.parse(world.slices.hacking ?? {});
  const parts = cyberwareCatalog(data);
  const programs = quickhackCatalog(data);
  const ram = found.ramMax;
  return {
    deck: found.deck,
    deckName: parts.get(found.deck)?.name ?? found.deck,
    ram,
    ramMax: found.ramMax,
    slots: found.slots,
    programs: state.programs.map((id) => {
      const def = programs.get(id);
      return {
        id,
        name: def?.name ?? id,
        category: def?.category ?? null,
        categoryLabel: def ? CATEGORY_LABELS[def.category] : "",
        ram: def?.ram ?? 0,
        effect: def?.effect ?? "",
      };
    }),
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
