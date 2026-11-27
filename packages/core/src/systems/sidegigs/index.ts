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
import { sidegigsStatus } from "./status";

/** 拳赛和赛车：与势力看场、地盘火拼与押金特权联动；赢了拿奖金、留名并在中/高阶赛场赢得势力尊重 */
export const sidegigs = defineSystem<SidegigsState, SidegigCommand>({
  id: "sidegigs",
  dependsOn: ["economy", "character", "world", "travel", "factions"],
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
        world.slices.factions,
      ),
  },
  status: sidegigsStatus,
});

export * from "./apply";
export * from "./objectives";
export * from "./prompt";
export * from "./schema";
export * from "./status";
