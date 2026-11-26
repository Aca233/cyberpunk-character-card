import type { LlmClient } from "@cp/core";
import { z } from "zod";
import type { Profile } from "../config";
import { geminiClient } from "./gemini";
import { UpstreamError } from "./http";
import { relayFetch } from "./relay";

/**
 * GCP Vertex AI 直连。两种认证都支持：
 * - 快捷模式（express mode）：AI Studio API key，走 ?key= 参数（另附 x-goog-api-key 头）
 * - 服务账号 JSON：本地用私钥签 RS256 JWT 换 OAuth access token，走 Bearer；
 *   token 缓存在内存里，快到期才重新换。私钥不出本机。
 * 请求/响应格式与 Gemini generateContent 一致，复用 geminiClient。
 */
export const VERTEX_DEFAULT_BASE = "https://aiplatform.googleapis.com/v1";

const BASE_HINT =
  "Vertex 的 baseUrl 可以只填 https://aiplatform.googleapis.com/v1（global 区域），也可换成 {区域}-aiplatform.googleapis.com；填完整集合根 .../projects/{项目ID}/locations/{区域}/publishers/google 时按所填路径使用";

const CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
/** access token 默认 1 小时有效，提前 5 分钟换 */
const TOKEN_LIFETIME_S = 3600;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const ServiceAccountSchema = z.looseObject({
  type: z.literal("service_account"),
  client_email: z.string().min(1),
  private_key: z.string().min(1),
  token_uri: z.string().min(1).optional(),
  project_id: z.string().min(1).optional(),
});
export type VertexServiceAccount = z.infer<typeof ServiceAccountSchema>;

/** 密钥栏内容判定：以 { 开头按服务账号 JSON 解析，其余按 API key */
export function parseServiceAccount(apiKey: string): VertexServiceAccount | null {
  const trimmed = apiKey.trim();
  if (!trimmed.startsWith("{")) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new UpstreamError("密钥栏以 { 开头但不是合法 JSON：服务账号密钥请整段粘贴 JSON 文件内容");
  }
  const parsed = ServiceAccountSchema.safeParse(raw);
  if (!parsed.success) {
    throw new UpstreamError(
      "服务账号 JSON 缺少 type=service_account / client_email / private_key 字段，请粘贴完整的服务账号密钥文件",
    );
  }
  return parsed.data;
}

function base64Url(input: string | ArrayBuffer): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  if (!body) throw new UpstreamError("服务账号 JSON 里的 private_key 不是 PEM 格式");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function signServiceAccountJwt(sa: VertexServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: sa.client_email,
      scope: CLOUD_SCOPE,
      aud: sa.token_uri ?? DEFAULT_TOKEN_URI,
      iat: now,
      exp: now + TOKEN_LIFETIME_S,
    }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(data),
  );
  return `${data}.${base64Url(signature)}`;
}

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
}

const tokenCache = new Map<string, Promise<CachedToken>>();

const TokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
});

/** 服务账号 JSON → OAuth access token（内存缓存，临期自动重签换新） */
async function vertexAccessToken(
  sa: VertexServiceAccount,
  signal?: AbortSignal,
): Promise<CachedToken> {
  const cached = tokenCache.get(sa.client_email);
  if (cached) {
    const resolved = await cached.catch(() => undefined);
    if (resolved && resolved.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) return resolved;
  }
  const pending = (async (): Promise<CachedToken> => {
    const assertion = await signServiceAccountJwt(sa);
    const res = await relayFetch(sa.token_uri ?? DEFAULT_TOKEN_URI, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: signal ?? null,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new UpstreamError(
        `服务账号换 token 失败（HTTP ${res.status}）：${text.slice(0, 300)}`,
        res.status,
      );
    }
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      throw new UpstreamError("token 接口返回的不是合法 JSON", res.status);
    }
    const parsed = TokenResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UpstreamError("token 接口返回里没有 access_token", res.status);
    }
    const expiresAt =
      Date.now() + (parsed.data.expires_in ?? TOKEN_LIFETIME_S) * 1000 - TOKEN_REFRESH_MARGIN_MS;
    return { token: parsed.data.access_token, expiresAt };
  })();
  tokenCache.set(
    sa.client_email,
    pending.catch((error: unknown) => {
      tokenCache.delete(sa.client_email);
      throw error;
    }),
  );
  return pending;
}

