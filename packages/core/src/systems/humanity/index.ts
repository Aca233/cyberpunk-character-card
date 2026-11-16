import { defineSystem } from "../../kernel/system";
import { applyHumanity, applySuppressHumanity, setCyberwareCost, setTolerance } from "./apply";
import { humanityEvents } from "./events";
import { psychosisRules } from "./prompt";
import {
  HUMANITY_MAX,
  type HumanityCommand,
  HumanityCommandSchema,
  HumanityProposalSchema,
  type HumanityState,
  HumanityStateSchema,
  legacyHumanity,
  type SetCyberwareCost,
  SetCyberwareCostSchema,
  type SetTolerance,
  SetToleranceSchema,
  type SuppressHumanity,
  SuppressHumanitySchema,
} from "./schema";
import { humanityStatus } from "./status";
import { humanityView } from "./view";

export const humanity = defineSystem<
  HumanityState,
  HumanityCommand,
  SetCyberwareCost | SetTolerance | SuppressHumanity
>({
  id: "humanity",
  state: HumanityStateSchema,
  initial: () => ({
    current: HUMANITY_MAX,
    cyberwareCost: 0,
    tolerance: "normal",
    recovery: { day: 0, amount: 0 },
    settled: [],
  }),
  commands: { humanity: HumanityCommandSchema },
  proposals: { humanity: { schema: HumanityProposalSchema, legacy: legacyHumanity } },
  internal: {
    "humanity.setCyberwareCost": SetCyberwareCostSchema,
    "humanity.setTolerance": SetToleranceSchema,
    "humanity.suppress": SuppressHumanitySchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "humanity") return applyHumanity(draft, command, ctx.now);
    if (command.type === "humanity.suppress") {
      return applySuppressHumanity(draft, command, ctx.now);
    }
    return command.type === "humanity.setTolerance"
      ? setTolerance(draft, command.tolerance)
      : setCyberwareCost(draft, command.total);
  },
  rules: [psychosisRules],
  view: { key: "humanity", project: humanityView },
  status: humanityStatus,
  events: humanityEvents,
});

export * from "./apply";
export * from "./events";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
