import { defineSystem } from "../../kernel/system";
import {
  applyCrisis,
  applyEpisode,
  applyLostControl,
  closeBlackouts,
  loseAnchor,
  openCrisis,
  setAnchor,
  takeSuppressant,
  tickCrisis,
} from "./apply";
import { anchorRules } from "./prompt";
import {
  type AnchorCommand,
  AnchorCommandSchema,
  type CrisisCommand,
  CrisisCommandSchema,
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

/** 赛博精神病：锚点、压制剂、发作、失控、记忆空白和危机章节；人性本身在 humanity 系统 */
export const psychosis = defineSystem<
  PsychosisState,
  AnchorCommand | SuppressantCommand | EpisodeCommand | LostControlCommand | CrisisCommand,
  PsychosisInternal
>({
  id: "psychosis",
  dependsOn: ["humanity", "inventory", "npc", "world", "cyberware"],
  state: PsychosisStateSchema,
  initial: () => ({
    anchors: [],
    lost: [],
    doses: [],
    episodeScene: null,
    events: [],
    blackouts: [],
    lostControl: 0,
    crisis: null,
    crises: 0,
  }),
  commands: {
    anchor: AnchorCommandSchema,
    suppressant: SuppressantCommandSchema,
    episode: EpisodeCommandSchema,
    lostControl: LostControlCommandSchema,
    crisis: CrisisCommandSchema,
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
      case "crisis":
        return applyCrisis(draft, command, ctx);
      case "psychosis.anchor":
        return setAnchor(draft, command, ctx);
    }
  },
  on: {
    "scene.end": (draft, ctx) => closeBlackouts(draft, ctx.now),
    "humanity.zero": (draft, ctx) => openCrisis(draft, ctx.now),
  },
  tick: (draft, span) => tickCrisis(draft, span.to),
  rules: [anchorRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
