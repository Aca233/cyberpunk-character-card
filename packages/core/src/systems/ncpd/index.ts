import { defineSystem } from "../../kernel/system";
import { applyNcpd, tickAlerts } from "./apply";
import { ncpdEvents } from "./events";
import { ncpdRules } from "./prompt";
import { type NcpdCommand, NcpdCommandSchema, type NcpdState, NcpdStateSchema } from "./schema";
import { ncpdStatus } from "./status";
import { ncpdView } from "./view";

/** NCPD 警情：每隔一段在 NCPD 管得到的地点挂一条街头案子，在地图与势力面板显示，不再占待办列表 */
export const ncpd = defineSystem<NcpdState, NcpdCommand>({
  id: "ncpd",
  dependsOn: ["world", "economy", "heat"],
  state: NcpdStateSchema,
  initial: () => ({ alerts: [], lastPostedAt: null, nextId: 1, cleared: 0 }),
  commands: { ncpd: NcpdCommandSchema },
  apply: (draft, command, ctx) => applyNcpd(draft, command, ctx),
  tick: (draft, span, ctx) => tickAlerts(draft, span, ctx),
  rules: [ncpdRules],
  view: { key: "ncpd", project: ncpdView },
  status: ncpdStatus,
  events: ncpdEvents,
});

export * from "./apply";
export * from "./events";
export * from "./objectives";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
