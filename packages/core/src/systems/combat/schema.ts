import { z } from "zod";
import { TierSchema } from "../dice";

/**
 * 战斗推倒重来（用户 2026-11-02 定的"战斗推倒重来"）：一轮一轮打，敌人每轮有盖着的打算，
 * 看穿、拦下、骗过它是这一仗的玩法；没拦下的打中你，由你挑拿身体哪一块去抵。
 * 超频义体拿人性换必中，人性太低时代码替你出手；你用惯的打法，下一伙敌人会防着
 */

/** 打法：玩家这一手靠什么；和宿敌针对的打法是同一套 */
export const TacticSchema = z.enum([
  "guns",
  "blades",
  "brawl",
  "quickhack",
  "stealth",
  "talk",
  "tech",
]);
export type Tactic = z.infer<typeof TacticSchema>;
export const TACTIC_LABELS: Readonly<Record<Tactic, string>> = {
  guns: "枪械",
  blades: "刀刃",
  brawl: "拳脚",
  quickhack: "快速破解",
  stealth: "潜入",
  talk: "嘴皮子",
  tech: "科技装置",
};

/** 敌人的路数：决定每轮从哪几种打算里抽 */
export const ArchetypeSchema = z.enum(["gunner", "brute", "netrunner", "boss"]);
export type Archetype = z.infer<typeof ArchetypeSchema>;

/** 敌人一轮的打算 */
export const IntentSchema = z.enum(["shoot", "aim", "rush", "hack", "call", "flee", "execute"]);
export type Intent = z.infer<typeof IntentSchema>;

/** 打算表：打中时最重扣到哪一档（null 是不伤人）、哪些打法这一轮能拦下它 */
export const INTENTS: Readonly<
  Record<
    Intent,
    {
      readonly label: string;
      readonly hit: "graze" | "heavy" | "lethal" | null;
      readonly counters: readonly Tactic[];
    }
  >
> = {
  shoot: { label: "开枪压制", hit: "graze", counters: ["stealth", "tech"] },
  aim: { label: "瞄准要害", hit: "heavy", counters: ["guns", "quickhack", "stealth"] },
  rush: { label: "冲上来近身", hit: "heavy", counters: ["guns", "tech", "blades"] },
  hack: { label: "上传快速破解", hit: "graze", counters: ["quickhack", "tech"] },
  call: { label: "叫增援", hit: null, counters: ["quickhack", "talk", "guns"] },
  flee: { label: "想跑", hit: null, counters: ["guns", "brawl", "blades", "talk"] },
  execute: { label: "下死手", hit: "lethal", counters: ["guns", "blades", "brawl", "quickhack"] },
};

/** 各路数每轮从哪几种打算里抽；重复的权重高 */
export const ARCHETYPE_INTENTS: Readonly<Record<Archetype, readonly Intent[]>> = {
  gunner: ["shoot", "shoot", "aim", "call", "flee"],
  brute: ["rush", "rush", "shoot", "execute"],
  netrunner: ["hack", "hack", "call", "flee"],
  boss: ["aim", "rush", "hack", "execute", "call"],
};

/** 敌人现在怎样了 */
export const FoeStateSchema = z.enum(["up", "hurt", "down", "fled"]);
export type FoeState = z.infer<typeof FoeStateSchema>;
export const FOE_STATE_LABELS: Readonly<Record<FoeState, string>> = {
  up: "还能打",
  hurt: "受伤了",
  down: "倒下了",
  fled: "逃走了",
};

/** 场上的一个敌人（一个有卡的人，或者一伙杂兵合成一个） */
export const ActiveFoeSchema = z.object({
  /** 有卡的写人物卡 id，杂兵由代码编 foe1、foe2 */
  id: z.string().min(1),
  name: z.string().min(1),
  /** 有人物卡时的卡 id */
  npc: z.string().min(1).nullable(),
  archetype: ArchetypeSchema,
  tier: TierSchema,
  state: FoeStateSchema,
  /** 这一轮的打算；倒下、逃走后是 null */
  intent: IntentSchema.nullable(),
  /** 玩家看穿了这一轮的打算 */
  known: z.boolean(),
  /** 被玩家骗了：这一轮的打算落空 */
  fooled: z.boolean(),
  /** 这伙人防着你哪种打法（你用惯了的）；没防是 null */
  braced: TacticSchema.nullable(),
  /** 身上带着的东西（物品表 id），开打时由代码按路数和档位抽；倒下后能捡，跑了就带走 */
  carry: z.array(z.string().min(1)).default([]),
});
export type ActiveFoe = z.infer<typeof ActiveFoeSchema>;

