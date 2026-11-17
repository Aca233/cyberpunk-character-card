import { z } from "zod";

/** 警戒度 0–3：没察觉、起疑、搜索、交战 */
export const ALERT_MAX = 3;
export const ALERT_LABELS = ["没察觉", "起疑", "搜索", "交战"] as const;
export const AlertSiteSchema = z.object({
  level: z.number().int().min(0).max(ALERT_MAX).default(0),
  /** 该地点曾确认的最高警戒，仅供事实回顾，不自动生成警方通报。 */
  peak: z.number().int().min(0).max(ALERT_MAX).default(0),
});
export type AlertSite = z.infer<typeof AlertSiteSchema>;
export const StealthStateSchema = z.object({
  sites: z.record(z.string(), AlertSiteSchema),
});
export type StealthState = z.infer<typeof StealthStateSchema>;

/** 模型使用：{"type": "alert", "delta": 1, "reason": "守卫听见了脚步声"} */
export const AlertCommandSchema = z
  .object({
    type: z.literal("alert"),
    delta: z
      .number()
      .int()
      .min(-ALERT_MAX)
      .max(ALERT_MAX)
      .refine((v) => v !== 0, "警戒变化不能为 0"),
    location: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "实际发生警戒变化的已知地点 id；不写默认本轮行动开始地点，离场不把原现场警戒带到目的地",
      ),
    reason: z.string().trim().min(1),
  })
  .describe(
    "地点警戒事实：delta 为正表示实际察觉、搜索或交火升级；为负表示已发生的停火、排除误报或解除搜索。必须说明现场原因，切场和离开本身不改变警戒，也不自动通知警方",
  );
export type AlertCommand = z.infer<typeof AlertCommandSchema>;
