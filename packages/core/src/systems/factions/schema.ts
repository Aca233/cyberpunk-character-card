import { z } from "zod";

export const FactionKindSchema = z.enum(["gang", "corp", "law", "service"]);
export type FactionKind = z.infer<typeof FactionKindSchema>;
export const FACTION_KIND_LABELS: Readonly<Record<FactionKind, string>> = {
  gang: "帮派",
  corp: "公司",
  law: "执法",
  service: "服务",
};

/** 对玩家的态度：只有五档标签，没有数值；从坏到好排 */
export const ATTITUDES = ["kos", "hostile", "neutral", "friendly", "family"] as const;
export const AttitudeSchema = z.enum(ATTITUDES);
export type Attitude = z.infer<typeof AttitudeSchema>;
export const ATTITUDE_LABELS: Readonly<Record<Attitude, string>> = {
  kos: "见面就打",
  hostile: "敌对",
  neutral: "中立",
  friendly: "友好",
  family: "自己人",
};
/** 公司的说法不一样 */
export const CORP_ATTITUDE_LABELS: Readonly<Record<Attitude, string>> = {
  kos: "清除目标",
  hostile: "列入档案",
  neutral: "不在意",
  friendly: "有用的外包",
  family: "公司资产",
};
/** 一条 faction 指令最多变几档 */
export const ATTITUDE_MAX_STEP = 2;

export function attitudeLabel(kind: FactionKind, attitude: Attitude): string {
  return (kind === "corp" ? CORP_ATTITUDE_LABELS : ATTITUDE_LABELS)[attitude];
}

/** 势力卡：名字要查文本库，source 写依据 */
export const FactionDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id 用小写英文、数字和连字符"),
  name: z.string().min(1),
  en: z.string().min(1),
  kind: FactionKindSchema,
  /** 地盘或产区所在的城区；没有固定地盘时为空 */
  turf: z.array(z.string().min(1)).default([]),
  /** 城区里更具体的地方 */
  turfNote: z.string().min(1).optional(),
  /** 风格：一句话 */
  style: z.string().min(1),
  /** 配色，地图叠加层和势力页用 */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "color 写 #rrggbb"),
  allies: z.array(z.string().min(1)).default([]),
  enemies: z.array(z.string().min(1)).default([]),
  /** 开局时对玩家的态度 */
  initial: AttitudeSchema.default("neutral"),
  source: z.string().min(1),
});
export type FactionDef = z.infer<typeof FactionDefSchema>;
export const FactionCatalogSchema = z.array(FactionDefSchema);

export const FactionStanceSchema = z.object({
  attitude: AttitudeSchema,
  reason: z.string().min(1),
  at: z.number().int(),
});
export type FactionStance = z.infer<typeof FactionStanceSchema>;

/** 代码每隔这么多游戏分钟让一个势力的打算到点（2 个游戏日） */
export const AGENDA_EVERY = 2 * 1440;
/** 玩家拖住一条动向后，它这么久不会到点（两轮） */
export const AGENDA_STALL = 2 * AGENDA_EVERY;
/** 玩家打断一条动向后，这个势力隔这么久才换个法子再来（7 个游戏日） */
export const AGENDA_DERAIL = 7 * 1440;
/** 最多同时挂着几条到点还没推演的；多了丢最早的 */
export const AGENDA_DUE_MAX = 3;
/** 每条动向只留最近几步 */
export const AGENDA_MOVES_KEPT = 12;

/** 到点时代码掷出的结果：成了、受挫、出了岔子；具体怎么发生由场外推演即兴 */
export const AgendaOutcomeSchema = z.enum(["success", "setback", "twist"]);
export type AgendaOutcome = z.infer<typeof AgendaOutcomeSchema>;
export const AGENDA_OUTCOME_LABELS: Readonly<Record<AgendaOutcome, string>> = {
  success: "成了",
  setback: "受挫",
  twist: "出了岔子",
};

/** 一步动向带来的地盘变化：某个势力在某个城区得到或失去地盘 */
export const TurfChangeSchema = z.object({
  faction: z.string().min(1),
  district: z.string().min(1),
  change: z.enum(["gain", "lose"]),
});
export type TurfChange = z.infer<typeof TurfChangeSchema>;

/** 势力动向的种子：目标、手段、能争的城区、对头、参考的原作任务；每一步怎么走由场外推演即兴，不是固定剧本 */
export const AgendaSeedSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id 用小写英文、数字和连字符"),
  faction: z.string().min(1),
  title: z.string().min(1).max(24),
  /** 这个势力想要什么 */
  goal: z.string().min(1).max(120),
  /** 可能用的法子：素材池，场外推演可以挑、可以换、可以自己想 */
  means: z.array(z.string().min(1).max(60)).min(2).max(8),
  /** 成了的时候这个势力可以拿下的城区 */
  districts: z.array(z.string().min(1)).default([]),
  /** 对头的势力 id：成了的时候也可以让对头丢一个城区 */
  rivals: z.array(z.string().min(1)).default([]),
  /** 参考的原作任务（任务名和文本库 key） */
  canon: z.array(z.string().min(1)).default([]),
  source: z.string().min(1),
});
export type AgendaSeed = z.infer<typeof AgendaSeedSchema>;
export const AgendaCatalogSchema = z.array(AgendaSeedSchema);

