import { defineSystem } from "../../kernel/system";
import { loseAnchor, setAnchor, takeSuppressant } from "./apply";
import { anchorRules } from "./prompt";
import {
  type AnchorCommand,
  AnchorCommandSchema,
  type PsychosisInternal,
  PsychosisInternalSchemas,
  type PsychosisState,
  PsychosisStateSchema,
  type SuppressantCommand,
  SuppressantCommandSchema,
} from "./schema";

/** 赛博精神病的支撑：锚点和压制剂；人性本身在 humanity 系统 */
export const psychosis = defineSystem<
  PsychosisState,
  AnchorCommand | SuppressantCommand,
  PsychosisInternal
>({
  id: "psychosis",
  dependsOn: ["humanity", "inventory", "npc"],
  state: PsychosisStateSchema,
  initial: () => ({ anchors: [], lost: [], doses: [] }),
  commands: { anchor: AnchorCommandSchema, suppressant: SuppressantCommandSchema },
  internal: PsychosisInternalSchemas,
  apply(draft, command, ctx) {
    switch (command.type) {
      case "anchor":
        return loseAnchor(draft, command, ctx);
      case "suppressant":
        return takeSuppressant(draft, command, ctx);
      case "psychosis.anchor":
        return setAnchor(draft, command, ctx);
    }
  },
  rules: [anchorRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
