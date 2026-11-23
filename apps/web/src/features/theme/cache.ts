import type { ShellThemeId } from "./catalog";

const DB_NAME = "cp-shell-theme-assets";
const DB_VERSION = 1;
const STORE_NAME = "blobs";

export interface CachedThemeAsset {
  readonly id: ShellThemeId;
  readonly mediaVersion: string;
  readonly size: number;
  readonly mimeType: string;
  readonly updatedAt: number;
  readonly blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("当前浏览器不支持本地 IndexedDB 缓存"));
  }
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("无法打开本地主题缓存库"));
    };
  });
  return dbPromise;
}

export async function getCachedThemeAsset(id: ShellThemeId): Promise<CachedThemeAsset | null> {
  try {
    const db = await openDb();
    return await new Promise<CachedThemeAsset | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => {
        const value = req.result as CachedThemeAsset | undefined;
        if (!value || !(value.blob instanceof Blob) || value.blob.size <= 0) {
          resolve(null);
          return;
        }
        resolve(value);
      };
      req.onerror = () => reject(req.error ?? new Error("读取主题缓存失败"));
    });
  } catch {
    return null;
  }
}

export async function listCachedThemeAssets(): Promise<readonly CachedThemeAsset[]> {
  try {
    const db = await openDb();
    return await new Promise<readonly CachedThemeAsset[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? (req.result as CachedThemeAsset[]) : [];
        resolve(rows.filter((row) => row && row.blob instanceof Blob && row.blob.size > 0));
      };
      req.onerror = () => reject(req.error ?? new Error("读取主题缓存列表失败"));
    });
  } catch {
    return [];
  }
}

export async function putCachedThemeAsset(record: CachedThemeAsset): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      const err = tx.error;
      if (err?.name === "QuotaExceededError") {
        reject(new Error("浏览器本地存储空间不足，请清理缓存后重试"));
        return;
      }
      reject(err ?? new Error("写入本地主题缓存失败"));
    };
    tx.onabort = () => reject(tx.error ?? new Error("写入本地主题缓存被中止"));
  });
}

export async function deleteCachedThemeAsset(id: ShellThemeId): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("删除本地主题缓存失败"));
    });
  } catch {
    // 清理失败时不阻断切回默认主题
  }
}
