import type { ProviderType } from "../config";
import { errorDetail, get, statusError, UpstreamError } from "./http";
import { vertexAuthHeaders, vertexModelsUrl } from "./vertex";

export interface FetchModelsInput {
  readonly type: ProviderType;
  readonly baseUrl?: string | undefined;
  readonly apiKey?: string | undefined;
}

const LABELS: Record<ProviderType, string> = {
  openai: "OpenAI / 兼容接口",
  gemini: "Gemini",
  vertex: "Vertex AI",
  ollama: "Ollama",
  anthropic: "Anthropic",
  sdwebui: "Stable Diffusion WebUI",
  comfyui: "ComfyUI",
  novelai: "NovelAI",
};

const DEFAULT_BASE: Record<ProviderType, string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  vertex: "https://aiplatform.googleapis.com/v1",
  ollama: "http://127.0.0.1:11434/v1",
  anthropic: "https://api.anthropic.com/v1",
  sdwebui: "http://127.0.0.1:7860",
  comfyui: "http://127.0.0.1:8188",
  novelai: "https://image.novelai.net",
};

const NOVELAI_MODELS: readonly string[] = [
  "nai-diffusion-4-5-full",
  "nai-diffusion-4-5-curated",
  "nai-diffusion-5-full",
  "nai-diffusion-5-curated",
  "nai-diffusion-4-full",
  "nai-diffusion-4-curated-preview",
  "nai-diffusion-3",
  "nai-diffusion-furry-3",
];

const MAX_GEMINI_PAGES = 4;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validateBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UpstreamError("接口地址（baseUrl）格式不正确");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UpstreamError("接口地址只支持 http 或 https");
  }
  if (parsed.username || parsed.password) {
    throw new UpstreamError("接口地址里不要带用户名或密码");
  }
  if (parsed.search || parsed.hash) {
    throw new UpstreamError("接口地址里不要带查询参数或 # 片段");
  }
  return trimmed;
}

function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** 兼容 { data: [{id}] }、{ models: [{name|id}] }、{ data: ["..."] } 或顶层数组 */
function extractModelIds(payload: unknown): string[] {
  const record = asRecord(payload);
  const rawList = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.models)
        ? record.models
        : [];
  const ids: string[] = [];
  for (const item of rawList) {
    if (typeof item === "string") {
      ids.push(item);
      continue;
    }
    const entry = asRecord(item);
    if (!entry) continue;
    const id =
      typeof entry.id === "string"
        ? entry.id
        : typeof entry.name === "string"
          ? entry.name
          : typeof entry.model === "string"
            ? entry.model
            : "";
    if (id) ids.push(id);
  }
  return uniqueSorted(ids);
}

async function requestJson(
  label: string,
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await get(label, url, headers, signal);
  if (!res.ok) {
    const detail = await errorDetail(res);
    const tail = detail.message ? `：${detail.message.slice(0, 300)}` : "";
    if (res.status === 401 || res.status === 403) {
      throw new UpstreamError(
        `${label} 拒绝了密钥（HTTP ${res.status}），请检查 API 密钥${tail}`,
        res.status,
      );
    }
    if (res.status === 404) {
      throw new UpstreamError(
        `${label} 没有找到模型列表接口（HTTP 404），请检查接口地址或确认服务商是否支持 /models${tail}`,
        res.status,
      );
    }
    throw statusError(label, res.status, detail.message);
  }
  try {
    return await res.json();
  } catch {
    throw new UpstreamError(`${label} 返回的不是合法 JSON，无法解析模型列表`);
  }
}

