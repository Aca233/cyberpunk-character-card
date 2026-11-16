import { defineSystem } from "../../kernel/system";
import { type HumanityState, neuralStage } from "../humanity";
import { psychosisActions } from "./actions";
import {
  applyEpisode,
  applyLostControl,
  closeBlackouts,
  psychosisView,
  takeSuppressant,
} from "./apply";
import { psychosisEvents } from "./events";
import { suppressantRules } from "./prompt";
import {
  type EpisodeCommand,
  EpisodeCommandSchema,
  type LostControlCommand,
  LostControlCommandSchema,
  type PsychosisState,
  PsychosisStateSchema,
  type SuppressantCommand,
  SuppressantCommandSchema,
} from "./schema";
import { psychosisStatus } from "./status";

/** 赛博精神病：压制剂、发作、失控与记忆空白；人性本身在 humanity 系统 */
export const psychosis = defineSystem<
  PsychosisState,
  SuppressantCommand | EpisodeCommand | LostControlCommand
>({
  id: "psychosis",
  dependsOn: ["humanity", "inventory", "world"],
  state: PsychosisStateSchema,
  initial: () => ({
    doses: [],
    episodeScene: null,
    events: [],
    blackouts: [],
    lostControl: 0,
  }),
  commands: {
    suppressant: SuppressantCommandSchema,
    episode: EpisodeCommandSchema,
    lostControl: LostControlCommandSchema,
  },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "suppressant":
        return takeSuppressant(draft, command, ctx);
      case "episode":
        return applyEpisode(draft, command, ctx);
      case "lostControl":
        return applyLostControl(draft, command);
    }
  },
  on: {
    "humanity.changed": (draft, ctx) => {
      if (["stable", "detached"].includes(neuralStage(ctx.read<HumanityState>("humanity")))) {
        closeBlackouts(draft, ctx.now);
        draft.episodeScene = null;
      }
    },
  },
  rules: [suppressantRules],
  actions: psychosisActions,
  events: psychosisEvents,
  view: {
    key: "psychosis",
    project: ({ world }) => psychosisView(world.slices.psychosis, world.time),
  },
  status: psychosisStatus,
});

export * from "./actions";
export * from "./apply";
export * from "./events";
export * from "./prompt";
export * from "./schema";
export * from "./status";
