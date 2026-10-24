import { z } from "zod";

export const AFFINITY_MIN = -100;
export const AFFINITY_MAX = 100;
/** 单条好感变化的上限，超出的截断 */
export const AFFINITY_STEP_CAP = 10;
/** 每个人物保留最近这么多条共同记忆 */
export const MEMORY_KEPT = 12;

const NpcIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "人物 id 用小写英文、数字和连字符，例如 rebecca");

/** 人物卡里写定以后不改的部分；canon 是原作人物，预先写在 content 包里 */
export const NpcCardSchema = z.object({
  id: NpcIdSchema,
  name: z.string().trim().min(1).max(20),
  alias: z.string().trim().min(1).max(20).optional(),
  /** 他、她、TA */
  pronoun: z.string().trim().min(1).max(4),
  /** 身份，例如中间人、义体医生、漩涡帮打手 */
  role: z.string().trim().min(1).max(40),
  look: z.string().trim().min(1).max(200),
  /** 说话方式：口癖、语气、爱用的词 */
  voice: z.string().trim().min(1).max(200),
  /** 几句说话样本，只给模型参考口吻，不照搬 */
  samples: z.array(z.string().trim().min(1).max(120)).max(4).default([]),
  /** 诉求：这个人想要什么 */
  want: z.string().trim().min(1).max(160),
  /** 底线：这个人绝不会做、也不能容忍的事 */
  limit: z.string().trim().min(1).max(160),
  /** 秘密：真实动机、隐藏身份或计划；只有模型看得到 */
  secret: z.string().trim().min(1).max(160).optional(),
  /** 常在的地点 id */
  home: z.string().min(1).optional(),
  canon: z.boolean().default(false),
});
export type NpcCard = z.infer<typeof NpcCardSchema>;

export const NpcSchema = NpcCardSchema.extend({
  affinity: z.number().int().min(AFFINITY_MIN).max(AFFINITY_MAX),
  alive: z.boolean(),
  /** 玩家角色见过没有；原作人物开局就有卡，但还没见过 */
  met: z.boolean(),
  /** 最后出现的地点 id */
  location: z.string().min(1).nullable(),
  /** 最后一次出场的游戏时间（分钟） */
  lastSeenAt: z.number().int().nullable(),
  /** 和玩家角色的共同记忆，旧的在前 */
  memories: z.array(z.string()),
});
export type Npc = z.infer<typeof NpcSchema>;

export const NpcStateSchema = z.object({
  npcs: z.record(z.string(), NpcSchema),
});
export type NpcState = z.infer<typeof NpcStateSchema>;

const LocationSchema = z.string().min(1).describe("地点 id，和 world 指令用的一致");

/** 模型使用：剧情里新认识、有名有姓并有实质互动的人，当场建卡 */
export const NewNpcSchema = NpcCardSchema.omit({ canon: true, samples: true, home: true })
  .extend({
    type: z.literal("npc"),
    location: LocationSchema.optional(),
  })
  .describe(
    "新人物建卡：有名字、并且和玩家角色有了实质互动（交谈、交易、冲突、人情）才建；路人不建。want、limit、secret 写定以后不能改",
  );
export type NewNpc = z.infer<typeof NewNpcSchema>;

/** 模型使用：已有人物出场或换了地点 */
export const MeetSchema = z
  .object({
    type: z.literal("meet"),
    id: NpcIdSchema,
    location: LocationSchema.optional(),
  })
  .describe("已有人物卡的人出场（第一次见面也用这条），或换了地点");
export type Meet = z.infer<typeof MeetSchema>;

export const AffinitySchema = z
  .object({
    type: z.literal("affinity"),
    id: NpcIdSchema,
    delta: z
      .number()
      .int()
      .refine((v) => v !== 0, "好感变化不能为 0"),
    reason: z.string().trim().min(1).max(80),
  })
  .describe(
    `好感变化：小事 ±1 至 ±3，帮了大忙或伤了感情 ±5 至 ±${AFFINITY_STEP_CAP}；单条最多 ±${AFFINITY_STEP_CAP}，范围 ${AFFINITY_MIN} 到 ${AFFINITY_MAX}，代码截断`,
  );
export type Affinity = z.infer<typeof AffinitySchema>;

export const MemorySchema = z
  .object({
    type: z.literal("memory"),
    id: NpcIdSchema,
    text: z.string().trim().min(1).max(120),
  })
  .describe("记下这个人和玩家角色之间值得记住的事：承诺、人情、冲突、秘密被说破；一句话");
export type Memory = z.infer<typeof MemorySchema>;

export const NpcDeathSchema = z
  .object({
    type: z.literal("npcDeath"),
    id: NpcIdSchema,
    reason: z.string().trim().min(1).max(80),
  })
  .describe("人物死亡；死了的人不会再出场");
export type NpcDeath = z.infer<typeof NpcDeathSchema>;

export type NpcCommand = NewNpc | Meet | Affinity | Memory | NpcDeath;

/** 只能由代码发出：新存档放进原作人物卡和主板模块带出的旧识，开局好感按卡上写的 */
export const SeedNpcSchema = NpcCardSchema.extend({
  type: z.literal("npc.seed"),
  affinity: z.number().int().min(AFFINITY_MIN).max(AFFINITY_MAX).default(0),
  /** 主板带出的人物是角色过去就认识的 */
  met: z.boolean().default(false),
});
export type SeedNpc = z.infer<typeof SeedNpcSchema>;
