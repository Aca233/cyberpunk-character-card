import { defineSystem } from "../../kernel/system";
import type { NpcState } from "../npc";
import { jobsActions } from "./actions";
import {
  acceptJob,
  crewJob,
  endJob,
  noteJob,
  offerJob,
  payJob,
  seedFixer,
  tickJobs,
} from "./apply";
import { jobsEvents } from "./events";
import { jobsObjectives } from "./objectives";
import { jobsRules } from "./prompt";
import {
  JobAcceptSchema,
  type JobCommand,
  JobCrewSchema,
  JobEndSchema,
  JobNoteSchema,
  JobOfferSchema,
  JobPaymentSchema,
  type JobsState,
  JobsStateSchema,
  type SeedFixer,
  SeedFixerSchema,
} from "./schema";
import { jobsSections, jobsStatus } from "./sections";
import { factionSide } from "./side";
import { jobsView } from "./view";

/** 委托和中间人：委托卡、进展笔记、结局、中间人好感和结算；报酬交给欧元系统 */
export const jobs = defineSystem<JobsState, JobCommand, SeedFixer>({
  id: "jobs",
  // factions：派单看派单人所属势力的态度（用户 2026-10-31 选的「势力进机制」）；势力系统不依赖别的系统，不会循环
  dependsOn: ["economy", "npc", "factions"],
  state: JobsStateSchema,
  initial: () => ({ fixers: {}, jobs: [] }),
  commands: {
    jobOffer: JobOfferSchema,
    jobAccept: JobAcceptSchema,
    jobNote: JobNoteSchema,
    jobCrew: JobCrewSchema,
    jobEnd: JobEndSchema,
    jobPayment: JobPaymentSchema,
  },
  internal: { "jobs.seedFixer": SeedFixerSchema },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "jobs.seedFixer":
        return seedFixer(draft, command);
      case "jobOffer": {
        const npcs = ctx.read<NpcState>("npc").npcs;
        return offerJob(draft, command, ctx.now, (id) => {
          // 同一轮先写的 npc 建卡已经结算进来（applyCommands 逐条结算），这里读得到
          const card = npcs[id];
          return card
            ? {
                name: card.name,
                alive: card.alive,
                faction: factionSide(card.faction, ctx.data, ctx.read("factions")),
              }
            : undefined;
        });
      }
      case "jobAccept":
        return acceptJob(draft, command, ctx.now);
      case "jobNote":
        return noteJob(draft, command);
      case "jobCrew": {
        const npcs = ctx.read<NpcState>("npc").npcs;
        return crewJob(draft, command, (id) => {
          const card = npcs[id];
          return card
            ? {
                name: card.name,
                alive: card.alive,
                met: card.met,
                hasGrudge: card.ledger.some((e) => e.settledAt === null && e.kind === "grudge"),
              }
            : undefined;
        });
      }
      case "jobEnd":
        return endJob(draft, command, ctx.now);
      case "jobPayment":
        return payJob(draft, command, ctx.now);
    }
  },
  tick: (draft, span) => tickJobs(draft, span),
  rules: [jobsRules],
  actions: jobsActions,
  sections: jobsSections,
  status: jobsStatus,
  objectives: jobsObjectives,
  events: jobsEvents,
  view: { key: "jobs", project: jobsView },
});

export * from "./actions";
export * from "./apply";
export * from "./events";
export * from "./objectives";
export * from "./prompt";
export * from "./schema";
export * from "./sections";
export * from "./view";
