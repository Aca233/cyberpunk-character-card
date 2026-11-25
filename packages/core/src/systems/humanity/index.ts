import { defineSystem } from "../../kernel/system";
import { applyHumanity, applySuppressHumanity } from "./apply";
import { humanityEvents } from "./events";
import { psychosisRules } from "./prompt";
import {
  type HumanityCommand,
  HumanityCommandSchema,
  type HumanityState,
  HumanityStateSchema,
  type SuppressHumanity,
  SuppressHumanitySchema,
} from "./schema";
import { humanityStatus } from "./status";
import { humanityView } from "./view";

export const humanity = defineSystem<HumanityState, HumanityCommand, SuppressHumanity>({
  id: "humanity",
  state: HumanityStateSchema,
  initial: () => ({ symptoms: [], settled: [] }),
  commands: { humanity: HumanityCommandSchema },
  internal: {
    "humanity.suppress": SuppressHumanitySchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "humanity") return applyHumanity(draft, command, ctx.now);
    return applySuppressHumanity(draft, command, ctx.now);
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
