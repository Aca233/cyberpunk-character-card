import { defineSystem } from "../../kernel/system";
import { applyBraindanceConclude, applyBraindanceMark, applyBraindanceStart } from "./apply";
import { braindanceRules } from "./prompt";
import {
  BdConcludeCommandSchema,
  BdMarkCommandSchema,
  type BraindanceCommand,
  BraindanceCommandSchema,
  type BraindanceInternal,
  type BraindanceState,
  BraindanceStateSchema,
} from "./schema";

/** 超梦调查：录像开始时写定冻结，玩家在编辑器里标线索，找全关键线索才能下结论，对错由代码判断 */
export const braindance = defineSystem<BraindanceState, BraindanceCommand, BraindanceInternal>({
  id: "braindance",
  dependsOn: ["jobs"],
  state: BraindanceStateSchema,
  initial: () => ({ active: null, history: [] }),
  commands: { braindance: BraindanceCommandSchema },
  internal: {
    "braindance.mark": BdMarkCommandSchema,
    "braindance.conclude": BdConcludeCommandSchema,
  },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "braindance":
        return applyBraindanceStart(draft, command, ctx);
      case "braindance.mark":
        return applyBraindanceMark(draft, command, ctx);
      case "braindance.conclude":
        return applyBraindanceConclude(draft, command, ctx);
    }
  },
  rules: [braindanceRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./view";
