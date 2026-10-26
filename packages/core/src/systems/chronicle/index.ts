import { defineSystem } from "../../kernel/system";
import { applyChronicle, applyChronicleEnd, applyChronicleSeed } from "./apply";
import { chronicleRules } from "./prompt";
import {
  type ChronicleCommand,
  ChronicleCommandSchema,
  ChronicleEndSchema,
  type ChronicleInternal,
  ChronicleSeedSchema,
  type ChronicleState,
  ChronicleStateSchema,
} from "./schema";

/**
 * 履历和传说名册：叙事模型在一段剧情告一段落时写的总结、玩家结束故事的记录，
 * 和开局时带进来的传说名册摘要。委托、死亡这些由投影从各系统现有的状态里拼出来，不在这里重复记
 */
export const chronicle = defineSystem<ChronicleState, ChronicleCommand, ChronicleInternal>({
  id: "chronicle",
  state: ChronicleStateSchema,
  initial: () => ({ arcs: [], ended: null, legends: [] }),
  commands: {
    chronicle: ChronicleCommandSchema,
  },
  internal: {
    "chronicle.end": ChronicleEndSchema,
    "chronicle.seedLegends": ChronicleSeedSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "chronicle.end") return applyChronicleEnd(draft, command, ctx.now);
    if (command.type === "chronicle.seedLegends") return applyChronicleSeed(draft, command);
    return applyChronicle(draft, command, ctx.now);
  },
  rules: [chronicleRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
