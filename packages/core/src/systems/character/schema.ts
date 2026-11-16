import { z } from "zod";
import { type Attribute, AttributeSchema } from "../dice";

export const ATTRIBUTE_MAX = 10;
export const AttributeValueSchema = z.number().int().min(1).max(ATTRIBUTE_MAX);

export const STREET_CRED_MAX = 50;

/** 角色主板上的一块：出身、过往、本事、负面经历或联动；专属选项的来源按它核对，侧栏也显示 */
export const TRAIT_SLOTS = ["origin", "past", "skill", "flaw", "combo"] as const;
export const TraitSlotSchema = z.enum(TRAIT_SLOTS);
export type TraitSlot = z.infer<typeof TraitSlotSchema>;
export const TRAIT_LABELS: Readonly<Record<TraitSlot, string>> = {
  origin: "出身",
  past: "过往",
  skill: "特长",
  flaw: "负面经历",
  combo: "联动",
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

export const CharacterStateSchema = z.object({
  /** 建档前为 null */
  name: z.string().min(1).nullable(),
  /** 给叙事模型看的一段简介：出身、外貌、性格、会什么 */
  brief: z.string(),
  attributes: z.record(AttributeSchema, AttributeValueSchema),
  /** 街头声望等级 */
  streetCred: z.number().int().min(0).max(STREET_CRED_MAX),
  /** 声望按半级增长：攒着半级时为 true，再得半级就升一级 */
  credHalf: z.boolean().default(false),
  /** 还没分配的属性点 */
  attributePoints: z.number().int().min(0).default(0),
  /** 已经结算过声望的事件 id；同一事件只结算一次 */
  credSettled: z.array(z.string()).default([]),
  /** 旧存档和没用主板的角色是空的 */
  traits: z.array(TraitSchema).max(TRAITS_MAX).default([]),
  /** 装着的义体带来的属性加成，由义体系统算好写进来；旧存档没有 */
  bonuses: z.partialRecord(AttributeSchema, z.number().int().min(0).max(ATTRIBUTE_MAX)).default({}),
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
});
export type CharacterState = z.infer<typeof CharacterStateSchema>;

/** 只能由代码发出：建档时写入角色 */
export const SetCharacterSchema = z.object({
  type: z.literal("character.set"),
  name: z.string().min(1),
  brief: z.string(),
  attributes: z.record(AttributeSchema, AttributeValueSchema),
  streetCred: z.number().int().min(0).max(STREET_CRED_MAX).default(1),
  /** 旧存档的角色快照没有 */
  traits: z.array(TraitSchema).max(TRAITS_MAX).optional(),
});
export type SetCharacter = z.infer<typeof SetCharacterSchema>;

/** 模型使用：传闻和公开事件带来的声望 */
export const StreetCredCommandSchema = z
  .object({
    type: z.literal("streetCred"),
    levels: z.number().multipleOf(0.5).min(0.5).max(2),
    reason: z.string().min(1),
    /** 事件 id，例如 rumor:arasaka-tower；同一事件只结算一次 */
    event: z.string().min(1),
  })
  .describe(
    "街头声望上涨（结算用；模型写的是大小，见 StreetCredProposalSchema）；同一事件只结算一次",
  );
export type StreetCredCommand = z.infer<typeof StreetCredCommandSchema>;

/** 声望的大小档：传闻传开、街上有人谈论、轰动的公开事件；换算表只在这里写一份（暂定，试玩时调） */
export const CRED_SIZES = { small: 0.5, medium: 1, large: 2 } as const;
export type CredSize = keyof typeof CRED_SIZES;
const CRED_SIZE_LABELS: Readonly<Record<CredSize, string>> = {
  small: "小",
  medium: "中",
  large: "大",
};

/** 模型写的声望：只选大小，代码按 CRED_SIZES 换成级数 */
export const StreetCredProposalSchema = z
  .object({
    type: z.literal("streetCred"),
    size: z
      .enum(["small", "medium", "large"])
      .describe("small 传闻传开，medium 街上有人认出、谈论，large 轰动的公开事件"),
    reason: z.string().min(1),
    /** 事件 id，例如 rumor:arasaka-tower；同一事件只结算一次 */
    event: z.string().min(1),
  })
  .describe(
    "街头声望上涨：只选大小，不写数字；同一事件只结算一次。只有确实公开传播的事件才改变名声，完成委托本身不自动奖励名声",
  )
  .transform(({ size, ...rest }): StreetCredCommand => ({ ...rest, levels: CRED_SIZES[size] }));

/** 模型仍写了级数时：换成最近的大小档（一样近取小的） */
export function legacyStreetCred(
  raw: Readonly<Record<string, unknown>>,
): { readonly value: Record<string, unknown>; readonly note: string } | undefined {
  if (!("levels" in raw)) return undefined;
  const { levels, ...rest } = raw;
  if (rest.size !== undefined) {
    return { value: rest, note: "街头声望写了数字，按写的大小处理，数字不用" };
  }
  if (typeof levels !== "number" || !Number.isFinite(levels) || levels <= 0) return undefined;
  const sizes = Object.entries(CRED_SIZES) as [CredSize, number][];
  const [size] = sizes.reduce((best, cur) =>
    Math.abs(cur[1] - levels) < Math.abs(best[1] - levels) ? cur : best,
  );
  return {
    value: { ...rest, size },
    note: `街头声望写了数字，已按最近的档位（${CRED_SIZE_LABELS[size]}）处理`,
  };
}

/** 只能由代码发出：委托完成等带来的声望，按半级计 */
export const GainCredSchema = z.object({
  type: z.literal("character.cred"),
  halves: z.number().int().min(1).max(12),
  reason: z.string().min(1),
  event: z.string().min(1),
});
export type GainCred = z.infer<typeof GainCredSchema>;

/** 只能由代码发出：义体装卸后重算的属性加成 */
export const SetBonusesSchema = z.object({
  type: z.literal("character.setBonuses"),
  bonuses: z.partialRecord(AttributeSchema, z.number().int().min(0).max(ATTRIBUTE_MAX)),
});
export type SetBonuses = z.infer<typeof SetBonusesSchema>;

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

export type CharacterInternal = SetCharacter | GainCred | SetBonuses | HabitChange | FlashbackTick;

/** 检定用的属性：自己的加上义体加成，最高 20 */
export function effectiveAttribute(
  state: Pick<CharacterState, "attributes"> & { readonly bonuses?: CharacterState["bonuses"] },
  attribute: Attribute,
): number {
  return Math.min(
    ATTRIBUTE_MAX,
    (state.attributes[attribute] ?? 0) + (state.bonuses?.[attribute] ?? 0),
  );
}

export function effectiveAttributes(
  state: Pick<CharacterState, "attributes"> & { readonly bonuses?: CharacterState["bonuses"] },
): Record<Attribute, number> {
  return Object.fromEntries(
    (Object.keys(state.attributes) as Attribute[]).map((a) => [a, effectiveAttribute(state, a)]),
  ) as Record<Attribute, number>;
}
