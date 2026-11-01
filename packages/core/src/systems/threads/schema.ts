import { z } from "zod";
import { ConcernFateSchema } from "../arcs";
import { TurfChangeSchema } from "../factions";

/**
 * 城里在发酵的事（用户 2026-11-01 定的「全改」第 4 步：模型当主持人，代码只管记账）：
 * 势力的打算、宿敌的报复、人物的心事并成一张单子，每件带一个按游戏日走的定时器；
 * 响了以后发生什么由场外推演写，代码只看表、记账、守几条硬账
 */

/** 同时最多挂几件 */
export const THREADS_MAX = 8;
/** 每件只留最近几步 */
export const THREAD_STEPS_KEPT = 6;
/** 主持人给的天数限在这个范围 */
export const THREAD_DAYS_MIN = 1;
export const THREAD_DAYS_MAX = 10;
/** 到点没写、提醒过一次还是没写：代码不替它编，把表往后拨这么多天 */
export const THREAD_SNOOZE_DAYS = 3;
/** 玩家拖住一件事，表往后拨这么多天 */
export const THREAD_STALL_DAYS = 2;
/** 宿敌刚冒出来时，第一次响在几天后 */
export const THREAD_NEMESIS_DAYS = 3;
/** 了结了的留几件给模型和玩家看 */
export const THREADS_CLOSED_KEPT = 6;
export const THREAD_TITLE_MAX = 24;
export const THREAD_WANT_MAX = 120;
export const THREAD_STAGE_MAX = 80;
export const THREAD_TEXT_MAX = 160;
export const THREAD_NEWS_MAX = 80;

const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id 用小写英文、数字和连字符");

export const ThreadKindSchema = z.enum(["faction", "nemesis", "concern"]);
export type ThreadKind = z.infer<typeof ThreadKindSchema>;
export const THREAD_KIND_LABELS: Readonly<Record<ThreadKind, string>> = {
  faction: "势力",
  nemesis: "宿敌",
  concern: "心事",
};

export const ThreadMoveSchema = z.enum(["push", "stall", "derail"]);
export type ThreadMove = z.infer<typeof ThreadMoveSchema>;
export const THREAD_MOVE_LABELS: Readonly<Record<ThreadMove, string>> = {
  push: "推了一把",
  stall: "拖住了",
  derail: "搅黄了",
};

/** 一件事走过的一步：move 是场外推演写的，push / stall / derail 是玩家插手 */
export const ThreadStepSchema = z.object({
  at: z.number().int(),
  kind: z.enum(["move", "push", "stall", "derail"]),
  /** 只给模型：实际发生了什么、谁在背后 */
  text: z.string().min(1).max(THREAD_TEXT_MAX),
  /** 传开以后玩家听到的说法 */
  news: z.string().min(1).max(THREAD_NEWS_MAX),
  turf: TurfChangeSchema.nullable().default(null),
  told: z.boolean().default(false),
});
export type ThreadStep = z.infer<typeof ThreadStepSchema>;

export const ThreadSchema = z.object({
  id: SlugSchema,
  kind: ThreadKindSchema,
  /** 势力 id 或人物卡 id */
  owner: z.string().min(1),
  /** 照着开的种子：势力动向 id 或心事 id；宿敌和即兴开的没有 */
  seed: z.string().min(1).nullable().default(null),
  title: z.string().min(1).max(THREAD_TITLE_MAX),
  want: z.string().min(1).max(THREAD_WANT_MAX),
  /** 眼下走到哪一步了 */
  stage: z.string().min(1).max(THREAD_STAGE_MAX),
  openedAt: z.number().int(),
  /** 定时器：到这个游戏时间响 */
  dueAt: z.number().int(),
  /** 响了没写、已经提醒过一次 */
  reminded: z.boolean().default(false),
  steps: z.array(ThreadStepSchema).default([]),
});
export type Thread = z.infer<typeof ThreadSchema>;

export const ClosedThreadSchema = ThreadSchema.extend({
  closedAt: z.number().int(),
  /** 只给模型：怎么收场的 */
  end: z.string().min(1).max(THREAD_TEXT_MAX),
});
export type ClosedThread = z.infer<typeof ClosedThreadSchema>;

