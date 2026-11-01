import { z } from "zod";

/**
 * 个人线（心事）：原作人物自己身上压着的几件事。种子只写这个人碰上了什么、想要什么、可能的走向和原作里怎么落地；
 * 玩家角色不是 V，不写玩家该做什么，没有固定步骤和顺序。玩家不插手的事由场外推演往前推。
 */

/** 每个人同时最多挂几件说出口、玩家还没表态或正在管的心事 */
export const ARC_OPEN_MAX = 1;
// 场外推演推心事的间隔和条数删了，改由【城里在发酵的事】的定时器管（用户 2026-11-01 定的「全改」第 4 步）
/** 每件心事留几条进展 */
export const ARC_NOTES_KEPT = 6;
export const ARC_TITLE_MAX = 24;
export const ARC_TEXT_MAX = 120;
/** 关系笔记的长度上限，和 npc 系统的 RELATION_CHARS 一致 */
export const ARC_BOND_MAX = 60;

const SlugSchema = z.string().regex(/^[a-z0-9-]+$/);

export const ArcConcernSeedSchema = z.object({
  id: SlugSchema,
  /** 他说出口以后玩家看得到的一句：他跟你说起了什么事 */
  title: z.string().trim().min(1).max(ARC_TITLE_MAX),
  /** 只给模型：这件事眼下是什么情况 */
  situation: z.string().trim().min(1).max(200),
  /** 只给模型：他希望事情怎样 */
  hope: z.string().trim().min(1).max(100),
  /** 只给模型：可能的走向；是这件事自己会怎么走，不是玩家要做的步骤 */
  turns: z.array(z.string().trim().min(1).max(100)).min(2).max(4),
  /** 只给模型：原作里这件事落在他身上的结局，没人插手时场外推演的参考；原作没有的写「本作改编」 */
  canon: z.string().trim().min(1).max(160),
});
export type ArcConcernSeed = z.infer<typeof ArcConcernSeedSchema>;

export const ArcSeedSchema = z.object({
  /** 人物卡 id，只给原作人物 */
  npc: z.string().min(1),
  /** 解锁：见过面、活着，好感和共同记忆都够了，他才会考虑跟玩家说 */
  unlock: z.object({
    affinity: z.number().int().min(0).max(100),
    memories: z.number().int().min(0).max(12),
  }),
  concerns: z.array(ArcConcernSeedSchema).min(2).max(3),
  /** 依据的原作任务：任务名（文本库 key） */
  refs: z.array(z.string().min(1)).min(1),
  source: z.string().min(1),
});
export type ArcSeed = z.infer<typeof ArcSeedSchema>;

export const ArcCatalogSchema = z.array(ArcSeedSchema).superRefine((seeds, ctx) => {
  const npcs = new Set<string>();
  const concerns = new Set<string>();
  for (const s of seeds) {
    if (npcs.has(s.npc)) ctx.addIssue({ code: "custom", message: `个人线 ${s.npc} 重复了` });
    npcs.add(s.npc);
    for (const c of s.concerns) {
      if (concerns.has(c.id)) ctx.addIssue({ code: "custom", message: `心事 ${c.id} 重复了` });
      concerns.add(c.id);
    }
  }
});

/** told 他说出口了，involved 玩家插手了，declined 玩家没接，resolved 有了结果；还没说出口是 null */
export const ConcernStatusSchema = z.enum(["told", "involved", "declined", "resolved"]);
export type ConcernStatus = z.infer<typeof ConcernStatusSchema>;
export const CONCERN_STATUS_LABELS: Readonly<Record<ConcernStatus, string>> = {
  told: "跟你说了",
  involved: "你在管",
  declined: "你没接",
  resolved: "有了结果",
};

/** 结果和原作里这个人的结局比：better 更好，canon 差不多，worse 更糟 */
export const ConcernFateSchema = z.enum(["better", "canon", "worse"]);
export type ConcernFate = z.infer<typeof ConcernFateSchema>;
export const CONCERN_FATE_LABELS: Readonly<Record<ConcernFate, string>> = {
  better: "比原作的结局好",
  canon: "和原作的结局差不多",
  worse: "比原作的结局糟",
};

/** scene 正文里发生的，offscreen 场外推演写的 */
export const ConcernBySchema = z.enum(["scene", "offscreen"]);
export type ConcernBy = z.infer<typeof ConcernBySchema>;

