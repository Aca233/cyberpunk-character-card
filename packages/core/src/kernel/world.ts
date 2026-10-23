/** 世界根状态：每个系统一块，键是系统 id */
export interface WorldState {
  readonly slices: Readonly<Record<string, unknown>>;
}

/** 快照：seq 小于 nextSeq 的日志记录都已经算进 world */
export interface Snapshot {
  readonly nextSeq: number;
  readonly world: WorldState;
}
