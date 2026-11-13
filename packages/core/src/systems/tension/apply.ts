import { EXPOSURE_LABELS, type ExposureStage, type TensionMode, type TensionState } from "./schema";

/**
 * 按客观现场变化更新物理危机记录（不再累加 0..4 进度条数字）
 */
export function advanceTension(
  state: TensionState,
  update: {
    readonly mode?: TensionMode;
    readonly exposure?: ExposureStage;
    readonly elapsedMinutes?: number;
    readonly exposeWeakpoint?: string;
    readonly scanChrome?: readonly string[];
    readonly disableChrome?: string;
    readonly triggerBackupInMinutes?: number;
  },
): TensionState {
  const mode = update.mode ?? state.mode;
  const exposure = update.exposure ?? state.exposure;

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
    backupEtaMinutes: backupEta,
    exposedWeakpoints,
    scannedEnemyChrome,
    disabledEnemyChrome,
  };
}

/**
 * 提炼为干练、零八股套话的客观现场事实简报（供裁决与正文按真实因果吸收，绝不强塞模板形容）
 */
export function tensionFacts(state: TensionState): string | undefined {
  if (!state.active) return undefined;
  const lines: string[] = [`现场处境：${EXPOSURE_LABELS[state.exposure]}`];

  if (state.backupEtaMinutes !== null) {
    lines.push(
      state.backupEtaMinutes === 0
        ? "外部增援或巡逻力量已到门口附近"
        : `外部增援大约还差几分钟赶到（约 ${state.backupEtaMinutes} 分钟）`,
    );
  }

  if (state.exposedWeakpoints.length > 0) {
    lines.push(`已知可利用的物理破绽或门路：${state.exposedWeakpoints.join("、")}`);
  }

  const activeChrome = state.scannedEnemyChrome.filter(
    (c) => !state.disabledEnemyChrome.includes(c),
  );
  if (activeChrome.length > 0) {
    lines.push(`对方目前正常运作中的硬件/义体：${activeChrome.join("、")}`);
  }
  if (state.disabledEnemyChrome.length > 0) {
    lines.push(`对方已受损或瘫痪失效的硬件/义体：${state.disabledEnemyChrome.join("、")}`);
  }

  return lines.join("；");
}
