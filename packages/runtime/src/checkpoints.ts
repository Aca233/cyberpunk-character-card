import { type TurnCheckpoint, TurnCheckpointSchema } from "@cp/core";
import { KeyedMutex } from "./mutex";
import { type DocStore, isSaveId } from "./ports";

const CHECKPOINTS_FOLDER = "turn-checkpoints";

/** 原始断点继续保存在 DocStore，错误信息只暴露字段路径，不包含提示词、正文或密钥。 */
export class TurnCheckpointCorruptError extends Error {
  override name = "TurnCheckpointCorruptError";
  readonly code = "checkpoint_corrupt";

  constructor(
    readonly saveId: string,
    readonly fields: readonly string[],
  ) {
    const where = fields.length > 0 ? `（${fields.join("、")}）` : "";
    super(
      `未完成回合的断点已损坏或不符合当前版本${where}，原始数据已保留，未重新生成或改动正式存档。请先备份正式存档，再清除损坏断点并重新发送这一轮。`,
    );
  }
}

function readCheckpoint(saveId: string, raw: unknown): TurnCheckpoint {
  const parsed = TurnCheckpointSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "断点"))];
    throw new TurnCheckpointCorruptError(saveId, fields.slice(0, 6));
  }
  if (parsed.data.saveId !== saveId) throw new TurnCheckpointCorruptError(saveId, ["saveId"]);
  return parsed.data;
}

/**
 * 回合阶段断点存储（基于 DocStore / IndexedDB；未传 DocStore 时回退到进程内存）：
 * 每个存档最多保留一份当前未完成回合的阶段结果，避免报错后重头调用大模型。
 */
export class TurnCheckpointStore {
  private readonly lock = new KeyedMutex();
  private readonly memory = new Map<string, string>();

  constructor(private readonly docs?: DocStore | undefined) {}

  private path(saveId: string): string {
    if (!isSaveId(saveId)) throw new Error(`存档 id 不合法：${saveId}`);
    return `${CHECKPOINTS_FOLDER}/${saveId}.json`;
  }

  async get(saveId: string): Promise<TurnCheckpoint | undefined> {
    if (!isSaveId(saveId)) return undefined;
    return this.lock.run(saveId, async () => {
      const path = this.path(saveId);
      const raw = this.docs ? await this.docs.read(path) : this.memory.get(path);
      if (raw === undefined) return undefined;
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new TurnCheckpointCorruptError(saveId, ["JSON"]);
      }
      return readCheckpoint(saveId, value);
    });
  }

  async save(saveId: string, checkpoint: TurnCheckpoint): Promise<void> {
    if (!isSaveId(saveId)) throw new Error(`存档 id 不合法：${saveId}`);
    await this.lock.run(saveId, async () => {
      const path = this.path(saveId);
      let serialized: string;
      try {
        serialized = JSON.stringify(checkpoint);
        // 按落盘后的 JSON 复核，及时发现 undefined / 非有限数值等无法可靠重放的数据。
        readCheckpoint(saveId, JSON.parse(serialized));
      } catch (error) {
        const where =
          error instanceof TurnCheckpointCorruptError ? error.fields.join("、") : "JSON";
        throw new Error(
          `本轮断点保存前校验失败（${where}），未覆盖已有断点，正式存档也未改动。请保留当前页面并反馈此错误；清除旧断点无法修复本次生成结果的结构问题。`,
        );
      }
      if (this.docs) await this.docs.write(path, serialized);
      else this.memory.set(path, serialized);
    });
  }

  async clear(saveId: string): Promise<boolean> {
    if (!isSaveId(saveId)) return false;
    return this.lock.run(saveId, async () => {
      const path = this.path(saveId);
      if (this.docs) return this.docs.remove(path);
      return this.memory.delete(path);
    });
  }
}
