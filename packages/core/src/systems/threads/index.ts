import { defineSystem } from "../../kernel/system";
import { applyThreads, cleanupDeadThreads, tickThreads } from "./apply";
import { threadsFeed } from "./feed";
import { threadRules, threadSections } from "./prompt";
import {
  ThreadCloseSchema,
  ThreadCommandSchema,
  ThreadDeferSchema,
  ThreadOpenSchema,
  ThreadRemindSchema,
  ThreadStepCommandSchema,
  type ThreadsCommand,
  type ThreadsInternal,
  type ThreadsState,
  ThreadsStateSchema,
  ThreadToldSchema,
} from "./schema";
import { threadsView } from "./view";

/**
 * 城里在发酵的事（统一城中局势账本）：
 * 城中突发与余波（civic）、势力打算、宿敌报复、人物心事并成一张单子，自动同步底层 city.events。
 */
export const threads = defineSystem<ThreadsState, ThreadsCommand, ThreadsInternal>({
  id: "threads",
  dependsOn: ["world", "npc", "nemesis", "factions", "arcs", "city"],
  state: ThreadsStateSchema,
  initial: () => ({ threads: [], closed: [] }),
  commands: {
    thread: ThreadCommandSchema,
    threadTold: ThreadToldSchema,
  },
  internal: {
    "thread.open": ThreadOpenSchema,
    "thread.step": ThreadStepCommandSchema,
    "thread.defer": ThreadDeferSchema,
    "thread.close": ThreadCloseSchema,
    "thread.remind": ThreadRemindSchema,
  },
  apply: (draft, command, ctx) => applyThreads(draft, command, ctx),
  on: {
    "npc.died": (draft, ctx) => cleanupDeadThreads(draft, ctx),
  },
  tick: (draft, _span, ctx) => tickThreads(draft, ctx),
  rules: [threadRules],
  sections: threadSections,
  view: { key: "threads", project: threadsView },
  feed: threadsFeed,
});

export * from "./apply";
export * from "./feed";
export * from "./prompt";
export * from "./schema";
export * from "./view";
