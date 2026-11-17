import { mkdir, open, readdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ParsedLog, parseLog, type SaveMeta, SaveMetaSchema, type Snapshot } from "@cp/core";
import { atomicWrite, hasCode, isNotFound } from "./fsutil";
import {
  isSaveId,
  SaveExistsError,
  SaveMovedError,
  SaveNotFoundError,
  type SaveStorage,
  SNAPSHOT_KEEP,
  SnapshotFileSchema,
} from "./ports";

const SNAPSHOT_FILE = /^\d{8}\.json$/;

/** 文件版存档：data/saves/<id>/ 下的 meta.json、turns.jsonl、snapshots/ */
export class SaveStore implements SaveStorage {
  constructor(private readonly root: string) {}

  private dir(id: string): string {
    if (!isSaveId(id)) throw new Error(`存档 id 不合法：${id}`);
    return join(this.root, "saves", id);
  }

  private logPath(id: string): string {
    return join(this.dir(id), "turns.jsonl");
  }

  private snapshotDir(id: string): string {
    return join(this.dir(id), "snapshots");
  }

  async list(): Promise<string[]> {
    try {
      const entries = await readdir(join(this.root, "saves"), { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && isSaveId(e.name))
        .map((e) => e.name)
        .sort();
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async create(id: string, meta: SaveMeta): Promise<void> {
    const dir = this.dir(id);
    await mkdir(join(this.root, "saves"), { recursive: true });
    try {
      await mkdir(dir);
    } catch (error) {
      if (hasCode(error, "EEXIST")) throw new SaveExistsError(`存档已存在：${id}`);
      throw error;
    }
    await mkdir(this.snapshotDir(id));
    const body = `${JSON.stringify(SaveMetaSchema.parse(meta), null, 2)}\n`;
    await atomicWrite(join(dir, "meta.json"), body);
    await writeFile(this.logPath(id), "", { flag: "wx" });
  }

  async readMeta(id: string): Promise<SaveMeta> {
    let text: string;
    try {
      text = await readFile(join(this.dir(id), "meta.json"), "utf8");
    } catch (error) {
      if (isNotFound(error)) throw new SaveNotFoundError(`没有这个存档：${id}`);
      throw error;
    }
    return SaveMetaSchema.parse(JSON.parse(text));
  }

  async readLog(id: string): Promise<string> {
    try {
      return await readFile(this.logPath(id), "utf8");
    } catch (error) {
      if (isNotFound(error)) throw new SaveNotFoundError(`没有这个存档：${id}`);
      throw error;
    }
  }

  /** 追加一整行并刷盘；调用方负责持有存档锁 */
  async appendLog(id: string, line: string): Promise<void> {
    if (!line.endsWith("\n") || line.indexOf("\n") !== line.length - 1) {
      throw new Error("每次只能追加一行完整的记录");
    }
    const handle = await open(this.logPath(id), "a");
    try {
      await handle.writeFile(line, "utf8");
      await handle.datasync();
    } finally {
      await handle.close();
    }
  }

  /** 导入存档：一次写下整份日志（调用方已经逐行校验过，存档是刚建的空档） */
  async importLog(id: string, text: string): Promise<void> {
    await atomicWrite(this.logPath(id), text);
  }

  /** 写回前核对条数再追加；调用方持有存档锁，核对和追加之间不会有别的写入。条数不对时什么都不写 */
  async appendAt(id: string, seq: number, line: string): Promise<void> {
    const { records } = await this.loadLog(id);
    if (records.length !== seq) throw new SaveMovedError(seq, records.length);
    await this.appendLog(id, line);
  }

  /** 场景重来等多记录操作整份原子替换，避免断电或写入失败只作废半个场景。调用方持有存档锁。 */
  async appendManyAt(id: string, seq: number, lines: readonly string[]): Promise<void> {
    for (const line of lines) {
      if (!line.endsWith("\n") || line.indexOf("\n") !== line.length - 1) {
        throw new Error("每条记录必须是一行完整的记录");
      }
    }
    const text = await this.readLog(id);
    const parsed = parseLog(text);
    if (parsed.records.length !== seq) throw new SaveMovedError(seq, parsed.records.length);
    await atomicWrite(this.logPath(id), text.slice(0, parsed.cleanLength) + lines.join(""));
  }

  /** 读取并解析日志；末尾有写到一半的行时，把文件截到最后一条完整记录 */
  async loadLog(id: string): Promise<ParsedLog> {
    const text = await this.readLog(id);
    const parsed = parseLog(text);
    if (parsed.droppedPartialTail) {
      const bytes = Buffer.byteLength(text.slice(0, parsed.cleanLength), "utf8");
      await truncate(this.logPath(id), bytes);
    }
    return parsed;
  }

  /** 读出所有能解析的快照；坏掉的快照跳过，日志才是准的 */
  async readSnapshots(id: string): Promise<readonly Snapshot[]> {
    let files: string[];
    try {
      files = (await readdir(this.snapshotDir(id))).filter((f) => SNAPSHOT_FILE.test(f));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const snapshots: Snapshot[] = [];
    for (const file of files) {
      try {
        const raw: unknown = JSON.parse(await readFile(join(this.snapshotDir(id), file), "utf8"));
        snapshots.push(SnapshotFileSchema.parse(raw));
      } catch {
        // 快照只是加速用的缓存，坏了就从更早的快照或从头重放
      }
    }
    return snapshots.sort((a, b) => a.nextSeq - b.nextSeq);
  }

  async writeSnapshot(id: string, snapshot: Snapshot): Promise<void> {
    const dir = this.snapshotDir(id);
    const name = `${String(snapshot.nextSeq).padStart(8, "0")}.json`;
    await atomicWrite(join(dir, name), JSON.stringify(snapshot));
    const files = (await readdir(dir)).filter((f) => SNAPSHOT_FILE.test(f)).sort();
    for (const old of files.slice(0, Math.max(0, files.length - SNAPSHOT_KEEP))) {
      await rm(join(dir, old), { force: true });
    }
  }
}
