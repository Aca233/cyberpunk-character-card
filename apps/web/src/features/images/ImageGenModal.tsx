import type { ImagePromptRequest } from "@cp/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { type AspectRatio, api, type SaveImageBindings, type StoredImage } from "../../api/client";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { Panel } from "../../ui/Panel";
import { imageStyleConfig, useNarrativePrefs } from "../settings/prefs";
import { downloadStoredImage } from "./GeneratedImage";
import styles from "./images.module.css";

const RATIOS: readonly { readonly id: AspectRatio; readonly label: string }[] = [
  { id: "3:4", label: "3:4 竖版肖像" },
  { id: "1:1", label: "1:1 方形头像" },
  { id: "16:9", label: "16:9 宽屏插图" },
  { id: "4:3", label: "4:3 横版场景" },
  { id: "9:16", label: "9:16 竖屏特写" },
];

export interface ImageGenModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly promptRequest: ImagePromptRequest | null;
  readonly defaultAspectRatio: AspectRatio;
  readonly bind?:
    | {
        readonly saveId: string;
        readonly target:
          | { readonly kind: "turn"; readonly seq: number }
          | { readonly kind: "npc"; readonly npcId: string }
          | { readonly kind: "character" };
      }
    | undefined;
  readonly onClose: () => void;
  readonly onApplied: (image: StoredImage, bindings?: SaveImageBindings) => void;
}

