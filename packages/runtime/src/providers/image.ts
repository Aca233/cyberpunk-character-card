import type { ConfigService, ImageProtocol, Profile } from "../config";
import { AbortedError, errorDetail, get, post, statusError, UpstreamError } from "./http";
import {
  imageBytesToBase64,
  readImageResponseBytes,
  type ValidatedImageAsset,
  validateImageDataUrl,
} from "./image-bytes";
import { imageGenerationQueue } from "./image-queue";

export type AspectRatio = "1:1" | "3:4" | "4:3" | "16:9" | "9:16";

export interface ImageGenerateRequest {
  readonly prompt: string;
  readonly negativePrompt?: string | undefined;
  readonly aspectRatio?: AspectRatio | undefined;
  readonly size?: string | undefined;
  readonly steps?: number | undefined;
  readonly cfgScale?: number | undefined;
  readonly seed?: number | undefined;
}

interface RawImageGenerateResult {
  readonly dataUrl: string;
  readonly mimeType: string;
  readonly revisedPrompt?: string | undefined;
  readonly actualSeed?: number | undefined;
}

export interface ImageGenerationMetadata {
  readonly profileName: string;
  readonly model: string;
  readonly protocol: ResolvedImageProtocol | "local-upload";
  readonly requestedAspectRatio?: AspectRatio;
  readonly requestedSize?: string;
  readonly sentSize?: string;
  readonly requestedPrompt: string;
  readonly sentPrompt: string;
  /** Original exclusion text; only SD WebUI and ComfyUI receive it as an independent field. */
  readonly negativePrompt?: string;
  readonly steps?: number;
  readonly cfgScale?: number;
  readonly seed?: number;
  readonly warnings?: readonly string[];
}

export interface ImageGenerateResult extends ValidatedImageAsset {
  readonly revisedPrompt?: string | undefined;
  readonly metadata: ImageGenerationMetadata;
}

export type ResolvedImageProtocol = Exclude<ImageProtocol, "auto">;

export type ImageResolved =
  | {
      readonly ok: true;
      readonly profile: Profile;
      readonly protocol: ResolvedImageProtocol;
      readonly apiKey: string | undefined;
    }
  | { readonly ok: false; readonly error: string };

const DEFAULT_BASE: Record<
  "openai" | "ollama" | "gemini" | "sdwebui" | "comfyui" | "novelai",
  string
> = {
  openai: "https://api.openai.com/v1",
  ollama: "http://127.0.0.1:11434/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  sdwebui: "http://127.0.0.1:7860",
  comfyui: "http://127.0.0.1:8188",
  novelai: "https://image.novelai.net",
};

const COMFY_POLL_MS = 800;
const COMFY_MAX_WAIT_MS = 180_000;
const IMAGE_REQUEST_TIMEOUT_MS = 5 * 60_000;

const GEMINI_BLOCK_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "JAILBREAK",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function cleanBaseUrl(raw: string | undefined, fallback: string): string {
  const base = (raw?.trim() || fallback).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new UpstreamError("文生图接口地址（baseUrl）格式不正确");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UpstreamError("文生图接口地址只支持 http 或 https");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new UpstreamError("文生图接口地址不能带账号、查询参数或 # 片段");
  }
  return base;
}

function toDataUrl(b64: string, mimeType?: string): { dataUrl: string; mimeType: string } {
  const cleaned = b64.trim();
  if (cleaned.startsWith("data:")) {
    const match = /^data:([^;]+);base64,/i.exec(cleaned);
    return { dataUrl: cleaned, mimeType: match?.[1] ?? "application/octet-stream" };
  }
  // The declared type is provisional. validateImageDataUrl inspects and decodes the real bytes.
  const mime = mimeType?.trim() || "application/octet-stream";
  return { dataUrl: `data:${mime};base64,${cleaned}`, mimeType: mime };
}

async function fetchUrlAsDataUrl(
  provider: string,
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ dataUrl: string; mimeType: string }> {
  try {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new UpstreamError("生成图片的下载地址无效");
    }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
      throw new UpstreamError("生成图片的下载地址仅支持不带账号的 HTTP 或 HTTPS");
    }
    const res = await fetch(url, {
      method: "GET",
      headers,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      throw statusError(provider, res.status, "下载生成的图片失败");
    }
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim();
    const buf = await readImageResponseBytes(res, signal);
    const b64 = imageBytesToBase64(buf);
    const mime = contentType?.startsWith("image/") ? contentType : "application/octet-stream";
    return { dataUrl: `data:${mime};base64,${b64}`, mimeType: mime };
  } catch (error) {
    if (signal?.aborted) throw new AbortedError();
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError(
      `${provider} 的图片未能完整下载到本地，请检查图片链接或浏览器跨域限制；没有自动重试生图`,
    );
  }
}

async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<
  { ok: true; json: unknown } | { ok: false; status: number; message: string; code?: string }
