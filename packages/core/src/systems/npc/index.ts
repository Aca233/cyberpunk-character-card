import { defineSystem } from "../../kernel/system";
import { applyNpc, seedNpc } from "./apply";
import { npcRules } from "./prompt";
import {
  AffinitySchema,
  MeetSchema,
  MemorySchema,
  NewNpcSchema,
  type NpcCommand,
  NpcDeathSchema,
  type NpcState,
  NpcStateSchema,
  type SeedNpc,
  SeedNpcSchema,
} from "./schema";

/** 有卡的人：名片、诉求底线秘密、好感、共同记忆、生死和位置；路人不建卡 */
export const npc = defineSystem<NpcState, NpcCommand, SeedNpc>({
  id: "npc",
  state: NpcStateSchema,
  initial: () => ({ npcs: {} }),
  commands: {
    npc: NewNpcSchema,
    meet: MeetSchema,
    affinity: AffinitySchema,
    memory: MemorySchema,
    npcDeath: NpcDeathSchema,
  },
  internal: { "npc.seed": SeedNpcSchema },
  apply(draft, command, ctx) {
    return command.type === "npc.seed"
      ? seedNpc(draft, command)
      : applyNpc(draft, command, ctx.now);
  },
  rules: [npcRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
