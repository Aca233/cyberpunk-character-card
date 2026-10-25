import { defineSystem } from "../../kernel/system";
import { applyHumanity, setAnchored, setCyberwareCost, setTolerance } from "./apply";
import { psychosisRules } from "./prompt";
import {
  HUMANITY_MAX,
  type HumanityCommand,
  HumanityCommandSchema,
  HumanityProposalSchema,
  type HumanityState,
  HumanityStateSchema,
  legacyHumanity,
  type SetAnchored,
  SetAnchoredSchema,
  type SetCyberwareCost,
  SetCyberwareCostSchema,
  type SetTolerance,
  SetToleranceSchema,
} from "./schema";

export const humanity = defineSystem<
  HumanityState,
  HumanityCommand,
  SetCyberwareCost | SetTolerance | SetAnchored
>({
  id: "humanity",
  state: HumanityStateSchema,
  initial: () => ({
    current: HUMANITY_MAX,
    cyberwareCost: 0,
    tolerance: "normal",
    recovery: { day: 0, amount: 0 },
    settled: [],
    anchored: false,
  }),
  commands: { humanity: HumanityCommandSchema },
  proposals: { humanity: { schema: HumanityProposalSchema, legacy: legacyHumanity } },
  internal: {
    "humanity.setCyberwareCost": SetCyberwareCostSchema,
    "humanity.setTolerance": SetToleranceSchema,
    "humanity.setAnchored": SetAnchoredSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "humanity") return applyHumanity(draft, command, ctx.now);
    if (command.type === "humanity.setAnchored") return setAnchored(draft, command.anchored);
    return command.type === "humanity.setTolerance"
      ? setTolerance(draft, command.tolerance)
      : setCyberwareCost(draft, command.total);
  },
  rules: [psychosisRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
