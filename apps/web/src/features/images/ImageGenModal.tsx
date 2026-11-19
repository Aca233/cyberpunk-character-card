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
import {
  imagePromptSourceKey,
  readImageDraft,
  type SavedImageDraft,
  writeImageDraft,
} from "./image-drafts";
import {
  boundImage,
  cancelImageJob,
  type ImageJobBinding,
  imageTargetKey,
  isImageJobPending,
  startImageJob,
  useImageJob,
} from "./image-jobs";
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
  readonly draftKey?: string;
  readonly bind?: ImageJobBinding | undefined;
  readonly onClose: () => void;
  readonly onApplied: (image: StoredImage, bindings?: SaveImageBindings) => void;
}

interface ModalDraft extends SavedImageDraft {
  readonly sessionKey: string;
}

export function ImageGenModal({
  open,
  title,
  subtitle,
  promptRequest,
  defaultAspectRatio,
  draftKey,
  bind,
  onClose,
  onApplied,
}: ImageGenModalProps) {
  const queryClient = useQueryClient();
  const prefs = useNarrativePrefs();
  const model = useQuery({
    queryKey: ["imageCapabilities"],
    queryFn: () => api.imageCapabilities(),
    enabled: open,
    staleTime: 0,
  });
  const bindingState = useQuery({
    queryKey: ["saveImages", bind?.saveId ?? ""],
    queryFn: () => api.saveImages(bind?.saveId ?? ""),
    enabled: open && Boolean(bind),
  });
  const sourceKey = promptRequest ? imagePromptSourceKey(promptRequest) : "";
  const key = bind ? imageTargetKey(bind) : (draftKey ?? `image:${sourceKey}`);
  const sessionKey =
    open && promptRequest ? JSON.stringify([key, sourceKey, defaultAspectRatio]) : "";
  const [draft, setDraft] = useState<ModalDraft>({
    sessionKey: "",
    sourceKey: "",
    prompt: "",
    negativePrompt: "",
    instruction: "",
    useAux: true,
    aspectRatio: defaultAspectRatio,
    profileName: null,
    capabilities: null,
  });
  const { useAux, instruction, prompt, negativePrompt, aspectRatio } = draft;
  const updateDraft = (patch: Partial<SavedImageDraft>) =>
    setDraft((previous) => ({ ...previous, ...patch }));
  const [drafting, setDrafting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setError] = useState<string | null>(null);
  const job = useImageJob(key);
  const generating = isImageJobPending(job);
  const preview =
    job?.sourceKey === sourceKey && job.image ? { image: job.image, sessionKey } : null;
  const abortRef = useRef<AbortController | null>(null);
  const liveKeyRef = useRef(sessionKey);
  liveKeyRef.current = sessionKey;
  const initialRef = useRef({ promptRequest, bind, defaultAspectRatio, prefs, key, sourceKey });
  initialRef.current = { promptRequest, bind, defaultAspectRatio, prefs, key, sourceKey };
  const sessionRef = useRef<{
    readonly key: string;
    readonly request: ImagePromptRequest;
    readonly bind: ImageGenModalProps["bind"];
  } | null>(null);
  const isCurrent = useCallback(
    (controller: AbortController, currentKey: string) =>
      !controller.signal.aborted &&
      abortRef.current === controller &&
      liveKeyRef.current === currentKey &&
      sessionRef.current?.key === currentKey,
    [],
  );
  const cancelLocal = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDrafting(false);
    setApplying(false);
  }, []);
  const closeModal = useCallback(() => {
    liveKeyRef.current = "";
    sessionRef.current = null;
    cancelLocal();
    onClose();
  }, [cancelLocal, onClose]);
  useLayer(closeModal, open);

  useEffect(() => {
    cancelLocal();
    const initial = initialRef.current;
    if (!sessionKey || !initial.promptRequest) {
      sessionRef.current = null;
      return;
    }
    const saved = readImageDraft(initial.key);
    sessionRef.current = {
      key: sessionKey,
      request: structuredClone(initial.promptRequest),
      bind: structuredClone(initial.bind),
    };
    setDraft({
      ...(saved ?? {
        sourceKey: initial.sourceKey,
        prompt: "",
        negativePrompt: initial.prefs.imageNegativePrompt,
        instruction: "",
        useAux: initial.prefs.autoImageUseAux,
        aspectRatio: initial.defaultAspectRatio,
        profileName: null,
        capabilities: null,
      }),
      sessionKey,
    });
    setError(null);
    setNotice(
      saved?.prompt
        ? saved.sourceKey === initial.sourceKey
          ? "已恢复上次编辑的提示词，可直接复用。"
          : "人物或场景资料已变化，已保留上次提示词；点击重新提炼可更新资料。"
        : "填写提示词，或点击「提炼提示词」。打开面板不会调用辅助模型。",
    );
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      sessionRef.current = null;
    };
  }, [sessionKey, cancelLocal]);

  useEffect(() => {
    if (!sessionKey || draft.sessionKey !== sessionKey) return;
    const { sessionKey: _sessionKey, ...saved } = draft;
    writeImageDraft(key, saved);
  }, [key, sessionKey, draft]);

  const runDraft = async () => {
    const session = sessionRef.current;
    if (!session || liveKeyRef.current !== session.key) return;
    cancelLocal();
    const controller = new AbortController();
    abortRef.current = controller;
    setDrafting(true);
    setError(null);
    setNotice(null);
    const request: ImagePromptRequest = {
      ...structuredClone(session.request),
      instruction: [session.request.instruction.trim(), instruction.trim()]
        .filter(Boolean)
        .join("\n"),
    };
    const style = imageStyleConfig();
    try {
      const selected = await api.imageCapabilities(undefined, controller.signal);
      if (!isCurrent(controller, session.key)) return;
      queryClient.setQueryData(["imageCapabilities"], selected);
      const result = await api.draftImagePrompt(
        {
          request,
          useAux,
          style,
          ...(selected.profileName ? { profileName: selected.profileName } : {}),
        },
        controller.signal,
      );
      if (!isCurrent(controller, session.key)) return;
      updateDraft({
        sourceKey,
        prompt: result.prompt,
        negativePrompt: result.negativePrompt,
        profileName: result.profileName,
        capabilities: result.capabilities,
      });
      if (result.fallbackReason)
        setNotice(`提示词改用本地拼接（${result.fallbackReason}），仍可自由修改。`);
    } catch (caught) {
      if (isCurrent(controller, session.key))
        setError(caught instanceof Error ? caught.message : "提示词提炼失败");
    } finally {
      if (isCurrent(controller, session.key)) {
        abortRef.current = null;
        setDrafting(false);
      }
    }
  };

  const imageModelReady = model.data?.ready === true;
  const imageModelError =
    model.data?.error ?? (model.error instanceof Error ? model.error.message : undefined);
  const independentNegative = model.data?.capabilities?.negativePrompt === true;
  const normalizedForRef = useRef("");
  useEffect(() => {
    if (
      !sessionKey ||
      draft.sessionKey !== sessionKey ||
      model.isFetching ||
      !model.data?.ready ||
      independentNegative
    )
      return;
    const normalizationKey = JSON.stringify([sessionKey, model.data.profileName]);
    if (normalizedForRef.current === normalizationKey) return;
    normalizedForRef.current = normalizationKey;
    if (!prompt.trim() || !negativePrompt.trim()) return;
    const finalPrompt = `${prompt.trim()}\nUser-requested exclusions (render the image without these): ${negativePrompt.trim()}`;
    if (finalPrompt.length > IMAGE_PROMPT_MAX_LENGTH) return;
    setDraft((previous) => ({ ...previous, prompt: finalPrompt, negativePrompt: "" }));
  }, [
    sessionKey,
    draft.sessionKey,
    model.isFetching,
    model.data?.ready,
    model.data?.profileName,
    independentNegative,
    negativePrompt,
    prompt,
  ]);
  const handleGenerate = () => {
    const session = sessionRef.current;
    if (
      !session ||
      liveKeyRef.current !== session.key ||
      !model.data?.ready ||
      !model.data.profileName
    )
      return;
    let finalPrompt = prompt.trim();
    if (!finalPrompt) {
      setError("请先填写或提炼提示词");
      return;
    }
    if (!independentNegative && negativePrompt.trim()) {
      finalPrompt += `\nUser-requested exclusions (render the image without these): ${negativePrompt.trim()}`;
    }
    if (finalPrompt.length > IMAGE_PROMPT_MAX_LENGTH) {
      setError(`提示词与排除要求合计不能超过 ${IMAGE_PROMPT_MAX_LENGTH} 字符，请精简后重试`);
      return;
    }
    cancelLocal();
    setError(null);
    setNotice(null);
    updateDraft({
      sourceKey,
      prompt: finalPrompt,
      negativePrompt: independentNegative ? negativePrompt : "",
      profileName: model.data.profileName,
      capabilities: model.data.capabilities,
    });
    startImageJob({
      key,
      sourceKey,
      client: queryClient,
      ...(session.bind ? { binding: session.bind } : {}),
      request: {
        prompt: finalPrompt,
        aspectRatio,
        profileName: model.data.profileName,
        ...(independentNegative && negativePrompt.trim()
          ? { negativePrompt: negativePrompt.trim() }
          : {}),
      },
    });
  };
  const handleCancel = () => {
    cancelLocal();
    if (generating) cancelImageJob(key);
    setNotice(
      generating
        ? "已取消等待；已经发送的任务可能仍在服务端继续，不会自动采用迟到结果。"
        : "已取消本次请求。",
    );
  };
  const handleApply = async () => {
    const session = sessionRef.current;
    if (!preview || !session || liveKeyRef.current !== session.key) return;
    if (!session.bind) {
      onApplied(preview.image);
      closeModal();
      return;
    }
    cancelLocal();
    const controller = new AbortController();
    abortRef.current = controller;
    setApplying(true);
    setError(null);
    try {
      const bindings = await api.bindSaveImage(
        session.bind.saveId,
        {
          ...session.bind.target,
          imageId: preview.image.id,
        },
        controller.signal,
      );
      if (!isCurrent(controller, session.key)) return;
      queryClient.setQueryData(["saveImages", session.bind.saveId], bindings);
      onApplied(preview.image, bindings);
      closeModal();
    } catch (caught) {
      if (isCurrent(controller, session.key))
        setError(caught instanceof Error ? caught.message : "应用图片失败");
    } finally {
      if (isCurrent(controller, session.key)) {
        abortRef.current = null;
        setApplying(false);
      }
    }
  };
  const busy = drafting || generating || applying;
  const applied = Boolean(
    bind &&
      preview &&
      bindingState.data &&
      boundImage(bindingState.data, bind.target) === preview.image.id,
  );
  const error = localError ?? (!applied && job?.sourceKey === sourceKey ? job.error : null);
  const displayNotice = [
    notice,
    generating
      ? bind
        ? "可以关闭面板继续后台生成，完成后会自动显示在原目标。"
        : "可以关闭面板继续后台生成，完成后重新打开即可预览和采用。"
      : null,
    applied
      ? bind?.target.kind === "turn"
        ? "图片已显示在对应回合正文。"
        : "图片已自动采用。"
      : null,
    model.data?.ready && !independentNegative
      ? negativePrompt.trim()
        ? "当前模型使用单条提示词，已保存的排除要求会合入正向提示词，不发送独立负面字段。"
        : "当前模型使用单条提示词，请将排除要求写在正向提示词中。"
      : null,
    ...(preview?.image.metadata.warnings ?? []),
  ]
    .filter(Boolean)
    .join("；");
  if (!open || !promptRequest) return null;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="关闭弹窗"
        className={styles.backdropDismiss}
        onClick={closeModal}
      />
      <div className={styles.modal}>
        <Panel line="var(--cp-cyan)" className={styles.modalPanel}>
          <div className={styles.modalHead}>
            <div>
              <h2 className={styles.modalTitle}>{title}</h2>
              {subtitle && <span className={styles.modalSub}>{subtitle}</span>}
            </div>
            <Button small keyId="key.esc" onClick={closeModal}>
              {generating ? "关闭面板" : "关闭"}
            </Button>
          </div>

          <div className={styles.modalBody}>
            {!imageModelReady && (
              <div className={styles.notice} role="status">
                <span>{imageModelError ?? "尚未设置文生图模型"}</span>
                <Link to="/settings?tab=profiles">前往配置文生图模型 →</Link>
              </div>
            )}

            {displayNotice && (
              <div className={styles.notice} role="status">
                <span>{displayNotice}</span>
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
                    onChange={(e) => updateDraft({ instruction: e.target.value })}
                  />
                </FrameBox>
              </label>

              <div className={styles.inlineTools}>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={useAux}
                    onChange={(e) => updateDraft({ useAux: e.target.checked })}
                  />
                  <span>辅助模型提炼</span>
                </label>
                <Button small disabled={busy} onClick={() => void runDraft()}>
                  {drafting ? "提炼中…" : prompt.trim() ? "重新提炼提示词" : "提炼提示词"}
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
                    onChange={(e) => updateDraft({ prompt: e.target.value })}
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
                    onChange={(e) => updateDraft({ aspectRatio: e.target.value as AspectRatio })}
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

            {independentNegative && (
              <details className={styles.negFold}>
                <summary>反向提示词（Negative Prompt）</summary>
                <label className={styles.field}>
                  <FrameBox>
                    <textarea
                      rows={2}
                      maxLength={2000}
                      disabled={busy}
                      value={negativePrompt}
                      onChange={(e) => updateDraft({ negativePrompt: e.target.value })}
                    />
                  </FrameBox>
                </label>
              </details>
            )}

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
              <>
                <Button onClick={closeModal}>{generating ? "关闭面板，后台继续" : "关闭"}</Button>
                <Button onClick={handleCancel}>{generating ? "取消任务" : "取消"}</Button>
              </>
            ) : (
              <>
                <Button onClick={closeModal}>关闭</Button>
                <Button
                  primary={!preview}
                  disabled={!prompt.trim() || !imageModelReady || model.isFetching}
                  onClick={() => void handleGenerate()}
                >
                  {preview ? "重新生成" : "开始生成"}
                </Button>
                {preview && !applied && (
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