export function ImageGenModal({
  open,
  title,
  subtitle,
  promptRequest,
  defaultAspectRatio,
  bind,
  onClose,
  onApplied,
}: ImageGenModalProps) {
  useLayer(onClose, open);
  const queryClient = useQueryClient();
  const prefs = useNarrativePrefs();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    enabled: open,
    staleTime: 5000,
  });

  const [useAux, setUseAux] = useState(prefs.autoImageUseAux);
  const [instruction, setInstruction] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState(prefs.imageNegativePrompt);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(defaultAspectRatio);
  const [drafting, setDrafting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    readonly image: StoredImage;
    readonly bindings?: SaveImageBindings;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef<ImagePromptRequest | null>(promptRequest);
  requestRef.current = promptRequest;

  const runDraft = useCallback(
    async (req: ImagePromptRequest, extraInstruction: string, withAux: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setDrafting(true);
      setError(null);
      setNotice(null);
      try {
        const enriched: ImagePromptRequest = {
          ...req,
          instruction: extraInstruction.trim(),
        };
        const res = await api.draftImagePrompt(
          {
            request: enriched,
            useAux: withAux,
            style: imageStyleConfig(),
          },
          controller.signal,
        );
        setPrompt(res.prompt);
        setNegativePrompt(res.negativePrompt);
        if (res.fallbackReason) {
          setNotice(`提示词改用本地拼接（${res.fallbackReason}），你仍可自由修改下方提示词。`);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "提示词提炼失败");
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setDrafting(false);
      }
    },
    [],
  );

  useEffect(() => {
    const req = requestRef.current;
    if (!open || !req) {
      abortRef.current?.abort();
      return;
    }
    setUseAux(prefs.autoImageUseAux);
    setInstruction("");
    setAspectRatio(defaultAspectRatio);
    setPreview(null);
    setError(null);
    setNotice(null);
    void runDraft(req, "", prefs.autoImageUseAux);
    return () => {
      abortRef.current?.abort();
    };
  }, [open, defaultAspectRatio, prefs.autoImageUseAux, runDraft]);

  if (!open || !promptRequest) return null;

  const imageModelReady = health.data?.models?.image?.ready ?? true;
  const imageModelError = health.data?.models?.image?.error;

  const handleGenerate = async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      setError("请先填写英文生图提示词");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.generateImage(
        {
          prompt: cleanPrompt,
          ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
          aspectRatio,
        },
        controller.signal,
      );
      queryClient.setQueryData(["image", res.image.id], res.image);
      setPreview(res);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "文生图失败，请重试");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setGenerating(false);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setDrafting(false);
    setGenerating(false);
  };

  const handleApply = async () => {
    if (!preview) return;
    if (!bind) {
      onApplied(preview.image);
      onClose();
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const bindings = await api.bindSaveImage(bind.saveId, {
        ...bind.target,
        imageId: preview.image.id,
      } as Parameters<typeof api.bindSaveImage>[1]);
      queryClient.setQueryData(["saveImages", bind.saveId], bindings);
      onApplied(preview.image, bindings);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "应用图片失败");
    } finally {
      setApplying(false);
    }
  };

  const busy = drafting || generating || applying;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="关闭弹窗"
        className={styles.backdropDismiss}
        disabled={busy}
        onClick={onClose}
      />
      <div className={styles.modal}>
        <Panel line="var(--cp-cyan)" className={styles.modalPanel}>
          <div className={styles.modalHead}>
            <div>
              <h2 className={styles.modalTitle}>{title}</h2>
              {subtitle && <span className={styles.modalSub}>{subtitle}</span>}
            </div>
            <Button small keyId="key.esc" disabled={busy} onClick={onClose}>
              关闭
            </Button>
          </div>

          <div className={styles.modalBody}>
            {!imageModelReady && (
              <div className={styles.notice} role="status">
                <span>{imageModelError ?? "尚未设置文生图模型"}</span>
                <Link to="/settings?tab=profiles">前往配置文生图模型 →</Link>
              </div>
            )}

            {notice && (
              <div className={styles.notice} role="status">
                <span>{notice}</span>
              </div>
            )}

            {error && (
              <div className={styles.errorBox} role="alert">
                {error}
              </div>
            )}

            <div className={styles.rowSplit}>
              <label className={styles.field}>
                <span className={styles.fieldHead}>
                  <span>补充要求 / 构图与风格微调（可选）</span>
                </span>
                <FrameBox>
                  <input
                    maxLength={240}
                    disabled={busy}
                    value={instruction}
                    placeholder="例如：霓虹雨夜侧脸、红黑公司西装、手持武士刀"
                    onChange={(e) => setInstruction(e.target.value)}
                  />
                </FrameBox>
              </label>

              <div className={styles.inlineTools}>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={useAux}
                    onChange={(e) => setUseAux(e.target.checked)}
                  />
                  <span>辅助模型提炼</span>
                </label>
                <Button
                  small
                  disabled={busy}
                  onClick={() => void runDraft(promptRequest, instruction, useAux)}
                >
                  {drafting ? "提炼中…" : "重新提炼提示词"}
                </Button>
              </div>
            </div>

            <div className={styles.rowSplit}>
              <label className={styles.field}>
                <span className={styles.fieldHead}>
                  <span>生图提示词（可直接修改或手写英文 Prompt）</span>
                  <Link to="/settings?tab=narrative">在设置中修改默认画风</Link>
                </span>
                <FrameBox>
                  <textarea
                    rows={4}
                    maxLength={4000}
                    disabled={busy}
                    value={prompt}
                    placeholder="Cyberpunk 2077 character portrait..."
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </FrameBox>
              </label>

              <label className={styles.field}>
                <span className={styles.fieldHead}>
                  <span>画幅比例</span>
                </span>
                <FrameBox>
                  <select
                    disabled={busy}
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                  >
                    {RATIOS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </FrameBox>
              </label>
            </div>

            <details className={styles.negFold}>
              <summary>反向提示词（Negative Prompt）</summary>
              <label className={styles.field}>
                <FrameBox>
                  <textarea
                    rows={2}
                    maxLength={2000}
                    disabled={busy}
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                  />
                </FrameBox>
              </label>
            </details>

            {(generating || drafting || preview) && (
              <div className={styles.previewBox}>
                <CellFrame />
                {generating ? (
                  <div className={styles.previewStatus}>
                    <span>正在向文生图模型请求生成图片…</span>
                    <small>取决于服务商或本地显卡，可能需要几秒到数十秒</small>
                  </div>
                ) : drafting && !preview ? (
                  <div className={styles.previewStatus}>
                    <span>正在提炼英文提示词…</span>
                  </div>
                ) : preview ? (
                  <img src={preview.image.dataUrl} alt={title} className={styles.previewImg} />
                ) : null}
              </div>
            )}
          </div>

          <div className={styles.actions}>
            <div className={styles.actionsLeft}>
              {preview && !busy && (
                <Button small onClick={() => downloadStoredImage(preview.image, title)}>
                  下载图片
                </Button>
              )}
            </div>
            {busy ? (
              <Button onClick={handleCancel}>取消</Button>
            ) : (
              <>
                <Button onClick={onClose}>关闭</Button>
                <Button
                  primary={!preview}
                  disabled={!prompt.trim() || !imageModelReady}
                  onClick={() => void handleGenerate()}
                >
                  {preview ? "重新生成" : "开始生成"}
                </Button>
                {preview && (
                  <Button primary onClick={() => void handleApply()}>
                    采用此图
                  </Button>
                )}
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
