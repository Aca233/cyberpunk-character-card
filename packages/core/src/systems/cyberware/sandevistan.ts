import type { ViewContext } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { HealthStateSchema } from "../health";
import { cyberwareCatalog } from "./apply";
import { BOOST_SLOTS, BOOST_WINDOW, CyberwareStateSchema } from "./schema";

/** 装着、没坏的第一件加速义体；cost 是再开一次扣多少人性 */
export function sandevistanOf(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
): {
  readonly id: string;
  readonly name: string;
  readonly slots: number;
  readonly cost: number;
} | null {
  const parts = cyberwareCatalog(data);
  const broken = HealthStateSchema.parse(world.slices.health).brokenChrome;
  const state = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  for (const c of state.installed) {
    const def = parts.get(c.id);
    if (!def?.accelerator || broken.includes(c.id)) continue;
    const last = state.boost;
    const cost = last && world.time - last.lastAt <= BOOST_WINDOW ? last.count + 1 : 1;
    return { id: def.id, name: def.name, slots: BOOST_SLOTS[def.rarity], cost };
  }
  return null;
}

/** 能用的加速义体；没装或打坏了是 null */
export function sandevistanView({ world, data }: ViewContext) {
  return sandevistanOf(world, data);
}