> {
  const res = await post(provider, url, { accept: "application/json", ...headers }, body, signal);
  if (!res.ok) {
    const detail = await errorDetail(res);
    return {
      ok: false,
      status: res.status,
      message: detail.message,
      ...(detail.code ? { code: detail.code } : {}),
    };
  }
  try {
    return { ok: true, json: await res.json() };
  } catch {
    throw new UpstreamError(`${provider} 返回的不是合法 JSON`);
  }
}

function dimensionsFor(ratio: AspectRatio = "1:1"): { width: number; height: number } {
  switch (ratio) {
    case "3:4":
      return { width: 768, height: 1024 };
    case "4:3":
      return { width: 1024, height: 768 };
    case "16:9":
      return { width: 1280, height: 720 };
    case "9:16":
      return { width: 720, height: 1280 };
    default:
      return { width: 1024, height: 1024 };
  }
}

function dimensionsForRequest(request: ImageGenerateRequest): { width: number; height: number } {
  const size = request.size?.trim();
  if (!size) return dimensionsFor(request.aspectRatio);
  const parsed = /^([1-9]\d{1,4})x([1-9]\d{1,4})$/.exec(size);
  if (!parsed) throw new UpstreamError("当前协议的尺寸必须使用 宽x高（例如 1280x720）");
  const width = Number(parsed[1]);
  const height = Number(parsed[2]);
  if (width > 8192 || height > 8192 || width * height > 32 * 1024 * 1024) {
    throw new UpstreamError("请求的生图尺寸过大");
  }
  return { width, height };
}

function openAiSizeFor(model: string, ratio: AspectRatio = "1:1", explicit?: string): string {
  if (explicit?.trim()) {
    const size = explicit.trim();
    if (size === "auto" || /^[1-9]\d{1,4}x[1-9]\d{1,4}$/.test(size)) return size;
    throw new UpstreamError("生图尺寸应为 宽x高（例如 1280x720）或 auto");
  }
  if (/^dall-e-2$/i.test(model)) return "1024x1024";
  const isDalle = /^dall-e-3$/i.test(model);
  // Only these known fixed-canvas families are mapped to their documented native sizes.
  // Other compatible models receive the requested canvas, and may reject unsupported sizes.
  if (!isDalle && !/^gpt-image-1(?:\.\d+)?(?:-|$)/i.test(model)) {
    const { width, height } = dimensionsFor(ratio);
    return `${width}x${height}`;
  }
  switch (ratio) {
    case "3:4":
    case "9:16":
      return isDalle ? "1024x1792" : "1024x1536";
    case "4:3":
    case "16:9":
      return isDalle ? "1792x1024" : "1536x1024";
    default:
      return "1024x1024";
  }
}

function novelAiDimensionsFor(request: ImageGenerateRequest): { width: number; height: number } {
  const size = request.size?.trim();
  if (size) {
    const { width, height } = dimensionsForRequest(request);
    if (width % 64 !== 0 || height % 64 !== 0) {
      throw new UpstreamError(
        "NovelAI 生图尺寸的宽和高必须是 64 的整数倍（例如 832x1216、1024x1024）",
      );
    }
    return { width, height };
  }
  switch (request.aspectRatio) {
    case "3:4":
      return { width: 832, height: 1216 };
    case "4:3":
      return { width: 1216, height: 832 };
    case "16:9":
      return { width: 1280, height: 704 };
    case "9:16":
      return { width: 704, height: 1280 };
    default:
      return { width: 1024, height: 1024 };
  }
}

export function imageProtocolCapabilities(protocol: ResolvedImageProtocol) {
  return {
    negativePrompt: protocol === "sdwebui" || protocol === "comfyui" || protocol === "novelai",
    aspectRatio: protocol === "gemini-native" || protocol === "gemini-imagen",
    size:
      protocol === "openai-images" ||
      protocol === "sdwebui" ||
      protocol === "comfyui" ||
      protocol === "novelai",
    sampling: protocol === "sdwebui" || protocol === "comfyui" || protocol === "novelai",
  } as const;
}

