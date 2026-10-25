import { z } from "zod";

/** 会籍档位（原作依据 2.1 的创伤小组银卡、白金卡；价格和规则本作改编，待核对） */
export const TraumaTierSchema = z.enum(["none", "silver", "platinum"]);
export type TraumaTier = z.infer<typeof TraumaTierSchema>;
export const TRAUMA_TIER_LABELS: Readonly<Record<TraumaTier, string>> = {
  none: "没有会籍",
  silver: "银卡",
  platinum: "白金卡",
};
/** 每期的价钱（欧元） */
export const TRAUMA_PRICES: Readonly<Record<Exclude<TraumaTier, "none">, number>> = {
  silver: 1000,
  platinum: 5000,
};
/** 一期多长（游戏分钟）：30 天 */
export const TRAUMA_PERIOD = 30 * 1440;
/** 创伤小组不进的城区 */
export const TRAUMA_EXCLUDED_DISTRICTS: readonly string[] = ["恶土", "狗镇"];
/** 警方热度到这么多星（暴恐机动队出动）时创伤小组不来 */
export const TRAUMA_MAXTAC_STARS = 5;

export const TraumaStateSchema = z.object({
  tier: TraumaTierSchema.default("none"),
  /** 这一期到什么时候；没有会籍为 null */
  paidUntil: z.number().int().nullable().default(null),
  /** 上一期过期的时间，提醒用 */
  lapsedAt: z.number().int().nullable().default(null),
  rescues: z.number().int().min(0).default(0),
});
export type TraumaState = z.infer<typeof TraumaStateSchema>;

/** 模型使用：{"type": "trauma", "action": "join", "tier": "silver", "reason": "..."} */
export const TraumaCommandSchema = z
  .object({
    type: z.literal("trauma"),
    action: z.enum(["join", "cancel", "rescue"]),
    /** join 时写档位 */
    tier: z.enum(["silver", "platinum"]).optional(),
    reason: z.string().trim().min(1).max(80),
  })
  .refine((c) => c.action !== "join" || c.tier !== undefined, {
    message: "join 要写 tier（silver 或 platinum）",
    path: ["tier"],
  })
  .describe(
    "创伤小组：join 是玩家买了一期会籍（tier 写 silver 或 platinum，代码扣钱，期限 30 天）；cancel 是退掉；rescue 是创伤小组赶到把倒下或濒死的角色救了回来，能不能来由代码核对",
  );
export type TraumaCommand = z.infer<typeof TraumaCommandSchema>;
