import type { Objective, ViewContext } from "../../kernel/system";
import { WorldClockStateSchema } from "../world";
import { sidegigsView } from "./apply";

/**
 * 拳赛和赛车交的待办：正在比的那一场，和当前地点能报名、还没赢过的场次；
 * 别处的场次只在地图上看，不进待办，免得一直挂着一排
 */
export function sidegigsObjectives({ world, data }: ViewContext): readonly Objective[] {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const view = sidegigsView(world.slices.sidegigs, data, clock.location, world.time);
  const active = view.active;
  const shown = view.list.filter(
    (g) => g.id === active?.id || (g.here && !g.beaten && g.rematch === null),
  );
  return shown.map((g) => ({
    id: `sidegigs:${g.id}`,
    source: "sidegigs",
    sourceLabel: g.kindLabel,
    title: `${g.name}：对手${g.opponent}`,
    location: g.location,
    due: null,
    dueIn: null,
    progress:
      g.id === active?.id
        ? "正在比"
        : `押金 ${g.stake}、奖金 ${g.purse}${g.losses > 0 ? `；输过 ${g.losses} 次` : ""}`,
    status: g.id === active?.id ? "active" : "offered",
  }));
}