/** 根据提供方类型和模型名自动判断生图协议 */
export function resolveImageProtocol(profile: Profile): ResolvedImageProtocol {
  if (profile.imageProtocol && profile.imageProtocol !== "auto") {
    return profile.imageProtocol;
  }
  if (profile.type === "sdwebui") return "sdwebui";
  if (profile.type === "comfyui") return "comfyui";
  if (profile.type === "novelai") return "novelai";
  if (profile.type === "gemini") {
    const cleanModel = profile.model.replace(/^models\//, "");
    return /^imagen/i.test(cleanModel) ? "gemini-imagen" : "gemini-native";
  }
  const m = profile.model.toLowerCase();
  if (m.startsWith("nai-diffusion")) {
    return "novelai";
  }
  if (
    m.includes("dall-e") ||
    m.includes("gpt-image") ||
    m.includes("imagen") ||
    m.includes("flux") ||
    m.includes("recraft") ||
    m.includes("ideogram") ||
    m.includes("wanx") ||
    m.includes("cogview") ||
    m.includes("kolors")
  ) {
    return "openai-images";
  }
  if (m.includes("gemini") || m.includes("gpt-4o") || m.includes("chat")) {
    return "openai-chat";
  }
  return "openai-images";
}

/* ———— 1. OpenAI 兼容 /v1/images/generations ———— */

async function generateOpenAiImages(
  provider: string,
  profile: Profile,
  apiKey: string | undefined,
  request: ImageGenerateRequest,
  signal?: AbortSignal,
): Promise<RawImageGenerateResult> {
  const base = cleanBaseUrl(
    profile.baseUrl,
    profile.type === "ollama" ? DEFAULT_BASE.ollama : DEFAULT_BASE.openai,
  );
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const size = openAiSizeFor(profile.model, request.aspectRatio, request.size);
  const body: Record<string, unknown> = {
    model: profile.model,
    prompt: request.prompt,
    n: 1,
    size,
    // gpt-image-1 等新模型不接受 response_format 字段，只有 dall-e 显式要 b64_json
    ...(/^dall-e/i.test(profile.model) ? { response_format: "b64_json" } : {}),
  };
  const res = await postJson(provider, `${base}/images/generations`, headers, body, signal);
  if (!res.ok) {
    throw statusError(provider, res.status, res.message);
  }
  const rec = asRecord(res.json);
  const dataList = Array.isArray(rec?.data) ? rec.data : [];
  const first = asRecord(dataList[0]);
  if (!first) {
    throw new UpstreamError(`${provider} 没有返回图片数据`);
  }
  const revisedPrompt = typeof first.revised_prompt === "string" ? first.revised_prompt : undefined;
  if (typeof first.b64_json === "string" && first.b64_json.trim() !== "") {
    const img = toDataUrl(first.b64_json);
    return { ...img, ...(revisedPrompt ? { revisedPrompt } : {}) };
  }
  if (typeof first.url === "string" && first.url.trim() !== "") {
    const img = await fetchUrlAsDataUrl(provider, first.url.trim(), {}, signal);
    return { ...img, ...(revisedPrompt ? { revisedPrompt } : {}) };
  }
  throw new UpstreamError(`${provider} 返回的图片对象里既没有 b64_json 也没有 url`);
}

/* ———— 2. OpenAI Chat / Responses 模态生图 ———— */

function extractImageFromText(text: string): string | null {
  const dataUri = /data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=\s]+/.exec(text);
  if (dataUri) return dataUri[0].replace(/\s+/g, "");
  const md = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/.exec(text);
  if (md?.[1]) return md[1];
  const bareUrl = /(https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>]*)?)/i.exec(text);
  if (bareUrl?.[1]) return bareUrl[1];
  const anyUrl = /(https?:\/\/[^\s"'<>]+)/.exec(text);
  return anyUrl?.[1] ?? null;
}

async function resolveChatImageCandidate(
  provider: string,
  candidate: string,
  signal?: AbortSignal,
): Promise<{ dataUrl: string; mimeType: string }> {
  if (candidate.startsWith("data:image/")) {
    return toDataUrl(candidate);
  }
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return fetchUrlAsDataUrl(provider, candidate, {}, signal);
  }
  return toDataUrl(candidate);
}

async function generateOpenAiChat(
  provider: string,
  profile: Profile,
  apiKey: string | undefined,
  request: ImageGenerateRequest,
  signal?: AbortSignal,
): Promise<RawImageGenerateResult> {
  const base = cleanBaseUrl(
    profile.baseUrl,
    profile.type === "ollama" ? DEFAULT_BASE.ollama : DEFAULT_BASE.openai,
  );
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const prompt = request.prompt;
  const body = {
    model: profile.model,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    stream: false,
  };
  const res = await postJson(provider, `${base}/chat/completions`, headers, body, signal);
  if (!res.ok) {
    throw statusError(provider, res.status, res.message);
  }
  const root = asRecord(res.json);

  // 兼容 Responses API 风格 output[].result
  if (Array.isArray(root?.output)) {
    for (const item of root.output) {
      const rec = asRecord(item);
      if (rec?.type === "image_generation_call" && typeof rec.result === "string") {
        return toDataUrl(rec.result);
      }
    }
  }

  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const msg = asRecord(asRecord(choices[0])?.message);
  if (!msg) throw new UpstreamError(`${provider} 没有返回消息内容`);

  // 1) OpenRouter / New API 等扩展字段 message.images
  if (Array.isArray(msg.images)) {
    for (const item of msg.images) {
      if (typeof item === "string" && item.trim()) {
        return resolveChatImageCandidate(provider, item.trim(), signal);
      }
      const rec = asRecord(item);
      const url =
        typeof rec?.b64_json === "string"
          ? rec.b64_json
          : typeof rec?.url === "string"
            ? rec.url
            : typeof asRecord(rec?.image_url)?.url === "string"
              ? (asRecord(rec?.image_url)?.url as string)
              : "";
      if (url) return resolveChatImageCandidate(provider, url, signal);
    }
  }

  // 2) 多模态 content 数组
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      const rec = asRecord(part);
      if (!rec) continue;
      const imageUrl = asRecord(rec.image_url);
      if (typeof imageUrl?.url === "string" && imageUrl.url) {
        return resolveChatImageCandidate(provider, imageUrl.url, signal);
      }
      const inline = asRecord(rec.inlineData) ?? asRecord(rec.inline_data);
      if (typeof inline?.data === "string" && inline.data) {
        const mime =
          typeof inline.mimeType === "string"
            ? inline.mimeType
            : typeof inline.mime_type === "string"
              ? inline.mime_type
              : undefined;
        return toDataUrl(inline.data, mime);
      }
      const src = asRecord(rec.source);
      if (typeof src?.data === "string" && src.data) {
        const mime = typeof src.media_type === "string" ? src.media_type : undefined;
        return toDataUrl(src.data, mime);
      }
      if (typeof rec.text === "string") {
        const found = extractImageFromText(rec.text);
        if (found) return resolveChatImageCandidate(provider, found, signal);
      }
    }
  }

  // 3) 纯文本里的 Markdown 图片 / Data URI / URL
  if (typeof msg.content === "string") {
    const found = extractImageFromText(msg.content);
    if (found) return resolveChatImageCandidate(provider, found, signal);
    const snippet = msg.content.trim().slice(0, 180);
    throw new UpstreamError(`${provider} 返回了文本而非图片${snippet ? `：${snippet}` : ""}`);
  }

  throw new UpstreamError(`${provider} 的回复中没有可识别的图片`);
}

