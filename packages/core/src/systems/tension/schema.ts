import { z } from "zod";

/**
 * 现场物理危局类别（潜行渗透、正面交火、公司对峙、贴身套话、追车、深层潜网）
 */
export const TensionModeSchema = z.enum([
  "stealth",
  "firefight",
  "boardroom",
  "honeytrap",
  "chase",
  "deepDive",
]);
export type TensionMode = z.infer<typeof TensionModeSchema>;

/**
 * 现场态势性质（客观事实描述，不作为游戏警戒进度条）：
 * - hidden：尚未察觉异常，各忙各的
 * - suspicious：对方或现场起疑、提高戒备
 * - compromised：已经暴露或撕破脸对峙
 * - openConflict：已全面动手交火或警报触发
 */
export const ExposureStageSchema = z.enum(["hidden", "suspicious", "compromised", "openConflict"]);
export type ExposureStage = z.infer<typeof ExposureStageSchema>;

export const EXPOSURE_LABELS: Readonly<Record<ExposureStage, string>> = {
  hidden: "正常未起疑",
  suspicious: "已有戒心或异动",
  compromised: "现场暴露对峙",
  openConflict: "已全面动手冲突",
};

/**
 * 现场持续物理危机状态：只记客观硬件损耗、增援距离与已露出的突破口，不输出游戏条框与套话模板
 */
export const TensionStateSchema = z.object({
  active: z.boolean().default(false),
  mode: TensionModeSchema.default("stealth"),
  exposure: ExposureStageSchema.default("hidden"),
  /** 历史存档兼容字段，不再用于数学升级 */
  risk: z.number().int().min(0).max(4).optional(),
  /** 安保/NCPD/快速反应力量大约还要几分钟赶到；null 表示尚未呼叫增援 */
  backupEtaMinutes: z.number().int().min(0).nullable().default(null),
  /** 通过侦查、扫描或交谈摸清的真实物理弱点或门路 */
  exposedWeakpoints: z.array(z.string()).default([]),
  /** 已看穿或扫描到的对方真实义体与安保硬件 */
  scannedEnemyChrome: z.array(z.string()).default([]),
  /** 已被 EMP、断电、破坏或烧毁失灵的敌方义体与安保硬件 */
  disabledEnemyChrome: z.array(z.string()).default([]),
});
export type TensionState = z.infer<typeof TensionStateSchema>;

export const TensionCommandSchema = z
  .object({
    type: z.literal("tension"),
    active: z
      .boolean()
      .optional()
      .describe("本场是否进入或结束持续物理危局（潜行/交火/对峙/追逐/潜网）"),
    mode: TensionModeSchema.optional(),
    exposure: ExposureStageSchema.optional(),
    exposeWeakpoint: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .describe("玩家摸清、侦查或交涉套出的真实物理弱点或门路"),
    scanChrome: z
      .array(z.string().trim().min(1).max(40))
      .max(6)
      .optional()
      .describe("刚扫描或看穿的敌方义体与安保硬件"),
    disableChrome: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .optional()
      .describe("已被破坏、EMP 烧毁或切断失灵的敌方义体与安保硬件"),
    triggerBackupInMinutes: z
      .number()
      .int()
      .min(1)
      .max(120)
      .optional()
      .describe("对方刚呼叫增援，大约多少分钟后赶到"),
  })
  .describe("现场局势物理追踪：只记客观硬件损耗、增援距离、已露出弱点与暴露状态；不作任何数值加成");
export type TensionCommand = z.infer<typeof TensionCommandSchema>;
