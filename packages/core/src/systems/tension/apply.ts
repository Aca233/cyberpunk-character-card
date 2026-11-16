import { EXPOSURE_LABELS, type ExposureStage, type TensionMode, type TensionSite } from "./schema";

/**
 * 按客观现场变化更新物理危机记录（不再累加 0..4 进度条数字）
 */
export function advanceTension(
  state: TensionSite,
  update: {
    readonly mode?: TensionMode | undefined;
    readonly exposure?: ExposureStage | undefined;
    readonly elapsedMinutes?: number | undefined;
    readonly exposeWeakpoint?: string | undefined;
    readonly scanChrome?: readonly string[] | undefined;
    readonly disableChrome?: string | undefined;
    readonly triggerBackupInMinutes?: number | undefined;
    readonly backupCause?: string | undefined;
    readonly cancelBackupReason?: string | undefined;
    readonly backupArrived?: boolean | undefined;
    readonly repairChrome?: string | undefined;
  },
): TensionSite {
  const mode = update.mode ?? state.mode;
  const exposure = update.exposure ?? state.exposure;

  let backupEta = state.backupEtaMinutes;
  if (update.triggerBackupInMinutes !== undefined && update.backupCause) {
    backupEta = update.triggerBackupInMinutes;
  }
  if (update.cancelBackupReason) backupEta = null;
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
    ...state,
    active: true,
    mode,
    exposure,
    backupEtaMinutes: backupEta,
    backupCause: update.cancelBackupReason ? null : (update.backupCause ?? state.backupCause),
    backupArrived: update.cancelBackupReason
      ? false
      : (update.backupArrived ??
        (update.triggerBackupInMinutes !== undefined ? false : state.backupArrived)),
    exposedWeakpoints,
    scannedEnemyChrome,
    disabledEnemyChrome: disabledEnemyChrome.filter((chrome) => chrome !== update.repairChrome),
  };
}

/**
 * 提炼为干练、零八股套话的客观现场事实简报（供裁决与正文按真实因果吸收，绝不强塞模板形容）
 */
export function tensionFacts(state: TensionSite): string | undefined {
  if (
    !state.active &&
    !state.disabledEnemyChrome.length &&
    state.backupEtaMinutes === null &&
    !state.backupArrived
  )
    return undefined;
  const lines: string[] = [`现场处境：${EXPOSURE_LABELS[state.exposure]}`];

  if (state.backupArrived || state.backupEtaMinutes !== null) {
    lines.push(
      state.backupArrived
        ? "已确认增援到达"
        : state.backupEtaMinutes === 0
          ? "已到预计增援时间，尚未确认到达；根据通信、路线和实际发生的事件判断"
          : `外部增援大约还差几分钟赶到（约 ${state.backupEtaMinutes} 分钟）`,
    );
  }

  if (state.backupCause) lines.push(`增援依据：${state.backupCause}`);

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
