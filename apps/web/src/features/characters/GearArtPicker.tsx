import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AssetId } from "../../assets";
import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { FrameBox } from "../../ui/FrameBox";
import { type OfficialArtOption, officialGearArtOptions } from "../story/art";
import styles from "./characters.module.css";

const MAX_ICON_EDGE = 256;
const MAX_DATA_URL_LEN = 175_000;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("读取图片失败"));
    };
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 16) {
    if ((data[i] ?? 255) < 250) return true;
  }
  return false;
}

/**
 * 将本地上传图片压缩为长边 ≤ 256px 的轻量图标缩略图（data:image/...）：
 * 透明 PNG/WebP 自动保留透明底（优先 WebP，超限时降尺寸/转 PNG），
 * 不透明图转高质 WebP/JPEG，确保本地库与存档体积可控。
 */
async function compressIconFile(file: File): Promise<string> {
  const raw = await readFileAsDataUrl(file);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("无法解码图片，请选择 PNG / JPG / WebP 文件"));
    img.src = raw;
  });

  const renderAt = (
    maxSide: number,
    mime: string,
    quality: number,
  ): { url: string; alpha: boolean } => {
    const scale = Math.min(1, maxSide / Math.max(1, img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { url: raw, alpha: false };
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const alpha = hasTransparency(ctx, w, h);
    const actualMime = alpha && mime === "image/jpeg" ? "image/png" : mime;
    return { url: canvas.toDataURL(actualMime, quality), alpha };
  };

  // 先尝试 WebP（支持透明且体积极小）
  for (const [edge, quality] of [
    [MAX_ICON_EDGE, 0.88],
    [192, 0.82],
    [160, 0.75],
  ] as const) {
    const webp = renderAt(edge, "image/webp", quality);
    if (webp.url.startsWith("data:image/webp;") && webp.url.length <= MAX_DATA_URL_LEN) {
      return webp.url;
    }
    const fallbackMime = webp.alpha ? "image/png" : "image/jpeg";
    const fallback = renderAt(edge, fallbackMime, quality);
    if (fallback.url.length <= MAX_DATA_URL_LEN) {
      return fallback.url;
    }
  }
  throw new Error("图片压缩后仍超出体积上限（170KB），请换一张更小的图标");
}

export interface GearArtPickerProps {
  /** 当前领域：武器 / 物品 / 义体 */
  readonly group: "weapon" | "item" | "cyberware";
  /** 当前细分分类（用于优先推荐最贴合的官方图标） */
  readonly subGroup: string;
  /** 未选图时按分类自动给出的默认官方图标 */
  readonly fallbackArt: AssetId;
  /** 用户指定的官方图标 ID */
  readonly art?: string | undefined;
  /** 用户上传的本地自定义图 data URL */
  readonly customImage?: string | undefined;
  readonly onChange: (next: {
    readonly art?: string | undefined;
    readonly customImage?: string | undefined;
  }) => void;
}

/**
 * 自建武器 / 物品 / 义体共用的图标选择器：
 * 支持① 上传本地 PNG/JPG/WebP（点击 / 拖拽 / 粘贴，保留透明底），
 * ② 挑选内置 2077 官方图标（按当前类别自动推荐，可搜索全部），
 * ③ 留空时自动使用同类默认官方图标。
 */
export function GearArtPicker({
  group,
  subGroup,
  fallbackArt,
  art,
  customImage,
  onChange,
}: GearArtPickerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [scope, setScope] = useState<"recommended" | "group" | "all">("recommended");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const allOptions = useMemo(() => officialGearArtOptions(), []);

  const filteredOptions = useMemo<readonly OfficialArtOption[]>(() => {
    const q = query.trim().toLowerCase();
    let pool = allOptions;
    if (scope === "recommended") {
      const exact = allOptions.filter((opt) => opt.group === group && opt.subGroup === subGroup);
      pool = exact.length > 0 ? exact : allOptions.filter((opt) => opt.group === group);
    } else if (scope === "group") {
      pool = allOptions.filter((opt) => opt.group === group);
    }
    if (!q) return pool;
    return pool.filter(
      (opt) => opt.label.toLowerCase().includes(q) || opt.artId.toLowerCase().includes(q),
    );
  }, [allOptions, group, subGroup, scope, query]);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
      setError("请选择 PNG、JPG、WebP 或 GIF 图片");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await compressIconFile(file);
      onChange({ art, customImage: dataUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "处理图片失败");
    } finally {
      setBusy(false);
    }
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void handleFile(file);
  };

  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void handleFile(file);
          return;
        }
      }
    }
  };

  const activeModeLabel = customImage
    ? "本地上传图（随本机与存档保存）"
    : art
      ? "内置官方图标（可随创意工坊共享）"
      : "分类默认官方图";

  return (
    <div className={styles.artPicker} onPaste={onPaste}>
      <span className={styles.artPickerLabel}>
        图标 / 配图
        <span className={styles.artPickerMode}>{activeModeLabel}</span>
      </span>

      <div className={styles.artPickerRow}>
        <button
          type="button"
          className={styles.artPreviewBox}
          data-dragover={dragOver || undefined}
          title="点击或拖拽/粘贴图片到此处上传自定义图标"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {customImage ? (
            <img src={customImage} alt="自定义图标预览" className={styles.artPreviewImg} />
          ) : (
            <Asset
              id={(art as AssetId | undefined) ?? fallbackArt}
              className={styles.artPreviewImg}
            />
          )}
        </button>

        <div className={styles.artPickerControls}>
          <div className={styles.shelfFilter}>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={onFileChange}
            />
            <Button small disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "压缩中…" : customImage ? "更换本地图" : "上传本地图"}
            </Button>
            <Button small pressed={galleryOpen} onClick={() => setGalleryOpen((open) => !open)}>
              {galleryOpen ? "收起官方图标库" : "挑选官方图标"}
            </Button>
            {(customImage || art) && (
              <Button
                small
                onClick={() => {
                  setError(null);
                  onChange({ art: undefined, customImage: undefined });
                }}
              >
                恢复默认
              </Button>
            )}
          </div>
          <p className={styles.artPickerHint}>
            支持点击、拖拽或 Ctrl+V 粘贴 PNG/JPG/WebP（自动保留透明底并压缩）；也可直接选用 2077
            官方图标，发布创意工坊时将自动保留所选官方图标。
          </p>
        </div>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {galleryOpen && (
        <div className={styles.artGallery}>
          <div className={styles.artGalleryBar}>
            <div className={styles.shelfFilter}>
              <Button
                small
                pressed={scope === "recommended"}
                onClick={() => setScope("recommended")}
              >
                同类推荐
              </Button>
              <Button small pressed={scope === "group"} onClick={() => setScope("group")}>
                {group === "weapon" ? "全部武器" : group === "cyberware" ? "全部义体" : "全部物品"}
              </Button>
              <Button small pressed={scope === "all"} onClick={() => setScope("all")}>
                全部官方图
              </Button>
            </div>
            <FrameBox className={`${styles.compactBox} ${styles.artSearchBox}`}>
              <input
                value={query}
                placeholder="搜官方图标名称…"
                aria-label="搜索官方图标"
                onChange={(e) => setQuery(e.target.value)}
              />
            </FrameBox>
          </div>

          <div className={styles.artGalleryGrid}>
            {filteredOptions.map((opt) => {
              const selected = !customImage && art === opt.artId;
              return (
                <button
                  key={opt.artId}
                  type="button"
                  className={styles.artChoiceBtn}
                  data-selected={selected || undefined}
                  title={opt.label}
                  onClick={() => {
                    setError(null);
                    onChange({ art: opt.artId, customImage: undefined });
                  }}
                >
                  <Asset id={opt.artId} className={styles.artChoiceImg} />
                  <span className={styles.artChoiceName}>{opt.label}</span>
                </button>
              );
            })}
            {filteredOptions.length === 0 && (
              <span className={styles.note}>
                没有匹配的官方图标，换个关键词或切到「全部官方图」试试。
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
