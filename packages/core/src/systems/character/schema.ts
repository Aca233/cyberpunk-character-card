import { z } from "zod";

/** 角色主板上的一块：出身、过往、特长或负面经历；专属选项的来源按它核对，侧栏也显示 */
export const TRAIT_SLOTS = ["origin", "past", "skill", "flaw"] as const;
export const TraitSlotSchema = z.enum(TRAIT_SLOTS);
export type TraitSlot = z.infer<typeof TraitSlotSchema>;
export const TRAIT_LABELS: Readonly<Record<TraitSlot, string>> = {
  origin: "出身",
  past: "过往",
  skill: "特长",
  flaw: "负面经历",
};
export const TraitSchema = z.object({
  slot: TraitSlotSchema,
  label: z.string().trim().min(1).max(24),
  ability: z.string().max(200).default(""),
});
export type Trait = z.infer<typeof TraitSchema>;
export const TRAITS_MAX = 24;

/** 习惯栏最多几条；叙事模型提议、还没确认的也最多这么多 */
export const HABITS_MAX = 8;
/** 一条习惯：常去的店、爱吃的东西、睡前做什么、车里放什么歌 */
export const HabitTextSchema = z.string().trim().min(1).max(40);

/** 闪回里确认的事最多记这么多条 */
export const PAST_FACTS_MAX = 24;

/** 街上传开的事迹最多保留条数 */
export const DEEDS_MAX = 16;

/** 一条事迹传了多远：圈子/街角、整个城区、全夜之城 */
export const DEED_REACHES = ["local", "district", "city"] as const;
export const DeedReachSchema = z.enum(DEED_REACHES);
export type DeedReach = z.infer<typeof DeedReachSchema>;
export const DEED_REACH_LABELS: Readonly<Record<DeedReach, string>> = {
  local: "圈内风声",
  district: "城区传开",
  city: "全城皆知",
};

/** 别人记住你干过的某件事：谁知道、传到哪一步、怎么说 */
export const KnownDeedSchema = z.object({
  /** 事件稳定 id，例如 deed:h10-cage-win、city:arasaka-heist；同一 id 再次上报会升级/更新而非重复追加 */
  id: z.string().trim().min(1).max(60),
  /** 别人知道你干了什么（一句话，60 字以内，可含夸大、污名或具体口碑） */
  summary: z.string().trim().min(1).max(80),
  /** 哪些圈子或群体知道，例如 ["虎爪帮", "日本町街头", "沃森中间人"] */
  knownBy: z.array(z.string().trim().min(1).max(24)).max(4).default([]),
  /** 传播范围 */
  reach: DeedReachSchema,
  /** 主要流传城区；全城皆知时可省 */
  district: z.string().trim().min(1).max(20).optional(),
  /** 首次传开的游戏时间 */
  at: z.number().int(),
  /** 最近扩散或改写说法的游戏时间 */
  updatedAt: z.number().int(),
});
export type KnownDeed = z.infer<typeof KnownDeedSchema>;

export const ActiveFlashbackSchema = z.object({
  /** 过往模块的名字 */
  past: z.string().min(1),
  startedAt: z.number().int(),
  /** 闪回里已经玩了几轮（开闪回的那一轮不算） */
  turns: z.number().int().min(0),
});
export type ActiveFlashback = z.infer<typeof ActiveFlashbackSchema>;

/** 闪回里确认、写进已确定事实的一句 */
export const PastFactSchema = z.object({
  past: z.string().min(1),
  text: z.string().min(1).max(200),
});
export type PastFact = z.infer<typeof PastFactSchema>;

/** 独立的人物视觉资料：只保存角色卡原文，不从经历或称谓推断外貌。 */
export const CharacterVisualSchema = z.object({
  alias: z.string().max(40),
  pronoun: z.string().max(10),
  look: z.string().max(500),
});
export type CharacterVisual = z.infer<typeof CharacterVisualSchema>;

export const CharacterStateSchema = z.object({
  /** 建档前为 null */
  name: z.string().min(1).nullable(),
  /** 给叙事模型看的一段简介：出身、外貌、性格、会什么 */
  brief: z.string(),
  /** 配图只读取这份明确的视觉资料，不拆解混合简介。 */
  visual: CharacterVisualSchema.optional(),
  /** 外界知道你干过的事（名声与口碑的唯一真相源，无数值等级） */
  deeds: z.array(KnownDeedSchema).max(DEEDS_MAX).default([]),
  /** 旧存档和没用主板的角色是空的 */
  traits: z.array(TraitSchema).max(TRAITS_MAX).default([]),
  /** 习惯：玩家自己写的，或者确认过的叙事模型提议；不加数值 */
  habits: z.array(HabitTextSchema).max(HABITS_MAX).default([]),
  /** 叙事模型提议、玩家还没确认的习惯 */
  habitOffers: z.array(HabitTextSchema).max(HABITS_MAX).default([]),
  /** 闪回过的过往；记录曾回忆的内容，不限制重访 */
  flashbackUsed: z.array(z.string().min(1)).default([]),
  /** 正在进行的闪回；不在闪回时为 null */
  flashback: ActiveFlashbackSchema.nullable().default(null),
  /** 闪回里确认的事：已确定的事实 */
  pastFacts: z.array(PastFactSchema).default([]),
  /** 角色立绘图片 ID（本地 ImageStore） */
  portrait: z.string().min(1).max(120).optional(),
});
export type CharacterState = z.infer<typeof CharacterStateSchema>;