/** 动向里实际发生过的一步：move 是场外推演写的，push / stall / derail 是玩家插手 */
export const AgendaMoveRecordSchema = z.object({
  at: z.number().int(),
  kind: z.enum(["move", "push", "stall", "derail"]),
  outcome: AgendaOutcomeSchema.nullable().default(null),
  title: z.string().min(1).max(24),
  /** 给叙事模型：实际发生了什么，谁在背后 */
  text: z.string().min(1).max(160),
  /** 传开以后玩家在势力页看到的一句，像新闻或传闻 */
  news: z.string().min(1).max(80),
  turf: TurfChangeSchema.nullable().default(null),
  /** 模型改了代码掷的结果时写的理由；只进剧透视图 */
  why: z.string().max(80).nullable().default(null),
  /** 模型留的后续钩子；只给模型看，不进玩家视图 */
  next: z.string().max(80).nullable().default(null),
  /** 玩家听说了没有 */
  told: z.boolean().default(false),
});
export type AgendaMoveRecord = z.infer<typeof AgendaMoveRecordSchema>;

/** 到点了、等场外推演写出来的一条；结果是代码掷的 */
export const AgendaDueSchema = z.object({
  id: z.string().min(1),
  at: z.number().int(),
  outcome: AgendaOutcomeSchema,
});
export type AgendaDue = z.infer<typeof AgendaDueSchema>;

/** 一条动向走过的几步；没动过的不记 */
export const AgendaProgressSchema = z.object({
  moves: z.array(AgendaMoveRecordSchema).default([]),
  /** 被玩家拖住或打断，到这个时间前不会到点 */
  holdUntil: z.number().int().nullable().default(null),
});
export type AgendaProgress = z.infer<typeof AgendaProgressSchema>;

/** 只记变过的势力；没变过的按势力卡的 initial */
export const FactionsStateSchema = z.object({
  stances: z.record(z.string(), FactionStanceSchema).default({}),
  agendas: z.record(z.string(), AgendaProgressSchema).default({}),
  /** 到点了还没推演的，最多 AGENDA_DUE_MAX 条 */
  due: z.array(AgendaDueSchema).default([]),
  /** 上次到点的游戏时间；还没走过时间为 null */
  agendaClock: z.number().int().nullable().default(null),
});
export type FactionsState = z.infer<typeof FactionsStateSchema>;

/** 模型使用：{"type": "faction", "id": "maelstrom", "attitude": "hostile", "reason": "..."} */
export const FactionCommandSchema = z
  .object({
    type: z.literal("faction"),
    id: z.string().min(1),
    attitude: AttitudeSchema,
    reason: z.string().trim().min(1).max(80),
  })
  .describe(
    "势力态度：发生了足以改变整个组织看法的事才写。id 写势力 id；attitude 写新的一档（kos 见面就打、hostile 敌对、neutral 中立、friendly 友好、family 自己人），一次最多变两档；reason 一句话写凭的是哪件事",
  );
export type FactionCommand = z.infer<typeof FactionCommandSchema>;

export const AgendaMoveSchema = z.enum(["push", "stall", "derail"]);
export type AgendaMove = z.infer<typeof AgendaMoveSchema>;
export const AGENDA_MOVE_LABELS: Readonly<Record<AgendaMove, string>> = {
  push: "推了一把",
  stall: "拖住了",
  derail: "打断了",
};

/** 模型使用：{"type": "agenda", "id": "maelstrom-arms", "move": "stall", "reason": "..."} */
export const AgendaCommandSchema = z
  .object({
    type: z.literal("agenda"),
    id: z.string().min(1),
    move: AgendaMoveSchema,
    reason: z.string().trim().min(1).max(80),
  })
  .describe(
    "玩家插手势力动向：正文里玩家真的出手了才写。id 写【势力动向】里的动向 id；move 写 push（帮了一把，下次推演这个势力得手）、stall（拖住，之后两轮不会到点）或 derail（搅黄了，这个势力要隔一周才换个法子再来）；reason 一句话写玩家做了什么",
  );
export type AgendaCommand = z.infer<typeof AgendaCommandSchema>;

/** 模型使用：{"type": "agendaTold", "id": "maelstrom-arms"} */
export const AgendaToldSchema = z
  .object({
    type: z.literal("agendaTold"),
    id: z.string().min(1),
  })
  .describe(
    "势力动向传到玩家耳朵里了：这一轮正文里用新闻、传闻或消息让玩家知道了某条动向最近发生的事才写，id 写动向 id",
  );
export type AgendaTold = z.infer<typeof AgendaToldSchema>;

/**
 * 只由场外推演产生：到点的动向实际发生了什么；必须对上一条到点的。
 * 代码掷的结果只是倾向，模型可以按局面改（outcome + why，只进剧透视图）；turf 按最终结果限制
 */
export const AgendaMoveCommandSchema = z.object({
  type: z.literal("agenda.move"),
  id: z.string().min(1),
  outcome: AgendaOutcomeSchema.optional(),
  why: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().min(1).max(24),
  text: z.string().trim().min(1).max(160),
  news: z.string().trim().min(1).max(80),
  turf: TurfChangeSchema.nullable().default(null),
  /** 模型留的后续钩子：这个势力接下来可能怎么走；只给模型看 */
  next: z.string().trim().min(1).max(80).optional(),
});
export type AgendaMoveCommand = z.infer<typeof AgendaMoveCommandSchema>;

export type FactionsCommand = FactionCommand | AgendaCommand | AgendaTold;
/** 模型不能直接写，只由场外推演的结果产生 */
export type FactionsInternal = AgendaMoveCommand;
