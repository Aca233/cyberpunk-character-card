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
    "novelai",
    "local-upload",
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

export const MAX_TURN_IMAGES = 8;

export const SaveImageBindingsSchema = z.object({
  turns: z.record(z.string(), z.string()).default({}),
  turnLists: z.record(z.string(), z.array(z.string().min(1)).max(MAX_TURN_IMAGES)).default({}),
  npcs: z.record(z.string(), z.string()).default({}),
  playerPortrait: z.string().min(1).optional(),
});
export type SaveImageBindings = z.infer<typeof SaveImageBindingsSchema>;

export type BindTarget = (
  | {
      readonly kind: "turn";
      readonly seq: number;
      readonly imageId: string;
      /** 指定替换某个槽位（0-based） */
      readonly slot?: number | undefined;
      /** 在该轮现有插图列表末尾追加新插图 */
      readonly append?: boolean | undefined;
      /** 替换整轮列表为单张图片 */
      readonly replaceAll?: boolean | undefined;
    }
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
  | {
      readonly kind: "turn";
      readonly seq: number;
      /** 移除指定槽位；若同时未传 imageId，则移除整轮所有插图 */
      readonly slot?: number | undefined;
      /** 按图片 id 移除该轮中的对应插图 */
      readonly imageId?: string | undefined;
    }
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

/** 读取某个回合的有序插图 id 列表，自动兼容只有 turns[seq] 的旧记录 */
export function turnImageIdsOf(bindings: SaveImageBindings, seq: number): readonly string[] {
  const key = String(seq);
  const list = bindings.turnLists?.[key];
  if (list && list.length > 0) return list;
  const legacy = bindings.turns[key];
  return legacy ? [legacy] : [];
}

function normalizeBindings(parsed: SaveImageBindings): SaveImageBindings {
  const turns: Record<string, string> = {};
  const turnLists: Record<string, string[]> = {};
  const keys = new Set([...Object.keys(parsed.turns), ...Object.keys(parsed.turnLists ?? {})]);
  for (const key of keys) {
    const rawList = parsed.turnLists?.[key];
    const list =
      rawList && rawList.length > 0
        ? rawList.slice(0, MAX_TURN_IMAGES)
        : parsed.turns[key]
          ? [parsed.turns[key]]
          : [];
    if (list.length > 0) {
      turnLists[key] = list;
      turns[key] = list[0] as string;
    }
  }
  return {
    turns,
    turnLists,
    npcs: parsed.npcs,
    ...(parsed.playerPortrait ? { playerPortrait: parsed.playerPortrait } : {}),
  };
}

function parseBindings(text: string | undefined): SaveImageBindings {
  if (text === undefined) return { turns: {}, turnLists: {}, npcs: {} };
  try {
    return normalizeBindings(SaveImageBindingsSchema.parse(JSON.parse(text)));
  } catch {
    throw new ImageBindingError("图片绑定数据损坏，未覆盖原记录", 409);
  }
}

export type StoredImageMetadataSummary = Omit<StoredImage, "dataUrl">;

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

  /** 删档时清理该存档的图片绑定记录（保留图片库本体，不影响其他存档或角色卡） */
  async removeSaveBindings(saveId: string): Promise<boolean> {
    if (!isSaveId(saveId)) return false;
    return this.docs.remove(this.bindingPath(saveId));
  }

  /** 列出最近保存的图片元数据（自动剥离 base64 图片本体，供诊断日志排查生图提示词、协议与尺寸告警） */
  async listRecentMetadata(limit = 15): Promise<StoredImageMetadataSummary[]> {
    const names = await this.docs.list(ITEMS_FOLDER);
    const items: StoredImageMetadataSummary[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      const item = await this.get(id);
      if (!item) continue;
      const { dataUrl: _omitted, ...summary } = item;
      items.push(summary);
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items.slice(0, Math.max(0, Math.min(50, limit)));
  }

  async getBindings(saveId: string): Promise<SaveImageBindings> {
    if (!isSaveId(saveId)) return { turns: {}, turnLists: {}, npcs: {} };
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
        let currentImage: string | undefined;
        if (target.kind === "turn") {
          const list = turnImageIdsOf(current, target.seq);
          if (target.append) {
            currentImage = undefined;
          } else if (target.slot !== undefined) {
            currentImage = list[target.slot];
          } else {
            currentImage = list[0];
          }
        } else if (target.kind === "npc") {
          currentImage = current.npcs[target.npcId];
        } else {
          currentImage = current.playerPortrait;
        }
        if (
          target.expectedImageId !== undefined &&
          target.expectedImageId !== (currentImage ?? null)
        ) {
          throw new ImageBindingError("目标图片已经改变，保留当前选择", 409);
        }
        let next: SaveImageBindings;
        if (target.kind === "turn") {
          const key = String(target.seq);
          const prevList = [...turnImageIdsOf(current, target.seq)];
          let nextList: string[];
          if (target.replaceAll) {
            nextList = [target.imageId];
          } else if (target.append) {
            if (prevList.length >= MAX_TURN_IMAGES) {
              throw new ImageBindingError(`单轮最多绑定 ${MAX_TURN_IMAGES} 张场景插图`, 409);
            }
            nextList = [...prevList, target.imageId];
          } else if (target.slot !== undefined) {
            if (target.slot < 0 || target.slot >= MAX_TURN_IMAGES) {
              throw new ImageBindingError("插图槽位超出范围", 409);
            }
            nextList = [...prevList];
            if (target.slot < nextList.length) {
              nextList[target.slot] = target.imageId;
            } else {
              nextList.push(target.imageId);
            }
          } else if (prevList.length === 0) {
            nextList = [target.imageId];
          } else {
            nextList = [target.imageId, ...prevList.slice(1)];
          }
          next = {
            ...current,
            turns: { ...current.turns, [key]: nextList[0] as string },
            turnLists: { ...current.turnLists, [key]: nextList },
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
        const key = String(target.seq);
        const turns = { ...current.turns };
        const turnLists = { ...current.turnLists };
        const prevList = [...turnImageIdsOf(current, target.seq)];
        let nextList: string[];
        if (target.imageId !== undefined) {
          nextList = prevList.filter((id) => id !== target.imageId);
        } else if (target.slot !== undefined) {
          nextList = prevList.filter((_, idx) => idx !== target.slot);
        } else {
          nextList = [];
        }
        if (nextList.length === 0) {
          delete turns[key];
          delete turnLists[key];
        } else {
          turns[key] = nextList[0] as string;
          turnLists[key] = nextList;
        }
        next = { ...current, turns, turnLists };
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