/** 打完还没捡走的：倒下的人身上剩的东西 */
export const LeftLootSchema = z.object({
  from: z.string().min(1),
  name: z.string().min(1),
  items: z.array(z.string().min(1)),
});

/** 打中你的一下：等你挑拿什么去抵 */
export const PendingHitSchema = z.object({
  /** 打你的敌人 id */
  from: z.string().min(1),
  name: z.string().min(1),
  intent: IntentSchema,
  tier: z.enum(["graze", "heavy", "lethal"]),
});
export type PendingHit = z.infer<typeof PendingHitSchema>;

/** 拿什么去抵：一件义体打坏、一条胳膊腿、或者肉身扣血 */
export const PaySchema = z.enum(["chrome", "limb", "flesh"]);
export type Pay = z.infer<typeof PaySchema>;

export const ActiveCombatSchema = z.object({
  startedAt: z.number().int(),
  /** 第几轮，从 1 起 */
  round: z.number().int().min(1),
  objective: z.string().min(1),
  defeat: z.string().min(1),
  foes: z.array(ActiveFoeSchema),
  /** 上一轮打中、还没抵的 */
  pending: z.array(PendingHitSchema),
  /** 这一轮超频了义体 */
  overclocked: z.boolean(),
  /** 这一仗超频了几次：越超人性代价越高 */
  overclocks: z.number().int().min(0),
  /** 上一次代码替你出手是第几轮；没有是 null */
  takeoverRound: z.number().int().nullable(),
});
export type ActiveCombat = z.infer<typeof ActiveCombatSchema>;

const zeroHabits = () =>
  Object.fromEntries(TacticSchema.options.map((t) => [t, 0])) as Record<Tactic, number>;

export const CombatStateSchema = z.object({
  active: ActiveCombatSchema.nullable(),
  /** 你各种打法用了多少次（跨场记，慢慢淡忘）；下一伙敌人防着最多的那种 */
  habits: z.record(TacticSchema, z.number().min(0)).default(zeroHabits),
  last: z
    .object({
      outcome: z.enum(["victory", "defeat", "retreat"]),
      endedAt: z.number().int(),
      foes: z.array(
        z.object({ npc: z.string().min(1), name: z.string().min(1), state: FoeStateSchema }),
      ),
      /** 倒下的人身上还没捡走的东西；下一仗开打时清掉 */
      loot: z.array(LeftLootSchema).default([]),
    })
    .nullable(),
});
export type CombatState = z.infer<typeof CombatStateSchema>;

/** start 写进来的敌人：有卡的写 npc，杂兵一伙写一条 */
export const FoeInputSchema = z.object({
  name: z.string().min(1),
  npc: z.string().min(1).optional(),
  archetype: ArchetypeSchema,
  tier: TierSchema,
});
export type FoeInput = z.infer<typeof FoeInputSchema>;

/**
 * 模型使用：start 开打；act 玩家这一轮用什么打法、对谁；reveal 看穿某人的打算；
 * fool 骗过某人（这一轮他落空）；foe 某人受伤、倒下或逃走；end 写结局；retreat 撤成了
 */
