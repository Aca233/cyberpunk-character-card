import {
  buildTurnSegmentPromptInput,
  IMAGE_AUX_SYSTEM_PROMPT_MAX_LENGTH,
  IMAGE_INSTRUCTION_MAX_LENGTH,
  IMAGE_NEGATIVE_PROMPT_MAX_LENGTH,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_STYLE_FIELD_MAX_LENGTH,
  type ImagePromptLanguage,
  type ImagePromptRequest,
  splitTurnSceneSegments,
  type TurnImagePromptInput,
} from "@cp/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { type AspectRatio, api, type SaveImageBindings, type StoredImage } from "../../api/client";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { Panel } from "../../ui/Panel";
import {
  type ImageBatchCount,
  imageStyleConfig,
  setImagePromptField,
  setImagePromptLanguage,
  useNarrativePrefs,
} from "../settings/prefs";
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
  startMultiTurnImageJob,
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

const PROMPT_LANGUAGES: readonly { readonly id: ImagePromptLanguage; readonly label: string }[] = [
  { id: "en", label: "纯英文自然语言" },
  { id: "en-tags", label: "纯英文 Tag 词组" },
  { id: "zh", label: "纯中文描述" },
];

const SEGMENT_COUNTS: readonly ImageBatchCount[] = [1, 2, 3, 4];

function mergeExclusionsIntoPrompt(
  promptText: string,
  negativeText: string,
  lang: ImagePromptLanguage,
): string {
  const pos = promptText.trim();
  const neg = negativeText.trim();
  if (!neg) return pos;
  const prefix =
    lang === "zh"
      ? "排除元素（画面中不要出现）："
      : "User-requested exclusions (render the image without these): ";
  return `${pos}\n${prefix}${neg}`;
}

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

