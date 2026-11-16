import { defineSystem } from "../../kernel/system";
import { applyHumanity, applySuppressHumanity, setTolerance } from "./apply";
import { humanityEvents } from "./events";
import { psychosisRules } from "./prompt";
import {
  type HumanityCommand,
  HumanityCommandSchema,
  type HumanityState,
  HumanityStateSchema,
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
  SetTolerance | SuppressHumanity
>({
  id: "humanity",
  state: HumanityStateSchema,
  initial: () => ({ tolerance: "normal", symptoms: [], settled: [] }),
  commands: { humanity: HumanityCommandSchema },
  internal: {
    "humanity.setTolerance": SetToleranceSchema,
    "humanity.suppress": SuppressHumanitySchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "humanity") return applyHumanity(draft, command, ctx.now);
    if (command.type === "humanity.suppress") {
      return applySuppressHumanity(draft, command, ctx.now);
    }
    return setTolerance(draft, command.tolerance);
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
