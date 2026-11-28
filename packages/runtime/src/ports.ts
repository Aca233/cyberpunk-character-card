import type { ParsedLog, SaveMeta, Snapshot, Storage } from "@cp/core";
import { z } from "zod";

/**
 * 存储接口：服务器用文件版（file-store.ts、storage.ts），纯前端用 IndexedDB 版。
 * 这个文件和它引用的东西不能依赖 Node，浏览器里也要能用
 */

/**
 * 按路径存取整份文本，路径用 / 分隔，例如 characters/c-1.json、presets/active.json、config.json。
 * 角色卡、预设、模型配置、评测草稿都存在这上面
 */
export interface DocStore {
  /** folder 下一层的文件名（不含目录部分）；目录不存在时返回空数组 */
  list(folder: string): Promise<string[]>;
  /** 没有这个文件时返回 undefined */
  read(path: string): Promise<string | undefined>;
  /** 整份替换，不会留下写到一半的内容；secret 表示里面有密钥，只让当前用户能读 */
  write(path: string, text: string, options?: { readonly secret?: boolean }): Promise<void>;
  /** 删掉了返回 true，本来就没有返回 false */
  remove(path: string): Promise<boolean>;
}

/** 存档：meta、只追加的回合日志、快照 */
export interface SaveStorage extends Storage {
  list(): Promise<string[]>;
  /** 已经有这个存档时抛 SaveExistsError */
  create(id: string, meta: SaveMeta): Promise<void>;
  /** 没有这个存档时抛 SaveNotFoundError */
  readMeta(id: string): Promise<SaveMeta>;
  /** 读取并解析日志；末尾有写到一半的行时截到最后一条完整记录 */
  loadLog(id: string): Promise<ParsedLog>;
  /** 导入新存档：meta、完整日志与快照必须一起提交；失败时不得留下可见的半份存档。 */
  createImported(
    id: string,
    meta: SaveMeta,
    lines: readonly string[],
    snapshot: Snapshot,
  ): Promise<void>;
  /**
   * 写回前的快照核对：确认日志现在正好有 seq 条记录，再追加这一行，核对和追加不可分
   * （IndexedDB 版在同一个事务里做）。条数不对时什么都不写，抛 SaveMovedError；不自动重试
   */
  appendAt(id: string, seq: number, line: string): Promise<void>;
  /** 同一次操作的多条记录：核对版本后全部写入，失败时不留下部分结果。 */
  appendManyAt(id: string, seq: number, lines: readonly string[]): Promise<void>;
  /** 彻底删除整个存档（meta、日志、快照）；删掉了返回 true，本来就没有返回 false */
  remove(id: string): Promise<boolean>;
}

const SAVE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** 快照保留最近 10 个 */
export const SNAPSHOT_KEEP = 10;

/** 读快照时的格式校验；文件版和 IndexedDB 版共用 */
export const SnapshotFileSchema = z.object({
  nextSeq: z.number().int().min(0),
  world: z.object({ time: z.number().int(), slices: z.record(z.string(), z.unknown()) }),
});

export class SaveNotFoundError extends Error {
  override name = "SaveNotFoundError";
}

export class SaveExistsError extends Error {
  override name = "SaveExistsError";
}

/** 写回前核对发现存档在等待期间被改过（记录条数和预期不同）；这一次什么都没写 */
export class SaveMovedError extends Error {
  override name = "SaveMovedError";
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`存档在生成期间被改动（应有 ${expected} 条记录，实际 ${actual} 条），这一轮没有保存`);
  }
}

export function isSaveId(id: string): boolean {
  return SAVE_ID.test(id);
}
