import { z } from "zod";

/** 固定界面状态条的显示刻度，不是可消费资源。 */
export const HUMANITY_MAX = 100;
export const NeuralStageSchema = z.enum(["stable", "detached", "unstable", "edge", "crisis"]);
export type HumanityStage = z.infer<typeof NeuralStageSchema>;
export const NeuralSymptomSchema = z.object({
  id: z.string().min(1),
  stage: z.enum(["detached", "unstable", "edge", "crisis"]),
  description: z.string().min(1),
  cause: z.string().min(1),
  at: z.number().int(),
});
export type NeuralSymptom = z.infer<typeof NeuralSymptomSchema>;
export const HumanityStateSchema = z.object({
  symptoms: z.array(NeuralSymptomSchema).default([]),
  immunosuppressantUntil: z.number().int().optional(),
  settled: z.array(z.string()).default([]),
});
export type HumanityState = z.infer<typeof HumanityStateSchema>;

export const HumanityCommandSchema = z
  .object({
    type: z.literal("humanity"),
    action: z.enum(["affect", "recover"]),
    id: z.string().min(1).describe("具体症状的稳定 id；恢复时引用已有症状"),
    reason: z.string().min(1),
    stage: z.enum(["detached", "unstable", "edge", "crisis"]).optional(),
    symptom: z.string().min(1).optional(),
    event: z.string().min(1).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.action === "affect" && (!c.stage || !c.symptom))
      ctx.addIssue({ code: "custom", message: "affect 要写 stage 与 symptom（实际症状）" });
  })
  .describe(
    "神经或精神状态事实：affect 记录实际出现的排异、过载、失真、解离等症状（写清 stage 与 symptom、诱因 reason）；recover 记录已有症状经压制外实际治疗、休息、调校、拆件或亲友支持后缓解。不写抽象数值加减，但高压/极限义体负荷在装机排异、连开加速、双中枢并发、激战、重伤或断药时引发的真实生理与精神症状必须如实记账",
  );
export type HumanityCommand = z.infer<typeof HumanityCommandSchema>;
export const SuppressHumanitySchema = z.object({
  type: z.literal("humanity.suppress"),
  durationMinutes: z.number().int().min(30).default(720),
});
export type SuppressHumanity = z.infer<typeof SuppressHumanitySchema>;
