/**
 * 浏览器直连上游；上游没有放行 CORS（或网络不通）时，自动改走同源的 /api/proxy 转发。
 * 转发层只做无状态透传，密钥仍由浏览器每次请求带上。
 * 本机和内网地址不会转发（转发层本来就拒绝），仍需上游自己放行 CORS。
 */

const RELAY_PATH = "/api/proxy";
const RELAY_TARGET_HEADER = "x-relay-target";
const RELAY_ERROR_HEADER = "x-relay-error";

/** 本次页面生命周期里已确认直连不通的域名：之后直接走转发，省掉一次必败的直连 */
const relayHosts = new Set<string>();

function relayAvailable(): boolean {
  const loc = (globalThis as { location?: { protocol?: string } }).location;
  return loc?.protocol === "http:" || loc?.protocol === "https:";
}

function isLocalHost(host: string): boolean {
  host = host
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (!host.includes(".") && !host.includes(":"))
  ) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
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
  return (
    host.includes(":") &&
    (host === "::1" ||
      host === "::" ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host) ||
      host.startsWith("::ffff:"))
  );
}

function viaRelay(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(RELAY_TARGET_HEADER, url);
  return fetch(RELAY_PATH, { ...init, headers, credentials: "omit" });
}

export async function relayFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return fetch(url, init);
  }
  const host = target.host;
  const canRelay =
    relayAvailable() &&
    (target.protocol === "http:" || target.protocol === "https:") &&
    !isLocalHost(target.hostname);
  if (canRelay && relayHosts.has(host)) {
    const res = await viaRelay(url, init);
    // 转发层自己拒绝或失败：当作网络错误，让调用方给出统一的「连不上」提示
    if (res.headers.get(RELAY_ERROR_HEADER)) {
      throw new TypeError(`转发层：${await res.text().catch(() => res.statusText)}`);
    }
    return res;
  }
  try {
    return await fetch(url, init);
  } catch (error) {
    if (init.signal?.aborted || !canRelay) throw error;
    // 直连失败（多半是对方没放行 CORS）：改走转发
    let res: Response;
    try {
      res = await viaRelay(url, init);
    } catch {
      throw error;
    }
    if (res.headers.get(RELAY_ERROR_HEADER)) throw error;
    relayHosts.add(host);
    return res;
  }
}
