import { z } from "zod";

/** 创伤小组会籍档位；价格和保障范围为本作改编规则。 */
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
/** 最多预付十二期，避免无限叠加期限与升级费用。 */
export const TRAUMA_MAX_PREPAID = 12 * TRAUMA_PERIOD;
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
  lastRescue: z
    .object({
      at: z.number().int(),
      location: z.string().nullable(),
      tier: z.enum(["silver", "platinum"]),
    })
    .nullable()
    .default(null),
});
export type TraumaState = z.infer<typeof TraumaStateSchema>;

/** 模型使用：{"type": "trauma", "action": "join", "tier": "silver", "reason": "..."} */
export const TraumaCommandSchema = z
  .object({
    type: z.literal("trauma"),
    action: z.enum(["join", "renew", "upgrade", "cancel", "rescue"]),
    /** join 时写档位 */
    tier: z.enum(["silver", "platinum"]).optional(),
    reason: z.string().trim().min(1).max(80),
  })
  .refine((c) => c.action !== "join" || c.tier !== undefined, {
    message: "join 要写 tier（silver 或 platinum）",
    path: ["tier"],
  })
  .describe(
    "创伤小组：join 初购（tier 写 silver 或 platinum），renew 同档续期 30 天，upgrade 银卡补差升白金并保留到期时间；金额由代码核价扣款，不另写 trade。cancel 立即退会且不退款；rescue 现场稳定倒下或濒死的有效会员，资格由代码核对，不自动转移地点、结束交火或清除伤口",
  );
export type TraumaCommand = z.infer<typeof TraumaCommandSchema>;
