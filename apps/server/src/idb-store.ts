import { type ParsedLog, parseLog, type SaveMeta, SaveMetaSchema, type Snapshot } from "@cp/core";
import {
  type DocStore,
  isSaveId,
  SaveExistsError,
  SaveMovedError,
  SaveNotFoundError,
  type SaveStorage,
  SNAPSHOT_KEEP,
  SnapshotFileSchema,
} from "./ports";

/**
 * IndexedDB 版存储：纯前端（静态网站）用，角色卡、预设、模型配置和存档都存在浏览器里。
 * 不依赖 Node；测试里用 fake-indexeddb。
 * 每次读写都在一个事务里，等事务 complete 才返回：返回了就是真的写进去了，出错时整个事务作废、什么都不留
 */

export const DB_NAME = "cyberpunk-character-card";
const DB_VERSION = 1;
/** 整份文本，键是路径（characters/c-1.json、presets/active.json、config.json） */
const DOCS = "docs";
/** 存档的 meta，键是存档 id，值是 JSON 文本 */
const METAS = "metas";
/** 回合日志，键是 [存档 id, seq]，值是一整行（带换行） */
const LOG = "log";
/** 快照，键是 [存档 id, nextSeq]，值是 JSON 文本 */
const SNAPSHOTS = "snapshots";
const STORES = [DOCS, METAS, LOG, SNAPSHOTS] as const;

export function openGameDb(
  name = DB_NAME,
  factory: IDBFactory = globalThis.indexedDB,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // 别的标签页要升级数据库时先让开，免得把它卡住
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("打不开浏览器存储（IndexedDB）"));
  });
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("浏览器存储读写失败"));
  });
}

/**
 * 在一个事务里跑 body，等事务 complete 才返回结果。
 * body 抛错时中止事务（已经发出的写入全部作废）再把错误抛出去；不自动重试
 */
async function inTx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(stores, mode);
  const finished = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("浏览器存储写入失败"));
    tx.onabort = () => reject(tx.error ?? new Error("浏览器存储的事务被中止"));
  });
  // 先挂上处理，免得 body 出错中止事务时报未处理的拒绝；真正的结果在下面 await
  finished.catch(() => undefined);
  let result: T;
  try {
    result = await body(tx);
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // 事务已经结束了
    }
    throw error;
  }
  await finished;
  return result;
}

function checkPath(path: string): string {
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.includes("\\"))) {
    throw new Error(`路径不合法：${path}`);
  }
  return path;
}

function checkLine(line: string): void {
  if (!line.endsWith("\n") || line.indexOf("\n") !== line.length - 1) {
    throw new Error("每次只能追加一行完整的记录");
  }
}

/** 一个存档的全部日志行或快照：键 [id, 0] 到 [id, ∞] */
const saveRange = (id: string) => IDBKeyRange.bound([id, 0], [id, Number.POSITIVE_INFINITY]);

/** 角色卡、预设、模型配置、评测草稿：按路径存整份文本 */
export class IdbDocStore implements DocStore {
  constructor(private readonly db: IDBDatabase) {}

