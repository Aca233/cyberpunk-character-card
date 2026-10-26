import { defineSystem } from "../../kernel/system";
import {
  applyCrisis,
  applyEpisode,
  applyLostControl,
  closeBlackouts,
  openCrisis,
  takeSuppressant,
  tickCrisis,
} from "./apply";
import { suppressantRules } from "./prompt";
import {
  type CrisisCommand,
  CrisisCommandSchema,
  type EpisodeCommand,
  EpisodeCommandSchema,
  type LostControlCommand,
  LostControlCommandSchema,
  type PsychosisState,
  PsychosisStateSchema,
  type SuppressantCommand,
  SuppressantCommandSchema,
} from "./schema";

/** 赛博精神病：压制剂、发作、失控、记忆空白和危机章节；人性本身在 humanity 系统 */
export const psychosis = defineSystem<
  PsychosisState,
  SuppressantCommand | EpisodeCommand | LostControlCommand | CrisisCommand
>({
  id: "psychosis",
  dependsOn: ["humanity", "inventory", "world", "cyberware"],
  state: PsychosisStateSchema,
  initial: () => ({
    doses: [],
    episodeScene: null,
    events: [],
    blackouts: [],
    lostControl: 0,
    crisis: null,
    crises: 0,
  }),
  commands: {
    suppressant: SuppressantCommandSchema,
    episode: EpisodeCommandSchema,
    lostControl: LostControlCommandSchema,
    crisis: CrisisCommandSchema,
  },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "suppressant":
        return takeSuppressant(draft, command, ctx);
      case "episode":
        return applyEpisode(draft, command, ctx);
      case "lostControl":
        return applyLostControl(draft, command, ctx);
      case "crisis":
        return applyCrisis(draft, command, ctx);
    }
  },
  on: {
    "scene.end": (draft, ctx) => closeBlackouts(draft, ctx.now),
    "humanity.zero": (draft, ctx) => openCrisis(draft, ctx.now),
  },
  tick: (draft, span) => tickCrisis(draft, span.to),
  rules: [suppressantRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