function makeEmptySlotPrompts(
  count: number,
  defaultNegative: string,
): {
  readonly prompts: readonly string[];
  readonly negatives: readonly string[];
} {
  return {
    prompts: Array.from({ length: count }, () => ""),
    negatives: Array.from({ length: count }, () => defaultNegative),
  };
}

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

  /** 仅当整轮场景生图（非单槽位重绘、非末尾单张追加）时开放多图分镜穿插模式 */
  const canMultiTurn = Boolean(
    promptRequest?.kind === "turn" &&
      bind?.target.kind === "turn" &&
      bind.target.slot === undefined &&
      !bind.target.append,
  );
  const [segmentCount, setSegmentCount] = useState<ImageBatchCount>(1);
  const [activeSegment, setActiveSegment] = useState(0);
  const [segmentPrompts, setSegmentPrompts] = useState<readonly string[]>([""]);
  const [segmentNegatives, setSegmentNegatives] = useState<readonly string[]>([""]);
  const [draftProgress, setDraftProgress] = useState<{
    readonly current: number;
    readonly total: number;
  } | null>(null);

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
  const { useAux, instruction, aspectRatio } = draft;
  const isMultiMode = canMultiTurn && segmentCount > 1;
  const prompt = isMultiMode ? (segmentPrompts[activeSegment] ?? "") : draft.prompt;
  const negativePrompt = isMultiMode
    ? (segmentNegatives[activeSegment] ?? prefs.imageNegativePrompt)
    : draft.negativePrompt;

  const updateDraft = (patch: Partial<SavedImageDraft>) =>
    setDraft((previous) => ({ ...previous, ...patch }));

  const updateCurrentPrompt = (value: string) => {
    if (isMultiMode) {
      setSegmentPrompts((prev) => prev.map((item, i) => (i === activeSegment ? value : item)));
    } else {
      updateDraft({ prompt: value });
    }
  };

  const updateCurrentNegative = (value: string) => {
    if (isMultiMode) {
      setSegmentNegatives((prev) => prev.map((item, i) => (i === activeSegment ? value : item)));
    } else {
      updateDraft({ negativePrompt: value });
    }
  };

  const handleSegmentCountChange = (nextCount: ImageBatchCount) => {
    if (!canMultiTurn || nextCount === segmentCount) return;
    setSegmentCount(nextCount);
    setActiveSegment(0);
    if (nextCount > 1) {
      setSegmentPrompts((prev) =>
        Array.from({ length: nextCount }, (_, i) => prev[i] ?? (i === 0 ? draft.prompt : "")),
      );
      setSegmentNegatives((prev) =>
        Array.from(
          { length: nextCount },
          (_, i) => prev[i] ?? (i === 0 ? draft.negativePrompt : prefs.imageNegativePrompt),
        ),
      );
    } else if (segmentPrompts[0]?.trim() && !draft.prompt.trim()) {
      updateDraft({
        prompt: segmentPrompts[0],
        negativePrompt: segmentNegatives[0] ?? prefs.imageNegativePrompt,
      });
    }
  };

  const segmentExcerpts = useMemo(() => {
    if (!isMultiMode || promptRequest?.kind !== "turn") return [] as readonly string[];
    return splitTurnSceneSegments(promptRequest.sceneText, segmentCount);
  }, [isMultiMode, promptRequest, segmentCount]);

  const [drafting, setDrafting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const job = useImageJob(key);
  const generating = isImageJobPending(job);
  const preview = job?.image ? { image: job.image, sessionKey } : null;
  const previewList = job?.images && job.images.length > 0 ? job.images : [];
  const abortRef = useRef<AbortController | null>(null);
  const liveKeyRef = useRef(sessionKey);
  liveKeyRef.current = sessionKey;
  const initialRef = useRef({
    promptRequest,
    bind,
    defaultAspectRatio,
    prefs,
    key,
    sourceKey,
    canMultiTurn,
  });
  initialRef.current = {
    promptRequest,
    bind,
    defaultAspectRatio,
    prefs,
    key,
    sourceKey,
    canMultiTurn,
  };
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
    setDraftProgress(null);
    setApplying(false);
    setUploading(false);
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
    const defaultCount: ImageBatchCount = initial.canMultiTurn ? initial.prefs.imageBatchCount : 1;
    setSegmentCount(defaultCount);
    setActiveSegment(0);
    const emptySlots = makeEmptySlotPrompts(defaultCount, initial.prefs.imageNegativePrompt);
    setSegmentPrompts(emptySlots.prompts);
    setSegmentNegatives(emptySlots.negatives);
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
      defaultCount > 1
        ? `当前将按正文切分为 ${defaultCount} 幕分镜插图穿插展示；点击「提炼全部分镜」即可一次性生成各幕提示词。`
        : saved?.prompt
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

  const runDraft = async (mode: "single" | "all" = isMultiMode ? "all" : "single") => {
    const session = sessionRef.current;
    if (!session || liveKeyRef.current !== session.key) return;
    cancelLocal();
    const controller = new AbortController();
    abortRef.current = controller;
    setDrafting(true);
    setError(null);
    setNotice(null);
    const style = imageStyleConfig();
    try {
      const selected = await api.imageCapabilities(undefined, controller.signal);
      if (!isCurrent(controller, session.key)) return;
      queryClient.setQueryData(["imageCapabilities"], selected);

      if (isMultiMode && session.request.kind === "turn") {
        const baseTurn: TurnImagePromptInput = {
          ...structuredClone(session.request),
          instruction: [session.request.instruction.trim(), instruction.trim()]
            .filter(Boolean)
            .join("\n"),
        };
        const indices =
          mode === "all"
            ? Array.from({ length: segmentCount }, (_, i) => i)
            : [Math.min(activeSegment, segmentCount - 1)];
        const fallbackNotes: string[] = [];
        const nextPrompts = [...segmentPrompts];
        const nextNegs = [...segmentNegatives];
        while (nextPrompts.length < segmentCount) nextPrompts.push("");
        while (nextNegs.length < segmentCount) nextNegs.push(prefs.imageNegativePrompt);

        for (let step = 0; step < indices.length; step++) {
          const segIdx = indices[step];
          if (segIdx === undefined) continue;
          setDraftProgress({ current: step + 1, total: indices.length });
          const segReq = buildTurnSegmentPromptInput(baseTurn, segIdx, segmentCount);
          const result = await api.draftImagePrompt(
            {
              request: segReq,
              useAux,
              style,
              ...(selected.profileName ? { profileName: selected.profileName } : {}),
            },
            controller.signal,
          );
          if (!isCurrent(controller, session.key)) return;
          nextPrompts[segIdx] = result.prompt;
          nextNegs[segIdx] = result.negativePrompt;
          setSegmentPrompts([...nextPrompts]);
          setSegmentNegatives([...nextNegs]);
          if (result.fallbackReason)
            fallbackNotes.push(`分镜 ${segIdx + 1}：${result.fallbackReason}`);
        }
        if (fallbackNotes.length > 0) {
          setNotice(`部分分镜改用本地拼接（${fallbackNotes.join("；")}），仍可自由修改。`);
        } else {
          setNotice(
            mode === "all"
              ? `已完成全部 ${segmentCount} 幕分镜提示词提炼，可切页逐张微调。`
              : `已完成分镜 ${activeSegment + 1} 提示词提炼。`,
          );
        }
        return;
      }

      const request: ImagePromptRequest = {
        ...structuredClone(session.request),
        instruction: [session.request.instruction.trim(), instruction.trim()]
          .filter(Boolean)
          .join("\n"),
      };
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
        setDraftProgress(null);
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
      isMultiMode ||
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
    if (!draft.prompt.trim() || !draft.negativePrompt.trim()) return;
    const finalPrompt = mergeExclusionsIntoPrompt(
      draft.prompt,
      draft.negativePrompt,
      prefs.imagePromptLanguage,
    );
    if (finalPrompt.length > IMAGE_PROMPT_MAX_LENGTH) return;
    setDraft((previous) => ({ ...previous, prompt: finalPrompt, negativePrompt: "" }));
  }, [
    isMultiMode,
    sessionKey,
    draft.sessionKey,
    model.isFetching,
    model.data?.ready,
    model.data?.profileName,
    independentNegative,
    draft.negativePrompt,
    draft.prompt,
    prefs.imagePromptLanguage,
  ]);

  const allSegmentsReady = isMultiMode
    ? segmentPrompts.slice(0, segmentCount).every((p) => p.trim().length > 0)
    : prompt.trim().length > 0;

  const handleGenerate = () => {
    const session = sessionRef.current;
    if (
      !session ||
      liveKeyRef.current !== session.key ||
      !model.data?.ready ||
      !model.data.profileName
    )
      return;

    if (isMultiMode && session.bind?.target.kind === "turn") {
      const requests: Parameters<typeof api.generateImage>[0][] = [];
      for (let i = 0; i < segmentCount; i++) {
        const rawPos = (segmentPrompts[i] ?? "").trim();
        const rawNeg = (segmentNegatives[i] ?? "").trim();
        if (!rawPos) {
          setActiveSegment(i);
          setError(`分镜 ${i + 1} 尚未填写或提炼提示词，请先补全或点击「提炼全部分镜」`);
          return;
        }
        const finalPos = independentNegative
          ? rawPos
          : mergeExclusionsIntoPrompt(rawPos, rawNeg, prefs.imagePromptLanguage);
        if (finalPos.length > IMAGE_PROMPT_MAX_LENGTH) {
          setActiveSegment(i);
          setError(`分镜 ${i + 1} 提示词合计不能超过 ${IMAGE_PROMPT_MAX_LENGTH} 字符`);
          return;
        }
        requests.push({
          prompt: finalPos,
          aspectRatio,
          profileName: model.data.profileName,
          ...(independentNegative && rawNeg ? { negativePrompt: rawNeg } : {}),
        });
      }
      cancelLocal();
      setError(null);
      setNotice(null);
      startMultiTurnImageJob({
        key,
        sourceKey,
        client: queryClient,
        requests,
        binding: {
          saveId: session.bind.saveId,
          seq: session.bind.target.seq,
        },
      });
      return;
    }

    let finalPrompt = prompt.trim();
    if (!finalPrompt) {
      setError("请先填写或提炼提示词");
      return;
    }
    if (!independentNegative && negativePrompt.trim()) {
      finalPrompt = mergeExclusionsIntoPrompt(
        finalPrompt,
        negativePrompt,
        prefs.imagePromptLanguage,
      );
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
  const handleLocalFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    const session = sessionRef.current;
    if (!file || !session || liveKeyRef.current !== session.key) return;
    cancelLocal();
    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!isCurrent(controller, session.key)) return;
      const uploaded = await api.uploadImage(
        {
          dataUrl,
          label: file.name ? `本地图片：${file.name}` : "本地上传图片",
        },
        controller.signal,
      );
      if (!isCurrent(controller, session.key)) return;
      queryClient.setQueryData(["image", uploaded.image.id], uploaded.image);
      if (session.bind) {
        const bindings = await api.bindSaveImage(
          session.bind.saveId,
          {
            ...session.bind.target,
            imageId: uploaded.image.id,
          },
          controller.signal,
        );
        if (!isCurrent(controller, session.key)) return;
        queryClient.setQueryData(["saveImages", session.bind.saveId], bindings);
        onApplied(uploaded.image, bindings);
      } else {
        onApplied(uploaded.image);
      }
      closeModal();
    } catch (caught) {
      if (isCurrent(controller, session.key)) {
        setError(caught instanceof Error ? caught.message : "上传本地图片失败");
      }
    } finally {
      if (isCurrent(controller, session.key)) {
        abortRef.current = null;
        setUploading(false);
      }
    }
  };

  const busy = drafting || generating || applying || uploading;
  const applied = Boolean(
    bind &&
      preview &&
      bindingState.data &&
      (job?.images && job.images.length > 1
        ? job.status === "done"
        : boundImage(bindingState.data, bind.target) === preview.image.id),
  );
  const error = localError ?? (!applied && job?.error ? job.error : null);
  const displayNotice = [
    notice,
    generating
      ? job?.progress && job.progress.total > 1
        ? `正在后台按顺序绘制第 ${job.progress.current}/${job.progress.total} 张分镜插图，可以关闭面板，每张完成后都会立即穿插显示在正文。`
        : bind
          ? "可以关闭面板继续后台生成，完成后会自动显示在原目标。"
          : "可以关闭面板继续后台生成，完成后重新打开即可预览和采用。"
      : null,
    applied
      ? bind?.target.kind === "turn"
        ? job?.images && job.images.length > 1
          ? `全部 ${job.images.length} 张分镜插图已穿插显示在对应回合正文。`
          : "图片已显示在对应回合正文。"
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

  const currentExcerpt = segmentExcerpts[activeSegment];

  const langHint =
    prefs.imagePromptLanguage === "zh"
      ? "纯中文描述"
      : prefs.imagePromptLanguage === "en-tags"
        ? "纯英文 Tag 词组"
        : "纯英文自然语言";

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

          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => void handleLocalFileChange(e)}
          />
          <div className={styles.modalBody}>
            {!imageModelReady && (
              <div className={styles.notice} role="status">
                <span>
                  {imageModelError ?? "尚未设置文生图模型"}
                  （仍可直接点击下方「上传本地图片」选用本机图片）
                </span>
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

            <div className={styles.quickConfigRow}>
              <div className={styles.quickGroup}>
                <span className={styles.quickLabel}>提示词语言</span>
                <fieldset className={styles.pillBar} aria-label="提示词语言">
                  {PROMPT_LANGUAGES.map((lang) => (
                    <button
                      key={lang.id}
                      type="button"
                      disabled={busy}
                      aria-pressed={prefs.imagePromptLanguage === lang.id}
                      className={styles.pillBtn}
                      onClick={() => setImagePromptLanguage(lang.id)}
                    >
                      {lang.label}
                    </button>
                  ))}
                </fieldset>
              </div>

              {canMultiTurn && (
                <div className={styles.quickGroup}>
                  <span className={styles.quickLabel}>本轮插图数量（正文穿插）</span>
                  <fieldset className={styles.pillBar} aria-label="本轮插图数量">
                    {SEGMENT_COUNTS.map((count) => (
                      <button
                        key={count}
                        type="button"
                        disabled={busy}
                        aria-pressed={segmentCount === count}
                        className={styles.pillBtn}
                        onClick={() => handleSegmentCountChange(count)}
                      >
                        {count} 张
                      </button>
                    ))}
                  </fieldset>
                </div>
              )}
            </div>

            <div className={styles.rowSplit}>
              <label className={styles.field}>
                <span className={styles.fieldHead}>
                  <span>补充要求 / 构图与风格微调（可选）</span>
                </span>
                <FrameBox>
                  <input
                    maxLength={IMAGE_INSTRUCTION_MAX_LENGTH}
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
                {isMultiMode ? (
                  <>
                    <Button small disabled={busy} onClick={() => void runDraft("all")}>
                      {drafting && draftProgress
                        ? `提炼中 ${draftProgress.current}/${draftProgress.total}…`
                        : "提炼全部分镜"}
                    </Button>
                    <Button small disabled={busy} onClick={() => void runDraft("single")}>
                      重提当前分镜
                    </Button>
                  </>
                ) : (
                  <Button small disabled={busy} onClick={() => void runDraft("single")}>
                    {drafting ? "提炼中…" : prompt.trim() ? "重新提炼提示词" : "提炼提示词"}
                  </Button>
                )}
              </div>
            </div>

            {isMultiMode && (
              <div className={styles.segmentBox}>
                <div className={styles.segmentTabs} role="tablist" aria-label="分镜切分列表">
                  {Array.from({ length: segmentCount }, (_, i) => {
                    const filled = (segmentPrompts[i] ?? "").trim().length > 0;
                    return (
                      <button
                        // biome-ignore lint/suspicious/noArrayIndexKey: 固定按分镜序号排列
                        key={i}
                        type="button"
                        role="tab"
                        aria-selected={activeSegment === i}
                        className={styles.segmentTab}
                        data-filled={filled || undefined}
                        onClick={() => setActiveSegment(i)}
                      >
                        <span>分镜 {i + 1}</span>
                        <span className={styles.segmentDot} aria-hidden />
                      </button>
                    );
                  })}
                </div>
                {currentExcerpt && (
                  <p className={styles.segmentExcerpt}>
                    <strong>对应正文片段：</strong>
                    {currentExcerpt.length > 160
                      ? `${currentExcerpt.slice(0, 160)}…`
                      : currentExcerpt}
                  </p>
                )}
              </div>
            )}

            <div className={styles.rowSplit}>
              <label className={styles.field}>
                <span className={styles.fieldHead}>
                  <span>
                    {isMultiMode
                      ? `分镜 ${activeSegment + 1}/${segmentCount} 提示词（${langHint}）`
                      : `生图提示词（${langHint}，可直接手写或修改）`}
                  </span>
                  <Link to="/settings?tab=narrative">更多默认画风设置</Link>
                </span>
                <FrameBox>
                  <textarea
                    rows={4}
                    maxLength={IMAGE_PROMPT_MAX_LENGTH}
                    disabled={busy}
                    value={prompt}
                    placeholder={
                      prefs.imagePromptLanguage === "zh"
                        ? "赛博朋克 2077 夜之城电影感场景，霓虹雨夜…"
                        : prefs.imagePromptLanguage === "en-tags"
                          ? "1girl, cyberpunk, neon rain, night city, masterpiece..."
                          : "Cyberpunk 2077 cinematic scene in Night City..."
                    }
                    onChange={(e) => updateCurrentPrompt(e.target.value)}
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

            <details className={styles.negFold}>
              <summary>自定义前缀提示词 & 辅助模型提炼主提示词（同步保存到全局设置）</summary>
              <div className={styles.customPromptStack}>
                <label className={styles.field}>
                  <span className={styles.fieldHead}>
                    <span>通用自定义提示词（前缀 / 画质词 / 画师串 / LoRA 触发词）</span>
                  </span>
                  <FrameBox>
                    <textarea
                      rows={2}
                      maxLength={IMAGE_STYLE_FIELD_MAX_LENGTH}
                      disabled={busy}
                      value={prefs.imageCustomPrompt}
                      placeholder="例如：masterpiece, best quality, very aesthetic, absurdres"
                      onChange={(e) => setImagePromptField("imageCustomPrompt", e.target.value)}
                    />
                  </FrameBox>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldHead}>
                    <span>辅助模型提炼主提示词（System Prompt）</span>
                  </span>
                  <FrameBox>
                    <textarea
                      rows={4}
                      maxLength={IMAGE_AUX_SYSTEM_PROMPT_MAX_LENGTH}
                      disabled={busy}
                      value={prefs.imageAuxSystemPrompt}
                      onChange={(e) => setImagePromptField("imageAuxSystemPrompt", e.target.value)}
                    />
                  </FrameBox>
                </label>
              </div>
            </details>

            {independentNegative && (
              <details className={styles.negFold}>
                <summary>
                  {isMultiMode
                    ? `分镜 ${activeSegment + 1} 反向提示词（Negative Prompt）`
                    : "反向提示词（Negative Prompt）"}
                </summary>
                <label className={styles.field}>
                  <FrameBox>
                    <textarea
                      rows={2}
                      maxLength={IMAGE_NEGATIVE_PROMPT_MAX_LENGTH}
                      disabled={busy}
                      value={negativePrompt}
                      onChange={(e) => updateCurrentNegative(e.target.value)}
                    />
                  </FrameBox>
                </label>
              </details>
            )}

            {(generating || drafting || preview || previewList.length > 0) && (
              <div className={styles.previewBox}>
                <CellFrame />
                {generating ? (
                  <div className={styles.previewStatus}>
                    <span>
                      {job?.progress && job.progress.total > 1
                        ? `正在绘制第 ${job.progress.current} / ${job.progress.total} 张分镜插图…`
                        : "图片正在排队或生成…"}
                    </span>
                    <small>取决于服务商或本地显卡，可能需要几秒到数十秒</small>
                    {previewList.length > 0 && (
                      <div className={styles.previewGrid}>
                        {previewList.map((img, i) => (
                          <img
                            key={img.id}
                            src={img.dataUrl}
                            alt={`已生成分镜 ${i + 1}`}
                            className={styles.previewThumb}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ) : drafting && !preview ? (
                  <div className={styles.previewStatus}>
                    <span>
                      {draftProgress && draftProgress.total > 1
                        ? `正在提炼第 ${draftProgress.current} / ${draftProgress.total} 幕分镜提示词（${langHint}）…`
                        : `正在提炼提示词（${langHint}）…`}
                    </span>
                  </div>
                ) : previewList.length > 1 ? (
                  <div className={styles.previewGrid}>
                    {previewList.map((img, i) => (
                      <figure key={img.id} className={styles.previewGridItem}>
                        <img
                          src={img.dataUrl}
                          alt={`${title} · 分镜 ${i + 1}`}
                          className={styles.previewThumb}
                        />
                        <figcaption className={styles.previewThumbCap}>
                          <span>分镜 {i + 1}</span>
                          <Button
                            small
                            onClick={() => downloadStoredImage(img, `${title}-分镜${i + 1}`)}
                          >
                            下载
                          </Button>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : preview ? (
                  <img src={preview.image.dataUrl} alt={title} className={styles.previewImg} />
                ) : null}
              </div>
            )}
          </div>

          <div className={styles.actions}>
            <div className={styles.actionsLeft}>
              <Button small disabled={busy} onClick={() => fileInputRef.current?.click()}>
                {uploading ? "上传中…" : "上传本地图片"}
              </Button>
              {preview && previewList.length <= 1 && !busy && (
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
                  disabled={!allSegmentsReady || !imageModelReady || model.isFetching}
                  onClick={() => void handleGenerate()}
                >
                  {isMultiMode
                    ? `生成全部 ${segmentCount} 张插图`
                    : preview
                      ? "重新生成"
                      : "开始生成"}
                </Button>
                {preview && !applied && !isMultiMode && (
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
