import { defineSystem } from "../../kernel/system";
import { applyNpc, applyNpcPast, applyOffscreenDeath, editNpcMemory, seedNpc } from "./apply";
import { perceivedView } from "./perceived";
import { npcRules } from "./prompt";
import {
  AffinityProposalSchema,
  AffinitySchema,
  DoingSchema,
  LearnSchema,
  LedgerSchema,
  LedgerSettleSchema,
  legacyAffinity,
  MeetSchema,
  MemorySchema,
  NewNpcSchema,
  NpcChromeSchema,
  type NpcCommand,
  NpcDeathSchema,
  NpcGearSchema,
  NpcHealSchema,
  NpcHumanitySchema,
  NpcHurtSchema,
  type NpcInternal,
  NpcMemoryEditSchema,
  NpcOffscreenDeathSchema,
  NpcPastSchema,
  NpcScanSchema,
  type NpcState,
  NpcStateSchema,
  RelationSchema,
  SeedNpcSchema,
} from "./schema";
import { npcSections } from "./sections";
import { npcsView } from "./view";

/** 有卡的人：名片、诉求底线秘密、好感、关系笔记、人情和仇、共同记忆、生死和位置、血量装备义体人性；路人不建卡 */
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
    relation: RelationSchema,
    ledger: LedgerSchema,
    ledgerSettle: LedgerSettleSchema,
    learn: LearnSchema,
    npcHurt: NpcHurtSchema,
    npcHeal: NpcHealSchema,
    npcGear: NpcGearSchema,
    npcChrome: NpcChromeSchema,
    npcHumanity: NpcHumanitySchema,
    npcScan: NpcScanSchema,
  },
  proposals: { affinity: { schema: AffinityProposalSchema, legacy: legacyAffinity } },
  internal: {
    "npc.seed": SeedNpcSchema,
    "npc.memoryEdit": NpcMemoryEditSchema,
    "npc.past": NpcPastSchema,
    "npc.offscreenDeath": NpcOffscreenDeathSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "npc.seed") return seedNpc(draft, command, ctx.data);
    if (command.type === "npc.memoryEdit") return editNpcMemory(draft, command);
    if (command.type === "npc.past") return applyNpcPast(draft, command, ctx.now);
    if (command.type === "npc.offscreenDeath") {
      return applyOffscreenDeath(draft, command, ctx.now, ctx.facts);
    }
    return applyNpc(draft, command, ctx.now, ctx.facts, ctx.data);
  },
  rules: [npcRules],
  sections: npcSections,
  view: { key: "npcs", project: npcsView },
  views: [{ key: "perceived", project: perceivedView }],
});

export * from "./apply";
export * from "./body";
export * from "./perceived";
export * from "./prompt";
export * from "./schema";
export * from "./sections";
export * from "./view";
