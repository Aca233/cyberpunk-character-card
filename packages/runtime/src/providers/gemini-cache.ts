import type { Profile } from "../config";
import { hashEmbeddingText } from "../embedding-cache";
import { relayFetch } from "./relay";

/**
 * Gemini / Vertex AI 显式上下文缓存（Explicit Context Caching / cachedContents）管理器：
 * - 仅在 profile.promptCacheMode === "on" 且静态 system 超过最低门槛（~2400 字符）时启用；
 * - 按 (endpoint, model, hash(staticSystem)) 复用远端 cachedContents 资源，临期自动后台 PATCH 续期；
 * - 若上游不支持（如中转站 404/400 或未配置项目路径的 Vertex 快捷模式），记录负缓存并静默回退到常规 systemInstruction，
 *   绝不拖慢或阻断正常回合生成。
 */

export interface GeminiCacheEndpoint {
  /** cachedContents 集合地址（POST 创建、PATCH {url}/{name} 续期） */
  readonly collectionUrl: string;
  /** 创建缓存时写入 body.model 的完整资源名 */
  readonly resourceModel: string;
  /** 仅用于 API key query 参数（Vertex 快捷模式等），无需时留空 */
  readonly apiKeyQuery?: string | undefined;
}

interface CacheEntry {
  readonly name: string;
  expiresAt: number;
  renewing?: boolean;
}

const MIN_STATIC_SYSTEM_CHARS = 2_400;
const DEFAULT_TTL_SECONDS = 1_800;
const LONG_TTL_SECONDS = 3_600;
const RENEW_MARGIN_MS = 5 * 60 * 1_000;
const MIN_REMAINING_MS = 60 * 1_000;
const NEGATIVE_TTL_MS = 10 * 60 * 1_000;

const activeCaches = new Map<string, CacheEntry>();
const inflightCreates = new Map<string, Promise<string | undefined>>();
const unsupportedEndpoints = new Map<string, number>();

function ttlSecondsFor(profile: Profile): number {
  return profile.cacheTtl === "1h" ? LONG_TTL_SECONDS : DEFAULT_TTL_SECONDS;
}

function appendQuery(url: string, apiKeyQuery?: string): string {
  if (!apiKeyQuery) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("key", apiKeyQuery);
  return parsed.toString();
}

function patchUrlFor(collectionUrl: string, resourceName: string, apiKeyQuery?: string): string {
  const base = new URL(collectionUrl);
  // resourceName 形如 "cachedContents/xxx" 或 "projects/.../locations/.../cachedContents/xxx"
  const cleanName = resourceName.replace(/^\/+/, "");
  const versionMatch = /^(\/v\d+[a-z0-9]*)\//u.exec(base.pathname);
  const versionPrefix = versionMatch ? versionMatch[1] : "";
  base.pathname = cleanName.startsWith("v") ? `/${cleanName}` : `${versionPrefix}/${cleanName}`;
  if (apiKeyQuery) base.searchParams.set("key", apiKeyQuery);
  return base.toString();
}

async function renewInBackground(
  endpoint: GeminiCacheEndpoint,
  entry: CacheEntry,
  headers: Record<string, string>,
  ttlSeconds: number,
): Promise<void> {
  if (entry.renewing) return;
  entry.renewing = true;
  try {
    const res = await relayFetch(
      patchUrlFor(endpoint.collectionUrl, entry.name, endpoint.apiKeyQuery),
      {
        method: "PATCH",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ ttl: `${ttlSeconds}s` }),
      },
    );
    if (res.ok) {
      entry.expiresAt = Date.now() + ttlSeconds * 1_000;
    }
  } catch {
    // 后台续期失败忽略；临近过期时下次会自然重建
  } finally {
    entry.renewing = false;
  }
}

/**
 * 为纯静态 systemInstruction 解析或创建显式 cachedContent 资源名；
 * 未开启、内容过短或上游不支持时返回 undefined（调用方回退到标准 systemInstruction）。
 */
export async function resolveGeminiCachedContent(
  profile: Profile,
  endpoint: GeminiCacheEndpoint | undefined,
  headers: Record<string, string>,
  staticSystem: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (profile.promptCacheMode !== "on" || !endpoint) return undefined;
  if (staticSystem.length < MIN_STATIC_SYSTEM_CHARS) return undefined;
  if (signal?.aborted) return undefined;

  const negKey = `${endpoint.collectionUrl}|${endpoint.resourceModel}`;
  const blockedUntil = unsupportedEndpoints.get(negKey);
  if (blockedUntil !== undefined && blockedUntil > Date.now()) return undefined;

  const ttlSeconds = ttlSecondsFor(profile);
  const cacheKey = `${negKey}|${hashEmbeddingText(staticSystem)}`;
  const now = Date.now();
  const existing = activeCaches.get(cacheKey);
  if (existing && existing.expiresAt > now + MIN_REMAINING_MS) {
    if (existing.expiresAt - now < RENEW_MARGIN_MS) {
      void renewInBackground(endpoint, existing, headers, ttlSeconds);
    }
    return existing.name;
  }

  const inflight = inflightCreates.get(cacheKey);
  if (inflight) return inflight;

  const pending = (async (): Promise<string | undefined> => {
    try {
      const res = await relayFetch(appendQuery(endpoint.collectionUrl, endpoint.apiKeyQuery), {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          model: endpoint.resourceModel,
          systemInstruction: { parts: [{ text: staticSystem }] },
          ttl: `${ttlSeconds}s`,
        }),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) {
        if (res.status === 400 || res.status === 403 || res.status === 404 || res.status === 501) {
          unsupportedEndpoints.set(negKey, Date.now() + NEGATIVE_TTL_MS);
        }
        return undefined;
      }
      const raw = (await res.json().catch(() => undefined)) as { name?: unknown } | undefined;
      if (!raw || typeof raw.name !== "string" || raw.name.trim() === "") return undefined;
      const name = raw.name.trim();
      activeCaches.set(cacheKey, { name, expiresAt: Date.now() + ttlSeconds * 1_000 });
      return name;
    } catch {
      return undefined;
    } finally {
      inflightCreates.delete(cacheKey);
    }
  })();

  inflightCreates.set(cacheKey, pending);
  return pending;
}

/** 远端显式缓存被提前回收或失效时移除内存句柄，供调用方单次退回常规 systemInstruction */
export function invalidateGeminiCachedContent(resourceName: string): void {
  for (const [key, entry] of activeCaches) {
    if (entry.name === resourceName) activeCaches.delete(key);
  }
}

/** 构造官方 Gemini Developer API 的 cachedContents 集合端点 */
export function geminiCacheEndpoint(profile: Profile, defaultBase: string): GeminiCacheEndpoint {
  const base = new URL(profile.baseUrl ?? defaultBase);
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/cachedContents`;
  const cleanModel = profile.model.trim().replace(/^models\//, "");
  return {
    collectionUrl: base.toString(),
    resourceModel: `models/${cleanModel}`,
  };
}
