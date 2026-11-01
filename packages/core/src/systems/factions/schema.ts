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

// 势力动向的到点掷骰、拖住和打断的时长删了，并进【城里在发酵的事】
// （用户 2026-11-01 定的「全改」第 4 步：模型当主持人，代码只管记账）

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

/** 地盘账里的一笔：哪件事带来的、玩家听说了没有 */
export const TurfRecordSchema = TurfChangeSchema.extend({
  at: z.number().int(),
  /** 【城里在发酵的事】里那件事的 id */
  thread: z.string().min(1),
  told: z.boolean().default(false),
});
export type TurfRecord = z.infer<typeof TurfRecordSchema>;

/** 只记变过的势力；没变过的按势力卡的 initial；地盘只记变过的几笔 */
export const FactionsStateSchema = z.object({
  stances: z.record(z.string(), FactionStanceSchema).default({}),
  turf: z.array(TurfRecordSchema).default([]),
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

/** 只由【城里在发酵的事】发出：那边核对过的一笔地盘变化 */
export const FactionTurfSchema = TurfChangeSchema.extend({
  type: z.literal("faction.turf"),
  thread: z.string().min(1),
});
export type FactionTurf = z.infer<typeof FactionTurfSchema>;

/** 只由【城里在发酵的事】发出：那件事传到玩家耳朵里了，它带来的地盘变化也算听说了 */
export const FactionTurfToldSchema = z.object({
  type: z.literal("faction.turfTold"),
  thread: z.string().min(1),
});
export type FactionTurfTold = z.infer<typeof FactionTurfToldSchema>;

export type FactionsCommand = FactionCommand;
/** 模型不能直接写 */
export type FactionsInternal = FactionTurf | FactionTurfTold;
