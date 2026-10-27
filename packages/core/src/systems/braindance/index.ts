import { defineSystem } from "../../kernel/system";
import { braindanceActions } from "./actions";
import { applyBraindanceConclude, applyBraindanceMark, applyBraindanceStart } from "./apply";
import { braindanceEvents } from "./events";
import { braindanceInteractions } from "./interactions";
import { braindanceObjectives } from "./objectives";
import { braindanceRules, braindanceSection } from "./prompt";
import {
  BdConcludeCommandSchema,
  BdMarkCommandSchema,
  type BraindanceCommand,
  BraindanceCommandSchema,
  type BraindanceInternal,
  type BraindanceState,
  BraindanceStateSchema,
} from "./schema";
import { braindanceView } from "./view";

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
  actions: braindanceActions,
  objectives: braindanceObjectives,
  interactions: braindanceInteractions,
  sections: [
    {
      order: 140,
      title: "超梦",
      render: ({ world, data, input }) =>
        braindanceSection(
          BraindanceStateSchema.parse(world.slices.braindance ?? {}),
          data ?? {},
          input,
        ) || undefined,
    },
  ],
  view: {
    key: "braindance",
    project: ({ world }) =>
      braindanceView(BraindanceStateSchema.parse(world.slices.braindance ?? {})),
  },
  events: braindanceEvents,
});

export * from "./actions";
export * from "./apply";
export * from "./events";
export * from "./interactions";
export * from "./objectives";
export * from "./prompt";
export * from "./schema";
export * from "./view";
