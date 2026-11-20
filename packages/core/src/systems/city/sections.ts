import type { SystemSection } from "../../kernel/system";
import { citySection, playerRumorLine, rumorSection } from "./prompt";
import { CityStateSchema } from "./schema";

/** 给叙事模型的情境节：城里的动静、街头传闻、传闻里的你，跟在【到期事件】后面 */
export const citySections: readonly SystemSection[] = [
  {
    order: 80,
    title: "城里的动静",
    stages: ["judge", "narrate"],
    render: ({ world }) => citySection(CityStateSchema.parse(world.slices.city ?? {})) || undefined,
  },
  {
    order: 90,
    title: "街头传闻",
    render: ({ world }) =>
      rumorSection(CityStateSchema.parse(world.slices.city ?? {})) || undefined,
  },
  {
    order: 100,
    title: "传闻里的你",
    stages: ["judge", "narrate"],
    render: ({ world }) => {
      const heard = playerRumorLine(CityStateSchema.parse(world.slices.city ?? {}));
      if (!heard) return undefined;
      return `${heard}\n听过这些说法的人第一反应照这个版本来，和状态里的「别人眼里的你」合起来看。`;
    },
  },
];
