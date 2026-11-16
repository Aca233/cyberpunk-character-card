import type { Objective, ViewContext } from "../../kernel/system";
import { WorldClockStateSchema } from "../world";
import { sidegigsView } from "./apply";

/**
 * 拳赛和赛车交的待办：只有玩家真正下场正在比的那一场才进追踪，
 * 平时只在街区氛围和地图风声里自然存在，不提前列成预设待办
 */
export function sidegigsObjectives({ world, data }: ViewContext): readonly Objective[] {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const view = sidegigsView(world.slices.sidegigs, data, clock.location, world.time);
  const active = view.active;
  if (!active) return [];
  return [
    {
      id: `sidegigs:${active.id}`,
      source: "sidegigs",
      sourceLabel: active.kindLabel,
      title: `${active.name}：对手${active.opponent}`,
      location: active.location,
      due: null,
      dueIn: null,
      progress: "正在比",
      status: "active",
    },
  ];
}
