import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api, type StoredImage } from "../../api/client";
import { Button } from "../../ui/Button";
import { useLayer } from "../../ui/layers";
import { Panel } from "../../ui/Panel";
import styles from "./images.module.css";

export function useGeneratedImage(imageId: string | null | undefined) {
  const id = imageId?.trim() || "";
  return useQuery({
    queryKey: ["image", id],
    queryFn: () => api.getImage(id),
    enabled: id !== "",
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function downloadStoredImage(image: StoredImage, filenameBase = "cyberpunk-art"): void {
  const ext = image.mimeType.includes("jpeg")
    ? "jpg"
    : image.mimeType.includes("webp")
      ? "webp"
      : "png";
  const link = document.createElement("a");
  link.href = image.dataUrl;
  link.download = `${filenameBase.replace(/[\\/:*?"<>|]/g, "_") || "image"}.${ext}`;
  link.click();
}

export function GeneratedImage({
  imageId,
  alt,
  className,
  fallback = null,
  onLoaded,
}: {
  readonly imageId: string | null | undefined;
  readonly alt: string;
  readonly className?: string | undefined;
  readonly fallback?: ReactNode;
  readonly onLoaded?: ((image: StoredImage) => void) | undefined;
}) {
  const query = useGeneratedImage(imageId);
  if (!imageId || query.isError || (!query.isPending && !query.data)) {
    return <>{fallback}</>;
  }
  if (query.isPending) {
    return <span className={styles.imgPlaceholder}>…</span>;
  }
  return (
    <img
      src={query.data.dataUrl}
      alt={alt}
      className={className}
      onLoad={() => onLoaded?.(query.data)}
    />
  );
}

export function ImageLightbox({
  imageId,
  title,
  onClose,
}: {
  readonly imageId: string | null;
  readonly title: string;
  readonly onClose: () => void;
}) {
  useLayer(onClose, imageId !== null);
  const query = useGeneratedImage(imageId);
  if (!imageId) return null;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="关闭预览"
        className={styles.backdropDismiss}
        onClick={onClose}
      />
      <div className={styles.lightbox}>
        <Panel line="var(--cp-cyan)">
          <div className={styles.modalHead}>
            <h2 className={styles.modalTitle}>{title}</h2>
            <Button small keyId="key.esc" onClick={onClose}>
              关闭
            </Button>
          </div>
          <div className={styles.lightboxBody}>
            <div className={styles.lightboxImgWrap}>
              {query.isPending ? (
                <span className={styles.previewStatus}>正在读取图片…</span>
              ) : query.data ? (
                <img src={query.data.dataUrl} alt={title} className={styles.lightboxImg} />
              ) : (
                <span className={styles.previewStatus}>找不到这张图片（可能已清除）</span>
              )}
            </div>
            {query.data && (
              <>
                <p className={styles.lightboxPrompt} title="生成提示词">
                  {query.data.revisedPrompt ?? query.data.prompt}
                </p>
                <div className={styles.actions}>
                  <Button small onClick={() => downloadStoredImage(query.data, title)}>
                    下载图片
                  </Button>
                  <Button small primary onClick={onClose}>
                    关闭
                  </Button>
                </div>
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
