/**
 * 社区创意工坊纯 Web 标准处理核心（零外部依赖）：
 * Cloudflare Pages Function（D1）与 Vite 本地开发中间件共用这一份逻辑。
 * - 强制同源校验（写操作）
 * - 强制单包体积上限 512 KB 与严格白名单结构校验（只允许纯数据 JSON）
 * - 匿名发布密钥（editToken）仅存 SHA-256 哈希，不存明文；支持凭密钥更新/下架
 * - 支持可选管理员密钥（WORKSHOP_ADMIN_TOKEN）下架违规包
 */

export const WORKSHOP_TOKEN_HEADER = "x-workshop-token";
export const WORKSHOP_PACK_MAX_BYTES = 512 * 1024;
export const WORKSHOP_COVER_MAX_BYTES = 180 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_WRITES = 12;

const PACK_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_TOP_KEYS = new Set([
  "format",
  "version",
  "id",
  "title",
  "author",
  "description",
  "characters",
  "modules",
  "acquaintances",
  "npcs",
  "seedNpcs",
  "items",
  "cyberware",
  "braindances",
  "chipContents",
  "shopListings",
  "ripperdocListings",
]);

const ARRAY_LIMITS: Readonly<Record<string, number>> = {
  characters: 20,
  modules: 200,
  acquaintances: 100,
  npcs: 200,
  seedNpcs: 200,
  items: 500,
  cyberware: 300,
  braindances: 100,
  chipContents: 500,
  shopListings: 500,
  ripperdocListings: 300,
};

export interface CommunityPackSummaryCounts {
  readonly characters: number;
  readonly modules: number;
  readonly acquaintances: number;
  readonly npcs: number;
  readonly items: number;
  readonly weapons: number;
  readonly cyberware: number;
  readonly braindances: number;
  readonly chipContents: number;
  readonly listings: number;
}

