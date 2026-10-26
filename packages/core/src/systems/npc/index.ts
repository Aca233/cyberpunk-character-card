import { defineSystem } from "../../kernel/system";
import { applyNpc, editNpcMemory, seedNpc } from "./apply";
import { npcRules } from "./prompt";
import {
  AffinityProposalSchema,
  AffinitySchema,
  DoingSchema,
  legacyAffinity,
  MeetSchema,
  MemorySchema,
  NewNpcSchema,
  type NpcCommand,
  NpcDeathSchema,
  type NpcInternal,
  NpcMemoryEditSchema,
  type NpcState,
  NpcStateSchema,
  SeedNpcSchema,
} from "./schema";

/** 有卡的人：名片、诉求底线秘密、好感、共同记忆、生死和位置；路人不建卡 */
export const npc = defineSystem<NpcState, NpcCommand, NpcInternal>({
  id: "npc",
  state: NpcStateSchema,
  initial: () => ({ npcs: {} }),
  commands: {
    npc: NewNpcSchema,
    meet: MeetSchema,
    affinity: AffinitySchema,
    memory: MemorySchema,
    npcDeath: NpcDeathSchema,
    doing: DoingSchema,
  },
  proposals: { affinity: { schema: AffinityProposalSchema, legacy: legacyAffinity } },
  internal: { "npc.seed": SeedNpcSchema, "npc.memoryEdit": NpcMemoryEditSchema },
  apply(draft, command, ctx) {
    if (command.type === "npc.seed") return seedNpc(draft, command);
    if (command.type === "npc.memoryEdit") return editNpcMemory(draft, command);
    return applyNpc(draft, command, ctx.now, ctx.facts);
  },
  rules: [npcRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
