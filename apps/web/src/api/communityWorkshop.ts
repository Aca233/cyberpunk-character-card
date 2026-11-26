import {
  type CommunityWorkshopDownloadResponse,
  CommunityWorkshopDownloadResponseSchema,
  type CommunityWorkshopListResponse,
  CommunityWorkshopListResponseSchema,
  type CommunityWorkshopPublishResponse,
  CommunityWorkshopPublishResponseSchema,
  WORKSHOP_COVER_MAX_BYTES,
  WORKSHOP_PACK_MAX_BYTES,
  type WorkshopPack,
} from "@cp/core";

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

export class CommunityWorkshopError extends Error {
  readonly status: number;
  readonly code?: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "CommunityWorkshopError";
    this.status = status;
    this.code = code;
  }
}

const TOKEN_STORAGE_KEY = "cp.workshop.communityTokens";

function basePath(): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.endsWith("/") ? `${base}api/community-workshop` : `${base}/api/community-workshop`;
}

async function parseError(response: Response): Promise<CommunityWorkshopError> {
  const body = (await response.json().catch(() => ({}))) as {
    readonly error?: unknown;
    readonly code?: unknown;
  };
  const message =
    typeof body.error === "string" ? body.error : `社区工坊请求失败（${response.status}）`;
  const code = typeof body.code === "string" ? body.code : undefined;
  return new CommunityWorkshopError(message, response.status, code);
}

/** 读取本机保存的社区发布管理密钥表（packId -> editToken） */
export function loadCommunityEditTokens(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim().length > 0) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function saveCommunityEditToken(packId: string, token: string): void {
  if (typeof window === "undefined") return;
  const all = loadCommunityEditTokens();
  all[packId] = token.trim();
  window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(all));
}

export function removeCommunityEditToken(packId: string): void {
  if (typeof window === "undefined") return;
  const all = loadCommunityEditTokens();
  delete all[packId];
  window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(all));
}

export function communityCoverUrl(
  packId: string,
  coverHash: string | null | undefined,
): string | null {
  if (!coverHash) return null;
  return `${basePath()}/packs/${encodeURIComponent(packId)}/cover?v=${encodeURIComponent(coverHash)}`;
}

const COVER_MAX_RAW_BYTES = 10 * 1024 * 1024;
const COVER_WIDTH = 800;
const COVER_HEIGHT = 450;

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败，请选择 PNG、JPEG 或 WebP 图片"));
    img.src = url;
  });
}

