/**
 * 浏览器端运行态诊断采集：
 * - 自动记录未捕获 JS 异常、Promise 拒绝与接口错误（最近 50 条）
 * - 自动记录最近 60 次内部 /api/* 调用轨迹（方法、路径、状态码、耗时、报错）
 * - 采集浏览器存储配额（IndexedDB 已用 / 总配额）
 * - 对常见 API 密钥格式做兜底脱敏，避免任何敏感凭证泄漏
 */

export interface ClientDiagnosticError {
  readonly at: string;
  readonly source: "window.error" | "unhandledrejection" | "api";
  readonly message: string;
  readonly detail?: string;
}

export interface ClientApiTrace {
  readonly at: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly ok: boolean;
  readonly ms: number;
  readonly error?: string;
}

export interface ClientStorageEstimate {
  readonly usageBytes: number | null;
  readonly quotaBytes: number | null;
  readonly usagePercent: number | null;
}

const MAX_CLIENT_ERRORS = 50;
const MAX_API_TRACES = 60;
const clientErrors: ClientDiagnosticError[] = [];
const apiTraces: ClientApiTrace[] = [];
let installed = false;

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /nk-[A-Za-z0-9_-]{12,}/g,
  /pst-[A-Za-z0-9_-]{12,}/g,
  /AIza[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]{12,}/gi,
  /(api[_-]?key|x-api-key|authorization)\s*[:=]\s*["']?[^\s"',;]{8,}["']?/gi,
];

export function redactPossibleSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

function sanitizeTracePath(path: string): string {
  const idx = path.indexOf("?");
  return idx >= 0 ? path.slice(0, idx) : path;
}

export function recordClientDiagnosticError(
  source: ClientDiagnosticError["source"],
  message: string,
  detail?: string,
): void {
  const cleanMessage = redactPossibleSecrets(message).slice(0, 600);
  const cleanDetail = detail ? redactPossibleSecrets(detail).slice(0, 1200) : undefined;
  clientErrors.push({
    at: new Date().toISOString(),
    source,
    message: cleanMessage,
    ...(cleanDetail ? { detail: cleanDetail } : {}),
  });
  if (clientErrors.length > MAX_CLIENT_ERRORS) clientErrors.shift();
}

export function recordClientApiTrace(entry: {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly ok: boolean;
  readonly ms: number;
  readonly error?: string;
}): void {
  const cleanPath = sanitizeTracePath(entry.path);
  if (cleanPath.startsWith("/diagnostics")) return;
  const cleanError = entry.error ? redactPossibleSecrets(entry.error).slice(0, 400) : undefined;
  apiTraces.push({
    at: new Date().toISOString(),
    method: entry.method.toUpperCase(),
    path: cleanPath,
    status: entry.status,
    ok: entry.ok,
    ms: Math.max(0, Math.round(entry.ms)),
    ...(cleanError ? { error: cleanError } : {}),
  });
  if (apiTraces.length > MAX_API_TRACES) apiTraces.shift();
}

export function getClientDiagnosticErrors(): readonly ClientDiagnosticError[] {
  return [...clientErrors];
}

export function clearClientDiagnosticErrors(): void {
  clientErrors.length = 0;
}

export function getClientApiTraces(): readonly ClientApiTrace[] {
  return [...apiTraces];
}

export function clearClientApiTraces(): void {
  apiTraces.length = 0;
}

export async function collectStorageEstimate(): Promise<ClientStorageEstimate | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    const usage = typeof est.usage === "number" ? est.usage : null;
    const quota = typeof est.quota === "number" && est.quota > 0 ? est.quota : null;
    const usagePercent =
      usage !== null && quota !== null ? Math.round((usage / quota) * 10000) / 100 : null;
    return { usageBytes: usage, quotaBytes: quota, usagePercent };
  } catch {
    return null;
  }
}

export function installClientErrorCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    const loc = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined;
    const stack = event.error instanceof Error ? event.error.stack : undefined;
    recordClientDiagnosticError("window.error", event.message || "未捕获脚本错误", stack ?? loc);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "未处理的异步异常";
    const stack = reason instanceof Error ? reason.stack : undefined;
    recordClientDiagnosticError("unhandledrejection", msg, stack);
  });
}
