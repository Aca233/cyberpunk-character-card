import { useSyncExternalStore } from "react";
import { deleteCachedThemeAsset, listCachedThemeAssets, putCachedThemeAsset } from "./cache";
import {
  DEFAULT_SHELL_THEME_ID,
  isShellThemeId,
  SHELL_THEMES,
  type ShellThemeId,
  themeById,
} from "./catalog";

const STORAGE_KEY = "cp.shellTheme";

export type ThemeAssetStatus = "builtin" | "not_downloaded" | "downloading" | "cached" | "error";

export interface ThemeRuntimeEntry {
  readonly status: ThemeAssetStatus;
  readonly objectUrl?: string;
  readonly cachedBytes?: number;
  readonly updatedAt?: number;
  readonly loadedBytes?: number;
  readonly totalBytes?: number;
  readonly error?: string;
}

export interface ShellThemeSnapshot {
  readonly selectedId: ShellThemeId;
  readonly effectiveId: ShellThemeId;
  readonly hydrating: boolean;
  readonly entries: Readonly<Record<ShellThemeId, ThemeRuntimeEntry>>;
}

function readStoredSelection(): ShellThemeId {
  if (typeof localStorage === "undefined") return DEFAULT_SHELL_THEME_ID;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isShellThemeId(raw) ? raw : DEFAULT_SHELL_THEME_ID;
  } catch {
    return DEFAULT_SHELL_THEME_ID;
  }
}

function writeStoredSelection(id: ShellThemeId): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 忽略隐私模式写入失败
  }
}

function initialEntries(): Record<ShellThemeId, ThemeRuntimeEntry> {
  const map = {} as Record<ShellThemeId, ThemeRuntimeEntry>;
  for (const theme of SHELL_THEMES) {
    map[theme.id] = theme.downloadable ? { status: "not_downloaded" } : { status: "builtin" };
  }
  return map;
}

let selectedId: ShellThemeId = readStoredSelection();
let hydrating = SHELL_THEMES.some((t) => t.downloadable);
const entries: Record<ShellThemeId, ThemeRuntimeEntry> = initialEntries();
const objectUrls = new Map<ShellThemeId, string>();
const activeDownloads = new Map<ShellThemeId, AbortController>();
const listeners = new Set<() => void>();

function computeEffectiveId(): ShellThemeId {
  const spec = themeById(selectedId);
  if (!spec.downloadable) return spec.id;
  const entry = entries[spec.id];
  if (entry.status === "cached") return spec.id;
  // 启动首帧在 IDB 校验完成前先保留用户上次选中的主题（渲染轻量封面图与配色），避免刷新时红紫闪烁
  if (hydrating) return spec.id;
  return DEFAULT_SHELL_THEME_ID;
}

let snapshot: ShellThemeSnapshot = {
  selectedId,
  effectiveId: computeEffectiveId(),
  hydrating,
  entries,
};

function emit(): void {
  snapshot = {
    selectedId,
    effectiveId: computeEffectiveId(),
    hydrating,
    entries: { ...entries },
  };
  for (const listener of listeners) listener();
}

function setObjectUrl(id: ShellThemeId, blob: Blob): string {
  const prev = objectUrls.get(id);
  if (prev) URL.revokeObjectURL(prev);
  const next = URL.createObjectURL(blob);
  objectUrls.set(id, next);
  return next;
}

function revokeObjectUrl(id: ShellThemeId): void {
  const prev = objectUrls.get(id);
  if (prev) {
    URL.revokeObjectURL(prev);
    objectUrls.delete(id);
  }
}

let hydratePromise: Promise<void> | null = null;

/** 启动时仅检查本地 IndexedDB 已缓存的主题，绝不主动发起任何网络下载 */
export function ensureShellThemesHydrated(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const cachedList = await listCachedThemeAssets();
    const byId = new Map(cachedList.map((row) => [row.id, row]));

    for (const theme of SHELL_THEMES) {
      if (!theme.downloadable || !theme.media) continue;
      if (activeDownloads.has(theme.id)) continue;
      const row = byId.get(theme.id);
      if (row && row.mediaVersion === theme.media.version) {
        const objectUrl = setObjectUrl(theme.id, row.blob);
        entries[theme.id] = {
          status: "cached",
          objectUrl,
          cachedBytes: row.size,
          updatedAt: row.updatedAt,
        };
      } else {
        if (row) {
          void deleteCachedThemeAsset(theme.id);
        }
        entries[theme.id] = { status: "not_downloaded" };
      }
    }

    hydrating = false;
    const currentSpec = themeById(selectedId);
    if (currentSpec.downloadable && entries[currentSpec.id].status !== "cached") {
      selectedId = DEFAULT_SHELL_THEME_ID;
      writeStoredSelection(DEFAULT_SHELL_THEME_ID);
    }
    emit();
  })();
  return hydratePromise;
}

