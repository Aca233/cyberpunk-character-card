import { z } from "zod";

/** 小队最多几个人（不算玩家） */
export const SQUAD_MAX = 4;
/** 雇佣型按周发薪：一期多少分钟 */
export const WAGE_PERIOD = 7 * 1440;
/** 朋友型一个人最多分几成 */
export const SHARE_MAX = 50;
/** 所有朋友型队员的分成合计最多多少 */
export const SHARE_TOTAL_MAX = 75;
/** 薪水最多预付几期 */
export const PREPAY_MAX = 2;
/** 离队记录留几条 */
export const GONE_KEPT = 20;

export const SquadKindSchema = z.enum(["friend", "hired"]);
export type SquadKind = z.infer<typeof SquadKindSchema>;
export const SQUAD_KIND_LABELS: Record<SquadKind, string> = {
  friend: "朋友型",
  hired: "雇佣型",
};

export const MemberStatusSchema = z.enum(["ok", "hurt", "captured"]);
export type MemberStatus = z.infer<typeof MemberStatusSchema>;
export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  ok: "能出手",
  hurt: "受伤",
  captured: "被抓",
};

export const GoneWhySchema = z.enum(["left", "dismissed", "dead"]);
export type GoneWhy = z.infer<typeof GoneWhySchema>;
export const GONE_WHY_LABELS: Record<GoneWhy, string> = {
  left: "离队",
  dismissed: "请走了",
  dead: "死去",
};

const TermsSchema = z.object({
  npc: z.string().min(1),
  name: z.string().min(1),
  kind: SquadKindSchema,
  /** 朋友型的分成百分比；雇佣型是 0 */
  share: z.number().int().min(0).max(SHARE_MAX),
  /** 雇佣型的周薪；朋友型是 0 */
  wage: z.number().int().min(0),
  specialty: z.string().min(1),
  /** 个人麻烦：会带来私人请求和委托 */
  trouble: z.string().min(1),
});

/** 入队请求：叙事模型提出，等玩家在小队面板确认 */
export const OfferSchema = TermsSchema.extend({ at: z.number().int() });
export type Offer = z.infer<typeof OfferSchema>;

export const MemberSchema = TermsSchema.extend({
  since: z.number().int(),
  status: MemberStatusSchema.default("ok"),
  /** 雇佣型的薪水付到什么时候；朋友型是 null */
  paidUntil: z.number().int().nullable().default(null),
});
export type Member = z.infer<typeof MemberSchema>;

export const GoneSchema = z.object({
  npc: z.string().min(1),
  name: z.string().min(1),
  why: GoneWhySchema,
  at: z.number().int(),
  note: z.string().optional(),
});
export type Gone = z.infer<typeof GoneSchema>;

export const SquadStateSchema = z.object({
  members: z.array(MemberSchema).default([]),
  offers: z.array(OfferSchema).default([]),
  gone: z.array(GoneSchema).default([]),
});
export type SquadState = z.infer<typeof SquadStateSchema>;

/** 模型使用：入队请求、离队、伤势和死亡 */
export const SquadCommandSchema = z
  .object({
    type: z.literal("squad"),
    action: z.enum(["offer", "leave", "status", "dead"]),
    /** 人物卡 id */
    npc: z.string().min(1),
    /** offer 时写：friend 朋友型（分成）或 hired 雇佣型（周薪） */
    kind: SquadKindSchema.optional(),
    /** 朋友型的分成百分比 */
    share: z.number().int().min(1).max(SHARE_MAX).optional(),
    /** 雇佣型的周薪，欧元 */
    wage: z.number().int().min(1).max(20_000).optional(),
    specialty: z.string().trim().min(1).max(40).optional(),
    trouble: z.string().trim().min(1).max(80).optional(),
    /** status 时写 */
    status: MemberStatusSchema.optional(),
    reason: z.string().trim().min(1).max(80),
  })
  .describe(
    "小队：offer 是有人物卡、见过面的人在剧情里答应跟玩家干（写 kind、friend 写 share、hired 写 wage，再写 specialty 和 trouble），要玩家在小队面板确认才算入队；leave 队员自己离开或收回请求；status 写队员 ok、hurt、captured；dead 队员死亡（只有场面进入必死绝境 lethal 且确实避无可避时才写）",
  );
export type SquadCommand = z.infer<typeof SquadCommandSchema>;

export const SquadInternalSchemas = {
  /** 界面动作：回应入队请求、请队员离开、发薪水 */
  "squad.member": z.object({
    type: z.literal("squad.member"),
    action: z.enum(["accept", "decline", "dismiss", "pay"]),
    npc: z.string().min(1),
  }),
};
export type SquadInternal = z.infer<
  (typeof SquadInternalSchemas)[keyof typeof SquadInternalSchemas]
>;
