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
    return new UpstreamError(
      `${provider} 拒绝了密钥，请检查 config.json 里的密钥或环境变量${tail}`,
      status,
    );
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

async function send(
  provider: string,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw new AbortedError();
    const reason =
      error instanceof Error
        ? error.cause instanceof Error
          ? error.cause.message
          : error.message
        : String(error);
    throw new UpstreamError(`连不上 ${provider}：${reason}`, undefined, true);
  }
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

/** 读出错误响应里的说明文字，兼容 {error: {message, code}} 和 {error: "..."} 两种写法 */
export async function errorDetail(res: Response): Promise<{ message: string; code?: string }> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text) as {
      error?: { message?: unknown; code?: unknown; status?: unknown } | string;
    };
    if (typeof json.error === "string") return { message: json.error };
    const message = typeof json.error?.message === "string" ? json.error.message : "";
    const code =
      typeof json.error?.code === "string" && json.error.code !== ""
        ? json.error.code
        : typeof json.error?.status === "string"
          ? json.error.status
          : undefined;
    return code ? { message, code } : { message };
  } catch {
    return { message: text.trim().slice(0, 300) };
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
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;
  let id: string | undefined;
  let data: string[] = [];
  const flush = (): SseEvent | undefined => {
    const out =
      data.length > 0
        ? { data: data.join("\n"), ...(event ? { event } : {}), ...(id ? { id } : {}) }
        : undefined;
    event = undefined;
    data = [];
    return out;
  };
  try {
    while (true) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch {
        if (signal?.aborted) throw new AbortedError();
        throw new UpstreamError(`${provider} 的连接中途断开`, undefined, true);
      }
      if (chunk.done) break;
      // stream: true 让被切开的多字节汉字留到下一块再解码
      buffer += decoder.decode(chunk.value, { stream: true });
      let newline = buffer.search(/\r\n|\r|\n/);
      // 末尾单独的 \r 可能是 \r\n 的前半，等下一块再处理
      while (newline >= 0 && !(buffer[newline] === "\r" && newline === buffer.length - 1)) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer.startsWith("\r\n", newline) ? 2 : 1));
        if (line === "") {
          const out = flush();
          if (out) yield out;
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "data") data.push(value);
          else if (field === "event") event = value;
          else if (field === "id") id = value;
        }
        newline = buffer.search(/\r\n|\r|\n/);
      }
    }
    if (signal?.aborted) throw new AbortedError();
    const out = flush();
    if (out) yield out;
  } finally {
    await reader.cancel().catch(() => {});
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