export interface CommunityPackSummary {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly description: string;
  readonly summary: CommunityPackSummaryCounts;
  readonly entryCount: number;
  readonly byteSize: number;
  readonly downloads: number;
  readonly revision: number;
  readonly coverHash: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredCommunityCover {
  readonly packId: string;
  readonly mimeType: "image/webp" | "image/png" | "image/jpeg";
  readonly dataBase64: string;
  readonly byteSize: number;
  readonly coverHash: string;
  readonly updatedAt: string;
}

export interface StoredCommunityPack {
  readonly item: CommunityPackSummary;
  readonly packJson: string;
  readonly editTokenHash: string;
}

export type CommunityCategoryFilter =
  | "all"
  | "characters"
  | "cyberware"
  | "items"
  | "npcs"
  | "modules"
  | "media"
  | "listings";

export type CommunitySortKey = "popular" | "newest" | "updated";

export interface CommunityListQuery {
  readonly q: string;
  readonly category: CommunityCategoryFilter;
  readonly sort: CommunitySortKey;
  readonly page: number;
  readonly pageSize: number;
}

export interface CommunityListResult {
  readonly items: readonly CommunityPackSummary[];
  readonly total: number;
}

export interface NewCommunityPackRecord {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly description: string;
  readonly summary: CommunityPackSummaryCounts;
  readonly entryCount: number;
  readonly byteSize: number;
  readonly packJson: string;
  readonly editTokenHash: string;
  readonly nowIso: string;
}

export interface UpdateCommunityPackRecord {
  readonly title: string;
  readonly author: string;
  readonly description: string;
  readonly summary: CommunityPackSummaryCounts;
  readonly entryCount: number;
  readonly byteSize: number;
  readonly packJson: string;
  readonly nowIso: string;
}

export interface CommunityWorkshopStore {
  list(query: CommunityListQuery): Promise<CommunityListResult>;
  get(
    id: string,
    options?: { readonly incrementDownload?: boolean },
  ): Promise<StoredCommunityPack | null>;
  create(
    record: NewCommunityPackRecord,
  ): Promise<
    | { readonly ok: true; readonly item: CommunityPackSummary }
    | { readonly ok: false; readonly reason: "exists" }
  >;
  update(id: string, patch: UpdateCommunityPackRecord): Promise<CommunityPackSummary | null>;
  remove(id: string): Promise<boolean>;
  getCover(packId: string): Promise<StoredCommunityCover | null>;
  putCover(cover: StoredCommunityCover): Promise<void>;
  deleteCover(packId: string): Promise<boolean>;
  hitRateLimit?(
    bucketKey: string,
    windowMs: number,
    maxHits: number,
    nowMs: number,
  ): Promise<boolean>;
}

export interface CommunityWorkshopOptions {
  readonly adminToken?: string | undefined;
  readonly clientIp?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function sameOrigin(request: Request, selfOrigin: string): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === selfOrigin;
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "same-origin" || fetchSite === null;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return bytesToHex(new Uint8Array(digest));
}

/** 严格按二进制魔数识别图片格式，拒绝 SVG/HTML 等可执行类型 */
function detectImageMime(bytes: Uint8Array): "image/webp" | "image/png" | "image/jpeg" | null {
  if (bytes.length < 12) return null;
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

function generateEditToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return `cpwk_${bytesToHex(bytes)}`;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ValidatedUpload {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly description: string;
  readonly summary: CommunityPackSummaryCounts;
  readonly entryCount: number;
  readonly byteSize: number;
  readonly canonicalJson: string;
}

function validateUploadPayload(
  rawText: string,
):
  | { readonly ok: true; readonly data: ValidatedUpload }
  | { readonly ok: false; readonly error: string } {
  const byteSize = new TextEncoder().encode(rawText).byteLength;
  if (byteSize === 0) return { ok: false, error: "请求体不能为空" };
  if (byteSize > WORKSHOP_PACK_MAX_BYTES) {
    return {
      ok: false,
      error: `内容包体积超限（${Math.ceil(byteSize / 1024)} KB），上限为 ${WORKSHOP_PACK_MAX_BYTES / 1024} KB`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "内容包不是合法的 JSON" };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: "内容包顶层必须是 JSON 对象" };
  }

  for (const key of Object.keys(parsed)) {
    if (!ALLOWED_TOP_KEYS.has(key)) {
      return { ok: false, error: `内容包包含不支持的顶层字段：${key}` };
    }
  }

  if (parsed.format !== undefined && parsed.format !== "cp2077-workshop-pack") {
    return { ok: false, error: 'format 必须为 "cp2077-workshop-pack"' };
  }
  if (parsed.version !== undefined && parsed.version !== 2) {
    return { ok: false, error: "仅支持 v2 版本内容包（version: 2）" };
  }

  const rawId = typeof parsed.id === "string" ? parsed.id.trim() : "";
  if (!rawId || rawId.length > 22 || !PACK_ID_RE.test(rawId)) {
    return { ok: false, error: "内容包 id 需为 1–22 位小写英文、数字和单个连字符" };
  }
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  if (!title || title.length > 40) {
    return { ok: false, error: "包名不能为空且不超过 40 字" };
  }
  const author = typeof parsed.author === "string" ? parsed.author.trim() : "";
  if (author.length > 40) {
    return { ok: false, error: "作者署名不能超过 40 字" };
  }
  const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
  if (description.length > 300) {
    return { ok: false, error: "简介不能超过 300 字" };
  }

  const arrays: Record<string, unknown[]> = {};
  for (const [field, limit] of Object.entries(ARRAY_LIMITS)) {
    const val = parsed[field];
    if (val === undefined) {
      arrays[field] = [];
      continue;
    }
    if (!Array.isArray(val)) {
      return { ok: false, error: `字段 ${field} 必须是数组` };
    }
    if (val.length > limit) {
      return { ok: false, error: `字段 ${field} 条目数超过上限（最多 ${limit} 条）` };
    }
    arrays[field] = val;
  }

  const uniqueGroups = [
    "modules",
    "npcs",
    "items",
    "cyberware",
    "braindances",
    "chipContents",
  ] as const;
  const seenGlobal = new Set<string>();
  const localNpcIds = new Set<string>();
  for (const group of uniqueGroups) {
    const list = arrays[group] ?? [];
    for (const item of list) {
      if (!isPlainObject(item) || typeof item.id !== "string") {
        return { ok: false, error: `${group} 中存在缺少合法 id 的条目` };
      }
      if (item.id.length < 1 || item.id.length > 33 || !PACK_ID_RE.test(item.id)) {
        return { ok: false, error: `${group} 条目 id「${item.id}」格式不合法` };
      }
      if (seenGlobal.has(item.id)) {
        return { ok: false, error: `内容包内存在重复条目 id：${item.id}` };
      }
      seenGlobal.add(item.id);
      if (group === "npcs") localNpcIds.add(item.id);
    }
  }

  const seedNpcs: string[] = [];
  for (const [index, value] of (arrays.seedNpcs ?? []).entries()) {
    const id = typeof value === "string" ? value.trim() : "";
    if (!id || id.length > 33 || !PACK_ID_RE.test(id)) {
      return { ok: false, error: `seedNpcs[${index}] 人物 id 格式不合法` };
    }
    if (!localNpcIds.has(id)) {
      return { ok: false, error: `seedNpcs[${index}] 没有这个包内人物：${id}` };
    }
    seedNpcs.push(id);
  }

  for (const cw of arrays.cyberware ?? []) {
    if (isPlainObject(cw) && (typeof cw.price !== "number" || cw.price <= 0)) {
      return { ok: false, error: `义体「${String(cw.name ?? cw.id)}」价格必须大于 0` };
    }
  }

  const charactersList = arrays.characters ?? [];
  for (const ch of charactersList) {
    if (!isPlainObject(ch) || typeof ch.name !== "string" || ch.name.trim().length === 0) {
      return { ok: false, error: "角色卡条目缺少合法名称" };
    }
  }

  const itemsList = arrays.items ?? [];
  const weaponsCount = itemsList.filter((i) => isPlainObject(i) && i.kind === "weapon").length;
  const charactersCount = charactersList.length;
  const modulesCount = (arrays.modules ?? []).length;
  const acquaintancesCount = (arrays.acquaintances ?? []).length;
  const npcsCount = (arrays.npcs ?? []).length;
  const cyberwareCount = (arrays.cyberware ?? []).length;
  const braindancesCount = (arrays.braindances ?? []).length;
  const chipContentsCount = (arrays.chipContents ?? []).length;
  const listingsCount =
    (arrays.shopListings ?? []).length + (arrays.ripperdocListings ?? []).length;
  const seedNpcsCount = seedNpcs.length;

  const entryCount =
    charactersCount +
    modulesCount +
    acquaintancesCount +
    npcsCount +
    seedNpcsCount +
    itemsList.length +
    cyberwareCount +
    braindancesCount +
    chipContentsCount +
    listingsCount;

  if (entryCount === 0) {
    return { ok: false, error: "不能上传空内容包，请至少包含 1 项条目" };
  }

  const normalized = {
    format: "cp2077-workshop-pack" as const,
    version: 2 as const,
    id: rawId,
    title,
    author,
    description,
    characters: charactersList,
    modules: arrays.modules ?? [],
    acquaintances: arrays.acquaintances ?? [],
    npcs: arrays.npcs ?? [],
    seedNpcs,
    items: itemsList,
    cyberware: arrays.cyberware ?? [],
    braindances: arrays.braindances ?? [],
    chipContents: arrays.chipContents ?? [],
    shopListings: arrays.shopListings ?? [],
    ripperdocListings: arrays.ripperdocListings ?? [],
  };
  const canonicalJson = JSON.stringify(normalized);
  const canonicalBytes = new TextEncoder().encode(canonicalJson).byteLength;
  if (canonicalBytes > WORKSHOP_PACK_MAX_BYTES) {
    return {
      ok: false,
      error: `标准化后内容包体积超限（上限 ${WORKSHOP_PACK_MAX_BYTES / 1024} KB）`,
    };
  }

  return {
    ok: true,
    data: {
      id: rawId,
      title,
      author,
      description,
      summary: {
        characters: charactersCount,
        modules: modulesCount,
        acquaintances: acquaintancesCount,
        npcs: npcsCount,
        items: itemsList.length,
        weapons: weaponsCount,
        cyberware: cyberwareCount,
        braindances: braindancesCount,
        chipContents: chipContentsCount,
        listings: listingsCount,
      },
      entryCount,
      byteSize: canonicalBytes,
      canonicalJson,
    },
  };
}

function parseCategory(raw: string | null): CommunityCategoryFilter {
  switch (raw) {
    case "characters":
    case "cyberware":
    case "items":
    case "npcs":
    case "modules":
    case "media":
    case "listings":
      return raw;
    default:
      return "all";
  }
}

function parseSort(raw: string | null): CommunitySortKey {
  switch (raw) {
    case "newest":
    case "updated":
      return raw;
    default:
      return "popular";
  }
}

function parseIntClamped(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function authorizeToken(
  provided: string | null,
  expectedHash: string,
  adminToken: string | undefined,
): Promise<boolean> {
  if (!provided || provided.trim().length < 8) return false;
  const clean = provided.trim();
  if (adminToken && adminToken.length >= 8 && timingSafeEqual(clean, adminToken)) {
    return true;
  }
  const hash = await sha256Hex(clean);
  return timingSafeEqual(hash, expectedHash);
}

/** 统一社区工坊请求入口：路径以 /api/community-workshop 开头 */
export async function handleCommunityWorkshop(
  request: Request,
  store: CommunityWorkshopStore,
  options: CommunityWorkshopOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method !== "GET" && method !== "HEAD" && !sameOrigin(request, url.origin)) {
    return jsonResponse({ error: "只接受本站页面发起的工坊写请求" }, 403);
  }

  const prefix = "/api/community-workshop";
  const subPath = url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length)
    : url.pathname;
  const cleanPath = subPath.replace(/\/+$/, "") || "/";

