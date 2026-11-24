import { defineSystem } from "../../kernel/system";
import type { WorldClockState } from "../world";
import { npcActions } from "./actions";
import {
  applyNpc,
  applyNpcPast,
  applyOffscreenDeath,
  applyOffscreenDoing,
  editNpcMemory,
  moveFollowingNpcs,
  seedNpc,
} from "./apply";
import { applyNpcCondition } from "./body";
import { perceivedView } from "./perceived";
import { adultServicesRules, npcRules } from "./prompt";
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
  NpcBehaviorSchema,
  NpcChromeSchema,
  type NpcCommand,
  NpcCompanionSchema,
  NpcConditionSchema,
  NpcDeathSchema,
  NpcGearSchema,
  NpcHealSchema,
  NpcHumanitySchema,
  NpcHurtSchema,
  type NpcInternal,
  NpcMemoryEditSchema,
  NpcOffscreenDeathSchema,
  NpcOffscreenDoingSchema,
  NpcOutfitSchema,
  NpcPastSchema,
  NpcScanSchema,
  type NpcState,
  NpcStateSchema,
  NpcUpdateSchema,
  normalizeNpcProposal,
  normalizeNpcTextProposal,
  RelationSchema,
  SeedNpcSchema,
  TieSchema,
} from "./schema";
import { npcSections } from "./sections";
import { npcStatus } from "./status";
import { npcsView } from "./view";

/** 有卡的人：名片、诉求底线秘密、好感、关系笔记、人情和仇、共同记忆、同行状态、生死和位置、装备义体人性；路人不建卡 */
export const npc = defineSystem<NpcState, NpcCommand, NpcInternal>({
  id: "npc",
  dependsOn: ["world"],
  state: NpcStateSchema,
  initial: () => ({ npcs: {}, seedTags: {} }),
  commands: {
    npc: NewNpcSchema,
    npcUpdate: NpcUpdateSchema,
    meet: MeetSchema,
    affinity: AffinitySchema,
    memory: MemorySchema,
    npcDeath: NpcDeathSchema,
    doing: DoingSchema,
    relation: RelationSchema,
    npcOutfit: NpcOutfitSchema,
    tie: TieSchema,
    ledger: LedgerSchema,
    ledgerSettle: LedgerSettleSchema,
    learn: LearnSchema,
    npcHurt: NpcHurtSchema,
    npcHeal: NpcHealSchema,
    npcGear: NpcGearSchema,
    npcChrome: NpcChromeSchema,
    npcHumanity: NpcHumanitySchema,
    npcScan: NpcScanSchema,
    npcBehavior: NpcBehaviorSchema,
    npcCompanion: NpcCompanionSchema,
  },
  proposals: {
    affinity: { schema: AffinityProposalSchema, legacy: legacyAffinity },
    npc: { schema: NewNpcSchema, legacy: normalizeNpcProposal },
    npcUpdate: { schema: NpcUpdateSchema, legacy: normalizeNpcProposal },
    tie: { schema: TieSchema, legacy: normalizeNpcTextProposal },
    relation: { schema: RelationSchema, legacy: normalizeNpcTextProposal },
    doing: { schema: DoingSchema, legacy: normalizeNpcTextProposal },
    memory: { schema: MemorySchema, legacy: normalizeNpcTextProposal },
    learn: { schema: LearnSchema, legacy: normalizeNpcTextProposal },
    ledger: { schema: LedgerSchema, legacy: normalizeNpcTextProposal },
    ledgerSettle: { schema: LedgerSettleSchema, legacy: normalizeNpcTextProposal },
    npcOutfit: { schema: NpcOutfitSchema, legacy: normalizeNpcTextProposal },
    npcDeath: { schema: NpcDeathSchema, legacy: normalizeNpcTextProposal },
    npcHurt: { schema: NpcHurtSchema, legacy: normalizeNpcTextProposal },
    npcHeal: { schema: NpcHealSchema, legacy: normalizeNpcTextProposal },
    npcHumanity: { schema: NpcHumanitySchema, legacy: normalizeNpcTextProposal },
    npcCompanion: { schema: NpcCompanionSchema, legacy: normalizeNpcTextProposal },
  },
  internal: {
    "npc.condition": NpcConditionSchema,
    "npc.seed": SeedNpcSchema,
    "npc.memoryEdit": NpcMemoryEditSchema,
    "npc.past": NpcPastSchema,
    "npc.offscreenDeath": NpcOffscreenDeathSchema,
    "npc.offscreenDoing": NpcOffscreenDoingSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "npc.condition") {
      const person = draft.npcs[command.id];
      return person
        ? applyNpcCondition(person, command, ctx.now, ctx.data)
        : { ok: false, reason: `没有人物 ${command.id}` };
    }
    if (command.type === "npc.seed") return seedNpc(draft, command, ctx.data, ctx.now);
    if (command.type === "npc.memoryEdit") return editNpcMemory(draft, command);
    if (command.type === "npc.past") return applyNpcPast(draft, command, ctx.now);
    if (command.type === "npc.offscreenDeath") {
      return applyOffscreenDeath(draft, command, ctx.now, ctx.facts);
    }
    if (command.type === "npc.offscreenDoing") {
      return applyOffscreenDoing(draft, command, ctx.now);
    }
    const currentLocation = ctx.read<WorldClockState>("world").location ?? null;
    return applyNpc(draft, command, ctx.now, ctx.facts, ctx.data, currentLocation);
  },
  on: {
    "world.arrived": (draft, ctx) => {
      const loc = ctx.read<WorldClockState>("world").location ?? null;
      const from =
        typeof ctx.facts.actionStartLocation === "string" ? ctx.facts.actionStartLocation : null;
      moveFollowingNpcs(draft, loc, ctx.now, from);
    },
  },
  rules: [npcRules, adultServicesRules],
  // 名字格和档案里的「扫描」按钮（计划第十二节第 14 条）
  actions: npcActions,
  sections: npcSections,
  view: { key: "npcs", project: npcsView },
  views: [{ key: "perceived", project: perceivedView }],
  status: npcStatus,
});

export * from "./actions";
export * from "./apply";
export * from "./body";
export * from "./perceived";
export * from "./prompt";
export * from "./schema";
export * from "./sections";
export * from "./status";
export * from "./view";