/* ———— 3a. Gemini 原生 generateContent 图像输出 ———— */

async function generateGeminiNative(
  provider: string,
  profile: Profile,
  apiKey: string,
  request: ImageGenerateRequest,
  signal?: AbortSignal,
): Promise<RawImageGenerateResult> {
  const base = cleanBaseUrl(profile.baseUrl, DEFAULT_BASE.gemini);
  const model = profile.model.replace(/^models\//, "");
  if (!model || /[/?#\s]/u.test(model)) {
    throw new UpstreamError("Gemini 生图模型 ID 不合法");
  }
  const url = `${base}/models/${encodeURIComponent(model)}:generateContent`;
  const headers = { "x-goog-api-key": apiKey };
  const prompt = request.prompt;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      ...(request.aspectRatio ? { imageConfig: { aspectRatio: request.aspectRatio } } : {}),
    },
  };
  const res = await postJson(provider, url, headers, body, signal);
  if (!res.ok) {
    throw statusError(provider, res.status, res.message);
  }
  const root = asRecord(res.json);
  const promptBlock = asRecord(root?.promptFeedback)?.blockReason;
  if (typeof promptBlock === "string" && GEMINI_BLOCK_REASONS.has(promptBlock)) {
    throw new UpstreamError(`${provider} 安全机制拦截了本次生图请求（${promptBlock}）`);
  }
  const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
  const first = asRecord(candidates[0]);
  const finishReason = typeof first?.finishReason === "string" ? first.finishReason : "";
  if (finishReason && GEMINI_BLOCK_REASONS.has(finishReason)) {
    throw new UpstreamError(`${provider} 拦截了生成的图像内容（${finishReason}）`);
  }
  const parts = Array.isArray(asRecord(first?.content)?.parts)
    ? (asRecord(first?.content)?.parts as unknown[])
    : [];
  for (const rawPart of parts) {
    const part = asRecord(rawPart);
    const inline = asRecord(part?.inlineData) ?? asRecord(part?.inline_data);
    if (typeof inline?.data === "string" && inline.data) {
      const mime =
        typeof inline.mimeType === "string"
          ? inline.mimeType
          : typeof inline.mime_type === "string"
            ? inline.mime_type
            : undefined;
      return toDataUrl(inline.data, mime);
    }
  }
  throw new UpstreamError(`${provider} 没有在回复里返回图像数据`);
}

/* ———— 3b. Gemini Imagen (:predict) ———— */

async function generateGeminiImagen(
  provider: string,
  profile: Profile,
  apiKey: string,
  request: ImageGenerateRequest,
  signal?: AbortSignal,
): Promise<RawImageGenerateResult> {
  const base = cleanBaseUrl(profile.baseUrl, DEFAULT_BASE.gemini);
  const model = profile.model.replace(/^models\//, "");
  if (!model || /[/?#\s]/u.test(model)) {
    throw new UpstreamError("Imagen 模型 ID 不合法");
  }
  const url = `${base}/models/${encodeURIComponent(model)}:predict`;
  const headers = { "x-goog-api-key": apiKey };
  const prompt = request.prompt;
  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
    },
  };
  const res = await postJson(provider, url, headers, body, signal);
  if (!res.ok) {
    throw statusError(provider, res.status, res.message);
  }
  const root = asRecord(res.json);
  const predictions = Array.isArray(root?.predictions) ? root.predictions : [];
  const first = asRecord(predictions[0]);
  if (typeof first?.bytesBase64Encoded === "string" && first.bytesBase64Encoded) {
    const mime = typeof first.mimeType === "string" ? first.mimeType : "image/png";
    return toDataUrl(first.bytesBase64Encoded, mime);
  }
  throw new UpstreamError(`${provider} 没有返回 Imagen 图像数据`);
}

