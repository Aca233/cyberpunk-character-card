import { useSyncExternalStore } from "react";
import type { AssetId } from "./ids.gen";

export type { AssetId } from "./ids.gen";

/**
 * 素材索引：pick.ts 生成的 index.json。网页只通过这里拿素材地址（check-assets 会检查别处有没有直接写路径）。
 * 缺图不退回任何替代样式：记进缺图列表，界面显示报错框
 */

/**
 * 站点根路径：本机是 /，部署到子路径（如 GitHub Pages 的 /仓库名/）时由构建的 base 决定。
 * index.json 里的路径都以 / 开头，取用时在前面拼上它
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const INDEX_URL = `${BASE}/assets/local/ui/index.json`;

interface Entry {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly source: "demo" | "release";
}

export interface AssetInfo {
  readonly url: string;
  /** 原图像素 */
  readonly width: number;
  readonly height: number;
  /** 原图相对 1080p 的倍数；CSS 像素 = 原图像素 / scale */
  readonly scale: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
}

let entries: Readonly<Record<string, Entry>> = {};
let tier: "demo" | "release" | null = null;
const missing = new Set<string>();
let missingList: readonly string[] = [];
const listeners = new Set<() => void>();

export async function loadAssetIndex(): Promise<{ ok: true } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(INDEX_URL, { cache: "no-cache" });
  } catch {
    return { ok: false, error: "素材索引读不到：开发服务器没有启动？" };
  }
  if (!response.ok) {
    return { ok: false, error: "没有素材索引 index.json：在项目根目录运行 pnpm pick-assets" };
  }
  try {
    const data = (await response.json()) as {
      tier: "demo" | "release";
      assets: Record<string, Entry>;
    };
    entries = data.assets;
    tier = data.tier;
  } catch {
    return { ok: false, error: "素材索引 index.json 格式不对：重新运行 pnpm pick-assets" };
  }
  return { ok: true };
}

export function assetTier(): "demo" | "release" | null {
  return tier;
}

function report(id: string): void {
  if (missing.has(id)) return;
  missing.add(id);
  missingList = [...missing].sort();
  for (const listener of listeners) listener();
}

/** 拿素材；索引里没有时记进缺图列表并返回 undefined */
export function asset(id: AssetId): AssetInfo | undefined {
  const entry = entries[id];
  if (!entry) {
    // 渲染期间不能同步通知订阅者，挪到微任务里
    queueMicrotask(() => report(id));
    return undefined;
  }
  return {
    url: `${BASE}${entry.path}`,
    width: entry.width,
    height: entry.height,
    scale: entry.scale,
    displayWidth: entry.width / entry.scale,
    displayHeight: entry.height / entry.scale,
  };
}

export function assetUrl(id: AssetId): string | undefined {
  return asset(id)?.url;
}

/**
 * 地图瓦片：解包目录下的 build_map_tiles.py 从原作 3D 地图的网格烘焙，
 * 第 z 级把整张底图切成 2^z × 2^z 块，每块 tile 像素。没有瓦片时返回 null，地图退回 map.roads 整图
 */
const TILES_URL = `${BASE}/assets/local/maptiles`;

export interface MapTiles {
  /** 每块的像素边长 */
  readonly tile: number;
  readonly maxZoom: number;
  readonly url: (z: number, x: number, y: number) => string;
}

let tilesPromise: Promise<MapTiles | null> | null = null;

export function loadMapTiles(): Promise<MapTiles | null> {
  tilesPromise ??= fetch(`${TILES_URL}/index.json`, { cache: "no-cache" })
    .then(async (response) => {
      if (!response.ok) return null;
      const data = (await response.json()) as { tile: number; maxZoom: number; format: string };
      return {
        tile: data.tile,
        maxZoom: data.maxZoom,
        url: (z: number, x: number, y: number) => `${TILES_URL}/${z}/${x}_${y}.${data.format}`,
      };
    })
    .catch(() => null);
  return tilesPromise;
}

export function useMissingAssets(): readonly string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => missingList,
  );
}
