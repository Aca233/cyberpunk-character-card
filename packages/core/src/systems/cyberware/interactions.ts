import type { Interaction, ViewContext } from "../../kernel/system";
import { WorldClockStateSchema } from "../world";
import { ripperdocList } from "./apply";

/** 当前地点的义体医生入口；安装、卸下和修理仍由各自操作校验 */
export function cyberwareInteractions({ world, data }: ViewContext): readonly Interaction[] {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  if (location === null) return [];
  return ripperdocList(data)
    .filter((doc) => doc.location === location)
    .map((doc) => ({
      id: `cyberware:ripperdoc:${doc.id}`,
      source: "cyberware",
      label: `找${doc.name}装义体`,
      icon: "cyberware",
      panel: "ripperdoc",
      target: doc.id,
    }));
}