export const CombatCommandSchema = z
  .object({
    type: z.literal("combat"),
    action: z.enum(["start", "act", "reveal", "fool", "foe", "end", "retreat", "pay", "loot"]),
    /** pay：玩家在正文里说了拿什么抵最早那一下 */
    pay: PaySchema.optional(),
    chrome: z.string().min(1).optional(),
    limb: z.enum(["left-arm", "right-arm", "left-leg", "right-leg"]).optional(),
    objective: z.string().min(1).max(80).optional(),
    defeat: z.string().min(1).max(80).optional(),
    foes: z.array(FoeInputSchema).min(1).max(5).optional(),
    tactic: TacticSchema.optional(),
    target: z.string().min(1).optional(),
    state: z.enum(["hurt", "down", "fled"]).optional(),
    outcome: z.enum(["victory", "defeat"]).optional(),
    /** loot：从 target 身上捡哪件（物品表 id） */
    item: z.string().min(1).optional(),
  })
  .superRefine((c, ctx) => {
    const need = (ok: boolean, message: string) => {
      if (!ok) ctx.addIssue({ code: "custom", message });
    };
    if (c.action === "start") {
      need(c.objective !== undefined && c.defeat !== undefined, "开打要写 objective 和 defeat");
      need(c.foes !== undefined, "开打要写 foes");
    }
    if (c.action === "act") need(c.tactic !== undefined, "act 要写 tactic");
    if (c.action === "reveal" || c.action === "fool")
      need(c.target !== undefined, `${c.action} 要写 target`);
    if (c.action === "foe")
      need(c.target !== undefined && c.state !== undefined, "foe 要写 target 和 state");
    if (c.action === "end") need(c.outcome !== undefined, "end 要写 outcome");
    if (c.action === "loot")
      need(c.target !== undefined && c.item !== undefined, "loot 要写 target 和 item");
    if (c.action === "pay") {
      need(c.pay !== undefined, "pay 要写拿什么抵：chrome、limb 或 flesh");
      if (c.pay === "chrome") need(c.chrome !== undefined, "拿义体抵要写 chrome（义体 id）");
      if (c.pay === "limb") need(c.limb !== undefined, "拿胳膊腿抵要写 limb");
    }
  })
  .describe(
    "战斗：start 开打（objective、defeat、foes：每个敌人写 name、archetype gunner/brute/netrunner/boss、tier，有卡的写 npc）；act 玩家这一轮的打法（tactic，target 对谁）；reveal 看穿 target 这一轮的打算；fool 骗过 target，他这一轮落空；foe 某人 hurt、down 或 fled；end 写 outcome；retreat 撤成了；pay 玩家在输入里说了拿什么抵挨的那一下（pay chrome 加 chrome 义体 id、limb 加 limb、flesh）；loot 从倒下的 target 身上捡一件 item（只能是【当前状态】里他身上带着的，打完了也能捡剩下的）",
  );
export type CombatCommand = z.infer<typeof CombatCommandSchema>;

/** 只能由代码发出：round 一轮打完结算打算并抽下一轮；pay 玩家挑了拿什么抵；overclock 超频义体 */
export const CombatInternalSchemas = {
  "combat.round": z.object({ type: z.literal("combat.round") }),
  "combat.pay": z.object({
    type: z.literal("combat.pay"),
    pay: PaySchema,
    /** chrome：打坏哪件义体（id） */
    chrome: z.string().min(1).optional(),
    /** limb：断哪条胳膊腿 */
    limb: z.enum(["left-arm", "right-arm", "left-leg", "right-leg"]).optional(),
  }),
  "combat.overclock": z.object({ type: z.literal("combat.overclock") }),
};
export type CombatInternal = z.infer<
  (typeof CombatInternalSchemas)[keyof typeof CombatInternalSchemas]
>;

/** 超频一次扣多少人性；同一仗里每多超一次再多扣这么多（暂定，试玩时调） */
export const OVERCLOCK_COST = 4;
export const OVERCLOCK_STEP = 2;
/** 人性低于这个数时，代码可能替你出手 */
export const TAKEOVER_BELOW = 40;
/** 人性每低于门槛 1 点，每轮被接管的机会加几个百分点 */
export const TAKEOVER_PERCENT_PER_POINT = 2;
/** 一种打法用到几次，下一伙敌人就防着它 */
export const BRACE_AT = 3;
/** 每打完一仗，习惯次数乘这个数（慢慢淡忘） */
export const HABIT_DECAY = 0.5;
/** 一仗最多打几轮；到了还没分出胜负，按败局收场 */
export const MAX_ROUNDS = 6;

/** 掉落表（暂定，试玩时调）：各路数身上带哪几类武器（物品表的 category），抽一把 */
export const LOOT_WEAPONS: Readonly<Record<Archetype, readonly string[]>> = {
  gunner: ["pistol", "revolver", "smg", "assaultRifle", "shotgun"],
  brute: ["blade", "blunt", "shotgun", "lmg"],
  netrunner: ["pistol", "smg"],
  boss: ["assaultRifle", "precisionRifle", "sniperRifle", "shotgun", "blade"],
};
/** 档位决定能抽到哪几档稀有度；抽不到就往下一档找。不朽物品不会掉 */
export const LOOT_RARITY: Readonly<Record<z.infer<typeof TierSchema>, readonly string[]>> = {
  street: ["common"],
  veteran: ["common", "uncommon"],
  elite: ["uncommon", "rare"],
  legend: ["rare", "epic"],
};
/** 除了武器，有一半机会再带一件这几类里的东西 */
export const LOOT_EXTRA_KINDS: readonly string[] = ["healing", "grenade"];
