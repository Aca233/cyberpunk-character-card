import type { ViewContext } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { HealthStateSchema } from "../health";
import { cyberwareCatalog } from "./apply";
import { CyberwareStateSchema } from "./schema";

/** 装着、没坏的第一件加速义体；动作范围由时距与设备能力决定 */
export function sandevistanOf(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
): {
  readonly id: string;
  readonly name: string;
} | null {
  const parts = cyberwareCatalog(data);
  const broken = HealthStateSchema.parse(world.slices.health).brokenChrome;
  const state = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  for (const c of state.installed) {
    const def = parts.get(c.id);
    if (!def?.accelerator || broken.includes(c.id)) continue;
    return { id: def.id, name: def.name };
  }
  return null;
}

/** 能用的加速义体；没装或打坏了是 null */
export function sandevistanView({ world, data }: ViewContext) {
  return sandevistanOf(world, data);
}
