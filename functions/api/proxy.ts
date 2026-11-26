/**
 * 无状态 CORS 转发：浏览器直连不了不带 CORS 头的上游时，由同源的 /api/proxy 代发。
 * 目标地址放在请求头 x-relay-target；不保存、不记录任何密钥或请求内容。
 * Cloudflare Pages Function 和 vite 开发中间件共用这一份处理函数。
 */

export const RELAY_TARGET_HEADER = "x-relay-target";
/** 转发层自己拒绝或失败时带上，前端据此区分「转发层的错」和「上游的错」 */
export const RELAY_ERROR_HEADER = "x-relay-error";

const DROP_REQUEST_HEADERS = new Set([
  "host",
  "cookie",
  "origin",
  "referer",
  "connection",
  "content-length",
  "accept-encoding",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  RELAY_TARGET_HEADER,
]);

const DROP_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "set-cookie2",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

function refuse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", [RELAY_ERROR_HEADER]: "1" },
  });
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** 只放行公网 http(s) 目标；返回 undefined 表示通过，否则返回拒绝原因 */
export function rejectTarget(target: URL, selfHost: string): string | undefined {
  if (target.protocol !== "https:" && target.protocol !== "http:")
    return "只支持 http 或 https 目标";
  if (target.username || target.password) return "目标地址不能带账号密码";
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === selfHost.toLowerCase()) return "不能转发到本站自身";
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (!host.includes(".") && !host.includes(":"))
  ) {
    return "不转发本机或内网地址";
  }
  if (isPrivateIpv4(host)) return "不转发内网地址";
  if (host.includes(":")) {
    // IPv6 字面量：回环、唯一本地、链路本地、IPv4 映射一律拒绝
    if (
      host === "::1" ||
      host === "::" ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host) ||
      host.startsWith("::ffff:")
    ) {
      return "不转发内网地址";
    }
  }
  return undefined;
}

function sameOrigin(request: Request, selfOrigin: string): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === selfOrigin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export async function handleRelay(request: Request): Promise<Response> {
  const self = new URL(request.url);
  if (!sameOrigin(request, self.origin)) return refuse(403, "只接受本站页面发起的转发请求");

  const rawTarget = request.headers.get(RELAY_TARGET_HEADER);
  if (!rawTarget) return refuse(400, `缺少 ${RELAY_TARGET_HEADER} 请求头`);
  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    return refuse(400, "转发目标地址格式不正确");
  }
  const reason = rejectTarget(target, self.hostname);
  if (reason) return refuse(403, reason);

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const key = name.toLowerCase();
    if (DROP_REQUEST_HEADERS.has(key) || key.startsWith("cf-") || key.startsWith("sec-")) continue;
    headers.set(name, value);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: hasBody ? request.body : null,
      redirect: "follow",
      // 流式请求体在部分运行时需要声明 half
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (error) {
    const reasonText = error instanceof Error ? error.message : String(error);
    return refuse(502, `转发层连不上目标：${reasonText}`);
  }

  const out = new Headers();
  for (const [name, value] of upstream.headers) {
    if (!DROP_RESPONSE_HEADERS.has(name.toLowerCase())) out.set(name, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}

/** Cloudflare Pages Functions 入口 */
export const onRequest = (context: { request: Request }): Promise<Response> =>
  handleRelay(context.request);
