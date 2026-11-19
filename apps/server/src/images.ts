import { z } from "zod";
import type { DocStore } from "./ports";
import { isSaveId } from "./ports";
import type { ImageGenerationMetadata } from "./providers/image";
import { randomHex } from "./random";

const IMAGE_ID = /^img-[a-z0-9-]{4,60}$/;
const ITEMS_FOLDER = "images/items";
const BINDINGS_FOLDER = "images/bindings";

const ImageGenerationMetadataSchema = z.object({
  profileName: z.string(),
  model: z.string(),
  protocol: z.enum([
    "openai-images",
    "openai-chat",
    "gemini-native",
    "gemini-imagen",
    "sdwebui",
    "comfyui",
  ]),
  requestedPrompt: z.string(),
  sentPrompt: z.string(),
  requestedAspectRatio: z.enum(["1:1", "3:4", "4:3", "16:9", "9:16"]).optional(),
  requestedSize: z.string().optional(),
  sentSize: z.string().optional(),
  negativePrompt: z.string().optional(),
  steps: z.number().optional(),
  cfgScale: z.number().optional(),
  seed: z.number().optional(),
  warnings: z.array(z.string()).optional(),
});

export const StoredImageSchema = z.object({
  id: z.string().regex(IMAGE_ID),
  dataUrl: z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,/),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteLength: z.number().int().positive(),
  metadata: ImageGenerationMetadataSchema,
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

export type BindTarget = (
  | { readonly kind: "turn"; readonly seq: number; readonly imageId: string }
  | { readonly kind: "npc"; readonly npcId: string; readonly imageId: string }
  | { readonly kind: "character"; readonly imageId: string }
) & { readonly expectedImageId?: string | null | undefined };

export class ImageBindingError extends Error {
  override name = "ImageBindingError";
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
  }
}

export type UnbindTarget =
  | { readonly kind: "turn"; readonly seq: number }
  | { readonly kind: "npc"; readonly npcId: string }
  | { readonly kind: "character" };

export interface ImageBindingPersistence extends DocStore {
  /** 在同一存储事务里校验存档/回合、比较当前绑定并写回；跨标签页也不可互相覆盖。 */
  updateImageBindings(
    saveId: string,
    update: (current: string | undefined) => string,
    options?: {
      readonly imageId?: string;
      readonly turnSeq?: number;
      readonly signal?: AbortSignal;
    },
  ): Promise<string>;
}

function parseBindings(text: string | undefined): SaveImageBindings {
  if (text === undefined) return { turns: {}, npcs: {} };
  try {
    return SaveImageBindingsSchema.parse(JSON.parse(text));
  } catch {
    throw new ImageBindingError("图片绑定数据损坏，未覆盖原记录", 409);
  }
}

/**
 * 浏览器本地图片存储（基于 DocStore / IndexedDB）：
 * - 单张图片保存在 `images/items/<id>.json`，避免污染角色卡、回合日志或快照体积
 * - 存档内绑定关系保存在 `images/bindings/<saveId>.json`，记录回合插图、NPC 肖像与主角立绘覆盖
 */
export class ImageStore {
  constructor(private readonly docs: ImageBindingPersistence) {}

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
      readonly width: number;
      readonly height: number;
      readonly byteLength: number;
      readonly metadata: ImageGenerationMetadata;
      readonly prompt: string;
      readonly negativePrompt?: string | undefined;
      readonly revisedPrompt?: string | undefined;
      readonly aspectRatio?: string | undefined;
    },
    now: Date,
  ): Promise<StoredImage> {
    const id = `img-${now.getTime().toString(36)}-${randomHex(4)}`;
    const record = StoredImageSchema.parse({
      id,
      dataUrl: input.dataUrl,
      mimeType: input.mimeType,
      width: input.width,
      height: input.height,
      byteLength: input.byteLength,
      metadata: input.metadata,
      prompt: input.prompt,
      ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
      ...(input.revisedPrompt ? { revisedPrompt: input.revisedPrompt } : {}),
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      createdAt: now.toISOString(),
    });
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
    return parseBindings(text);
  }

  async bind(
    saveId: string,
    target: BindTarget,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<SaveImageBindings> {
    if (!IMAGE_ID.test(target.imageId)) throw new ImageBindingError("图片 id 不合法", 404);
    const text = await this.docs.updateImageBindings(
      saveId,
      (raw) => {
        const current = parseBindings(raw);
        const currentImage =
          target.kind === "turn"
            ? current.turns[String(target.seq)]
            : target.kind === "npc"
              ? current.npcs[target.npcId]
              : current.playerPortrait;
        if (
          target.expectedImageId !== undefined &&
          target.expectedImageId !== (currentImage ?? null)
        ) {
          throw new ImageBindingError("目标图片已经改变，保留当前选择", 409);
        }
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
        return JSON.stringify(next);
      },
      {
        imageId: target.imageId,
        ...(target.kind === "turn" ? { turnSeq: target.seq } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
    return parseBindings(text);
  }

  async unbind(saveId: string, target: UnbindTarget): Promise<SaveImageBindings> {
    const text = await this.docs.updateImageBindings(saveId, (raw) => {
      const current = parseBindings(raw);
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
      return JSON.stringify(next);
    });
    return parseBindings(text);
  }
}
