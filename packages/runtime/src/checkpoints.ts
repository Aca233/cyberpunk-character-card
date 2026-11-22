import type { TurnCheckpoint } from "@cp/core";
import { z } from "zod";
import { KeyedMutex } from "./mutex";
import { type DocStore, isSaveId } from "./ports";

const CHECKPOINTS_FOLDER = "turn-checkpoints";

const CheckpointEnvelopeSchema = z.object({
  saveId: z.string().min(1),
  baseVersion: z.number().int().min(0),
  inputKey: z.string(),
  stage: z.enum(["prepared", "narrated", "extracted"]),
  updatedAt: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  prepared: z.record(z.string(), z.unknown()),
  narrated: z.record(z.string(), z.unknown()).optional(),
  extracted: z.record(z.string(), z.unknown()).optional(),
});

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
      try {
        const parsed = CheckpointEnvelopeSchema.safeParse(JSON.parse(raw));
        return parsed.success ? (parsed.data as unknown as TurnCheckpoint) : undefined;
      } catch {
        return undefined;
      }
    });
  }

  async save(saveId: string, checkpoint: TurnCheckpoint): Promise<void> {
    if (!isSaveId(saveId)) return;
    await this.lock.run(saveId, async () => {
      const path = this.path(saveId);
      const serialized = JSON.stringify(checkpoint);
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