  // GET /packs
  if (cleanPath === "/packs" && method === "GET") {
    const page = parseIntClamped(url.searchParams.get("page"), 1, 1, 500);
    const pageSize = parseIntClamped(url.searchParams.get("pageSize"), 24, 1, 60);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
    const category = parseCategory(url.searchParams.get("category"));
    const sort = parseSort(url.searchParams.get("sort"));
    const result = await store.list({ q, category, sort, page, pageSize });
    return jsonResponse({
      items: result.items,
      total: result.total,
      page,
      pageSize,
      hasMore: page * pageSize < result.total,
    });
  }

  // POST /packs — 发布新内容包
  if (cleanPath === "/packs" && method === "POST") {
    const now = options.now ? options.now() : new Date();
    if (store.hitRateLimit) {
      const ipSeed = options.clientIp || request.headers.get("cf-connecting-ip") || "local";
      const ipHash = await sha256Hex(`write:${ipSeed}`);
      const allowed = await store.hitRateLimit(
        ipHash,
        RATE_LIMIT_WINDOW_MS,
        RATE_LIMIT_MAX_WRITES,
        now.getTime(),
      );
      if (!allowed) {
        return jsonResponse({ error: "上传过于频繁，请稍后再试（每小时上限 12 次）" }, 429);
      }
    }

    const rawText = await request.text();
    const checked = validateUploadPayload(rawText);
    if (!checked.ok) return jsonResponse({ error: checked.error }, 400);

    const editToken = generateEditToken();
    const editTokenHash = await sha256Hex(editToken);
    const created = await store.create({
      id: checked.data.id,
      title: checked.data.title,
      author: checked.data.author,
      description: checked.data.description,
      summary: checked.data.summary,
      entryCount: checked.data.entryCount,
      byteSize: checked.data.byteSize,
      packJson: checked.data.canonicalJson,
      editTokenHash,
      nowIso: now.toISOString(),
    });
    if (!created.ok) {
      return jsonResponse(
        {
          error: `社区已有同 ID 内容包「${checked.data.id}」。如果你是作者请凭管理密钥执行更新，否则请更换内容包 ID。`,
          code: "PACK_ID_EXISTS",
        },
        409,
      );
    }
    return jsonResponse({ item: created.item, editToken }, 201);
  }

