import { defineSystem } from "../../kernel/system";
import { recordFallout } from "./apply";
import {
  type FalloutRecord,
  FalloutRecordSchema,
  type FalloutState,
  FalloutStateSchema,
} from "./schema";

/** 近期后果：主持流程每轮把生效的指令归类后记下来，提醒主持人别重复、别让失败落空 */
export const fallout = defineSystem<FalloutState, never, FalloutRecord>({
  id: "fallout",
  dependsOn: ["dice"],
  state: FalloutStateSchema,
  initial: () => ({ recent: [], owed: null }),
  commands: {},
  internal: { "fallout.record": FalloutRecordSchema },
  apply: (draft, command, ctx) => recordFallout(draft, command, ctx),
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
