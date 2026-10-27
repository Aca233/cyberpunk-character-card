import { defineSystem } from "../../kernel/system";
import { WorldClockStateSchema } from "../world";
import { applySidegig, sidegigsView } from "./apply";
import { sidegigsObjectives } from "./objectives";
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
  objectives: sidegigsObjectives,
  view: {
    key: "sidegigs",
    project: ({ world, data }) =>
      sidegigsView(
        world.slices.sidegigs,
        data,
        WorldClockStateSchema.parse(world.slices.world).location,
        world.time,
      ),
  },
});

export * from "./apply";
export * from "./objectives";
export * from "./prompt";
export * from "./schema";
