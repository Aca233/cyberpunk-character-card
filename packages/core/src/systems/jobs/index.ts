import { defineSystem } from "../../kernel/system";
import type { CharacterState } from "../character";
import type { HumanityState } from "../humanity";
import type { NpcState } from "../npc";
import { acceptJob, endJob, noteJob, offerJob, seedFixer, tickJobs } from "./apply";
import { jobsRules } from "./prompt";
import {
  JobAcceptSchema,
  type JobCommand,
  JobEndSchema,
  JobNoteSchema,
  JobOfferSchema,
  type JobsState,
  JobsStateSchema,
  type SeedFixer,
  SeedFixerSchema,
} from "./schema";

/** 委托和中间人：委托卡、进展笔记、结局、中间人好感和结算；报酬交给欧元系统，声望交给角色系统 */
export const jobs = defineSystem<JobsState, JobCommand, SeedFixer>({
  id: "jobs",
  dependsOn: ["economy", "character", "humanity", "npc"],
  state: JobsStateSchema,
  initial: () => ({ fixers: {}, jobs: [] }),
  commands: {
    jobOffer: JobOfferSchema,
    jobAccept: JobAcceptSchema,
    jobNote: JobNoteSchema,
    jobEnd: JobEndSchema,
  },
  internal: { "jobs.seedFixer": SeedFixerSchema },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "jobs.seedFixer":
        return seedFixer(draft, command);
      case "jobOffer": {
        const npcs = ctx.read<NpcState>("npc").npcs;
        return offerJob(
          draft,
          command,
          ctx.now,
          ctx.read<CharacterState>("character").streetCred,
          (id) => npcs[id]?.affinity ?? 0,
        );
      }
      case "jobAccept":
        return acceptJob(draft, command, ctx.now, ctx.read<HumanityState>("humanity").current);
      case "jobNote":
        return noteJob(draft, command);
      case "jobEnd":
        return endJob(
          draft,
          command,
          ctx.now,
          ctx.read<HumanityState>("humanity").current,
          ctx.read<NpcState>("npc").npcs,
        );
    }
  },
  tick: (draft, span) => tickJobs(draft, span),
  rules: [jobsRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
