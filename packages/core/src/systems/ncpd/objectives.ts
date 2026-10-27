import type { Objective, ViewContext } from "../../kernel/system";
import { formatGameTime, locationCatalog } from "../world";
import { NcpdStateSchema } from "./schema";

/** NCPD 警情交的待办：扫描器上挂着的每一条，期限是警情撤掉的时间；玩家可以不管 */
export function ncpdObjectives({ world, data }: ViewContext): readonly Objective[] {
  const state = NcpdStateSchema.parse(world.slices.ncpd ?? {});
  const places = locationCatalog(data);
  return state.alerts.map((a) => ({
    id: `ncpd:${a.id}`,
    source: "ncpd",
    sourceLabel: "NCPD 警情",
    title: a.label,
    location: a.location,
    due: formatGameTime(a.expiresAt),
    dueIn: a.expiresAt - world.time,
    progress: `${places.get(a.location)?.name ?? a.location}（${a.district}），${"★".repeat(a.risk)}，赏金 ${a.reward} 欧元`,
    status: "offered",
  }));
}
