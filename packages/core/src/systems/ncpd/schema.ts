import { z } from "zod";

/** 同时挂着几条警情 */
export const ALERTS_MAX = 3;
/** 隔多久挂一条新的（游戏分钟） */
export const ALERT_INTERVAL = 360;
/** 一条警情挂多久没人管就撤掉 */
export const ALERT_TTL = 1440;
/** NCPD 管不到的城区：狗镇归幽冥犬，恶土在城外 */
export const ALERT_EXCLUDED_DISTRICTS: readonly string[] = ["狗镇", "恶土"];

/** 警情模板：扫描器上能接的街头案子（原作依据 2.0 的 NCPD 扫描器委托；具体情形本作改编） */
export const AlertTemplateSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().min(1),
  /** 给叙事模型的一句话：现场是什么情况 */
  note: z.string().min(1),
  /** 只在这些城区出现；不写是 NCPD 管得到的全城 */
  districts: z.array(z.string().min(1)).min(1).optional(),
  /** 处理完 NCPD 给的赏金（欧元） */
  reward: z.number().int().min(0).max(5000),
  /** 危险程度 1–3 */
  risk: z.number().int().min(1).max(3),
  weight: z.number().min(0).default(1),
});
export type AlertTemplate = z.infer<typeof AlertTemplateSchema>;
export const AlertCatalogSchema = z.array(AlertTemplateSchema);

export const AlertSchema = z.object({
  id: z.string().min(1),
  template: z.string().min(1),
  label: z.string().min(1),
  note: z.string().min(1),
  district: z.string().min(1),
  /** 出事的地点 id */
  location: z.string().min(1),
  reward: z.number().int(),
  risk: z.number().int(),
  postedAt: z.number().int(),
  expiresAt: z.number().int(),
});
export type Alert = z.infer<typeof AlertSchema>;

export const NcpdStateSchema = z.object({
  alerts: z.array(AlertSchema).default([]),
  lastPostedAt: z.number().int().nullable().default(null),
  nextId: z.number().int().min(1).default(1),
  /** 处理过几条 */
  cleared: z.number().int().min(0).default(0),
});
export type NcpdState = z.infer<typeof NcpdStateSchema>;

/** 模型使用：{"type": "ncpd", "action": "clear", "id": "ncpd-3", "reason": "..."} */
export const NcpdCommandSchema = z
  .object({
    type: z.literal("ncpd"),
    action: z.enum(["clear", "drop"]),
    id: z.string().min(1),
    reason: z.string().trim().min(1).max(80),
  })
  .describe(
    "NCPD 警情：clear 是在现场把事处理完了（本轮检定没失败），代码发赏金、警方热度降一星；drop 是搞砸了或者放弃了，警情撤掉、不给钱",
  );
export type NcpdCommand = z.infer<typeof NcpdCommandSchema>;
