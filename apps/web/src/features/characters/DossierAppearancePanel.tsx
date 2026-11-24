import { APPEARANCE_LOOK_MAX } from "@cp/core";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "../../api/client";
import { ActionButton } from "../../ui/ActionButton";
import { Button } from "../../ui/Button";
import { FrameBox } from "../../ui/FrameBox";
import wb from "./workbench.module.css";

const MAX_VISION_EDGE = 1280;
const ACCEPTED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("读取图片文件失败"));
    };
    reader.onerror = () => reject(new Error("读取图片文件失败"));
    reader.readAsDataURL(file);
  });
}

/**
 * 将本地图片按需要缩放至长边不超过 1280px，控制识图请求与本地 ImageStore 体积；
 * 若本身是合规格式且尺寸在阈值内，直接保留原图字节避免多余重压缩。
 */
async function preparePortraitDataUrl(file: File): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(file);
  if (typeof document === "undefined") return rawDataUrl;

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("无法解码图片，请选择有效的 PNG、JPEG 或 WebP 文件"));
    img.src = rawDataUrl;
  });

  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const maxSide = Math.max(width, height);
  const needsResize = maxSide > MAX_VISION_EDGE;
  const needsConvert = !ACCEPTED_MIME.has(file.type.toLowerCase());
  if (!needsResize && !needsConvert) return rawDataUrl;

  const scale = needsResize ? MAX_VISION_EDGE / maxSide : 1;
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return rawDataUrl;
  ctx.drawImage(img, 0, 0, targetW, targetH);

  // PNG 透明图保留 PNG，其他图转高质 JPEG 控制体积
  const outputMime =
    file.type.toLowerCase() === "image/png" && !needsResize ? "image/png" : "image/jpeg";
  return canvas.toDataURL(outputMime, 0.9);
}

/**
 * 右侧档案栏内置外貌面板：
 * 只通过上传参考图（点击/拖拽/粘贴）反推出中文物理外貌描述并同步设为角色立绘，
 * 支持查看与微调反推结果、基于当前立绘重新反推。
 */
export function DossierAppearancePanel({
  portrait,
  look,
  pronoun,
  busy = false,
  onPortraitChange,
  onLookChange,
}: {
  readonly portrait?: string | undefined;
  readonly look: string;
  readonly pronoun: string;
  readonly busy?: boolean;
  readonly onPortraitChange: (imageId: string) => void;
  readonly onLookChange: (nextLook: string) => void;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "analyzing">("idle");
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const working = phase !== "idle";

  const cancelWork = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
  };

  const describeFromImageId = async (imageId: string, signal?: AbortSignal) => {
    setPhase("analyzing");
    setError(null);
    const result = await api.describeAppearance(
      {
        imageId,
        ...(pronoun.trim() ? { pronoun: pronoun.trim() } : {}),
      },
      signal,
    );
    onLookChange(result.look);
    const roleLabel = result.usedPurpose === "aux" ? "辅助模型" : "叙事模型";
    setMeta(`已由 ${result.profileName}（${roleLabel}）反推`);
  };

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) {
      setError("请选择图片文件（支持 PNG、JPEG、WebP）");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("uploading");
    setError(null);
    setMeta(null);

    try {
      const dataUrl = await preparePortraitDataUrl(file);
      if (controller.signal.aborted) return;

      const uploaded = await api.uploadImage(
        {
          dataUrl,
          label: file.name ? `角色参考图：${file.name}` : "角色参考图",
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;

      queryClient.setQueryData(["image", uploaded.image.id], uploaded.image);
      onPortraitChange(uploaded.image.id);

      setPhase("analyzing");
      const described = await api.describeAppearance(
        {
          dataUrl,
          ...(pronoun.trim() ? { pronoun: pronoun.trim() } : {}),
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;

      onLookChange(described.look);
      const roleLabel = described.usedPurpose === "aux" ? "辅助模型" : "叙事模型";
      setMeta(`已由 ${described.profileName}（${roleLabel}）反推`);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "上传或反推外貌失败");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setPhase("idle");
      }
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void handleImageFile(file);
  };

  const handleAnalyzeCurrent = async () => {
    if (!portrait || working) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setMeta(null);
    try {
      await describeFromImageId(portrait, controller.signal);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "反推外貌失败");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setPhase("idle");
      }
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (busy || working) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void handleImageFile(file);
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (busy || working) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          void handleImageFile(file);
          return;
        }
      }
    }
  };

  const lookText = look.trim();

  return (
    <section
      className={wb.asideLookBox}
      data-drag={dragActive || undefined}
      aria-label="外貌反推与描写"
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy && !working) setDragActive(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragActive(false);
      }}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/*"
        className={wb.hiddenFileInput}
        onChange={handleFileChange}
      />

      <div className={wb.asideLookHead}>
        <span className={wb.asideLookCode}>{"VISION // 外貌反推"}</span>
        <span className={wb.asideLookCount}>
          {look.length}/{APPEARANCE_LOOK_MAX}
        </span>
      </div>

      <div className={wb.asideLookActions}>
        <Button small disabled={busy || working} onClick={() => fileInputRef.current?.click()}>
          {phase === "uploading"
            ? "读取图片中…"
            : phase === "analyzing"
              ? "反推外貌中…"
              : portrait
                ? "上传换图并反推"
                : "上传本地图并反推"}
        </Button>

        {portrait && !working && (
          <Button small disabled={busy} onClick={() => void handleAnalyzeCurrent()}>
            {lookText ? "重新反推" : "反推当前图"}
          </Button>
        )}

        {working && <ActionButton onClick={cancelWork}>取消</ActionButton>}

        {!working && (
          <ActionButton disabled={busy} onClick={() => setEditing((v) => !v)}>
            {editing ? "收起编辑" : lookText ? "微调" : "手写"}
          </ActionButton>
        )}

        {!working && lookText && (
          <ActionButton
            disabled={busy}
            onClick={() => {
              setMeta(null);
              onLookChange("");
            }}
          >
            清空
          </ActionButton>
        )}
      </div>

      {error && (
        <p className={wb.asideLookError} role="alert">
          {error}
        </p>
      )}

      {meta && !error && <p className={wb.asideLookMeta}>{meta}</p>}

      {editing ? (
        <FrameBox className={wb.asideLookTextareaBox}>
          <textarea
            aria-label="角色外貌描述"
            rows={4}
            maxLength={APPEARANCE_LOOK_MAX}
            placeholder="上传角色参考图后自动反推，也可以在这里直接微调外貌描写…"
            value={look}
            onChange={(e) => onLookChange(e.target.value)}
          />
        </FrameBox>
      ) : lookText ? (
        <p className={wb.asideLookFull}>{lookText}</p>
      ) : (
        <button
          type="button"
          className={wb.asideLookDropHint}
          disabled={busy || working}
          onClick={() => fileInputRef.current?.click()}
        >
          {dragActive
            ? "松开即可上传图片并自动反推外貌"
            : portrait
              ? "已上传立绘，点击「反推当前图」或拖入新图生成外貌描述"
              : "点击上传、拖入或 Ctrl+V 粘贴角色图片，自动设为立绘并反推外貌描述"}
        </button>
      )}
    </section>
  );
}