/**
 * Vertex 请求头：服务账号 JSON 用 Bearer access token（需要时先换），
 * API key 用 x-goog-api-key。
 */
export async function vertexAuthHeaders(
  apiKey: string,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const sa = parseServiceAccount(apiKey);
  if (sa) {
    const { token } = await vertexAccessToken(sa, signal);
    return { authorization: `Bearer ${token}` };
  }
  return { "x-goog-api-key": apiKey };
}

/** 从 aiplatform 域名推导区域：aiplatform.googleapis.com → global，{region}-aiplatform → region */
function vertexRegionFromHost(host: string): string | null {
  if (host === "aiplatform.googleapis.com") return "global";
  const m = /^([a-z0-9-]+)-aiplatform\.googleapis\.com$/u.exec(host);
  return m ? (m[1] ?? null) : null;
}

const VERSION_PATH = /\/v\d+[a-z0-9]*$/u;

/**
 * 把 baseUrl 归一化到模型集合根（.../publishers/{publisher}）：
 * - 已经填到 .../publishers/{x} 或 .../projects/{p}/locations/{l}：直接补齐
 * - 只填域名或 /v1 这类根路径：
 *   - 服务账号且 JSON 带 project_id、域名可推出区域：自动补 projects/{id}/locations/{region}
 *   - 否则按快捷模式裸集合根 /v1/publishers/google
 */
export function vertexCollectionRoot(rawBase: string | undefined, apiKey?: string): string {
  const raw = (rawBase?.trim() ? rawBase.trim() : VERTEX_DEFAULT_BASE).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UpstreamError(`Vertex 的接口地址（baseUrl）格式不正确。${BASE_HINT}`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new UpstreamError(`Vertex 的 baseUrl 不要带账号、查询参数或片段。${BASE_HINT}`);
  }
  let path = parsed.pathname.replace(/\/+$/, "");
  if (/\/publishers\/[^/]+$/u.test(path)) {
    // 已经是集合根
  } else if (/\/projects\/[^/]+\/locations\/[^/]+$/u.test(path)) {
    path = `${path}/publishers/google`;
  } else {
    const version = VERSION_PATH.test(path) ? "" : "/v1";
    const sa = apiKey ? parseServiceAccount(apiKey) : null;
    const region = vertexRegionFromHost(parsed.hostname);
    path =
      sa?.project_id && region
        ? `${path}${version}/projects/${sa.project_id}/locations/${region}/publishers/google`
        : `${path}${version}/publishers/google`;
  }
  parsed.pathname = path;
  return parsed.toString().replace(/\/+$/, "");
}

function cleanVertexModel(profile: Pick<Profile, "model">): string {
  const model = profile.model.trim().replace(/^models\//, "");
  if (!model || model === "." || model === ".." || /[/?#\s]/u.test(model)) {
    throw new UpstreamError("Vertex 的 model 填模型 ID（如 gemini-3-pro-preview），不要填完整网址");
  }
  return model;
}

/** Vertex 方法调用地址：{集合根}/models/{model}:{method}；API key 附带 ?key=，服务账号不带 */
export function vertexModelUrl(
  profile: Pick<Profile, "baseUrl" | "model">,
  apiKey: string | undefined,
  method: "streamGenerateContent" | "generateContent" | "predict",
): string {
  const root = new URL(vertexCollectionRoot(profile.baseUrl, apiKey));
  root.pathname = `${root.pathname}/models/${encodeURIComponent(cleanVertexModel(profile))}:${method}`;
  if (apiKey && !parseServiceAccount(apiKey)) root.searchParams.set("key", apiKey);
  if (method === "streamGenerateContent") root.searchParams.set("alt", "sse");
  return root.toString();
}

/** 模型列表地址：{集合根}/models；API key 附带 ?key=，服务账号不带 */
export function vertexModelsUrl(baseUrl: string | undefined, apiKey: string | undefined): string {
  const root = new URL(vertexCollectionRoot(baseUrl, apiKey));
  root.pathname = `${root.pathname}/models`;
  if (apiKey && !parseServiceAccount(apiKey)) root.searchParams.set("key", apiKey);
  root.searchParams.set("pageSize", "100");
  return root.toString();
}

export function vertexClient(profile: Profile, apiKey: string): LlmClient {
  return geminiClient(profile, apiKey, {
    urlFor: (p, key) => vertexModelUrl(p, key, "streamGenerateContent"),
    headersFor: (_p, key, signal) => vertexAuthHeaders(key, signal),
  });
}
