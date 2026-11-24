/**
 * 浏览器端轻量异常捕获环缓冲：
 * 自动记录运行期间的未捕获 JS 异常、Promise 拒绝与接口错误，导出诊断包时随附，
 * 并对常见 API 密钥格式做兜底脱敏，避免任何敏感凭证泄漏。
 */

export interface ClientDiagnosticError {
  readonly at: string;
  readonly source: "window.error" | "unhandledrejection" | "api";
  readonly message: string;
  readonly detail?: string;
}

const MAX_CLIENT_ERRORS = 50;
const clientErrors: ClientDiagnosticError[] = [];
let installed = false;

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{12,}/g,
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

export function getClientDiagnosticErrors(): readonly ClientDiagnosticError[] {
  return [...clientErrors];
}

export function clearClientDiagnosticErrors(): void {
  clientErrors.length = 0;
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
