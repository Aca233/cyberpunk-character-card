import { z } from "zod";
import { MOD_STEP, TierSchema } from "../dice";

/** 敌群：杂兵不建卡，按档位和大致人数合成一组 */
export const EnemyGroupSchema = z.object({
  group: z.string().min(1),
  tier: TierSchema,
  count: z.number().int().min(1).max(50),
});
export type EnemyGroup = z.infer<typeof EnemyGroupSchema>;

/** 有名有姓的敌人：有人物卡，情况由叙事模型按正文写，代码不算命中次数 */
export const FoeSchema = z.object({
  npc: z.string().min(1).describe("人物卡 id"),
  tier: TierSchema,
});
export type Foe = z.infer<typeof FoeSchema>;

/** 有卡敌人现在怎样了 */
export const FoeStateSchema = z.enum(["up", "hurt", "down", "fled"]);
export type FoeState = z.infer<typeof FoeStateSchema>;
export const FOE_STATE_LABELS: Readonly<Record<FoeState, string>> = {
  up: "还能打",
  hurt: "受伤了",
  down: "倒下了",
  fled: "逃走了",
};

export const ActiveFoeSchema = z.object({
  npc: z.string().min(1),
  name: z.string().min(1),
  tier: TierSchema,
  /** 旧存档没有，按还能打算 */
  state: FoeStateSchema.default("up"),
  /** 玩家扫描过才显示情况 */
  scanned: z.boolean(),
});
export type ActiveFoe = z.infer<typeof ActiveFoeSchema>;

/** 每段最多几个快捷动作（用治疗品、扔手雷），不算主行动 */
export const MAX_QUICK = 2;

export const CombatOutcomeSchema = z.enum(["victory", "defeat", "retreat"]);
export type CombatOutcome = z.infer<typeof CombatOutcomeSchema>;

/** 第一段谁占先机：对峙里先开枪、埋伏得手是 player，谈崩被抢先、被埋伏是 enemy */
export const EdgeSchema = z.enum(["player", "enemy"]);
export type Edge = z.infer<typeof EdgeSchema>;
export const EDGE_LABELS: Readonly<Record<Edge, string>> = {
  player: `你占先机，检定 +${MOD_STEP}`,
  enemy: `对方占先机，检定 −${MOD_STEP}`,
};

/** 对峙：枪口对着枪口，最多几轮发言，时间到了对方先动手 */
export const StandoffSchema = z.object({
  startedAt: z.number().int(),
  /** 对面是谁 */
  opponent: z.string().min(1),
  rounds: z.number().int().min(1).max(3),
  /** 还剩几轮；0 是时间到了 */
  left: z.number().int().min(0).max(3),
});
export type Standoff = z.infer<typeof StandoffSchema>;

export const ActiveCombatSchema = z.object({
  startedAt: z.number().int(),
  /** 分几段，1–3 */
  moments: z.number().int().min(1).max(3),
  /** 当前是第几段（从 0 起） */
  current: z.number().int().min(0),
  /** 开战时写明的目标：这一仗要达成什么；旧存档没有 */
  objective: z.string().min(1).nullable().default(null),
  /** 开战时写明的败局 */
  defeat: z.string().min(1),
  enemies: z.array(EnemyGroupSchema),
  /** 有卡敌人；旧存档里没有 */
  foes: z.array(ActiveFoeSchema).default([]),
  /** 这一段已经做了几个快捷动作 */
  quick: z.number().int().min(0).default(0),
  /** 濒死要在这一段（从 0 起）结束前被救回；不在濒死时为 null */
  dyingUntil: z.number().int().min(0).nullable(),
  /** 第一段谁占先机；没写是 null */
  edge: EdgeSchema.nullable().default(null),
});
export type ActiveCombat = z.infer<typeof ActiveCombatSchema>;

