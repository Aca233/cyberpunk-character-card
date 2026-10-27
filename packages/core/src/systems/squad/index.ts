import { defineSystem } from "../../kernel/system";
import { type NpcState, NpcStateSchema } from "../npc";
import { squadActions } from "./actions";
import { applyMember, applySquad, squadView, tickSquad } from "./apply";
import { squadRules } from "./prompt";
import {
  type SquadCommand,
  SquadCommandSchema,
  type SquadInternal,
  SquadInternalSchemas,
  type SquadState,
  SquadStateSchema,
} from "./schema";

/** 小队：入队请求、队员、分成和薪水；委托分账在 jobs 结束委托时做 */
export const squad = defineSystem<SquadState, SquadCommand, SquadInternal>({
  id: "squad",
  dependsOn: ["npc", "economy"],
  state: SquadStateSchema,
  initial: () => ({ members: [], offers: [], gone: [] }),
  commands: { squad: SquadCommandSchema },
  internal: SquadInternalSchemas,
  apply(draft, command, ctx) {
    switch (command.type) {
      case "squad":
        return applySquad(draft, command, ctx);
      case "squad.member":
        return applyMember(draft, command, ctx);
    }
  },
  tick: (draft, span, ctx) => tickSquad(draft, span.to, ctx.read<NpcState>("npc").npcs),
  rules: [squadRules],
  actions: squadActions,
  view: {
    key: "squad",
    project: ({ world }) =>
      squadView(world.slices.squad, NpcStateSchema.parse(world.slices.npc).npcs, world.time),
  },
});

export * from "./actions";
export * from "./apply";
export * from "./prompt";
export * from "./schema";
