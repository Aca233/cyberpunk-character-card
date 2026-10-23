/** 世界根状态：游戏时间加上每个系统的一块状态，键是系统 id */
export interface WorldState {
  /** 游戏内时间：从 1970-01-01 00:00 起的分钟数，只往前走 */
  readonly time: number;
  readonly slices: Readonly<Record<string, unknown>>;
}

/** 快照：seq 小于 nextSeq 的日志记录都已经算进 world */
export interface Snapshot {
  readonly nextSeq: number;
  readonly world: WorldState;
}
