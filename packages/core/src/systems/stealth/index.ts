import { defineSystem } from "../../kernel/system";
import type { WorldClockState } from "../world";
import { applyAlert } from "./apply";
import { stealthRules } from "./prompt";
import {
  type AlertCommand,
  AlertCommandSchema,
  type StealthState,
  StealthStateSchema,
} from "./schema";
import { stealthStatus } from "./status";
import { stealthView } from "./view";

/** 潜入警戒：按场景记 0–3，换场景归零；收尾时的热度由热度系统读最高警戒度来算 */
export const stealth = defineSystem<StealthState, AlertCommand>({
  id: "stealth",
  dependsOn: ["world"],
  state: StealthStateSchema,
  initial: () => ({ scene: null, level: 0, peak: 0, lowered: false }),
  commands: { alert: AlertCommandSchema },
  apply: (draft, command, ctx) =>
    applyAlert(draft, command, ctx.read<WorldClockState>("world").scene),
  on: {
    // 留着 scene 和 peak 给热度系统算收尾；下一次 alert 发现换了场景再清零
    "scene.end": (draft) => {
      draft.level = 0;
      draft.lowered = false;
    },
  },
  rules: [stealthRules],
  view: { key: "stealth", project: stealthView },
  status: stealthStatus,
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