  // /packs/:id/cover — 封面图读取、上传与删除
  const coverMatch = /^\/packs\/([^/]+)\/cover$/.exec(cleanPath);
  if (coverMatch) {
    const coverPackId = decodeURIComponent(coverMatch[1] ?? "");
    if (!PACK_ID_RE.test(coverPackId) || coverPackId.length > 22) {
      return jsonResponse({ error: "内容包 ID 格式不合法" }, 400);
    }

    if (method === "GET") {
      const cover = await store.getCover(coverPackId);
      if (!cover) return new Response("Not Found", { status: 404 });
      const bytes = base64ToBytes(cover.dataBase64);
      const body = new Uint8Array(bytes.byteLength);
      body.set(bytes);
      const versioned = url.searchParams.get("v") === cover.coverHash;
      return new Response(body.buffer, {
        status: 200,
        headers: {
          "content-type": cover.mimeType,
          "content-length": String(body.byteLength),
          "cache-control": versioned
            ? "public, max-age=31536000, immutable"
            : "public, max-age=300",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'",
        },
      });
    }

    const existing = await store.get(coverPackId);
    if (!existing) return jsonResponse({ error: "社区中找不到这个内容包" }, 404);
    const providedToken = request.headers.get(WORKSHOP_TOKEN_HEADER);
    const ok = await authorizeToken(providedToken, existing.editTokenHash, options.adminToken);
    if (!ok) {
      return jsonResponse({ error: "管理密钥不正确或缺失，无权修改此内容包封面" }, 403);
    }

    if (method === "PUT") {
      const buf = await request.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.byteLength === 0) return jsonResponse({ error: "封面图片不能为空" }, 400);
      if (bytes.byteLength > WORKSHOP_COVER_MAX_BYTES) {
        return jsonResponse(
          {
            error: `封面图片体积超限（${Math.ceil(bytes.byteLength / 1024)} KB），上限为 ${WORKSHOP_COVER_MAX_BYTES / 1024} KB`,
          },
          400,
        );
      }
      const mimeType = detectImageMime(bytes);
      if (!mimeType) {
        return jsonResponse({ error: "仅支持 WebP、PNG 或 JPEG 静态图片作为封面" }, 400);
      }
      const coverHash = (await sha256HexBytes(bytes)).slice(0, 12);
      const now = options.now ? options.now() : new Date();
      await store.putCover({
        packId: coverPackId,
        mimeType,
        dataBase64: bytesToBase64(bytes),
        byteSize: bytes.byteLength,
        coverHash,
        updatedAt: now.toISOString(),
      });
      return jsonResponse({ coverHash, byteSize: bytes.byteLength, mimeType }, 200);
    }

