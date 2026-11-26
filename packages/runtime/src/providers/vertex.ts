import type { LlmClient } from "@cp/core";
import type { Profile } from "../config";
import { geminiClient } from "./gemini";
import { UpstreamError } from "./http";

/**
 * GCP Vertex AI 快捷模式（express mode）：AI Studio 密钥 + aiplatform 端点，
 * 赠金额度同样抵扣。认证走 ?key= 查询参数（另附 x-goog-api-key 头），
 * 请求/响应格式与 Gemini generateContent 一致，复用 geminiClient。
 */
export const VERTEX_DEFAULT_BASE = "https://aiplatform.googleapis.com/v1";

const BASE_HINT =
  "Vertex 的 baseUrl 填到模型集合根，例如 https://aiplatform.googleapis.com/v1/projects/项目ID/locations/global/publishers/google（快捷模式区域填 global 或对应区域域名）";

/** 把 baseUrl 归一化到模型集合根（.../projects/{p}/locations/{l}/publishers/{publisher}） */
export function vertexCollectionRoot(rawBase: string | undefined): string {
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
    throw new UpstreamError(BASE_HINT);
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

/** Vertex 方法调用地址：{集合根}/models/{model}:{method} */
export function vertexModelUrl(
  profile: Pick<Profile, "baseUrl" | "model">,
  apiKey: string,
  method: "streamGenerateContent" | "generateContent" | "predict",
): string {
  const root = new URL(vertexCollectionRoot(profile.baseUrl));
  root.pathname = `${root.pathname}/models/${encodeURIComponent(cleanVertexModel(profile))}:${method}`;
  root.searchParams.set("key", apiKey);
  if (method === "streamGenerateContent") root.searchParams.set("alt", "sse");
  return root.toString();
}

/** 模型列表地址：{集合根}/models */
export function vertexModelsUrl(baseUrl: string | undefined, apiKey: string): string {
  const root = new URL(vertexCollectionRoot(baseUrl));
  root.pathname = `${root.pathname}/models`;
  root.searchParams.set("key", apiKey);
  root.searchParams.set("pageSize", "100");
  return root.toString();
}

export function vertexClient(profile: Profile, apiKey: string): LlmClient {
  return geminiClient(profile, apiKey, (p, key) => vertexModelUrl(p, key, "streamGenerateContent"));
}