/** 只能由代码发出：建档时写入角色 */
export const SetCharacterSchema = z.object({
  type: z.literal("character.set"),
  name: z.string().min(1),
  brief: z.string(),
  visual: CharacterVisualSchema.optional(),
  /** 旧存档的角色快照没有 */
  traits: z.array(TraitSchema).max(TRAITS_MAX).optional(),
  portrait: z.string().min(1).max(120).optional(),
});
export type SetCharacter = z.infer<typeof SetCharacterSchema>;

/** 模型或场外推演使用：记录或扩散外界知道主角干过的某件事 */
export const ReputationCommandSchema = z
  .object({
    type: z.literal("reputation"),
    /** 事件稳定 id，例如 kabuki-shootout、militech-convoy；同一件事后续扩散或改口复用同一个 id */
    id: z.string().trim().min(1).max(60),
    /** 外界流传的说法：别人知道你干了什么、留下了什么名声或恶名（80 字以内） */
    summary: z.string().trim().min(1).max(80),
    /** 哪些圈子/群体知道（最多 4 个短语），例如 ["漩涡帮", "沃森中间人", "歌舞伎街坊"] */
    knownBy: z.array(z.string().trim().min(1).max(24)).max(4).default([]),
    /** 传播范围：local 圈内/街角在传，district 整个城区传开，city 全城皆知（上新闻/全城议论） */
    reach: DeedReachSchema.default("local"),
    /** 主要流传城区；reach 为 city 时可省 */
    district: z.string().trim().min(1).max(20).optional(),
  })
  .describe(
    "登记或更新外界知道主角干过的事：仅当有目击、消息流出、新闻播报或圈内议论时使用（含好名声、狠名、恶名、黑吃黑或丢脸事）；无人知晓的私事不记。同一件事扩散或口碑演变时复用同一 id 更新。",
  );
export type ReputationCommand = z.infer<typeof ReputationCommandSchema>;

/** 只能由代码发出：场内/场外已确认公开事件写入外界事迹 */
export const RecordDeedSchema = z.object({
  type: z.literal("character.deed"),
  id: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(1).max(80),
  knownBy: z.array(z.string().trim().min(1).max(24)).max(4).default([]),
  reach: DeedReachSchema.default("local"),
  district: z.string().trim().min(1).max(20).optional(),
});
export type RecordDeed = z.infer<typeof RecordDeedSchema>;

/** 模型使用：{"type": "habit", "text": "..."}，玩家确认后才写进角色卡 */
export const HabitCommandSchema = z
  .object({ type: z.literal("habit"), text: HabitTextSchema })
  .describe(
    "提议一个习惯：剧情里角色反复做的一件小事（常去的店、爱吃的东西、睡前做什么、车里放什么歌），一句话；玩家确认后才写进角色卡，不加数值",
  );
export type HabitCommand = z.infer<typeof HabitCommandSchema>;

/** 只能由代码发出：玩家在角色卡上加、确认、拒绝或删掉一条习惯 */
export const HabitChangeSchema = z.object({
  type: z.literal("character.habit"),
  action: z.enum(["add", "confirm", "dismiss", "remove"]),
  text: HabitTextSchema,
});
export type HabitChange = z.infer<typeof HabitChangeSchema>;

/** 模型使用：{"type": "flashback", "past": "过往的名字"}；结束时 {"type": "flashback", "action": "end", "fact": "..."} */
export const FlashbackCommandSchema = z
  .object({
    type: z.literal("flashback"),
    action: z.enum(["start", "end"]).default("start"),
    past: z.string().min(1).optional(),
    fact: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.action === "start" && c.past === undefined) {
      ctx.addIssue({ code: "custom", message: "开始闪回要写 past（过往的名字）" });
    }
  })
  .describe(
    "过往闪回：start 开一段闪回，past 写状态里还能闪回的过往名字，可以再次回忆同一段过往，不覆盖已确定的事实；end 回到现在，fact 写这段闪回里确认的事（一句话，成为已确定的事实）",
  );
export type FlashbackCommand = z.infer<typeof FlashbackCommandSchema>;

/** 只能由代码发出：闪回里每过一轮由回合流程发出，只记录交互次数，不自动结束 */
export const FlashbackTickSchema = z.object({ type: z.literal("character.flashbackTick") });
export type FlashbackTick = z.infer<typeof FlashbackTickSchema>;

export type CharacterInternal = SetCharacter | RecordDeed | HabitChange | FlashbackTick;
