import { defineSystem } from "../../kernel/system";
import { chronicleActions } from "./actions";
import { applyChronicle, applyChronicleEnd } from "./apply";
import { chronicleRules, chronicleSection } from "./prompt";
import {
  type ChronicleCommand,
  ChronicleCommandSchema,
  ChronicleEndSchema,
  type ChronicleInternal,
  type ChronicleState,
  ChronicleStateSchema,
} from "./schema";
import { chronicleView, endedView } from "./view";

/**
 * 履历：叙事模型在一段剧情告一段落时写的总结与玩家结束故事的记录。
 * 委托、死亡这些由投影从各系统现有的状态里拼出来，不在这里重复记
 */
export const chronicle = defineSystem<ChronicleState, ChronicleCommand, ChronicleInternal>({
  id: "chronicle",
  state: ChronicleStateSchema,
  initial: () => ({ arcs: [], ended: null }),
  commands: {
    chronicle: ChronicleCommandSchema,
  },
  internal: {
    "chronicle.end": ChronicleEndSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "chronicle.end") return applyChronicleEnd(draft, command, ctx.now);
    return applyChronicle(draft, command, ctx.now);
  },
  rules: [chronicleRules],
  actions: chronicleActions,
  sections: [
    {
      order: 40,
      title: "履历",
      stages: ["extract"],
      render: ({ world }) =>
        chronicleSection(ChronicleStateSchema.parse(world.slices.chronicle ?? {})) || undefined,
    },
  ],
  view: { key: "ended", project: endedView },
  views: [{ key: "chronicle", project: chronicleView }],
});

export * from "./actions";
export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./view";
