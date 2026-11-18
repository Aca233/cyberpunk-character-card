import { z } from "zod";
import { KeyedMutex } from "./mutex";
import type { DocStore } from "./ports";
import { isSaveId } from "./ports";
import { randomHex } from "./random";

const IMAGE_ID = /^img-[a-z0-9-]{4,60}$/;
const ITEMS_FOLDER = "images/items";
const BINDINGS_FOLDER = "images/bindings";

export const StoredImageSchema = z.object({
  id: z.string().regex(IMAGE_ID),
  dataUrl: z.string().min(1),
  mimeType: z.string().min(1),
  prompt: z.string(),
  negativePrompt: z.string().optional(),
  revisedPrompt: z.string().optional(),
  aspectRatio: z.string().optional(),
  createdAt: z.string().min(1),
});
export type StoredImage = z.infer<typeof StoredImageSchema>;

export const SaveImageBindingsSchema = z.object({
  turns: z.record(z.string(), z.string()).default({}),
  npcs: z.record(z.string(), z.string()).default({}),
  playerPortrait: z.string().min(1).optional(),
});
export type SaveImageBindings = z.infer<typeof SaveImageBindingsSchema>;

export type BindTarget =
  | { readonly kind: "turn"; readonly seq: number; readonly imageId: string }
  | { readonly kind: "npc"; readonly npcId: string; readonly imageId: string }
  | { readonly kind: "character"; readonly imageId: string };

export type UnbindTarget =
  | { readonly kind: "turn"; readonly seq: number }
  | { readonly kind: "npc"; readonly npcId: string }
  | { readonly kind: "character" };

/**
 * 浏览器本地图片存储（基于 DocStore / IndexedDB）：
 * - 单张图片保存在 `images/items/<id>.json`，避免污染角色卡、回合日志或快照体积
 * - 存档内绑定关系保存在 `images/bindings/<saveId>.json`，记录回合插图、NPC 肖像与主角立绘覆盖
 */
export class ImageStore {
  private readonly lock = new KeyedMutex();

  constructor(private readonly docs: DocStore) {}

  private itemPath(id: string): string {
    if (!IMAGE_ID.test(id)) throw new Error(`图片 id 不合法：${id}`);
    return `${ITEMS_FOLDER}/${id}.json`;
  }

  private bindingPath(saveId: string): string {
    if (!isSaveId(saveId)) throw new Error(`存档 id 不合法：${saveId}`);
    return `${BINDINGS_FOLDER}/${saveId}.json`;
  }

  async save(
    input: {
      readonly dataUrl: string;
      readonly mimeType: string;
      readonly prompt: string;
      readonly negativePrompt?: string | undefined;
      readonly revisedPrompt?: string | undefined;
      readonly aspectRatio?: string | undefined;
    },
    now: Date,
  ): Promise<StoredImage> {
    const id = `img-${now.getTime().toString(36)}-${randomHex(4)}`;
    const record: StoredImage = {
      id,
      dataUrl: input.dataUrl,
      mimeType: input.mimeType,
      prompt: input.prompt,
      ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
      ...(input.revisedPrompt ? { revisedPrompt: input.revisedPrompt } : {}),
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      createdAt: now.toISOString(),
    };
    await this.docs.write(this.itemPath(id), JSON.stringify(record));
    return record;
  }

  async get(id: string): Promise<StoredImage | undefined> {
    if (!IMAGE_ID.test(id)) return undefined;
    const text = await this.docs.read(this.itemPath(id));
    if (text === undefined) return undefined;
    try {
      const parsed = StoredImageSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  async remove(id: string): Promise<boolean> {
    if (!IMAGE_ID.test(id)) return false;
    return this.docs.remove(this.itemPath(id));
  }

  async getBindings(saveId: string): Promise<SaveImageBindings> {
    if (!isSaveId(saveId)) return { turns: {}, npcs: {} };
    const text = await this.docs.read(this.bindingPath(saveId));
    if (text === undefined) return { turns: {}, npcs: {} };
    try {
      const parsed = SaveImageBindingsSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : { turns: {}, npcs: {} };
    } catch {
      return { turns: {}, npcs: {} };
    }
  }

  async bind(saveId: string, target: BindTarget): Promise<SaveImageBindings> {
    return this.lock.run(`bind:${saveId}`, async () => {
      const current = await this.getBindings(saveId);
      let next: SaveImageBindings;
      if (target.kind === "turn") {
        next = {
          ...current,
          turns: { ...current.turns, [String(target.seq)]: target.imageId },
        };
      } else if (target.kind === "npc") {
        next = {
          ...current,
          npcs: { ...current.npcs, [target.npcId]: target.imageId },
        };
      } else {
        next = {
          ...current,
          playerPortrait: target.imageId,
        };
      }
      await this.docs.write(this.bindingPath(saveId), JSON.stringify(next));
      return next;
    });
  }

  async unbind(saveId: string, target: UnbindTarget): Promise<SaveImageBindings> {
    return this.lock.run(`bind:${saveId}`, async () => {
      const current = await this.getBindings(saveId);
      let next: SaveImageBindings;
      if (target.kind === "turn") {
        const turns = { ...current.turns };
        delete turns[String(target.seq)];
        next = { ...current, turns };
      } else if (target.kind === "npc") {
        const npcs = { ...current.npcs };
        delete npcs[target.npcId];
        next = { ...current, npcs };
      } else {
        const { playerPortrait: _removed, ...rest } = current;
        next = rest;
      }
      await this.docs.write(this.bindingPath(saveId), JSON.stringify(next));
      return next;
    });
  }
}