/* ———— 4a. Stable Diffusion WebUI (/sdapi/v1/txt2img) ———— */

async function generateSdWebUi(
  provider: string,
  profile: Profile,
  apiKey: string | undefined,
  request: ImageGenerateRequest,
  signal?: AbortSignal,
): Promise<RawImageGenerateResult> {
  const base = cleanBaseUrl(profile.baseUrl, DEFAULT_BASE.sdwebui);
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const { width, height } = dimensionsForRequest(request);
  const body: Record<string, unknown> = {
    prompt: request.prompt.trim(),
    negative_prompt: request.negativePrompt?.trim() ?? "",
    width,
    height,
    steps: request.steps ?? 24,
    cfg_scale: request.cfgScale ?? 7,
    seed: request.seed ?? -1,
    ...(profile.model && profile.model !== "default"
      ? { override_settings: { sd_model_checkpoint: profile.model } }
      : {}),
  };
  const res = await postJson(provider, `${base}/sdapi/v1/txt2img`, headers, body, signal);
  if (!res.ok) {
    throw statusError(provider, res.status, res.message);
  }
  const root = asRecord(res.json);
  const images = Array.isArray(root?.images) ? root.images : [];
  if (typeof images[0] === "string" && images[0].trim() !== "") {
    let info = asRecord(root?.info);
    if (typeof root?.info === "string") {
      try {
        info = asRecord(JSON.parse(root.info));
      } catch {
        /* Optional sampling metadata. */
      }
    }
    const actualSeed =
      typeof info?.seed === "number" && Number.isSafeInteger(info.seed) && info.seed >= 0
        ? info.seed
        : undefined;
    return { ...toDataUrl(images[0]), ...(actualSeed !== undefined ? { actualSeed } : {}) };
  }
  throw new UpstreamError(`${provider} 没有返回生成图片`);
}

/* ———— 4b. ComfyUI (/prompt -> /history -> /view) ———— */

function defaultComfyWorkflow(
  model: string,
  prompt: string,
  negativePrompt: string,
  width: number,
  height: number,
  steps: number,
  cfg: number,
  seed: number,
): Record<string, unknown> {
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: model },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["4", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: negativePrompt, clip: ["4", 1] },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "cp2077", images: ["8", 0] },
    },
  };
}

function applyComfyPlaceholders(
  node: unknown,
  vars: Readonly<Record<string, string | number>>,
): unknown {
  if (typeof node === "string") {
    const exact = /^\{\{([a-z_]+)\}\}$/.exec(node.trim());
    if (exact?.[1] && exact[1] in vars) return vars[exact[1]];
    let out = node;
    for (const [k, v] of Object.entries(vars)) {
      out = out.split(`{{${k}}}`).join(String(v));
    }
    return out;
  }
  if (Array.isArray(node)) return node.map((item) => applyComfyPlaceholders(item, vars));
  if (typeof node === "object" && node !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = applyComfyPlaceholders(v, vars);
    }
    return out;
  }
  return node;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new AbortedError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function generateComfyUi(
  provider: string,
  profile: Profile,
  apiKey: string | undefined,
  request: ImageGenerateRequest,
  signal?: AbortSignal,
): Promise<RawImageGenerateResult> {
  const base = cleanBaseUrl(profile.baseUrl, DEFAULT_BASE.comfyui);
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const { width, height } = dimensionsForRequest(request);
  const seed = request.seed ?? Math.floor(Math.random() * 2_147_483_647);
  const steps = request.steps ?? 24;
  const cfg = request.cfgScale ?? 7;
  const negativePrompt = request.negativePrompt?.trim() ?? "";

  let workflow: Record<string, unknown>;
  if (profile.comfyWorkflow?.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(profile.comfyWorkflow);
    } catch {
      throw new UpstreamError(`${provider} 的 ComfyUI 工作流 JSON 格式不合法`);
    }
    const replaced = applyComfyPlaceholders(parsed, {
      prompt: request.prompt.trim(),
      negative_prompt: negativePrompt,
      width,
      height,
      steps,
      cfg,
      seed,
      model: profile.model,
    });
    const obj = asRecord(replaced);
    if (!obj) throw new UpstreamError(`${provider} 的 ComfyUI 工作流必须是 JSON 对象`);
    workflow = obj;
  } else {
    workflow = defaultComfyWorkflow(
      profile.model,
      request.prompt.trim(),
      negativePrompt,
      width,
      height,
      steps,
      cfg,
      seed,
    );
  }

  const clientId = `cp2077-${Date.now().toString(36)}`;
  const queueRes = await postJson(
    provider,
    `${base}/prompt`,
    headers,
    { prompt: workflow, client_id: clientId },
    signal,
  );
  if (!queueRes.ok) {
    throw statusError(provider, queueRes.status, queueRes.message);
  }
  const promptId = asRecord(queueRes.json)?.prompt_id;
  if (typeof promptId !== "string" || !promptId) {
    throw new UpstreamError(`${provider} 没有返回 ComfyUI 任务 ID（prompt_id）`);
  }

  const deadline = Date.now() + COMFY_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(COMFY_POLL_MS, signal);
    const histRes = await get(
      provider,
      `${base}/history/${encodeURIComponent(promptId)}`,
      headers,
      signal,
    );
    if (!histRes.ok) continue;
    const histJson = asRecord(await histRes.json().catch(() => null));
    const entry = asRecord(histJson?.[promptId]);
    if (!entry) continue;

    const statusObj = asRecord(entry.status);
    if (statusObj?.status_str === "error") {
      throw new UpstreamError(`${provider} ComfyUI 执行工作流失败`);
    }
    const outputs = asRecord(entry.outputs);
    if (!outputs) continue;
    for (const nodeOut of Object.values(outputs)) {
      const images = asRecord(nodeOut)?.images;
      if (!Array.isArray(images) || images.length === 0) continue;
      const imgInfo = asRecord(images[0]);
      const filename = typeof imgInfo?.filename === "string" ? imgInfo.filename : "";
      if (!filename) continue;
      const params = new URLSearchParams({
        filename,
        subfolder: typeof imgInfo?.subfolder === "string" ? imgInfo.subfolder : "",
        type: typeof imgInfo?.type === "string" ? imgInfo.type : "output",
      });
      return fetchUrlAsDataUrl(provider, `${base}/view?${params.toString()}`, headers, signal);
    }
  }
  throw new UpstreamError(`${provider} ComfyUI 生成超时，请检查本地队列或工作流`);
}