  async list(folder: string): Promise<string[]> {
    const prefix = `${checkPath(folder)}/`;
    const keys = await inTx(this.db, [DOCS], "readonly", (tx) =>
      req(tx.objectStore(DOCS).getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`))),
    );
    return keys
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.slice(prefix.length))
      .filter((name) => name !== "" && !name.includes("/"))
      .sort();
  }

  async read(path: string): Promise<string | undefined> {
    checkPath(path);
    const value: unknown = await inTx(this.db, [DOCS], "readonly", (tx) =>
      req(tx.objectStore(DOCS).get(path)),
    );
    return typeof value === "string" ? value : undefined;
  }

  /** 浏览器里没有文件权限这回事；带密钥的内容（模型配置）只存在这个网站自己的存储里 */
  async write(path: string, text: string, _options?: { readonly secret?: boolean }): Promise<void> {
    checkPath(path);
    await inTx(this.db, [DOCS], "readwrite", async (tx) => {
      await req(tx.objectStore(DOCS).put(text, path));
    });
  }

  async remove(path: string): Promise<boolean> {
    checkPath(path);
    return inTx(this.db, [DOCS], "readwrite", async (tx) => {
      const store = tx.objectStore(DOCS);
      if ((await req(store.count(path))) === 0) return false;
      await req(store.delete(path));
      return true;
    });
  }
}

/** 存档：meta、只追加的回合日志、快照。日志行的 seq 总是从 0 连续往上，所以条数就是下一条的 seq */
export class IdbSaveStore implements SaveStorage {
  constructor(private readonly db: IDBDatabase) {}

  async list(): Promise<string[]> {
    const keys = await inTx(this.db, [METAS], "readonly", (tx) =>
      req(tx.objectStore(METAS).getAllKeys()),
    );
    return keys.filter((k): k is string => typeof k === "string" && isSaveId(k)).sort();
  }

  async create(id: string, meta: SaveMeta): Promise<void> {
    checkSaveId(id);
    const body = `${JSON.stringify(SaveMetaSchema.parse(meta), null, 2)}\n`;
    await inTx(this.db, [METAS, LOG, SNAPSHOTS], "readwrite", async (tx) => {
      const metas = tx.objectStore(METAS);
      if ((await req(metas.count(id))) > 0) throw new SaveExistsError(`存档已存在：${id}`);
      // 万一有以前留下的同名日志或快照，一起清掉，新存档从空日志开始
      tx.objectStore(LOG).delete(saveRange(id));
      tx.objectStore(SNAPSHOTS).delete(saveRange(id));
      await req(metas.add(body, id));
    });
  }

  async readMeta(id: string): Promise<SaveMeta> {
    checkSaveId(id);
    const text: unknown = await inTx(this.db, [METAS], "readonly", (tx) =>
      req(tx.objectStore(METAS).get(id)),
    );
    if (typeof text !== "string") throw new SaveNotFoundError(`没有这个存档：${id}`);
    return SaveMetaSchema.parse(JSON.parse(text));
  }

  async readLog(id: string): Promise<string> {
    checkSaveId(id);
    const rows = await inTx(this.db, [METAS, LOG], "readonly", async (tx) => {
      await requireMeta(tx, id);
      return req(tx.objectStore(LOG).getAll(saveRange(id)));
    });
    return rows.map(String).join("");
  }

  /** 追加一整行；调用方负责持有存档锁 */
  appendLog(id: string, line: string): Promise<void> {
    return this.append(id, [line]);
  }

  /** 写回前的快照核对：数条数和追加在同一个事务里，条数不对时抛 SaveMovedError、什么都不写 */
  appendAt(id: string, seq: number, line: string): Promise<void> {
    return this.append(id, [line], seq);
  }

  appendManyAt(id: string, seq: number, lines: readonly string[]): Promise<void> {
    return this.append(id, lines, seq);
  }

  private async append(id: string, lines: readonly string[], expected?: number): Promise<void> {
    checkSaveId(id);
    for (const line of lines) checkLine(line);
    await inTx(this.db, [METAS, LOG], "readwrite", async (tx) => {
      await requireMeta(tx, id);
      const log = tx.objectStore(LOG);
      const count = await req(log.count(saveRange(id)));
      if (expected !== undefined && count !== expected) throw new SaveMovedError(expected, count);
      for (const [offset, line] of lines.entries()) {
        await req(log.add(line, [id, count + offset]));
      }
    });
  }

  /** 导入存档：一次写下整份日志（调用方已经逐行校验过，存档是刚建的空档） */
  async importLog(id: string, text: string): Promise<void> {
    checkSaveId(id);
    if (text !== "" && !text.endsWith("\n")) throw new Error("导入的日志最后一行不完整");
    const lines = text === "" ? [] : text.slice(0, -1).split("\n");
    await inTx(this.db, [METAS, LOG], "readwrite", async (tx) => {
      await requireMeta(tx, id);
      const log = tx.objectStore(LOG);
      log.delete(saveRange(id));
      // 不逐条等：任何一条失败都会中止整个事务，inTx 等 complete 时会报出来
      for (const [seq, line] of lines.entries()) log.add(`${line}\n`, [id, seq]);
    });
  }

  /** 每行都是整行写进去的，不会有写到一半的尾巴 */
  async loadLog(id: string): Promise<ParsedLog> {
    return parseLog(await this.readLog(id));
  }

  /** 读出所有能解析的快照；坏掉的快照跳过，日志才是准的 */
  async readSnapshots(id: string): Promise<readonly Snapshot[]> {
    checkSaveId(id);
    const rows = await inTx(this.db, [SNAPSHOTS], "readonly", (tx) =>
      req(tx.objectStore(SNAPSHOTS).getAll(saveRange(id))),
    );
    const snapshots: Snapshot[] = [];
    for (const row of rows) {
      try {
        snapshots.push(SnapshotFileSchema.parse(JSON.parse(String(row))));
      } catch {
        // 快照只是加速用的缓存，坏了就从更早的快照或从头重放
      }
    }
    return snapshots.sort((a, b) => a.nextSeq - b.nextSeq);
  }

  async writeSnapshot(id: string, snapshot: Snapshot): Promise<void> {
    checkSaveId(id);
    await inTx(this.db, [METAS, SNAPSHOTS], "readwrite", async (tx) => {
      await requireMeta(tx, id);
      const store = tx.objectStore(SNAPSHOTS);
      await req(store.put(JSON.stringify(snapshot), [id, snapshot.nextSeq]));
      // 键按 nextSeq 从小到大排，只留最近 SNAPSHOT_KEEP 个
      const keys = await req(store.getAllKeys(saveRange(id)));
      for (const old of keys.slice(0, Math.max(0, keys.length - SNAPSHOT_KEEP))) store.delete(old);
    });
  }
}

function checkSaveId(id: string): void {
  if (!isSaveId(id)) throw new Error(`存档 id 不合法：${id}`);
}

async function requireMeta(tx: IDBTransaction, id: string): Promise<void> {
  if ((await req(tx.objectStore(METAS).count(id))) === 0) {
    throw new SaveNotFoundError(`没有这个存档：${id}`);
  }
}
