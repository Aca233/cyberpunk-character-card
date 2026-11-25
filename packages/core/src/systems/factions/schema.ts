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

/** 大势力内部派系定义：绑定真实领袖/骨干 NPC id（第一条为默认初始掌权派） */
export const FactionWingDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "派系 id 用小写英文、数字和连字符"),
  name: z.string().min(1),
  style: z.string().min(1),
  /** 关联的原作核心领袖与骨干 NPC id 列表（首位视为默认主领袖） */
  leaders: z.array(z.string().min(1)).default([]),
});
export type FactionWingDef = z.infer<typeof FactionWingDefSchema>;

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
  /** 内部派系（可选，主要大势力配 2 条路线） */
  wings: z.array(FactionWingDefSchema).default([]),
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

/** 帮规污点上限：满 3 笔自动除名并触发清理门户 */
export const MAX_FACTION_STRIKES = 3;

export const FactionStrikeSchema = z.object({
  at: z.number().int(),
  reason: z.string().trim().min(1).max(80),
  /** 记账或追责的具体 NPC id（可选） */
  byNpc: z.string().min(1).optional(),
});
export type FactionStrike = z.infer<typeof FactionStrikeSchema>;

/** 玩家正式隶属的势力身份（同时最多隶属一个组织，可选靠山与污点账本） */
export const FactionMembershipSchema = z.object({
  faction: z.string().min(1),
  rank: z.string().trim().min(1).max(24),
  joinedAt: z.number().int(),
  note: z.string().trim().min(1).max(80),
  /** 可选引荐人/靠山 NPC id（不强制同势力） */
  sponsor: z.string().min(1).optional(),
  /** 靠山是否在入帮后身亡（由 npc.died 自动置位） */
  sponsorLost: z.boolean().default(false),
  /** 帮规污点（0-3，满 3 笔自动除名并触发清理门户） */
  strikes: z.array(FactionStrikeSchema).default([]),
});
export type FactionMembership = z.infer<typeof FactionMembershipSchema>;

export const FACTION_DEFAULT_RANKS: Readonly<Record<FactionKind, string>> = {
  gang: "正式成员",
  corp: "外勤专员",
  law: "编外干员",
  service: "签约成员",
};

/** 某势力内部派系的动态掌权与站队账本 */
export const FactionWingStateSchema = z.object({
  /** 当前掌权派系 id */
  ruling: z.string().min(1),
  /** 当前掌权派系的领头 NPC id（可为原作领袖或剧情新推举人物） */
  leaderNpc: z.string().min(1).optional(),
  /** 当前掌权派领袖是否阵亡、处于权力真空/内乱期 */
  vacant: z.boolean().default(false),
  /** 玩家当前站队的派系 id（可不入帮也站队） */
  playerSide: z.string().min(1).optional(),
  note: z.string().trim().min(1).max(80),
  at: z.number().int(),
});
export type FactionWingState = z.infer<typeof FactionWingStateSchema>;

/** 处于「火拼争夺中」的城区地盘态势 */
export const ContestedDistrictSchema = z.object({
  district: z.string().min(1),
  /** 卷入火拼/争夺的势力 id 列表 */
  factions: z.array(z.string().min(1)).default([]),
  reason: z.string().trim().min(1).max(80),
  /** 触发或坐镇的关键 NPC id（可选） */
  leadNpc: z.string().min(1).optional(),
  at: z.number().int(),
});
export type ContestedDistrict = z.infer<typeof ContestedDistrictSchema>;

/** 只记变过的势力；没变过的按势力卡的 initial；地盘、派系掌权与争夺区按实际发生记录 */
export const FactionsStateSchema = z.object({
  stances: z.record(z.string(), FactionStanceSchema).default({}),
  turf: z.array(TurfRecordSchema).default([]),
  membership: FactionMembershipSchema.nullable().default(null),
  wings: z.record(z.string(), FactionWingStateSchema).default({}),
  contested: z.record(z.string(), ContestedDistrictSchema).default({}),
});
export type FactionsState = z.infer<typeof FactionsStateSchema>;

export const FactionActionSchema = z.enum([
  "stance",
  "join",
  "rank",
  "leave",
  "strike",
  "clearStrike",
  "wing",
  "turf",
]);
export type FactionAction = z.infer<typeof FactionActionSchema>;

/** 模型使用：改态度 / 入帮晋升脱离 / 帮规污点 / 内部派系站队与政变 / 主动地盘争夺 */
export const FactionCommandSchema = z
  .object({
    type: z.literal("faction"),
    action: FactionActionSchema.default("stance"),
    id: z.string().min(1),
    attitude: AttitudeSchema.optional(),
    rank: z.string().trim().min(1).max(24).optional(),
    betrayal: z.boolean().optional(),
    sponsor: z.string().min(1).optional(),
    byNpc: z.string().min(1).optional(),
    wing: z.string().min(1).optional(),
    ruling: z.string().min(1).optional(),
    leaderNpc: z.string().min(1).optional(),
    district: z.string().min(1).optional(),
    turfChange: z.enum(["contest", "gain", "lose"]).optional(),
    rival: z.string().min(1).optional(),
    leadNpc: z.string().min(1).optional(),
    reason: z.string().trim().min(1).max(80),
  })
  .describe(
    "势力态度、成员归属、帮规、内部派系与地盘争夺：默认 action:'stance'（改态度，须填 attitude：kos/hostile/neutral/friendly/family，一次最多变两档）；入帮/入职写 action:'join'（非敌对即可，可带 rank 与引荐人 sponsor NPC id）；晋升写 action:'rank'；退帮/叛帮写 action:'leave'（叛变加 betrayal:true）；触犯帮规记污点写 action:'strike'（满 3 笔自动除名清理门户，可带追责人 byNpc），立功销污点写 action:'clearStrike'；站队内部派系或扶持新派掌权写 action:'wing'（传 wing 和/或 ruling + 活着的 leaderNpc）；玩家主动抢地盘/打成火拼争夺写 action:'turf'（传 district、turfChange:'contest'|'gain'|'lose'，可带 rival 与关键人物 leadNpc）。reason 写凭哪件事",
  );
export type FactionCommand = z.infer<typeof FactionCommandSchema>;

/** 仅由建档初始化发出：按角色出身写入开局初始势力态度，不触发对头连带降档 */
export const FactionSeedSchema = z.object({
  type: z.literal("faction.seed"),
  id: z.string().min(1),
  attitude: AttitudeSchema,
  reason: z.string().trim().min(1).max(80),
});
export type FactionSeed = z.infer<typeof FactionSeedSchema>;

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
export type FactionsInternal = FactionSeed | FactionTurf | FactionTurfTold;
