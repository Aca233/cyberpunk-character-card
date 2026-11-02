import type { ParsedLog, SaveMeta, Storage } from "@cp/core";

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
  /** 导入存档：一次写下整份日志（调用方已经逐行校验过，存档是刚建的空档） */
  importLog(id: string, text: string): Promise<void>;
}

const SAVE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** 快照保留最近 10 个 */
export const SNAPSHOT_KEEP = 10;

export class SaveNotFoundError extends Error {
  override name = "SaveNotFoundError";
}

export class SaveExistsError extends Error {
  override name = "SaveExistsError";
}

export function isSaveId(id: string): boolean {
  return SAVE_ID.test(id);
}