export const CombatStateSchema = z.object({
  active: ActiveCombatSchema.nullable(),
  /** 进行中的对峙；旧存档没有 */
  standoff: StandoffSchema.nullable().default(null),
  last: z
    .object({
      outcome: CombatOutcomeSchema,
      defeat: z.string().nullable(),
      endedAt: z.number().int(),
      /** 收场时有卡敌人的情况：宿敌从这里挑；旧存档没有 */
      foes: z
        .array(z.object({ npc: z.string().min(1), name: z.string().min(1), state: FoeStateSchema }))
        .default([]),
    })
    .nullable(),
});
export type CombatState = z.infer<typeof CombatStateSchema>;

/**
 * 模型使用：
 * {"type": "combat", "action": "start", "moments": 2, "objective": "抢在他们之前把货运出仓库",
 *  "defeat": "被迫撤退，货物丢失",
 *  "enemies": [{"group": "漩涡帮打手", "tier": "street", "count": 5}]}
 * action 可为 start、next（这一段打完，进下一段）、end（写结局）、retreat（撤退成功）、foe（有卡敌人的情况变了）
 */
export const CombatCommandSchema = z
  .object({
    type: z.literal("combat"),
    action: z.enum(["start", "next", "retreat", "end", "foe", "scan", "standoff", "defuse"]),
    moments: z.number().int().min(1).max(3).optional(),
    /** start：这一仗要达成什么 */
    objective: z.string().min(1).max(80).optional(),
    defeat: z.string().min(1).optional(),
    enemies: z.array(EnemyGroupSchema).min(1).max(6).optional(),
    /** 有卡敌人，不放进敌群 */
    foes: z.array(FoeSchema).min(1).max(4).optional(),
    /** foe、scan：说的是哪个有卡敌人 */
    target: z.string().min(1).optional(),
    /** foe：他现在怎样了 */
    state: z.enum(["hurt", "down", "fled"]).optional(),
    /** end：赢了还是输了 */
    outcome: z.enum(["victory", "defeat"]).optional(),
    /** start：第一段谁占先机 */
    edge: EdgeSchema.optional(),
    /** standoff：对面是谁 */
    opponent: z.string().min(1).optional(),
    /** standoff：最多几轮发言 */
    rounds: z.number().int().min(1).max(3).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.action === "standoff" && (c.opponent === undefined || c.rounds === undefined)) {
      ctx.addIssue({ code: "custom", message: "对峙要写 opponent 和 rounds" });
    }
    if (c.action === "start") {
      if (c.moments === undefined || c.objective === undefined || c.defeat === undefined) {
        ctx.addIssue({ code: "custom", message: "开战要写 moments、objective 和 defeat" });
      }
      if (c.enemies === undefined && c.foes === undefined) {
        ctx.addIssue({ code: "custom", message: "开战要写 enemies 或 foes" });
      }
    }
    if (c.action === "end" && c.outcome === undefined) {
      ctx.addIssue({ code: "custom", message: "结束要写 outcome：victory 或 defeat" });
    }
    if (c.action === "foe" && (c.target === undefined || c.state === undefined)) {
      ctx.addIssue({ code: "custom", message: "foe 要写 target 和 state" });
    }
    if (c.action === "scan" && c.target === undefined) {
      ctx.addIssue({ code: "custom", message: "scan 要写 target" });
    }
  })
  .describe(
    "战斗：start 开打（要写 moments 分几段、objective 这一仗要达成什么、defeat 输了会怎样，敌群写 enemies，有人物卡的敌人写 foes），next 这一段打完、进下一段，end 写结局（outcome 写 victory 或 defeat），retreat 撤退成功，foe 有卡敌人的情况变了（target 写他的 id，state 写 hurt、down 或 fled），scan 玩家扫描了某个有卡敌人；standoff 开一场对峙（写 opponent、rounds 2–3），defuse 对峙化解、不打了；start 可以写 edge（player 或 enemy）说明第一段谁占先机",
  );
export type CombatCommand = z.infer<typeof CombatCommandSchema>;

/** 只能由代码发出：对峙每过一轮倒数一次 */
export const StandoffTickSchema = z.object({ type: z.literal("combat.standoffTick") });
export type StandoffTick = z.infer<typeof StandoffTickSchema>;
