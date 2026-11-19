import { defineSystem } from "../../kernel/system";
import { applyBraindance } from "./apply";
import { braindanceEvents } from "./events";
import { braindanceRules, braindanceSection } from "./prompt";
import {
  type BraindanceCommand,
  BraindanceCommandSchema,
  type BraindanceState,
  BraindanceStateSchema,
} from "./schema";
import { braindanceView } from "./view";

/** 作品、正文体验与有来源的追问；消费不自动成为任务。 */
export const braindance = defineSystem<BraindanceState, BraindanceCommand>({
  id: "braindance",
  dependsOn: ["commerce", "inventory", "world", "shards"],
  state: BraindanceStateSchema,
  initial: () => BraindanceStateSchema.parse({}),
  commands: { braindance: BraindanceCommandSchema },
  apply: applyBraindance,
  rules: [braindanceRules],
  sections: [
    {
      order: 140,
      title: "超梦",
      render: ({ world, data, input }) =>
        braindanceSection(
          BraindanceStateSchema.parse(world.slices.braindance ?? {}),
          data ?? {},
          input,
          world,
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

export * from "./apply";
export * from "./events";
export * from "./prompt";
export * from "./schema";
export * from "./view";
