import { defineSystem } from "../../kernel/system";
import { applyHumanity, setCyberwareCost, setTolerance } from "./apply";
import { psychosisRules } from "./prompt";
import {
  HUMANITY_MAX,
  type HumanityCommand,
  HumanityCommandSchema,
  type HumanityState,
  HumanityStateSchema,
  type SetCyberwareCost,
  SetCyberwareCostSchema,
  type SetTolerance,
  SetToleranceSchema,
} from "./schema";

export const humanity = defineSystem<
  HumanityState,
  HumanityCommand,
  SetCyberwareCost | SetTolerance
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
  internal: {
    "humanity.setCyberwareCost": SetCyberwareCostSchema,
    "humanity.setTolerance": SetToleranceSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "humanity") return applyHumanity(draft, command, ctx.now);
    return command.type === "humanity.setTolerance"
      ? setTolerance(draft, command.tolerance)
      : setCyberwareCost(draft, command.total);
  },
  rules: [psychosisRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
