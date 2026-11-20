import type { SystemSection } from "../../kernel/system";
import { NpcStateSchema, onStage } from "../npc";
import { WorldClockStateSchema } from "../world";
import { arcSection } from "./prompt";
import { ArcsStateSchema } from "./schema";

/** 给叙事模型的【心事】：按在场人物筛选，排在【宿敌】之后 */
export const arcsSections: readonly SystemSection[] = [
  {
    order: 130,
    title: "心事",
    render: ({ world, data, stage }) => {
      const clock = WorldClockStateSchema.parse(world.slices.world);
      const npcs = NpcStateSchema.parse(world.slices.npc);
      const stageInfo = { location: clock.location, sceneStartedAt: clock.sceneStartedAt };
      const present = new Set(
        Object.values(npcs.npcs)
          .filter((n) => onStage(n, stageInfo))
          .map((n) => n.id),
      );
      return (
        arcSection(
          ArcsStateSchema.parse(world.slices.arcs ?? {}),
          data ?? {},
          npcs.npcs,
          present,
          stage,
        ) || undefined
      );
    },
  },
];
