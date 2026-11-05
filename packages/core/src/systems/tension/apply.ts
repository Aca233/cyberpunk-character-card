import { EXPOSURE_LABELS, type ExposureStage, type TensionMode, type TensionState } from "./schema";

const EXPOSURE_ORDER: readonly ExposureStage[] = [
  "hidden",
  "suspicious",
  "compromised",
  "openConflict",
];

export function exposureFromRisk(risk: number): ExposureStage {
  if (risk <= 0) return "hidden";
  if (risk === 1) return "suspicious";
  if (risk === 2 || risk === 3) return "compromised";
  return "openConflict";
}

/**
 * 根据检定或行动结算更新后台黑箱态势（无抽象“打满进度条清盘”，只记录真实暴露度、增援时间与硬件/把柄状态）
 */
export function advanceTension(
  state: TensionState,
  update: {
    readonly mode?: TensionMode;
    readonly riskDelta?: number;
    readonly elapsedMinutes?: number;
    readonly exposeWeakpoint?: string;
    readonly scanChrome?: readonly string[];
    readonly disableChrome?: string;
    readonly triggerBackupInMinutes?: number;
  },
): TensionState {
  const mode = update.mode ?? state.mode;
  const nextRisk = Math.max(0, Math.min(4, state.risk + (update.riskDelta ?? 0)));
  const exposure = exposureFromRisk(nextRisk);

  let backupEta = state.backupEtaMinutes;
  if (update.triggerBackupInMinutes !== undefined && backupEta === null) {
    backupEta = update.triggerBackupInMinutes;
  } else if (exposure === "openConflict" && backupEta === null) {
    backupEta = 4;
  }
  if (backupEta !== null && update.elapsedMinutes && update.elapsedMinutes > 0) {
    backupEta = Math.max(0, backupEta - update.elapsedMinutes);
  }

  const exposedWeakpoints =
    update.exposeWeakpoint && !state.exposedWeakpoints.includes(update.exposeWeakpoint)
      ? [...state.exposedWeakpoints, update.exposeWeakpoint]
      : state.exposedWeakpoints;

  const scannedEnemyChrome = update.scanChrome
    ? [...new Set([...state.scannedEnemyChrome, ...update.scanChrome])]
    : state.scannedEnemyChrome;

  const disabledEnemyChrome =
    update.disableChrome && !state.disabledEnemyChrome.includes(update.disableChrome)
      ? [...state.disabledEnemyChrome, update.disableChrome]
      : state.disabledEnemyChrome;

  return {
    active: true,
    mode,
    exposure,
    risk: nextRisk,
    backupEtaMinutes: backupEta,
    exposedWeakpoints,
    scannedEnemyChrome,
    disabledEnemyChrome,
  };
}

/**
 * 将后台黑箱态势转化为零剧透的【纯感官描写指令】注入叙事提示词（严禁在前台画进度条或倒计时数字）
 */
export function buildTensionSensoryDirective(state: TensionState): string | undefined {
  if (!state.active) return undefined;
  const lines: string[] = [
    `【现场黑箱态势·${EXPOSURE_LABELS[state.exposure]}】（严禁在正文写出数字或进度条，必须全部转化为以下感官细节）：`,
  ];

  switch (state.exposure) {
    case "hidden":
      lines.push(
        "- 环境呼吸平稳：守卫或交谈对象尚未察觉异常，仅描写自然的背景灯光、通风管低鸣或酒杯碰撞声。",
      );
      break;
    case "suspicious":
      lines.push(
        "- 戒心初起：通过微表情与环境细节表现紧绷感——对方停下话头、义眼微距变焦扫视你、保安按住耳麦低声询问，或摄像头转向你的角落。",
      );
      break;
    case "compromised":
      lines.push(
        "- 剑拔弩张：行迹或意图已近败露——对方心率飙升、手已摸向枪套或桌下警报钮，走廊传来急促脚步声，局势一触即发。",
      );
      break;
    case "openConflict":
      lines.push(
        "- 全面撕破脸：警报蜂鸣或枪火已开，红光在走廊频闪，防弹闸门正在落下，必须速战速决或立刻突围。",
      );
      break;
  }

  if (state.backupEtaMinutes !== null) {
    if (state.backupEtaMinutes === 0) {
      lines.push(
        "- 【增援已抵达现场】：电梯叮声打开或远处浮空车探照灯刺破雨幕，武装增援小队已经堵截退路！",
      );
    } else if (state.backupEtaMinutes <= 2) {
      lines.push(
        "- 【增援迫近感官】：街道远处已传来刺耳的警笛声或高速电梯下行的嗡鸣，留给现场处置的时间只剩最后几息。",
      );
    }
  }

  if (state.exposedWeakpoints.length > 0) {
    lines.push(
      `- 【已掌握的真实软肋/突破口】：${state.exposedWeakpoints.join("、")}（玩家若针对此软肋出手，可走通原本无法强攻的物理或交涉路径）。`,
    );
  }

  const activeChrome = state.scannedEnemyChrome.filter(
    (c) => !state.disabledEnemyChrome.includes(c),
  );
  if (activeChrome.length > 0) {
    lines.push(
      `- 【义眼扫描已知敌方配置】：${activeChrome.join("、")}（在交手描写中体现这些硬件带来的真实物理威胁）。`,
    );
  }
  if (state.disabledEnemyChrome.length > 0) {
    lines.push(
      `- 【已瘫痪的敌方硬件】：${state.disabledEnemyChrome.join("、")}（描写其冒出电火花或报错失效）。`,
    );
  }

  return lines.join("\n");
}