/* ———— 5. NovelAI Diffusion V5 / V4.5 / V4 / V3 (/ai/generate-image) ———— */

function isRawImageBytes(bytes: Uint8Array): boolean {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return true;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return true;
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return true;
  }
  return false;
}

async function extractNovelAiZipImage(
  provider: string,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (isRawImageBytes(bytes)) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 30 || view.getUint32(0, true) !== 0x04034b50) {
    throw new UpstreamError(`${provider} 返回的数据既不是 ZIP 归档也不是有效图片`);
  }

  let method = view.getUint16(8, true);
  let compressedSize = view.getUint32(18, true);
  let localHeaderOffset = 0;

  // 若 Local File Header 因流式 Data Descriptor 未写 compressedSize，从末尾 Central Directory 读取
  const minEocd = Math.max(0, bytes.length - 65557);
  for (let pos = bytes.length - 22; pos >= minEocd; pos -= 1) {
    if (view.getUint32(pos, true) === 0x06054b50) {
      const cdOffset = view.getUint32(pos + 16, true);
      if (cdOffset + 46 <= bytes.length && view.getUint32(cdOffset, true) === 0x02014b50) {
        method = view.getUint16(cdOffset + 10, true);
        compressedSize = view.getUint32(cdOffset + 20, true);
        localHeaderOffset = view.getUint32(cdOffset + 42, true);
      }
      break;
    }
  }

  if (
    localHeaderOffset + 30 > bytes.length ||
    view.getUint32(localHeaderOffset, true) !== 0x04034b50
  ) {
    throw new UpstreamError(`${provider} 返回的 ZIP 文件头损坏`);
  }
  const fileNameLen = view.getUint16(localHeaderOffset + 26, true);
  const extraLen = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + fileNameLen + extraLen;
  if (compressedSize === 0 || dataStart + compressedSize > bytes.length) {
    throw new UpstreamError(`${provider} 返回的 ZIP 图像数据不完整`);
  }
  const slice = bytes.subarray(dataStart, dataStart + compressedSize);
  if (method === 0) return slice;
  if (method === 8) {
    if (typeof DecompressionStream === "undefined") {
      throw new UpstreamError("当前浏览器不支持 DecompressionStream，无法解压 NovelAI ZIP 响应");
    }
    const stream = new Blob([new Uint8Array(slice)])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    return readImageResponseBytes(new Response(stream), signal);
  }
  throw new UpstreamError(`${provider} 返回的 ZIP 压缩算法不受支持（method=${method}）`);
}

function novelAiGenerateUrl(baseUrl: string | undefined): string {
  const base = cleanBaseUrl(baseUrl, DEFAULT_BASE.novelai);
  if (base.endsWith("/ai/generate-image")) return base;
  if (base.endsWith("/ai")) return `${base}/generate-image`;
  return `${base}/ai/generate-image`;
}