/** 浏览器端将任意静态图片裁切压缩为 16:9（800×450）WebP 封面，确保体积 ≤ 180 KB */
export async function compressCoverImage(file: File): Promise<{
  readonly blob: Blob;
  readonly previewUrl: string;
  readonly byteSize: number;
  readonly mimeType: string;
}> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw new Error("仅支持 PNG、JPEG 或 WebP 静态图片，不支持 SVG 或其他文件");
  }
  if (file.size > COVER_MAX_RAW_BYTES) {
    throw new Error("原始图片不能超过 10 MB");
  }
  const sourceUrl = URL.createObjectURL(file);
  try {
    const img = await loadHtmlImage(sourceUrl);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (srcW < 32 || srcH < 32) {
      throw new Error("图片分辨率过小（至少 32×32）");
    }

    const targetRatio = COVER_WIDTH / COVER_HEIGHT;
    const srcRatio = srcW / srcH;
    let sx = 0;
    let sy = 0;
    let sw = srcW;
    let sh = srcH;
    if (srcRatio > targetRatio) {
      sw = Math.round(srcH * targetRatio);
      sx = Math.round((srcW - sw) / 2);
    } else if (srcRatio < targetRatio) {
      sh = Math.round(srcW / targetRatio);
      sy = Math.round((srcH - sh) / 2);
    }

    const canvas = document.createElement("canvas");
    canvas.width = COVER_WIDTH;
    canvas.height = COVER_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器画布初始化失败");
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, COVER_WIDTH, COVER_HEIGHT);

    const qualities = [0.84, 0.72, 0.6, 0.48];
    let best: Blob | null = null;
    for (const mime of ["image/webp", "image/jpeg"] as const) {
      for (const q of qualities) {
        const candidate = await canvasToBlob(canvas, mime, q);
        if (!candidate || candidate.type !== mime) break;
        best = candidate;
        if (candidate.size <= WORKSHOP_COVER_MAX_BYTES) {
          return {
            blob: candidate,
            previewUrl: URL.createObjectURL(candidate),
            byteSize: candidate.size,
            mimeType: candidate.type,
          };
        }
      }
      if (best && best.size <= WORKSHOP_COVER_MAX_BYTES) break;
    }
    throw new Error(
      `图片压缩后仍超过 ${Math.round(WORKSHOP_COVER_MAX_BYTES / 1024)} KB 上限，请换一张更简洁的图片`,
    );
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export const communityWorkshopApi = {
  async list(params: {
    readonly q?: string;
    readonly category?: CommunityCategoryFilter;
    readonly sort?: CommunitySortKey;
    readonly page?: number;
    readonly pageSize?: number;
  }): Promise<CommunityWorkshopListResponse> {
    const qs = new URLSearchParams();
    if (params.q?.trim()) qs.set("q", params.q.trim());
    if (params.category && params.category !== "all") qs.set("category", params.category);
    if (params.sort) qs.set("sort", params.sort);
    if (params.page && params.page > 1) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    const url = qs.toString() ? `${basePath()}/packs?${qs.toString()}` : `${basePath()}/packs`;
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) throw await parseError(response);
    return CommunityWorkshopListResponseSchema.parse(await response.json());
  },

  async fetchPack(
    id: string,
    options: { readonly download?: boolean } = {},
  ): Promise<CommunityWorkshopDownloadResponse> {
    const url = `${basePath()}/packs/${encodeURIComponent(id)}${options.download ? "?download=1" : ""}`;
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) throw await parseError(response);
    return CommunityWorkshopDownloadResponseSchema.parse(await response.json());
  },

  async publish(pack: WorkshopPack): Promise<CommunityWorkshopPublishResponse> {
    const body = JSON.stringify(pack);
    const bytes = new TextEncoder().encode(body).byteLength;
    if (bytes > WORKSHOP_PACK_MAX_BYTES) {
      throw new CommunityWorkshopError(
        `内容包体积过大（${Math.ceil(bytes / 1024)} KB），社区上传上限为 ${WORKSHOP_PACK_MAX_BYTES / 1024} KB`,
        400,
      );
    }
    const response = await fetch(`${basePath()}/packs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!response.ok) throw await parseError(response);
    return CommunityWorkshopPublishResponseSchema.parse(await response.json());
  },

  async update(pack: WorkshopPack, editToken: string): Promise<CommunityWorkshopPublishResponse> {
    const body = JSON.stringify(pack);
    const bytes = new TextEncoder().encode(body).byteLength;
    if (bytes > WORKSHOP_PACK_MAX_BYTES) {
      throw new CommunityWorkshopError(
        `内容包体积过大（${Math.ceil(bytes / 1024)} KB），社区上传上限为 ${WORKSHOP_PACK_MAX_BYTES / 1024} KB`,
        400,
      );
    }
    const response = await fetch(`${basePath()}/packs/${encodeURIComponent(pack.id)}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-workshop-token": editToken.trim(),
      },
      body,
    });
    if (!response.ok) throw await parseError(response);
    return CommunityWorkshopPublishResponseSchema.parse(await response.json());
  },

  async unpublish(id: string, editToken: string): Promise<{ readonly ok: true }> {
    const response = await fetch(`${basePath()}/packs/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "x-workshop-token": editToken.trim() },
    });
    if (!response.ok) throw await parseError(response);
    return { ok: true };
  },

  async uploadCover(
    id: string,
    blob: Blob,
    editToken: string,
  ): Promise<{ readonly coverHash: string; readonly byteSize: number; readonly mimeType: string }> {
    if (blob.size > WORKSHOP_COVER_MAX_BYTES) {
      throw new CommunityWorkshopError(
        `封面图片体积超限（${Math.ceil(blob.size / 1024)} KB），上限为 ${Math.round(WORKSHOP_COVER_MAX_BYTES / 1024)} KB`,
        400,
      );
    }
    const response = await fetch(`${basePath()}/packs/${encodeURIComponent(id)}/cover`, {
      method: "PUT",
      headers: {
        "content-type": blob.type || "image/webp",
        "x-workshop-token": editToken.trim(),
      },
      body: blob,
    });
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as {
      readonly coverHash: string;
      readonly byteSize: number;
      readonly mimeType: string;
    };
  },

  async deleteCover(id: string, editToken: string): Promise<{ readonly ok: true }> {
    const response = await fetch(`${basePath()}/packs/${encodeURIComponent(id)}/cover`, {
      method: "DELETE",
      headers: { "x-workshop-token": editToken.trim() },
    });
    if (!response.ok) throw await parseError(response);
    return { ok: true };
  },
};