async function fetchGeminiModels(
  label: string,
  base: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const preferred: string[] = [];
  const fallback: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_GEMINI_PAGES; page += 1) {
    const params = new URLSearchParams({ pageSize: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const json = await requestJson(
      label,
      `${base}/models?${params.toString()}`,
      { "x-goog-api-key": apiKey },
      signal,
    );
    const record = asRecord(json);
    const items = Array.isArray(record?.models) ? record.models : [];
    for (const item of items) {
      const entry = asRecord(item);
      const rawName = typeof entry?.name === "string" ? entry.name.trim() : "";
      if (!rawName) continue;
      const id = rawName.replace(/^models\//, "");
      if (!id) continue;
      fallback.push(id);
      const methods = entry?.supportedGenerationMethods;
      if (
        Array.isArray(methods) &&
        (methods.includes("generateContent") || methods.includes("predict"))
      ) {
        preferred.push(id);
      }
    }
    pageToken =
      typeof record?.nextPageToken === "string" && record.nextPageToken.trim() !== ""
        ? record.nextPageToken.trim()
        : undefined;
    if (!pageToken) break;
  }
  return uniqueSorted(preferred.length > 0 ? preferred : fallback);
}

/** Vertex 快捷模式模型列表：{集合根}/models 返回 publisherModels 或 models */
async function fetchVertexModels(
  label: string,
  rawBase: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const preferred: string[] = [];
  const fallback: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_GEMINI_PAGES; page += 1) {
    const url = new URL(vertexModelsUrl(rawBase, apiKey));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const json = await requestJson(
      label,
      url.toString(),
      await vertexAuthHeaders(apiKey, signal),
      signal,
    );
    const record = asRecord(json);
    const items = Array.isArray(record?.publisherModels)
      ? record.publisherModels
      : Array.isArray(record?.models)
        ? record.models
        : [];
    for (const item of items) {
      const entry = asRecord(item);
      const rawName = typeof entry?.name === "string" ? entry.name.trim() : "";
      if (!rawName) continue;
      // Vertex 资源名形如 projects/{p}/locations/{l}/publishers/google/models/{id}
      const id = rawName.includes("/models/")
        ? rawName.slice(rawName.lastIndexOf("/models/") + "/models/".length)
        : rawName.replace(/^models\//, "");
      if (!id || id.includes("/")) continue;
      fallback.push(id);
      const methods = entry?.supportedGenerationMethods;
      if (
        !Array.isArray(methods) ||
        methods.includes("generateContent") ||
        methods.includes("predict")
      ) {
        preferred.push(id);
      }
    }
    pageToken =
      typeof record?.nextPageToken === "string" && record.nextPageToken.trim() !== ""
        ? record.nextPageToken.trim()
        : undefined;
    if (!pageToken) break;
  }
  return uniqueSorted(preferred.length > 0 ? preferred : fallback);
}

/** 向当前或已保存的提供方接口拉取可用模型 ID 列表 */
export async function fetchProviderModels(
  input: FetchModelsInput,
  signal?: AbortSignal,
): Promise<string[]> {
  const label = LABELS[input.type];
  const rawBase = input.baseUrl?.trim() ? input.baseUrl : DEFAULT_BASE[input.type];
  const base = validateBaseUrl(rawBase);
  const apiKey = input.apiKey?.trim() ?? "";

  if (input.type === "gemini") {
    if (!apiKey) throw new UpstreamError(`请先填写或保存 ${label} API 密钥再获取模型列表`);
    return fetchGeminiModels(label, base, apiKey, signal);
  }

  if (input.type === "vertex") {
    if (!apiKey) throw new UpstreamError(`请先填写或保存 ${label} API 密钥再获取模型列表`);
    return fetchVertexModels(label, rawBase, apiKey, signal);
  }

  if (input.type === "anthropic") {
    if (!apiKey) throw new UpstreamError(`请先填写或保存 ${label} API 密钥再获取模型列表`);
    const modelsUrl = base.endsWith("/models")
      ? base
      : base.endsWith("/v1")
        ? `${base}/models`
        : `${base}/v1/models`;
    const json = await requestJson(
      label,
      modelsUrl,
      {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      signal,
    );
    return extractModelIds(json);
  }

  if (input.type === "novelai") {
    return [...NOVELAI_MODELS];
  }

  if (input.type === "sdwebui") {
    const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
    const json = await requestJson(label, `${base}/sdapi/v1/sd-models`, headers, signal);
    const items = Array.isArray(json) ? json : [];
    const ids: string[] = [];
    for (const item of items) {
      const rec = asRecord(item);
      const id =
        typeof rec?.title === "string"
          ? rec.title
          : typeof rec?.model_name === "string"
            ? rec.model_name
            : "";
      if (id) ids.push(id);
    }
    return uniqueSorted(ids);
  }

  if (input.type === "comfyui") {
    const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
    const json = await requestJson(
      label,
      `${base}/object_info/CheckpointLoaderSimple`,
      headers,
      signal,
    );
    const root = asRecord(json);
    const loader = asRecord(root?.CheckpointLoaderSimple);
    const inputDef = asRecord(loader?.input);
    const required = asRecord(inputDef?.required);
    const ckpt = required?.ckpt_name;
    const list = Array.isArray(ckpt) && Array.isArray(ckpt[0]) ? ckpt[0] : [];
    return uniqueSorted(list.filter((item): item is string => typeof item === "string"));
  }

  if (input.type === "openai" && base === DEFAULT_BASE.openai && !apiKey) {
    throw new UpstreamError("请先填写或保存 OpenAI API 密钥再获取模型列表");
  }

  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const candidates =
    input.type === "ollama"
      ? [
          ...new Set([
            `${base}/models`,
            ...(base.endsWith("/v1") ? [] : [`${base}/v1/models`]),
            `${base.replace(/\/v1$/, "")}/api/tags`,
          ]),
        ]
      : [`${base}/models`];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (!candidate) continue;
    try {
      const json = await requestJson(label, candidate, headers, signal);
      return extractModelIds(json);
    } catch (error) {
      const canFallback =
        error instanceof UpstreamError && error.status === 404 && i < candidates.length - 1;
      if (!canFallback) throw error;
    }
  }
  return [];
}