async function generateNovelAi(
  provider: string,
  profile: Profile,
  apiKey: string,
  request: ImageGenerateRequest,
  signal?: AbortSignal,
): Promise<RawImageGenerateResult> {
  const url = novelAiGenerateUrl(profile.baseUrl);
  const model = profile.model.trim() || "nai-diffusion-5-full";
  const { width, height } = novelAiDimensionsFor(request);
  const prompt = request.prompt.trim();
  const negativePrompt = request.negativePrompt?.trim() ?? "";
  const steps = request.steps ?? 28;
  const scale = request.cfgScale ?? 5.5;
  const seed =
    request.seed !== undefined && request.seed >= 0
      ? request.seed
      : (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 2_147_483_647;
  const isV5 = /^nai-diffusion-5/i.test(model);
  const isV4OrV5 = isV5 || /^nai-diffusion-4/i.test(model);

  const parameters: Record<string, unknown> = {
    params_version: isV5 ? 4 : isV4OrV5 ? 3 : 1,
    width,
    height,
    scale,
    sampler: "k_euler_ancestral",
    steps,
    n_samples: 1,
    ucPreset: 0,
    qualityToggle: true,
    autoSmea: false,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    legacy: false,
    add_original_image: true,
    cfg_rescale: 0,
    noise_schedule: "karras",
    legacy_v3_extend: false,
    seed,
    negative_prompt: negativePrompt,
    ...(isV4OrV5
      ? {
          v4_prompt: {
            caption: {
              base_caption: prompt,
              char_captions: [],
            },
            use_coords: false,
            use_order: true,
          },
          v4_negative_prompt: {
            caption: {
              base_caption: negativePrompt,
              char_captions: [],
            },
            use_coords: false,
            use_order: true,
          },
        }
      : {}),
  };

  const body = {
    input: prompt,
    model,
    action: "generate",
    parameters,
  };

  const res = await post(
    provider,
    url,
    {
      authorization: `Bearer ${apiKey}`,
      accept: "application/x-zip-compressed, application/zip, application/octet-stream, image/png",
    },
    body,
    signal,
  );
  if (!res.ok) {
    const detail = await errorDetail(res);
    throw statusError(provider, res.status, detail.message);
  }
  const zipOrImgBytes = await readImageResponseBytes(res, signal);
  const imgBytes = await extractNovelAiZipImage(provider, zipOrImgBytes, signal);
  const b64 = imageBytesToBase64(imgBytes);
  return {
    ...toDataUrl(b64, "image/png"),
    actualSeed: seed,
  };
}

/* ———— 统一路由 ———— */

async function withImageDeadline<T>(
  operation: (requestSignal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  let timedOut = false;
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, IMAGE_REQUEST_TIMEOUT_MS);
  try {
    if (controller.signal.aborted) throw new AbortedError();
    const result = await operation(controller.signal);
    if (controller.signal.aborted) throw new AbortedError();
    return result;
  } catch (error) {
    if (timedOut) {
      throw new UpstreamError(
        "生图或图片下载等待超时，服务端任务可能仍在继续；请确认任务状态后再操作，没有自动重试。",
      );
    }
    if (signal?.aborted) throw new AbortedError();
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

async function requestImageWithProfile(
  profile: Profile,
  apiKey: string | undefined,
  request: ImageGenerateRequest,
  signal?: AbortSignal,
): Promise<RawImageGenerateResult> {
  const protocol = resolveImageProtocol(profile);
  const provider = `文生图方案「${profile.name}」`;
  switch (protocol) {
    case "openai-images":
      return generateOpenAiImages(provider, profile, apiKey, request, signal);
    case "openai-chat":
      return generateOpenAiChat(provider, profile, apiKey, request, signal);
    case "gemini-native":
      if (!apiKey) throw new UpstreamError(`${provider} 缺少 API 密钥`);
      return generateGeminiNative(provider, profile, apiKey, request, signal);
    case "gemini-imagen":
      if (!apiKey) throw new UpstreamError(`${provider} 缺少 API 密钥`);
      return generateGeminiImagen(provider, profile, apiKey, request, signal);
    case "sdwebui":
      return generateSdWebUi(provider, profile, apiKey, request, signal);
    case "comfyui":
      return generateComfyUi(provider, profile, apiKey, request, signal);
    case "novelai":
      if (!apiKey) throw new UpstreamError(`${provider} 缺少 NovelAI API 密钥`);
      return generateNovelAi(provider, profile, apiKey, request, signal);
  }
}

/** Freeze inputs before queueing; every actual generation call has exactly one request attempt. */
export function generateImageWithProfile(
  profile: Profile,
  apiKey: string | undefined,
  request: ImageGenerateRequest,
  signal?: AbortSignal,
): Promise<ImageGenerateResult> {
  const snapshot = Object.freeze({ ...profile });
  const original = Object.freeze({ ...request });
  const protocol = resolveImageProtocol(snapshot);
  const capabilities = imageProtocolCapabilities(protocol);
  if (original.negativePrompt?.trim() && !capabilities.negativePrompt) {
    return Promise.reject(
      new UpstreamError(
        "当前模型不支持独立负面提示词；请重新提炼提示词，或将排除要求写入正向提示词并清空负面提示词后再生成。",
        400,
      ),
    );
  }
  const sampling = capabilities.sampling
    ? {
        steps: original.steps ?? (protocol === "novelai" ? 28 : 24),
        cfgScale: original.cfgScale ?? (protocol === "novelai" ? 5.5 : 7),
        seed:
          original.seed !== undefined && original.seed >= 0
            ? original.seed
            : (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 2_147_483_647,
      }
    : {};
  const prepared = Object.freeze({ ...original, ...sampling });
  return imageGenerationQueue.run(
    () =>
      withImageDeadline(async (requestSignal) => {
        const warnings: string[] = [];
        if (original.aspectRatio && !capabilities.aspectRatio && !capabilities.size) {
          warnings.push(
            "当前对话生图协议没有独立画幅参数，本次未向提示词追加隐藏的比例要求；实际尺寸以返回图片为准。",
          );
        }
        if (original.size && !capabilities.size)
          warnings.push("当前协议不发送 size 参数，实际尺寸以返回图片为准。");
        if (protocol === "comfyui" && snapshot.comfyWorkflow?.trim()) {
          warnings.push(
            "本次使用自定义 ComfyUI 工作流；记录的提示词和采样参数为占位符输入，工作流内部固定值以该工作流为准。",
          );
        }
        if (
          !capabilities.sampling &&
          (original.steps !== undefined ||
            original.cfgScale !== undefined ||
            original.seed !== undefined)
        ) {
          warnings.push("当前协议不发送步数、CFG 或种子参数。");
        }
        let sentSize: string | undefined;
        if (protocol === "openai-images")
          sentSize = openAiSizeFor(snapshot.model, original.aspectRatio, original.size);
        else if (protocol === "novelai") {
          const size = novelAiDimensionsFor(prepared);
          sentSize = `${size.width}x${size.height}`;
        } else if (capabilities.size) {
          const size = dimensionsForRequest(prepared);
          sentSize = `${size.width}x${size.height}`;
        }
        const raw = await requestImageWithProfile(snapshot, apiKey, prepared, requestSignal);
        if (requestSignal.aborted) throw new AbortedError();
        const validated = await validateImageDataUrl(raw.dataUrl, requestSignal);
        const ratio = original.aspectRatio?.split(":").map(Number);
        if (ratio?.[0] && ratio[1]) {
          const expected = ratio[0] / ratio[1];
          if (Math.abs(validated.width / validated.height / expected - 1) > 0.01) {
            warnings.push(
              `请求画幅为 ${original.aspectRatio}，实际返回 ${validated.width}×${validated.height}；已保留原图，未自动裁切或拉伸。`,
            );
          }
        }
        if (
          original.size &&
          original.size !== "auto" &&
          original.size !== `${validated.width}x${validated.height}`
        ) {
          warnings.push(
            `请求尺寸为 ${original.size}，实际返回 ${validated.width}×${validated.height}。`,
          );
        }
        const metadata: ImageGenerationMetadata = {
          profileName: snapshot.name,
          model: snapshot.model,
          protocol,
          requestedPrompt: original.prompt,
          sentPrompt: capabilities.sampling ? prepared.prompt.trim() : prepared.prompt,
          ...(original.aspectRatio ? { requestedAspectRatio: original.aspectRatio } : {}),
          ...(original.size ? { requestedSize: original.size } : {}),
          ...(sentSize ? { sentSize } : {}),
          ...(original.negativePrompt !== undefined
            ? { negativePrompt: original.negativePrompt }
            : {}),
          ...sampling,
          ...(raw.actualSeed !== undefined ? { seed: raw.actualSeed } : {}),
          ...(warnings.length ? { warnings } : {}),
        };
        return {
          ...validated,
          ...(raw.revisedPrompt ? { revisedPrompt: raw.revisedPrompt } : {}),
          metadata,
        };
      }, signal),
    signal,
  );
}

export class ImageRouter {
  constructor(private readonly config: ConfigService) {}

  async resolve(profileNameOverride?: string): Promise<ImageResolved> {
    const state = await this.config.load();
    if (state.status !== "ok") {
      return { ok: false, error: `模型配置还不能用：${state.errors.join("；")}` };
    }
    const name = profileNameOverride ?? state.config.image;
    if (name === undefined) {
      return {
        ok: false,
        error: "还没有选文生图模型：到设置页「模型连接」添加或选择一个连接，再点「设为文生图模型」",
      };
    }
    const profile = state.config.profiles.find((p) => p.name === name);
    if (!profile) {
      return { ok: false, error: `文生图模型指向的方案「${name}」不存在` };
    }
    if (profile.type === "anthropic") {
      return {
        ok: false,
        error: `方案「${profile.name}」是 anthropic 类型，不支持文生图；请改用 OpenAI 兼容、Gemini、SD WebUI 或 ComfyUI`,
      };
    }
    const key = this.config.keyFor(profile);
    if (
      !key &&
      profile.type !== "ollama" &&
      profile.type !== "sdwebui" &&
      profile.type !== "comfyui"
    ) {
      return {
        ok: false,
        error: `文生图方案「${profile.name}」没有密钥：到设置页粘贴密钥并保存`,
      };
    }
    return {
      ok: true,
      profile,
      protocol: resolveImageProtocol(profile),
      apiKey: key,
    };
  }

  async generate(
    request: ImageGenerateRequest,
    signal?: AbortSignal,
    profileNameOverride?: string,
  ): Promise<ImageGenerateResult> {
    const snapshot = { ...request };
    const resolved = await this.resolve(profileNameOverride);
    if (!resolved.ok) throw new UpstreamError(resolved.error);
    if (signal?.aborted) throw new AbortedError();
    return generateImageWithProfile(resolved.profile, resolved.apiKey, snapshot, signal);
  }
}
