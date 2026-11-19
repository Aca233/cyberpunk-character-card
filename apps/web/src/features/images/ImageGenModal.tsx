import { IMAGE_PROMPT_MAX_LENGTH, type ImagePromptRequest } from "@cp/core";
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
    readonly sessionKey: string;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const promptProfileRef = useRef<string | undefined>(undefined);
  const sessionKey =
    open && promptRequest ? JSON.stringify([bind, promptRequest, defaultAspectRatio]) : "";
  const liveKeyRef = useRef(sessionKey);
  liveKeyRef.current = sessionKey;
  const initialRef = useRef({ promptRequest, bind, defaultAspectRatio, prefs });
  initialRef.current = { promptRequest, bind, defaultAspectRatio, prefs };
  const sessionRef = useRef<{
    readonly key: string;
    readonly request: ImagePromptRequest;
    readonly bind: ImageGenModalProps["bind"];
  } | null>(null);

  const isCurrent = useCallback(
    (controller: AbortController, key: string) =>
      !controller.signal.aborted &&
      abortRef.current === controller &&
      liveKeyRef.current === key &&
      sessionRef.current?.key === key,
    [],
  );

  const cancelOperation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDrafting(false);
    setGenerating(false);
    setApplying(false);
  }, []);

  const closeModal = useCallback(() => {
    liveKeyRef.current = "";
    sessionRef.current = null;
    cancelOperation();
    onClose();
  }, [cancelOperation, onClose]);
  useLayer(closeModal, open);

  const runDraft = useCallback(
    async (req: ImagePromptRequest, extraInstruction: string, withAux: boolean) => {
      const session = sessionRef.current;
      if (!session || liveKeyRef.current !== session.key) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setDrafting(true);
      setGenerating(false);
      setApplying(false);
      setError(null);
      setNotice(null);
      const enriched: ImagePromptRequest = {
        ...structuredClone(req),
        instruction: [req.instruction.trim(), extraInstruction.trim()].filter(Boolean).join("\n"),
      };
      const style = imageStyleConfig();
      try {
        const profiles = await api.profiles();
        if (!isCurrent(controller, session.key)) return;
        const res = await api.draftImagePrompt(
          {
            request: enriched,
            useAux: withAux,
            style,
            ...(profiles.image ? { profileName: profiles.image } : {}),
          },
          controller.signal,
        );
        if (!isCurrent(controller, session.key)) return;
        promptProfileRef.current = profiles.image ?? undefined;
        setPrompt(res.prompt);
        setNegativePrompt(res.negativePrompt);
        if (res.fallbackReason) {
          setNotice(`提示词改用本地拼接（${res.fallbackReason}），你仍可自由修改下方提示词。`);
        }
      } catch (caught) {
        if (isCurrent(controller, session.key)) {
          setError(caught instanceof Error ? caught.message : "提示词提炼失败");
        }
      } finally {
        if (isCurrent(controller, session.key)) {
          abortRef.current = null;
          setDrafting(false);
        }
      }
    },
    [isCurrent],
  );

  useEffect(() => {
    cancelOperation();
    const initial = initialRef.current;
    if (!sessionKey || !initial.promptRequest) {
      sessionRef.current = null;
      return;
    }
    const req = structuredClone(initial.promptRequest);
    sessionRef.current = { key: sessionKey, request: req, bind: structuredClone(initial.bind) };
    promptProfileRef.current = undefined;
    setUseAux(initial.prefs.autoImageUseAux);
    setInstruction("");
    setPrompt("");
    setNegativePrompt(initial.prefs.imageNegativePrompt);
    setAspectRatio(initial.defaultAspectRatio);
    setPreview(null);
    setError(null);
    setNotice(null);
    void runDraft(req, "", initial.prefs.autoImageUseAux);
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      sessionRef.current = null;
    };
  }, [sessionKey, cancelOperation, runDraft]);

  if (!open || !promptRequest) return null;

  const imageModelReady = health.data?.models?.image?.ready ?? true;
  const imageModelError = health.data?.models?.image?.error;

  const handleGenerate = async () => {
    const session = sessionRef.current;
    if (!session || liveKeyRef.current !== session.key) return;
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      setError("请先填写生图提示词");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const request = {
      prompt: cleanPrompt,
      ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
      aspectRatio,
    };
    setGenerating(true);
    setDrafting(false);
    setApplying(false);
    setError(null);
    setNotice(null);
    try {
      const profileName = promptProfileRef.current ?? (await api.profiles()).image;
      if (!isCurrent(controller, session.key)) return;
      if (!profileName) throw new Error("尚未设置文生图模型");
      const res = await api.generateImage({ ...request, profileName }, controller.signal);
      if (!isCurrent(controller, session.key)) return;
      queryClient.setQueryData(["image", res.image.id], res.image);
      setPreview({ ...res, sessionKey: session.key });
      if (res.image.metadata.warnings?.length) {
        setNotice(res.image.metadata.warnings.join("；"));
      }
    } catch (caught) {
      if (isCurrent(controller, session.key)) {
        setError(caught instanceof Error ? caught.message : "文生图失败，请重试");
      }
    } finally {
      if (isCurrent(controller, session.key)) {
        abortRef.current = null;
        setGenerating(false);
      }
    }
  };

  const handleCancel = () => {
    const wasGenerating = generating;
    cancelOperation();
    setNotice(
      wasGenerating ? "已取消本地等待；已经发送的生图任务可能仍在服务端继续。" : "已取消本次请求。",
    );
  };

  const handleApply = async () => {
    const session = sessionRef.current;
    if (
      !preview ||
      !session ||
      preview.sessionKey !== session.key ||
      liveKeyRef.current !== session.key
    )
      return;
    if (!session.bind) {
      onApplied(preview.image);
      closeModal();
      return;
    }
    const target = session.bind;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setApplying(true);
    setError(null);
    try {
      const bindings = await api.bindSaveImage(
        target.saveId,
        {
          ...target.target,
          imageId: preview.image.id,
        } as Parameters<typeof api.bindSaveImage>[1],
        controller.signal,
      );
      if (!isCurrent(controller, session.key)) return;
      queryClient.setQueryData(["saveImages", target.saveId], bindings);
      onApplied(preview.image, bindings);
      closeModal();
    } catch (caught) {
      if (isCurrent(controller, session.key)) {
        setError(caught instanceof Error ? caught.message : "应用图片失败");
      }
    } finally {
      if (isCurrent(controller, session.key)) {
        abortRef.current = null;
        setApplying(false);
      }
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
        onClick={closeModal}
      />
      <div className={styles.modal}>
        <Panel line="var(--cp-cyan)" className={styles.modalPanel}>
          <div className={styles.modalHead}>
            <div>
              <h2 className={styles.modalTitle}>{title}</h2>
              {subtitle && <span className={styles.modalSub}>{subtitle}</span>}
            </div>
            <Button small keyId="key.esc" disabled={busy} onClick={closeModal}>
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
                  onClick={() =>
                    void runDraft(sessionRef.current?.request ?? promptRequest, instruction, useAux)
                  }
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
                    maxLength={IMAGE_PROMPT_MAX_LENGTH}
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
                    <span>图片正在排队或生成…</span>
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
                <Button onClick={closeModal}>关闭</Button>
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
