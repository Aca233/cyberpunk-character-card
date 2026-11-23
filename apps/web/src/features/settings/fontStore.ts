/**
 * 本地导入字体库：把用户选择的字体文件（.ttf / .otf / .woff / .woff2）存入浏览器 IndexedDB，
 * 并通过原生 FontFace API 注册到 document.fonts，刷新后自动恢复，无需上传服务器。
 */

const DB_NAME = "cp-custom-fonts";
const DB_VERSION = 1;
const STORE_NAME = "fonts";

export const MAX_FONT_FILE_BYTES = 40 * 1024 * 1024;
export const FONT_FILE_ACCEPT = ".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf";
const FONT_EXT_RE = /.(woff2|woff|ttf|otf)$/i;

export interface StoredFontMeta {
  readonly id: string;
  readonly name: string;
  readonly fileName: string;
  readonly size: number;
  readonly addedAt: number;
}

interface StoredFontRecord extends StoredFontMeta {
  readonly data: ArrayBuffer;
}

let dbPromise: Promise<IDBDatabase> | null = null;
const loadedFaces = new Map<string, FontFace>();
const loadingFaces = new Map<string, Promise<boolean>>();

/** 为每条导入字体生成唯一安全的 CSS font-family 名称 */
export function importedFontFamilyName(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return `CPImportedFont_${safe}`;
}

export function cleanFontDisplayName(fileName: string): string {
  const base = fileName.replace(FONT_EXT_RE, "").trim();
  return (base || "自定义字体").slice(0, 48);
}

export function formatFontSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("当前浏览器不支持本地 IndexedDB 字体存储"));
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
      reject(request.error ?? new Error("无法打开本地字体库"));
    };
  });
  return dbPromise;
}

async function getFontRecord(id: string): Promise<StoredFontRecord | null> {
  try {
    const db = await openDb();
    return await new Promise<StoredFontRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => {
        const rec = req.result as StoredFontRecord | undefined;
        if (!rec || !(rec.data instanceof ArrayBuffer) || rec.data.byteLength <= 0) {
          resolve(null);
          return;
        }
        resolve(rec);
      };
      req.onerror = () => reject(req.error ?? new Error("读取字体数据失败"));
    });
  } catch {
    return null;
  }
}

async function registerFace(id: string, data: ArrayBuffer): Promise<boolean> {
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) {
    throw new Error("当前浏览器不支持动态加载字体文件");
  }
  const existing = loadedFaces.get(id);
  if (existing) return true;
  const family = importedFontFamilyName(id);
  const face = new FontFace(family, data.slice(0), { display: "swap" });
  const loaded = await face.load();
  document.fonts.add(loaded);
  loadedFaces.set(id, loaded);
  return true;
}

/** 列出全部已导入字体元信息（按导入时间倒序） */
export async function listImportedFonts(): Promise<readonly StoredFontMeta[]> {
  try {
    const db = await openDb();
    return await new Promise<readonly StoredFontMeta[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? (req.result as StoredFontRecord[]) : [];
        const list: StoredFontMeta[] = rows
          .filter((r) => r && typeof r.id === "string" && r.data instanceof ArrayBuffer)
          .map(({ id, name, fileName, size, addedAt }) => ({ id, name, fileName, size, addedAt }))
          .sort((a, b) => b.addedAt - a.addedAt);
        resolve(list);
      };
      req.onerror = () => reject(req.error ?? new Error("读取已导入字体列表失败"));
    });
  } catch {
    return [];
  }
}

/** 确保某个已导入字体已注册到 document.fonts */
export async function ensureImportedFontLoaded(id: string): Promise<boolean> {
  if (!id) return false;
  if (loadedFaces.has(id)) return true;
  const inflight = loadingFaces.get(id);
  if (inflight) return inflight;
  const task = (async () => {
    try {
      const rec = await getFontRecord(id);
      if (!rec) return false;
      return await registerFace(id, rec.data);
    } catch {
      return false;
    } finally {
      loadingFaces.delete(id);
    }
  })();
  loadingFaces.set(id, task);
  return task;
}

/** 导入一个本地字体文件：校验格式与体积、测试可渲染性后持久化到 IndexedDB */
export async function importFontFile(file: File): Promise<StoredFontMeta> {
  if (!FONT_EXT_RE.test(file.name)) {
    throw new Error("仅支持 .woff2、.woff、.ttf、.otf 格式的字体文件");
  }
  if (file.size <= 0) {
    throw new Error("字体文件为空，请重新选择");
  }
  if (file.size > MAX_FONT_FILE_BYTES) {
    throw new Error("字体文件超过 40 MB 上限，请选用体积更小的子集或 woff2 字体");
  }

  const buffer = await file.arrayBuffer();
  const id = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const name = cleanFontDisplayName(file.name);

  try {
    await registerFace(id, buffer);
  } catch {
    throw new Error("无法解析该字体文件，请确认文件未损坏且为标准 TTF / OTF / WOFF / WOFF2");
  }

  const record: StoredFontRecord = {
    id,
    name,
    fileName: file.name,
    size: file.size,
    addedAt: Date.now(),
    data: buffer,
  };

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("保存字体到浏览器存储失败"));
    });
  } catch (err) {
    const face = loadedFaces.get(id);
    if (face && typeof document !== "undefined" && document.fonts) {
      document.fonts.delete(face);
    }
    loadedFaces.delete(id);
    throw err instanceof Error ? err : new Error("保存字体失败（可能超出浏览器存储配额）");
  }

  return {
    id: record.id,
    name: record.name,
    fileName: record.fileName,
    size: record.size,
    addedAt: record.addedAt,
  };
}

/** 删除已导入的字体并从 document.fonts 卸载 */
export async function removeImportedFont(id: string): Promise<void> {
  const face = loadedFaces.get(id);
  if (face && typeof document !== "undefined" && document.fonts) {
    document.fonts.delete(face);
  }
  loadedFaces.delete(id);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("删除字体失败"));
    });
  } catch {
    // 忽略删除异常
  }
}