    if (method === "DELETE") {
      await store.deleteCover(coverPackId);
      return jsonResponse({ ok: true }, 200);
    }

    return jsonResponse({ error: `不支持的请求方法 ${method}` }, 405);
  }

  // /packs/:id
  const match = /^\/packs\/([^/]+)$/.exec(cleanPath);
  if (!match) {
    return jsonResponse({ error: "接口路径不存在" }, 404);
  }
  const packId = decodeURIComponent(match[1] ?? "");
  if (!PACK_ID_RE.test(packId) || packId.length > 22) {
    return jsonResponse({ error: "内容包 ID 格式不合法" }, 400);
  }

  // GET /packs/:id
  if (method === "GET") {
    const incrementDownload = url.searchParams.get("download") === "1";
    const found = await store.get(packId, { incrementDownload });
    if (!found) return jsonResponse({ error: "社区中找不到这个内容包" }, 404);
    return jsonResponse({
      item: found.item,
      pack: JSON.parse(found.packJson) as unknown,
    });
  }

  // PUT /packs/:id — 凭管理密钥更新已发布的内容包
  if (method === "PUT") {
    const existing = await store.get(packId);
    if (!existing) return jsonResponse({ error: "社区中找不到这个内容包" }, 404);
    const providedToken = request.headers.get(WORKSHOP_TOKEN_HEADER);
    const ok = await authorizeToken(providedToken, existing.editTokenHash, options.adminToken);
    if (!ok) {
      return jsonResponse({ error: "管理密钥不正确或缺失，无权更新此内容包" }, 403);
    }
    const rawText = await request.text();
    const checked = validateUploadPayload(rawText);
    if (!checked.ok) return jsonResponse({ error: checked.error }, 400);
    if (checked.data.id !== packId) {
      return jsonResponse({ error: `更新内容包时 id 必须保持为 ${packId}` }, 400);
    }
    const now = options.now ? options.now() : new Date();
    const updated = await store.update(packId, {
      title: checked.data.title,
      author: checked.data.author,
      description: checked.data.description,
      summary: checked.data.summary,
      entryCount: checked.data.entryCount,
      byteSize: checked.data.byteSize,
      packJson: checked.data.canonicalJson,
      nowIso: now.toISOString(),
    });
    if (!updated) return jsonResponse({ error: "社区中找不到这个内容包" }, 404);
    return jsonResponse({ item: updated }, 200);
  }

  // DELETE /packs/:id — 凭管理密钥（或站长密钥）下架内容包
  if (method === "DELETE") {
    const existing = await store.get(packId);
    if (!existing) return jsonResponse({ error: "社区中找不到这个内容包" }, 404);
    const providedToken = request.headers.get(WORKSHOP_TOKEN_HEADER);
    const ok = await authorizeToken(providedToken, existing.editTokenHash, options.adminToken);
    if (!ok) {
      return jsonResponse({ error: "管理密钥不正确或缺失，无权下架此内容包" }, 403);
    }
    await store.remove(packId);
    return jsonResponse({ ok: true }, 200);
  }

  return jsonResponse({ error: `不支持的请求方法 ${method}` }, 405);
}

