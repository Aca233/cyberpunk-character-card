import { defineSystem } from "../../kernel/system";
import { applyNcpd, tickAlerts } from "./apply";
import { ncpdObjectives } from "./objectives";
import { ncpdRules } from "./prompt";
import { type NcpdCommand, NcpdCommandSchema, type NcpdState, NcpdStateSchema } from "./schema";
import { ncpdView } from "./view";

/** NCPD 警情：每隔一段在 NCPD 管得到的地点挂一条街头案子，处理完发赏金、降一星 */
export const ncpd = defineSystem<NcpdState, NcpdCommand>({
  id: "ncpd",
  dependsOn: ["world", "economy", "heat"],
  state: NcpdStateSchema,
  initial: () => ({ alerts: [], lastPostedAt: null, nextId: 1, cleared: 0 }),
  commands: { ncpd: NcpdCommandSchema },
  apply: (draft, command, ctx) => applyNcpd(draft, command, ctx),
  tick: (draft, span, ctx) => tickAlerts(draft, span, ctx),
  rules: [ncpdRules],
  objectives: ncpdObjectives,
  view: { key: "ncpd", project: ncpdView },
});

export * from "./apply";
export * from "./objectives";
export * from "./prompt";
export * from "./schema";
export * from "./view";
