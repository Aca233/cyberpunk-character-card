/** 各家提供方共用的 HTTP 和 SSE 工具；报错文字给玩家看，统一用中文，调用方负责脱敏 */

export class UpstreamError extends Error {
  constructor(
    message: string,
    /** 上游的 HTTP 状态码；网络错误、超时没有状态码 */
    readonly status?: number,
    /** 可以稍后重试（限流、上游 5xx、网络中断） */
    readonly retryable = false,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export class AbortedError extends Error {
  constructor() {
    super("已停止生成");
    this.name = "AbortedError";
  }
}

/** 按状态码给出中文说明；detail 是上游返回的错误信息，调用方脱敏后再展示 */
export function statusError(provider: string, status: number, detail: string): UpstreamError {
  const tail = detail ? `：${detail.slice(0, 300)}` : "";
  if (status === 401 || status === 403)
    return new UpstreamError(`${provider} 拒绝了密钥，请检查设置中的 API 密钥${tail}`, status);
  if (status === 404)
    return new UpstreamError(
      `${provider} 找不到这个接口或模型，请检查 baseUrl 和 model${tail}`,
      status,
    );
  if (status === 429)
    return new UpstreamError(`${provider} 限流或额度用完，请稍后再试${tail}`, status, true);
  if (status >= 500)
    return new UpstreamError(`${provider} 服务暂时不可用（HTTP ${status}）${tail}`, status, true);
  return new UpstreamError(`${provider} 拒绝了请求（HTTP ${status}）${tail}`, status);
}

const NETWORK_RETRY_DELAYS_MS = [800, 1_800] as const;

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new AbortedError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function send(
  provider: string,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= NETWORK_RETRY_DELAYS_MS.length; attempt += 1) {
    if (signal?.aborted) throw new AbortedError();
    try {
      return await fetch(url, {
        ...init,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw new AbortedError();
      lastError = error;
      const delay = NETWORK_RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) {
        await sleepWithAbort(delay, signal);
      }
    }
  }
  const reason =
    lastError instanceof Error
      ? lastError.cause instanceof Error
        ? lastError.cause.message
        : lastError.message
      : String(lastError);
  throw new UpstreamError(`连不上 ${provider}：${reason}`, undefined, true);
}

/** 发 POST 请求；网络失败和停止都转成上面两种错误 */
export async function post(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return send(
    provider,
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
      body: JSON.stringify(body),
    },
    signal,
  );
}

/** 发 GET 请求；网络失败和停止都转成上面两种错误 */
export async function get(
  provider: string,
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  return send(
    provider,
    url,
    {
      method: "GET",
      headers: { accept: "application/json", ...headers },
    },
    signal,
  );
}

/** 读出错误响应里的说明文字，兼容 {error: {message, code}}、{error: "..."} 及顶层 {message|detail|msg} */
export async function errorDetail(res: Response): Promise<{ message: string; code?: string }> {
  const text = await res.text().catch(() => "");
  const trimmed = text.trim();
  if (!trimmed) return { message: "" };
  try {
    const json = JSON.parse(trimmed) as {
      error?: { message?: unknown; code?: unknown; status?: unknown } | string;
      message?: unknown;
      detail?: unknown;
      msg?: unknown;
      statusMessage?: unknown;
      code?: unknown;
    };
    if (typeof json.error === "string" && json.error.trim()) {
      return { message: json.error.trim() };
    }
    const nestedError = typeof json.error === "object" && json.error !== null ? json.error : null;
    const candidates = [
      nestedError?.message,
      json.message,
      json.detail,
      json.msg,
      json.statusMessage,
    ];
    let message = "";
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim() !== "") {
        message = candidate.trim();
        break;
      }
    }
    if (!message) {
      message = trimmed.slice(0, 300);
    }
    const rawCode = nestedError?.code ?? nestedError?.status ?? json.code;
    const code =
      typeof rawCode === "string" && rawCode.trim() !== ""
        ? rawCode.trim()
        : typeof rawCode === "number"
          ? String(rawCode)
          : undefined;
    return code ? { message, code } : { message };
  } catch {
    return { message: trimmed.slice(0, 300) };
  }
}

export interface SseEvent {
  readonly event?: string;
  readonly id?: string;
  readonly data: string;
}

/** 按 SSE 规范逐条读出事件；停止时抛 AbortedError，连接中途断开抛可重试的 UpstreamError */
export async function* readSse(
  provider: string,
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  if (signal?.aborted) {
    void body.cancel().catch(() => {});
    throw new AbortedError();
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;
  let id: string | undefined;
  let data: string[] = [];
  let rejectAbort: ((error: Error) => void) | undefined;
  const aborted = signal
    ? new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
      })
    : undefined;
  aborted?.catch(() => {});
  const onAbort = () => {
    void reader.cancel().catch(() => {});
    rejectAbort?.(new AbortedError());
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const flush = (): SseEvent | undefined => {
    const out =
      data.length > 0
        ? { data: data.join("\n"), ...(event ? { event } : {}), ...(id ? { id } : {}) }
        : undefined;
    event = undefined;
    data = [];
    return out;
  };
  const consumeLine = (line: string): SseEvent | undefined => {
    if (line === "") return flush();
    if (!line.startsWith(":")) {
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "data") data.push(value);
      else if (field === "event") event = value;
      else if (field === "id") id = value;
    }
    return undefined;
  };
  try {
    while (true) {
      if (signal?.aborted) throw new AbortedError();
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = aborted ? await Promise.race([reader.read(), aborted]) : await reader.read();
      } catch (error) {
        if (error instanceof AbortedError || signal?.aborted) throw new AbortedError();
        throw new UpstreamError(`${provider} 的连接中途断开`, undefined, true);
      }
      if (signal?.aborted) throw new AbortedError();
      if (chunk.done) break;
      // stream: true 让被切开的多字节汉字留到下一块再解码
      buffer += decoder.decode(chunk.value, { stream: true });
      let newline = buffer.search(/\r\n|\r|\n/);
      // 末尾单独的 \r 可能是 \r\n 的前半，等下一块再处理
      while (newline >= 0 && !(buffer[newline] === "\r" && newline === buffer.length - 1)) {
        if (signal?.aborted) throw new AbortedError();
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer.startsWith("\r\n", newline) ? 2 : 1));
        const out = consumeLine(line);
        if (out) yield out;
        newline = buffer.search(/\r\n|\r|\n/);
      }
    }
    if (signal?.aborted) throw new AbortedError();
    // 流结束时刷新解码器残留字节并处理无尾换行的末行
    buffer += decoder.decode();
    if (buffer !== "") {
      for (const line of buffer.split(/\r\n|\r|\n/)) {
        if (signal?.aborted) throw new AbortedError();
        const out = consumeLine(line);
        if (out) yield out;
      }
    }
    if (signal?.aborted) throw new AbortedError();
    const out = flush();
    if (out) yield out;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    void reader.cancel().catch(() => {});
  }
}

/** 把 core 的 AbortSignalLike 接到真正的 AbortSignal 上，供 fetch 使用 */
export function toAbortSignal(signal?: {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
}): AbortSignal | undefined {
  if (!signal) return undefined;
  if (signal instanceof AbortSignal) return signal;
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", () => controller.abort());
  return controller.signal;
}