export const ThreadsStateSchema = z.object({
  threads: z.array(ThreadSchema).default([]),
  closed: z.array(ClosedThreadSchema).default([]),
});
export type ThreadsState = z.infer<typeof ThreadsStateSchema>;

/** 模型使用：{"type": "thread", "id": "maelstrom-arms", "move": "stall", "reason": "..."} */
export const ThreadCommandSchema = z
  .object({
    type: z.literal("thread"),
    id: z.string().trim().min(1),
    move: ThreadMoveSchema,
    reason: z.string().trim().min(1).max(THREAD_NEWS_MAX),
  })
  .describe(
    "玩家插手【城里在发酵的事】里的一件：正文里玩家真的出手了才写。id 写那件事的 id；move 写 push（帮了一把，这件事马上到点）、stall（拖住，表往后拨两天）或 derail（搅黄了，这件事收场）；reason 一句话写玩家做了什么",
  );
export type ThreadCommand = z.infer<typeof ThreadCommandSchema>;

/** 模型使用：{"type": "threadTold", "id": "maelstrom-arms"} */
export const ThreadToldSchema = z
  .object({
    type: z.literal("threadTold"),
    id: z.string().trim().min(1),
  })
  .describe(
    "【城里在发酵的事】里的一件传到玩家耳朵里了：这一轮正文里用新闻、传闻、消息或有人亲口说，让玩家知道了它最近发生的事才写，id 写那件事的 id",
  );
export type ThreadTold = z.infer<typeof ThreadToldSchema>;

const DaysSchema = z.number().int().min(THREAD_DAYS_MIN).max(THREAD_DAYS_MAX);

/** 只由场外推演或别的系统产生：开一件新的 */
export const ThreadOpenSchema = z.object({
  type: z.literal("thread.open"),
  id: SlugSchema,
  kind: ThreadKindSchema,
  owner: z.string().trim().min(1),
  seed: z.string().trim().min(1).nullable().default(null),
  title: z.string().trim().min(1).max(THREAD_TITLE_MAX),
  want: z.string().trim().min(1).max(THREAD_WANT_MAX),
  stage: z.string().trim().min(1).max(THREAD_STAGE_MAX),
  days: DaysSchema,
});
export type ThreadOpen = z.infer<typeof ThreadOpenSchema>;

/** 只由场外推演产生：这一步发生了什么，下一次几天后响 */
export const ThreadStepCommandSchema = z.object({
  type: z.literal("thread.step"),
  id: z.string().trim().min(1),
  text: z.string().trim().min(1).max(THREAD_TEXT_MAX),
  news: z.string().trim().min(1).max(THREAD_NEWS_MAX),
  stage: z.string().trim().min(1).max(THREAD_STAGE_MAX).optional(),
  turf: TurfChangeSchema.nullable().default(null),
  days: DaysSchema,
});
export type ThreadStepCommand = z.infer<typeof ThreadStepCommandSchema>;

/** 只由场外推演产生：响了先不写，往后推 */
export const ThreadDeferSchema = z.object({
  type: z.literal("thread.defer"),
  id: z.string().trim().min(1),
  days: DaysSchema,
  why: z.string().trim().min(1).max(THREAD_NEWS_MAX),
});
export type ThreadDefer = z.infer<typeof ThreadDeferSchema>;

/** 只由场外推演或别的系统产生：这件事收场；心事收场时 fate 和原作结局比，交给心事系统记结果 */
export const ThreadCloseSchema = z.object({
  type: z.literal("thread.close"),
  id: z.string().trim().min(1),
  end: z.string().trim().min(1).max(THREAD_TEXT_MAX),
  fate: ConcernFateSchema.optional(),
});
export type ThreadClose = z.infer<typeof ThreadCloseSchema>;

/** 只由回合流程产生：推演过一次以后，响了没写的记成提醒过；提醒过还没写的往后拨 */
export const ThreadRemindSchema = z.object({ type: z.literal("thread.remind") });

export type ThreadsCommand = ThreadCommand | ThreadTold;
export type ThreadsInternal =
  | ThreadOpen
  | ThreadStepCommand
  | ThreadDefer
  | ThreadClose
  | z.infer<typeof ThreadRemindSchema>;