function matchesCategory(
  summary: CommunityPackSummaryCounts,
  category: CommunityCategoryFilter,
): boolean {
  switch (category) {
    case "characters":
      return summary.characters > 0;
    case "cyberware":
      return summary.cyberware > 0;
    case "items":
      return summary.items > 0;
    case "npcs":
      return summary.npcs > 0 || summary.acquaintances > 0;
    case "modules":
      return summary.modules > 0;
    case "media":
      return summary.braindances > 0 || summary.chipContents > 0;
    case "listings":
      return summary.listings > 0;
    default:
      return true;
  }
}

/** 纯内存社区工坊存储（零 Node 依赖，供 Vite 本地开发预览与冒烟校验复用） */
export function createMemoryWorkshopStore(): CommunityWorkshopStore {
  const records = new Map<string, StoredCommunityPack>();
  const covers = new Map<string, StoredCommunityCover>();
  return {
    async list(query: CommunityListQuery) {
      const q = query.q.toLowerCase();
      const all = [...records.values()]
        .map((entry) => entry.item)
        .filter((item) => {
          if (!matchesCategory(item.summary, query.category)) return false;
          if (!q) return true;
          return `${item.title} ${item.author} ${item.id} ${item.description}`
            .toLowerCase()
            .includes(q);
        });
      all.sort((a, b) => {
        if (query.sort === "newest") return b.createdAt.localeCompare(a.createdAt);
        if (query.sort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
        if (b.downloads !== a.downloads) return b.downloads - a.downloads;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
      const start = (query.page - 1) * query.pageSize;
      return { items: all.slice(start, start + query.pageSize), total: all.length };
    },
    async get(id, options) {
      const hit = records.get(id);
      if (!hit) return null;
      if (options?.incrementDownload) {
        const next: StoredCommunityPack = {
          ...hit,
          item: { ...hit.item, downloads: hit.item.downloads + 1 },
        };
        records.set(id, next);
        return next;
      }
      return hit;
    },
    async create(record) {
      if (records.has(record.id)) return { ok: false as const, reason: "exists" as const };
      const item: CommunityPackSummary = {
        id: record.id,
        title: record.title,
        author: record.author,
        description: record.description,
        summary: record.summary,
        entryCount: record.entryCount,
        byteSize: record.byteSize,
        downloads: 0,
        revision: 1,
        coverHash: null,
        createdAt: record.nowIso,
        updatedAt: record.nowIso,
      };
      records.set(record.id, {
        item,
        packJson: record.packJson,
        editTokenHash: record.editTokenHash,
      });
      return { ok: true as const, item };
    },
    async update(id, patch) {
      const hit = records.get(id);
      if (!hit) return null;
      const item: CommunityPackSummary = {
        ...hit.item,
        title: patch.title,
        author: patch.author,
        description: patch.description,
        summary: patch.summary,
        entryCount: patch.entryCount,
        byteSize: patch.byteSize,
        revision: hit.item.revision + 1,
        updatedAt: patch.nowIso,
      };
      records.set(id, { ...hit, item, packJson: patch.packJson });
      return item;
    },
    async remove(id) {
      covers.delete(id);
      return records.delete(id);
    },
    async getCover(packId) {
      return covers.get(packId) ?? null;
    },
    async putCover(cover) {
      covers.set(cover.packId, cover);
      const hit = records.get(cover.packId);
      if (hit) {
        records.set(cover.packId, {
          ...hit,
          item: { ...hit.item, coverHash: cover.coverHash },
        });
      }
    },
    async deleteCover(packId) {
      const existed = covers.delete(packId);
      const hit = records.get(packId);
      if (hit) {
        records.set(packId, {
          ...hit,
          item: { ...hit.item, coverHash: null },
        });
      }
      return existed;
    },
  };
}