export function selectShellTheme(id: ShellThemeId): boolean {
  const spec = themeById(id);
  if (spec.downloadable && entries[id].status !== "cached") {
    return false;
  }
  selectedId = id;
  writeStoredSelection(id);
  emit();
  return true;
}

export function cancelThemeDownload(id: ShellThemeId): void {
  const controller = activeDownloads.get(id);
  if (!controller) return;
  controller.abort();
  activeDownloads.delete(id);
  const existingUrl = objectUrls.get(id);
  if (existingUrl) {
    entries[id] = {
      status: "cached",
      objectUrl: existingUrl,
      ...(entries[id].cachedBytes !== undefined ? { cachedBytes: entries[id].cachedBytes } : {}),
      ...(entries[id].updatedAt !== undefined ? { updatedAt: entries[id].updatedAt } : {}),
    };
  } else {
    entries[id] = { status: "not_downloaded" };
  }
  emit();
}

export async function downloadAndSelectTheme(id: ShellThemeId): Promise<boolean> {
  const spec = themeById(id);
  if (!spec.downloadable || !spec.media) {
    return selectShellTheme(id);
  }
  if (entries[id].status === "cached") {
    return selectShellTheme(id);
  }
  if (activeDownloads.has(id)) {
    return false;
  }

  const controller = new AbortController();
  activeDownloads.set(id, controller);
  const estimatedTotal = spec.media.estimatedBytes;

  entries[id] = {
    status: "downloading",
    loadedBytes: 0,
    totalBytes: estimatedTotal,
  };
  emit();

  try {
    const response = await fetch(spec.media.videoUrl, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`主题资源下载失败（HTTP ${response.status}）`);
    }

    const headerLen = Number(response.headers.get("content-length"));
    const totalBytes = Number.isFinite(headerLen) && headerLen > 0 ? headerLen : estimatedTotal;

    let blob: Blob;
    if (response.body) {
      const reader = response.body.getReader();
      const chunks: BlobPart[] = [];
      let loadedBytes = 0;
      let lastEmitAt = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loadedBytes += value.byteLength;
          const now = performance.now();
          if (now - lastEmitAt >= 90 || loadedBytes >= totalBytes) {
            lastEmitAt = now;
            entries[id] = {
              status: "downloading",
              loadedBytes,
              totalBytes: Math.max(totalBytes, loadedBytes),
            };
            emit();
          }
        }
      }
      blob = new Blob(chunks, {
        type: response.headers.get("content-type") || spec.media.mimeType,
      });
    } else {
      blob = await response.blob();
    }

    if (controller.signal.aborted) {
      return false;
    }
    if (blob.size <= 0) {
      throw new Error("下载到的主题资源为空，请稍后重试");
    }

    const updatedAt = Date.now();
    await putCachedThemeAsset({
      id,
      mediaVersion: spec.media.version,
      size: blob.size,
      mimeType: blob.type || spec.media.mimeType,
      updatedAt,
      blob,
    });

    if (controller.signal.aborted) {
      await deleteCachedThemeAsset(id);
      return false;
    }

    const objectUrl = setObjectUrl(id, blob);
    activeDownloads.delete(id);
    entries[id] = {
      status: "cached",
      objectUrl,
      cachedBytes: blob.size,
      updatedAt,
    };
    selectedId = id;
    writeStoredSelection(id);
    emit();
    return true;
  } catch (error) {
    activeDownloads.delete(id);
    if (
      controller.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      entries[id] = { status: "not_downloaded" };
      emit();
      return false;
    }
    const message = error instanceof Error ? error.message : "网络异常，主题下载未能完成";
    entries[id] = {
      status: "error",
      error: message,
    };
    emit();
    return false;
  }
}

export async function clearThemeCache(id: ShellThemeId): Promise<void> {
  const spec = themeById(id);
  if (!spec.downloadable) return;
  if (activeDownloads.has(id)) {
    cancelThemeDownload(id);
  }
  revokeObjectUrl(id);
  await deleteCachedThemeAsset(id);
  entries[id] = { status: "not_downloaded" };
  if (selectedId === id) {
    selectedId = DEFAULT_SHELL_THEME_ID;
    writeStoredSelection(DEFAULT_SHELL_THEME_ID);
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void ensureShellThemesHydrated();
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    const next = readStoredSelection();
    if (next === selectedId) return;
    if (!themeById(next).downloadable || entries[next].status === "cached") {
      selectedId = next;
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useShellTheme(): ShellThemeSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
