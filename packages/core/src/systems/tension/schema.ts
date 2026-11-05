import { z } from "zod";

/**
 * 3.0 黑箱冲突与现场态势类别：
 * 潜行渗透、正面交火、企业谈判/审计交锋、枕边套话/暗杀、飞车追逐、深层潜网
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
 * 现场暴露与戒备状态（替代出戏的数字进度条）：
 * - hidden：隐蔽/未起疑（对方毫无察觉或处于正常社交状态）
 * - suspicious：起疑/戒备（保安开始巡检异响、交谈对象眼神闪烁起了戒心、子网流量异常）
 * - compromised：败露/对峙（监控拍到身影、对方手按武器或准备呼叫保安、追踪程序锁定扇区）
 * - openConflict：全面交火/警报拉响（枪声大作、安保封锁大厦、暴恐机动队/创伤小组或黑冰全面扑杀）
 */
export const ExposureStageSchema = z.enum(["hidden", "suspicious", "compromised", "openConflict"]);
export type ExposureStage = z.infer<typeof ExposureStageSchema>;

export const EXPOSURE_LABELS: Readonly<Record<ExposureStage, string>> = {
  hidden: "隐蔽自然",
  suspicious: "引起警觉",
  compromised: "行迹败露",
  openConflict: "全面冲突",
};

/**
 * 后台黑箱态势机状态（前台零进度条 UI，仅向叙事模型输出感官化描写指令）
 */
export const TensionStateSchema = z.object({
  active: z.boolean().default(false),
  mode: TensionModeSchema.default("stealth"),
  exposure: ExposureStageSchema.default("hidden"),
  /** 后台风险累积（0..4），用于驱动暴露状态升级 */
  risk: z.number().int().min(0).max(4).default(0),
  /** 安保/NCPD/企业快速反应部队抵达剩余分钟数；null 表示尚未触发增援呼叫 */
  backupEtaMinutes: z.number().int().min(0).nullable().default(null),
  /** 已通过扫描、调查或套话摸清的目标真实弱点/把柄（打开原本走不通的物理或社交路径） */
  exposedWeakpoints: z.array(z.string()).default([]),
  /** 已通过义眼扫描或情报看穿的敌方真实义体与安保硬件（如斯安威斯坦、皮下重甲、心率创伤呼救器） */
  scannedEnemyChrome: z.array(z.string()).default([]),
  /** 已被 EMP、黑客或物理破坏废掉的敌方义体/安保硬件 */
  disabledEnemyChrome: z.array(z.string()).default([]),
});
export type TensionState = z.infer<typeof TensionStateSchema>;
