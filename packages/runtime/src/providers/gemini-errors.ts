import { UpstreamError } from "./http";

export const GEMINI_BLOCK_REASONS: ReadonlySet<string> = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "JAILBREAK",
  "REFUSAL",
  "CONTENT_FILTER",
  "CONTENT_POLICY_VIOLATION",
  "SENSITIVE_WORDS_DETECTED",
]);

/** 同时识别原生错误与网关 error envelope，数字 HTTP code 不能遮住安全 status。 */
export function isGeminiBlockedError(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const detail = value as { readonly code?: unknown; readonly status?: unknown; error?: unknown };
  const nested =
    detail.error && typeof detail.error === "object"
      ? (detail.error as { readonly code?: unknown; readonly status?: unknown })
      : undefined;
  return [detail.code, detail.status, nested?.code, nested?.status].some(
    (code) => typeof code === "string" && GEMINI_BLOCK_REASONS.has(code.trim().toUpperCase()),
  );
}

/** 缓存创建也会接收提示词；被拦截后禁止降级重发完整提示词。 */
export class GeminiCacheBlockedError extends UpstreamError {
  constructor() {
    super("Gemini 拦截了上下文缓存内容，本次未继续生成，请修改输入后重试");
    this.name = "GeminiCacheBlockedError";
  }
}
