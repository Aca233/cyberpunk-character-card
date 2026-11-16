import { defineSystem } from "../../kernel/system";
import { recordFallout } from "./apply";
import { falloutSection } from "./prompt";
import {
  type FalloutRecord,
  FalloutRecordSchema,
  type FalloutState,
  FalloutStateSchema,
} from "./schema";

/** 近期后果：回合流程每轮把生效的指令归类后记下来，提醒叙事模型别重复、别让失败落空 */
export const fallout = defineSystem<FalloutState, never, FalloutRecord>({
  id: "fallout",
  state: FalloutStateSchema,
  initial: () => ({ recent: [], owed: null }),
  commands: {},
  internal: { "fallout.record": FalloutRecordSchema },
  apply: (draft, command, ctx) => recordFallout(draft, command, ctx),
  sections: [
    {
      order: 60,
      title: "近期后果",
      render: ({ world }) =>
        falloutSection(FalloutStateSchema.parse(world.slices.fallout ?? {})) || undefined,
    },
  ],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
