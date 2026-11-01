import { defineSystem } from "../../kernel/system";
import { applyThreads, tickThreads } from "./apply";
import { threadsFeed } from "./feed";
import { threadRules, threadSection } from "./prompt";
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
 * 城里在发酵的事（用户 2026-11-01 定的「全改」第 4 步：模型当主持人，代码只管记账）：
 * 势力的打算、宿敌的报复、人物的心事并成一张单子，每件一个按游戏日走的定时器；
 * 响了以后发生什么由场外推演写，代码只看表、记账、守地盘和条数这几条硬账
 */
export const threads = defineSystem<ThreadsState, ThreadsCommand, ThreadsInternal>({
  id: "threads",
  dependsOn: ["npc", "nemesis", "factions", "arcs"],
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
  tick: (draft, _span, ctx) => tickThreads(draft, ctx),
  rules: [threadRules],
  sections: [
    {
      order: 110,
      title: "城里在发酵的事",
      render: ({ world }) => threadSection(ThreadsStateSchema.parse(world.slices.threads ?? {})),
    },
  ],
  view: { key: "threads", project: threadsView },
  feed: threadsFeed,
});

export * from "./apply";
export * from "./feed";
export * from "./prompt";
export * from "./schema";
export * from "./view";
