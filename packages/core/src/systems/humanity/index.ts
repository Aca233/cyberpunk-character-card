import { defineSystem } from "../../kernel/system";
import { applyHumanity, setCyberwareCost } from "./apply";
import {
  HUMANITY_MAX,
  type HumanityCommand,
  HumanityCommandSchema,
  type HumanityState,
  HumanityStateSchema,
  type SetCyberwareCost,
  SetCyberwareCostSchema,
} from "./schema";

export const humanity = defineSystem<HumanityState, HumanityCommand, SetCyberwareCost>({
  id: "humanity",
  state: HumanityStateSchema,
  initial: () => ({
    current: HUMANITY_MAX,
    cyberwareCost: 0,
    recovery: { day: 0, amount: 0 },
    settled: [],
  }),
  commands: { humanity: HumanityCommandSchema },
  internal: { "humanity.setCyberwareCost": SetCyberwareCostSchema },
  apply(draft, command, ctx) {
    return command.type === "humanity"
      ? applyHumanity(draft, command, ctx.now)
      : setCyberwareCost(draft, command.total);
  },
});

export * from "./apply";
export * from "./schema";
