import { z } from "zod";

/** 同时最多几个宿敌 */
export const NEMESES_MAX = 2;
/** 宿敌在屏幕外动一次以后至少隔几天才能再动、再亲自出场 */
export const NEMESIS_GAP_DAYS = 3;
/** 隔了这么多天还没动，下次场外推演要写他 */
export const NEMESIS_DUE_DAYS = 5;
/** 打完多久以内还能把逃掉、放走的人升成宿敌（小时） */
export const NEMESIS_RISE_HOURS = 24;
/** 每个宿敌留几条屏幕外的动作 */
export const NEMESIS_MOVES_KEPT = 6;
/** 了结一个宿敌给的街头声望，按半级计：2 级 */
export const NEMESIS_CRED_HALVES = 4;
export const HOW_MAX = 80;
export const PREP_MAX = 60;
export const MOVE_MAX = 120;
export const END_TEXT_MAX = 120;

/** 宿敌针对的打法：玩家最常用的路数 */
export const NemesisStyleSchema = z.enum([
  "guns",
  "blades",
  "brawl",
  "quickhack",
  "stealth",
  "talk",
  "tech",
]);
export type NemesisStyle = z.infer<typeof NemesisStyleSchema>;
export const NEMESIS_STYLE_LABELS: Readonly<Record<NemesisStyle, string>> = {
  guns: "枪械",
  blades: "刀刃",
  brawl: "拳脚",
  quickhack: "快速破解",
  stealth: "潜入",
  talk: "嘴皮子",
  tech: "科技装置",
};

/** 怎么了结的 */
export const NemesisEndSchema = z.enum(["killed", "reconciled", "gone"]);
export type NemesisEnd = z.infer<typeof NemesisEndSchema>;
export const NEMESIS_END_LABELS: Readonly<Record<NemesisEnd, string>> = {
  killed: "杀掉了",
  reconciled: "和解了",
  gone: "彻底退场",
};

export const NemesisPrepSchema = z.object({
  against: NemesisStyleSchema,
  text: z.string().trim().min(1).max(PREP_MAX),
  at: z.number().int(),
});
export type NemesisPrep = z.infer<typeof NemesisPrepSchema>;

export const NemesisMoveSchema = z.object({
  text: z.string().min(1).max(MOVE_MAX),
  at: z.number().int(),
});

export const NemesisSchema = z.object({
  npc: z.string().min(1),
  name: z.string().min(1),
  since: z.number().int(),
  /** 他是怎么输给玩家的：逃掉还是被放走，当时的情形 */
  how: z.string().min(1).max(HOW_MAX),
  /** 回来时针对玩家打法做的准备；没准备是 null */
  prep: NemesisPrepSchema.nullable().default(null),
  /** 玩家扫描或打听过，知道他准备了什么 */
  known: z.boolean().default(false),
  /** 屏幕外的动作，旧的在前 */
  moves: z.array(NemesisMoveSchema).default([]),
  lastMoveAt: z.number().int().nullable().default(null),
});
export type Nemesis = z.infer<typeof NemesisSchema>;

export const EndedNemesisSchema = z.object({
  npc: z.string().min(1),
  name: z.string().min(1),
  since: z.number().int(),
  how: z.string().min(1),
  end: NemesisEndSchema,
  text: z.string().min(1).max(END_TEXT_MAX),
  at: z.number().int(),
});
export type EndedNemesis = z.infer<typeof EndedNemesisSchema>;

export const NemesisStateSchema = z.object({
  nemeses: z.array(NemesisSchema).default([]),
  ended: z.array(EndedNemesisSchema).default([]),
  /** 刚打完的有卡敌人和还能升级到什么时候：规则层据此决定带不带宿敌规则 */
  recent: z
    .object({ foes: z.array(z.string().min(1)), until: z.number().int() })
    .nullable()
    .default(null),
});
export type NemesisState = z.infer<typeof NemesisStateSchema>;

/**
 * 模型使用：
 * {"type": "nemesis", "action": "rise", "npc": "royce", "how": "被你打穿了义体，跳进排水渠逃了"}
 * action：rise 升成宿敌，prep 他回来时针对你的打法做了准备，reveal 玩家扫描或打听到了他的准备，end 了结
 */
export const NemesisCommandSchema = z
  .object({
    type: z.literal("nemesis"),
    action: z.enum(["rise", "prep", "reveal", "end"]),
    npc: z.string().trim().min(1).describe("人物卡 id"),
    /** rise：他是怎么输的 */
    how: z.string().trim().min(1).max(HOW_MAX).optional(),
    /** rise、prep：针对哪种打法 */
    against: NemesisStyleSchema.optional(),
    /** rise、prep：做了什么准备 */
    prep: z.string().trim().min(1).max(PREP_MAX).optional(),
    /** end：杀掉、和解还是彻底退场 */
    end: NemesisEndSchema.optional(),
    /** end：怎么了结的，一两句 */
    text: z.string().trim().min(1).max(END_TEXT_MAX).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.action === "rise" && c.how === undefined) {
      ctx.addIssue({ code: "custom", message: "rise 要写 how：他是怎么输的" });
    }
    if ((c.against === undefined) !== (c.prep === undefined)) {
      ctx.addIssue({ code: "custom", message: "against 和 prep 要一起写" });
    }
    if (c.action === "prep" && c.prep === undefined) {
      ctx.addIssue({ code: "custom", message: "prep 要写 against 和 prep" });
    }
    if (c.action === "end" && (c.end === undefined || c.text === undefined)) {
      ctx.addIssue({ code: "custom", message: "end 要写 end（killed、reconciled、gone）和 text" });
    }
  })
  .describe(
    "宿敌：rise 把刚打完、活着逃掉或被放走的有卡敌人升成宿敌（写 how 他是怎么输的，可以同时写 against 和 prep），prep 他回来时针对玩家的打法做了准备（against 写 guns、blades、brawl、quickhack、stealth、talk、tech 之一，prep 写准备了什么），reveal 玩家扫描或打听到了他的准备，end 了结（end 写 killed、reconciled 或 gone，text 写怎么了结的；killed 要先让他死）",
  );
export type NemesisCommand = z.infer<typeof NemesisCommandSchema>;

/** 只能由代码发出：场外推演写的宿敌动作 */
export const NemesisMoveCommandSchema = z.object({
  type: z.literal("nemesis.move"),
  npc: z.string().min(1),
  text: z.string().trim().min(1).max(MOVE_MAX),
});
export type NemesisMoveCommand = z.infer<typeof NemesisMoveCommandSchema>;

export type NemesisInternal = NemesisMoveCommand;
