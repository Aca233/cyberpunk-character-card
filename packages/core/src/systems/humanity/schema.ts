import { z } from "zod";

/** 固定界面状态条的显示刻度，不是可消费资源。 */
export const HUMANITY_MAX = 100;
export const ToleranceSchema = z.enum(["low", "normal", "high"]);
export type Tolerance = z.infer<typeof ToleranceSchema>;
export const TOLERANCE_LABELS: Readonly<Record<Tolerance, string>> = {
  low: "低耐受",
  normal: "普通",
  high: "高耐受",
};
export const TOLERANCE_EFFECTS: Readonly<Record<Tolerance, string>> = {
  low: "神经耐受较低：面对高烈度战斗、连续加速过载、剧痛排异或精神创伤时更易浮现感知失真与神经症状",
  normal: "神经耐受普通：常态下义体同步稳定，持续高压或创伤刺激下仍可能出现神经症状",
  high: "神经耐受较高：对义体排异与高压刺激抗性更强，常规过载不易立刻引发解离或失控",
};
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
  tolerance: ToleranceSchema.default("normal"),
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
    "神经或精神状态事实：affect 记录实际发生的症状、诱因及定性状态；recover 记录已有症状经实际治疗、休息或支持缓解。义体安装、使用次数、残忍行为本身不自动扣人性；不写数值变化",
  );
export type HumanityCommand = z.infer<typeof HumanityCommandSchema>;
export const SetToleranceSchema = z.object({
  type: z.literal("humanity.setTolerance"),
  tolerance: ToleranceSchema,
});
export type SetTolerance = z.infer<typeof SetToleranceSchema>;
export const SuppressHumanitySchema = z.object({
  type: z.literal("humanity.suppress"),
  durationMinutes: z.number().int().min(30).default(720),
});
export type SuppressHumanity = z.infer<typeof SuppressHumanitySchema>;
