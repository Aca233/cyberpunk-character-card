import { defineSystem } from "../../kernel/system";
import { applySidegig } from "./apply";
import { sidegigRules } from "./prompt";
import {
  type SidegigCommand,
  SidegigCommandSchema,
  type SidegigsState,
  SidegigsStateSchema,
} from "./schema";

/** 拳赛和赛车：报名扣押金，赢了拿奖金和声望；比赛本身走检定 */
export const sidegigs = defineSystem<SidegigsState, SidegigCommand>({
  id: "sidegigs",
  dependsOn: ["economy", "character", "world", "travel"],
  state: SidegigsStateSchema,
  initial: () => ({ active: null, record: {} }),
  commands: { sidegig: SidegigCommandSchema },
  apply: (draft, command, ctx) => applySidegig(draft, command, ctx),
  rules: [sidegigRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
