import { defineSystem } from "../../kernel/system";
import {
  applyEpisode,
  applyLostControl,
  closeBlackouts,
  loseAnchor,
  setAnchor,
  takeSuppressant,
} from "./apply";
import { anchorRules } from "./prompt";
import {
  type AnchorCommand,
  AnchorCommandSchema,
  type EpisodeCommand,
  EpisodeCommandSchema,
  type LostControlCommand,
  LostControlCommandSchema,
  type PsychosisInternal,
  PsychosisInternalSchemas,
  type PsychosisState,
  PsychosisStateSchema,
  type SuppressantCommand,
  SuppressantCommandSchema,
} from "./schema";

/** 赛博精神病：锚点、压制剂、发作、失控和记忆空白；人性本身在 humanity 系统 */
export const psychosis = defineSystem<
  PsychosisState,
  AnchorCommand | SuppressantCommand | EpisodeCommand | LostControlCommand,
  PsychosisInternal
>({
  id: "psychosis",
  dependsOn: ["humanity", "inventory", "npc", "world"],
  state: PsychosisStateSchema,
  initial: () => ({
    anchors: [],
    lost: [],
    doses: [],
    episodeScene: null,
    events: [],
    blackouts: [],
    lostControl: 0,
  }),
  commands: {
    anchor: AnchorCommandSchema,
    suppressant: SuppressantCommandSchema,
    episode: EpisodeCommandSchema,
    lostControl: LostControlCommandSchema,
  },
  internal: PsychosisInternalSchemas,
  apply(draft, command, ctx) {
    switch (command.type) {
      case "anchor":
        return loseAnchor(draft, command, ctx);
      case "suppressant":
        return takeSuppressant(draft, command, ctx);
      case "episode":
        return applyEpisode(draft, command, ctx);
      case "lostControl":
        return applyLostControl(draft, command, ctx);
      case "psychosis.anchor":
        return setAnchor(draft, command, ctx);
    }
  },
  on: {
    "scene.end": (draft, ctx) => closeBlackouts(draft, ctx.now),
  },
  rules: [anchorRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
