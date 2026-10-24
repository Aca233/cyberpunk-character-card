import { z } from "zod";

/** 警戒度 0–3：没察觉、起疑、搜索、交战 */
export const ALERT_MAX = 3;
export const ALERT_LABELS = ["没察觉", "起疑", "搜索", "交战"] as const;
/** 收尾时最高警戒度到这一档，热度加一星 */
export const ALERT_HEAT_LEVEL = 2;

export const StealthStateSchema = z.object({
  /** 警戒度记在哪个场景（world.scene）；换了场景从 0 重新算 */
  scene: z.number().int().min(0).nullable().default(null),
  level: z.number().int().min(0).max(ALERT_MAX).default(0),
  /** 这个场景里到过的最高警戒度；收尾时按它算热度 */
  peak: z.number().int().min(0).max(ALERT_MAX).default(0),
  /** 这个场景已经降过一档 */
  lowered: z.boolean().default(false),
});
export type StealthState = z.infer<typeof StealthStateSchema>;

/** 模型使用：{"type": "alert", "delta": 1, "reason": "守卫听见了脚步声"} */
export const AlertCommandSchema = z
  .object({
    type: z.literal("alert"),
    delta: z
      .number()
      .int()
      .min(-1)
      .max(ALERT_MAX)
      .refine((v) => v !== 0, "警戒变化不能为 0"),
    reason: z.string().min(1),
  })
  .describe(
    "潜入警戒：delta 为正是被察觉（升档），−1 是降一档（躲起来等一阵、处理掉起疑的人、骇掉警报）；每个场景最多降一档，交战档不能再降",
  );
export type AlertCommand = z.infer<typeof AlertCommandSchema>;
