import type { AbortSignalLike, Embedder, EmbedOptions } from "@cp/core";
import { z } from "zod";
import { KeyedMutex } from "./mutex";
import type { DocStore } from "./ports";
import { AbortedError } from "./providers/http";

/**
 * 浏览器 / 文件通用的本地持久化向量缓存（按存档隔离存储于 embeddings/<saveId>.json）。
 * - 仅缓存 task === "document" 的记忆文档向量；查询向量始终实时计算，不污染缓存。
 * - 通过 modelKey（提供方 + 地址 + 模型）做维度隔离，切换向量模型后自动清空重建。
 * - 单存档保留最近 MAX_ENTRIES 条文档向量（按最近使用时间 LRU 淘汰），防止缓存无限膨胀。
 */

const FOLDER = "embeddings";
const MAX_ENTRIES = 512;

const CacheFileSchema = z.object({
  version: z.literal(1),
  modelKey: z.string().min(1),
  entries: z.record(
    z.string(),
    z.object({
      v: z.array(z.number()),
      t: z.number(),
    }),
  ),
});

interface MemoryCacheBucket {
  modelKey: string;
  entries: Map<string, { readonly v: readonly number[]; t: number }>;
}

/** 纯 JS 确定性 128-bit 文本指纹（四路加盐 FNV-1a），零 Node 依赖，兼容浏览器 */
export function hashEmbeddingText(text: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b1, 0x85ebca77, 0xc2b2ae3d] as const;
  const out: string[] = [];
  for (const seed of seeds) {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out.push(h.toString(16).padStart(8, "0"));
  }
  return out.join("");
}

function cachePath(saveId: string): string {
  const safe = saveId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${FOLDER}/${safe}.json`;
}

function normalizeOptions(signalOrOptions?: AbortSignalLike | EmbedOptions): {
  readonly signal?: AbortSignalLike | undefined;
  readonly task?: EmbedOptions["task"];
} {
  if (!signalOrOptions) return {};
  if ("aborted" in signalOrOptions && "addEventListener" in signalOrOptions) {
    return { signal: signalOrOptions };
  }
  return signalOrOptions;
}

export class EmbeddingCacheStore {
  private readonly lock = new KeyedMutex();
  private readonly memory = new Map<string, MemoryCacheBucket>();

  constructor(private readonly docs?: DocStore) {}

  private async loadBucket(saveId: string, modelKey: string): Promise<MemoryCacheBucket> {
    const existing = this.memory.get(saveId);
    if (existing) {
      if (existing.modelKey === modelKey) return existing;
      const reset: MemoryCacheBucket = { modelKey, entries: new Map() };
      this.memory.set(saveId, reset);
      return reset;
    }

    const bucket: MemoryCacheBucket = { modelKey, entries: new Map() };
    if (this.docs) {
      try {
        const raw = await this.docs.read(cachePath(saveId));
        if (raw) {
          const parsed = CacheFileSchema.safeParse(JSON.parse(raw));
          if (parsed.success && parsed.data.modelKey === modelKey) {
            for (const [k, entry] of Object.entries(parsed.data.entries)) {
              if (entry.v.length > 0) bucket.entries.set(k, { v: entry.v, t: entry.t });
            }
          }
        }
      } catch {
        // 缓存损坏时静默重建，不影响回合
      }
    }
    this.memory.set(saveId, bucket);
    return bucket;
  }

  private async persistBucket(saveId: string, bucket: MemoryCacheBucket): Promise<void> {
    if (!this.docs) return;
    if (bucket.entries.size > MAX_ENTRIES) {
      const sorted = [...bucket.entries.entries()].sort((a, b) => b[1].t - a[1].t);
      bucket.entries = new Map(sorted.slice(0, MAX_ENTRIES));
    }
    const payload = {
      version: 1 as const,
      modelKey: bucket.modelKey,
      entries: Object.fromEntries(
        [...bucket.entries.entries()].map(([k, item]) => [k, { v: [...item.v], t: item.t }]),
      ),
    };
    try {
      await this.docs.write(cachePath(saveId), JSON.stringify(payload));
    } catch {
      // 浏览器配额满或隐私模式写入失败时只保留内存缓存，不阻断回合
    }
  }

  /** 为指定存档与向量模型包装上游 Embedder：文档向量走增量持久化缓存，查询向量直通 */
  wrap(saveId: string, modelKey: string, upstream: Embedder): Embedder {
    return {
      embed: async (
        texts: readonly string[],
        signalOrOptions?: AbortSignalLike | EmbedOptions,
      ): Promise<readonly (readonly number[])[]> => {
        if (texts.length === 0) return [];
        const opts = normalizeOptions(signalOrOptions);
        if (opts.task === "query") {
          return upstream.embed(texts, opts);
        }
        return this.lock.run(saveId, async () => {
          if (opts.signal?.aborted) throw new AbortedError();
          const bucket = await this.loadBucket(saveId, modelKey);
          const now = Date.now();
          const hashes = texts.map(hashEmbeddingText);

          // 找出缓存未命中的唯一文本（同批次去重）
          const missingHashes: string[] = [];
          const missingTexts: string[] = [];
          const seenMissing = new Set<string>();
          for (let i = 0; i < texts.length; i += 1) {
            const hash = hashes[i];
            const text = texts[i];
            if (!hash || text === undefined) continue;
            const hit = bucket.entries.get(hash);
            if (hit) {
              hit.t = now;
              continue;
            }
            if (!seenMissing.has(hash)) {
              seenMissing.add(hash);
              missingHashes.push(hash);
              missingTexts.push(text);
            }
          }

          if (missingTexts.length > 0) {
            const fresh = await upstream.embed(missingTexts, opts);
            if (fresh.length !== missingTexts.length) return [];
            let wrote = false;
            for (let i = 0; i < missingHashes.length; i += 1) {
              const hash = missingHashes[i];
              const vec = fresh[i];
              if (!hash || !vec || vec.length === 0) return [];
              bucket.entries.set(hash, { v: vec, t: now });
              wrote = true;
            }
            if (wrote) await this.persistBucket(saveId, bucket);
          }

          const resolved: (readonly number[])[] = [];
          for (const hash of hashes) {
            const entry = bucket.entries.get(hash);
            if (!entry || entry.v.length === 0) return [];
            resolved.push(entry.v);
          }
          return resolved;
        });
      },
    };
  }

  /** 删档时同步清理对应存档的向量缓存 */
  async remove(saveId: string): Promise<void> {
    await this.lock.run(saveId, async () => {
      this.memory.delete(saveId);
      if (this.docs) {
        try {
          await this.docs.remove(cachePath(saveId));
        } catch {
          // 忽略清理失败
        }
      }
    });
  }
}