export const ConcernNoteSchema = z.object({
  text: z.string().min(1).max(ARC_TEXT_MAX),
  at: z.number().int(),
  by: ConcernBySchema,
});

export const ConcernProgressSchema = z.object({
  status: ConcernStatusSchema.nullable().default(null),
  toldAt: z.number().int().nullable().default(null),
  notes: z.array(ConcernNoteSchema).default([]),
  outcome: z
    .object({
      text: z.string().min(1).max(ARC_TEXT_MAX),
      fate: ConcernFateSchema,
      at: z.number().int(),
      by: ConcernBySchema,
      /** 玩家知不知道这个结果：正文里的当场知道，场外推演的要听说或撞见以后才算 */
      known: z.boolean(),
      /** 场外结局公布前保留原来的状态，避免待办消失或重新出现泄露结果 */
      previousStatus: ConcernStatusSchema.nullable().optional(),
    })
    .nullable()
    .default(null),
});
export type ConcernProgress = z.infer<typeof ConcernProgressSchema>;

export const ArcProgressSchema = z.object({
  /** 第一次够条件的游戏时间；够过一次就一直算解锁 */
  unlockedAt: z.number().int().nullable().default(null),
  concerns: z.record(z.string(), ConcernProgressSchema).default({}),
  /** 几件心事都有了结果的时间 */
  doneAt: z.number().int().nullable().default(null),
});
export type ArcProgress = z.infer<typeof ArcProgressSchema>;

export const ArcsStateSchema = z.object({
  arcs: z.record(z.string(), ArcProgressSchema).default({}),
});
export type ArcsState = z.infer<typeof ArcsStateSchema>;

/**
 * 模型使用：
 * {"type": "arc", "action": "tell", "npc": "judy", "concern": "judy-evelyn"}
 * action：tell 他自己提起这件事，join 玩家答应插手，decline 玩家不管，note 插手以后的实质进展，resolve 有了结果，hear 玩家听说了场外的结果
 */
export const ArcCommandSchema = z
  .object({
    type: z.literal("arc"),
    action: z.enum(["tell", "join", "decline", "note", "resolve", "hear"]),
    npc: z.string().trim().min(1).describe("人物卡 id"),
    concern: z.string().trim().min(1).describe("【心事】里的心事 id"),
    /** note、resolve：发生了什么 */
    text: z.string().trim().min(1).max(ARC_TEXT_MAX).optional(),
    /** resolve：和原作结局比 */
    fate: ConcernFateSchema.optional(),
    /** resolve：关系真的变了时写一句新的关系笔记 */
    bond: z.string().trim().min(1).max(ARC_BOND_MAX).optional(),
  })
  .superRefine((c, ctx) => {
    if ((c.action === "note" || c.action === "resolve") && c.text === undefined) {
      ctx.addIssue({ code: "custom", message: `${c.action} 要写 text` });
    }
    if (c.action === "resolve" && c.fate === undefined) {
      ctx.addIssue({ code: "custom", message: "resolve 要写 fate（better、canon、worse）" });
    }
    if (c.bond !== undefined && c.action !== "resolve") {
      ctx.addIssue({ code: "custom", message: "bond 只在 resolve 时写" });
    }
  })
  .describe(
    "心事（原作人物的个人线）：tell 他自己向玩家提起【心事】里的一件事，join 玩家答应插手，decline 玩家明说不管，note 插手以后的实质进展（写 text），resolve 这件事有了结果（text 写结果，fate 写 better、canon 或 worse 和原作结局比，关系真的变了时 bond 写一句新的关系笔记），hear 玩家听说或撞见了场外推演写下的结果",
  );
export type ArcCommand = z.infer<typeof ArcCommandSchema>;

/** 只能由代码发出：场外推演把没人管的心事往前推一步，或者推出结果 */
export const ArcOffscreenCommandSchema = z.object({
  type: z.literal("arc.offscreen"),
  npc: z.string().min(1),
  concern: z.string().min(1),
  text: z.string().trim().min(1).max(ARC_TEXT_MAX),
  resolve: z.boolean().default(false),
  fate: ConcernFateSchema.optional(),
});
export type ArcOffscreenCommand = z.infer<typeof ArcOffscreenCommandSchema>;

export type ArcsInternal = ArcOffscreenCommand;
