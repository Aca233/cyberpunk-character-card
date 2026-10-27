import type { SystemSection } from "../../kernel/system";
import { districtResolver, WorldClockStateSchema } from "../world";
import { castSection } from "./prompt";
import { NpcStateSchema } from "./schema";

/** 给叙事模型的情境节：【人物】每轮都带，在【当前状态】之后 */
export const npcSections: readonly SystemSection[] = [
  {
    order: 10,
    title: "人物",
    render: ({ world, data }) => {
      const clock = WorldClockStateSchema.parse(world.slices.world);
      return castSection(NpcStateSchema.parse(world.slices.npc), {
        location: clock.location,
        sceneStartedAt: clock.sceneStartedAt,
        districtOf: districtResolver(data),
        data,
        now: world.time,
      });
    },
  },
];
