import { type TurnEvent, type TurnInput, TurnInputSchema } from "@cp/core";
import { create } from "zustand";
import { ApiError, api, newRequestId } from "../../api/client";
import { followTurn } from "../../api/events";
import { playSfx } from "../../audio";
import { beginProgress, type EndCategory, type ProgressHandle } from "../../progress";

/**
 * 一轮生成的进度：提交 → 事件流（正文逐字、阶段推进）→ 终止事件 → 刷新存档状态。
 * 出错、被拦截、停止时玩家的输入留在输入框里，可以原样重试
 */

export type Pending = { readonly kind: "input"; readonly input: TurnInput };

export type FailureKind =
  /** 被安全过滤拦截 */
  | "blocked"
  /** 模型或网络出错 */
  | "error"
  /** 玩家停止了生成 */
  | "stopped"
  /** 模型没配好（503），要去设置里改 */
  | "unavailable"
  /** 后端拒绝：版本过期或请求冲突 */
  | "rejected"
  /** 事件流断了，这一轮在后端找不到 */
  | "lost";

export interface Failure {
  readonly kind: FailureKind;
  readonly message: string;
  readonly retryable: boolean;
}

export type LiveBoost = Extract<TurnEvent, { type: "boost" }>;
export type LiveStage = Extract<TurnEvent, { type: "stage" }> & {
  readonly startedAt: number;
  readonly local?: true;
};

export interface CompletedStage {
  readonly label: string;
  readonly ms: number;
}

/** 提交前确认：这一轮要一次花掉一大笔钱；确认后带 spendOk 原样重发 */
export interface Spend {
  readonly label: string;
  readonly price: number;
  readonly eddies: number;
  readonly input: TurnInput;
}

interface StoryState {
  readonly phase: "idle" | "submitting" | "streaming";
  readonly stopping: boolean;
  readonly saveId: string | null;
  readonly turnId: string | null;
  /** 正在生成的正文；记账在正文之后由后端另外抽 */
  readonly text: string;
  /** 正在生成的思维链（原生思考流或思考标签剥离所得） */
  readonly thought: string;
  readonly boost: LiveBoost | null;
  readonly stage: LiveStage | null;
  readonly stageTrace: readonly CompletedStage[];
  readonly pending: Pending | null;
  readonly failure: Failure | null;
  readonly spend: Spend | null;
  /** 输入框：方式和文字；发送成功、这一轮写进存档后才清空 */
  readonly draft: TurnInput;
  setDraft(draft: Partial<TurnInput>): void;
  restoreDraft(saveId: string, draft: TurnInput): void;
  dismiss(): void;
  /** 不花这笔钱：关掉确认框，输入留在输入框里 */
  cancelSpend(): void;
  enter(saveId: string): void;
  submit(
    saveId: string,
    baseVersion: number,
    pending: Pending,
    refresh: () => Promise<unknown>,
  ): Promise<void>;
  stop(): Promise<void>;
}

let unsubscribe: (() => void) | null = null;

/** 这一轮的进度（第 2 条）：提交时开始，下面每条走到 idle 的路各结束一次；重复结束不会再发 */
let progress: ProgressHandle | null = null;

function finish(category: EndCategory, message?: string): void {
  progress?.end(category, message);
  progress = null;
}

const EMPTY_DRAFT: TurnInput = { text: "" };
const DRAFT_KEY_PREFIX = "cp.storyDraft:";

function mergeDraft(current: TurnInput, patch: Partial<TurnInput>): TurnInput {
  const merged = { ...current, ...patch };
  return {
    text: merged.text,
    ...(merged.replyTo !== undefined ? { replyTo: merged.replyTo } : {}),
    ...(merged.sandevistan === true ? { sandevistan: true } : {}),
  };
}

function loadSavedDraft(saveId: string): TurnInput {
  if (typeof localStorage === "undefined") return EMPTY_DRAFT;
  try {
    const raw = localStorage.getItem(`${DRAFT_KEY_PREFIX}${saveId}`);
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as Partial<TurnInput>;
    const text = typeof parsed.text === "string" ? parsed.text : "";
    const replyTo =
      typeof parsed.replyTo === "number" && Number.isInteger(parsed.replyTo) && parsed.replyTo >= 1
        ? parsed.replyTo
        : undefined;
    const sandevistan = parsed.sandevistan === true ? true : undefined;
    if (text === "" && replyTo === undefined && !sandevistan) return EMPTY_DRAFT;
    return {
      text,
      ...(replyTo !== undefined ? { replyTo } : {}),
      ...(sandevistan ? { sandevistan: true } : {}),
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

function persistDraft(saveId: string | null, draft: TurnInput): void {
  if (!saveId || typeof localStorage === "undefined") return;
  const key = `${DRAFT_KEY_PREFIX}${saveId}`;
  try {
    if (draft.text === "" && draft.replyTo === undefined && draft.sandevistan !== true) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(
      key,
      JSON.stringify({
        text: draft.text,
        ...(draft.replyTo !== undefined ? { replyTo: draft.replyTo } : {}),
        ...(draft.sandevistan === true ? { sandevistan: true } : {}),
      }),
    );
  } catch {
    // 隐私模式或存储配额不足时静默忽略
  }
}

export const useStory = create<StoryState>()((set, get) => {
  let generation = 0;
  let pendingText = "";
  let pendingThought = "";
  let flushRaf = 0;

  const clearPendingStream = () => {
    pendingText = "";
    pendingThought = "";
    if (flushRaf !== 0 && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(flushRaf);
    }
    flushRaf = 0;
  };

  const flushPendingStream = () => {
    flushRaf = 0;
    if (pendingText === "" && pendingThought === "") return;
    const addText = pendingText;
    const addThought = pendingThought;
    pendingText = "";
    pendingThought = "";
    set((s) => ({
      ...(addText !== "" ? { text: s.text + addText } : {}),
      ...(addThought !== "" ? { thought: s.thought + addThought } : {}),
    }));
  };

  const scheduleStreamFlush = () => {
    if (flushRaf !== 0) return;
    if (typeof requestAnimationFrame === "function") {
      flushRaf = requestAnimationFrame(flushPendingStream);
    } else {
      flushPendingStream();
    }
  };

  const follow = (
    saveId: string,
    turnId: string,
    refresh: () => Promise<unknown>,
    current: () => boolean,
    submittedDraft: TurnInput | null,
  ) => {
    clearPendingStream();
    unsubscribe?.();
    set({ phase: "streaming", turnId });
    unsubscribe = followTurn(saveId, turnId, {
      onEvent: (event) => {
        if (!current()) return;
        switch (event.type) {
          case "started":
            set((s) =>
              s.stage?.local ? { stage: { ...s.stage, detail: "回合已建立，正在准备上下文" } } : s,
            );
            return;
          case "stage": {
            if (get().stopping) return;
            const now = Date.now();
            set((s) => {
              const prev = s.stage;
              const trace =
                prev && !prev.local
                  ? [...s.stageTrace, { label: prev.label, ms: Math.max(0, now - prev.startedAt) }]
                  : s.stageTrace;
              return { stage: { ...event, startedAt: now }, stageTrace: trace };
            });
            return;
          }
          case "rolled":
            return;
          case "boost":
            if (get().stopping) return;
            if (get().boost === null) playSfx("sandevistan");
            set({ boost: event });
            return;
          case "thought":
            if (get().stopping) return;
            pendingThought += event.text;
            scheduleStreamFlush();
            return;
          case "text":
            if (get().stopping) return;
            pendingText += event.text;
            scheduleStreamFlush();
            return;
          case "done": {
            if (!get().stopping) flushPendingStream();
            else clearPendingStream();
            const complete = () => {
              if (!current()) return;
              clearPendingStream();
              playSfx("turnDone");
              set((s) => {
                const nextDraft = s.draft === submittedDraft ? EMPTY_DRAFT : s.draft;
                if (nextDraft !== s.draft) persistDraft(saveId, nextDraft);
                return {
                  phase: "idle",
                  stopping: false,
                  turnId: null,
                  text: "",
                  thought: "",
                  boost: null,
                  stage: null,
                  stageTrace: [],
                  pending: null,
                  draft: nextDraft,
                };
              });
              finish("ok");
            };
            void refresh().then(complete, complete);
            return;
          }
          case "confirmSpend": {
            clearPendingStream();
            const pending = get().pending;
            finish("confirmSpend");
            set({
              phase: "idle",
              stopping: false,
              turnId: null,
              text: "",
              thought: "",
              boost: null,
              stage: null,
              stageTrace: [],
              pending: null,
              spend:
                pending?.kind === "input"
                  ? {
                      label: event.label,
                      price: event.price,
                      eddies: event.eddies,
                      input: pending.input,
                    }
                  : null,
            });
            return;
          }
          case "blocked":
            clearPendingStream();
            playSfx("error");
            finish("blocked", event.reason);
            set({
              phase: "idle",
              stopping: false,
              turnId: null,
              boost: null,
              stage: null,
              stageTrace: [],
              failure: { kind: "blocked", message: event.reason, retryable: true },
            });
            void refresh();
            return;
          case "stopped":
            clearPendingStream();
            playSfx("cancel");
            finish("stopped");
            set({
              phase: "idle",
              stopping: false,
              turnId: null,
              boost: null,
              stage: null,
              stageTrace: [],
              failure: {
                kind: "stopped",
                message: "已停止生成，这一轮没有写进存档",
                retryable: true,
              },
            });
            void refresh();
            return;
          case "error":
            clearPendingStream();
            playSfx("error");
            finish("error", event.message);
            set({
              phase: "idle",
              stopping: false,
              turnId: null,
              boost: null,
              stage: null,
              stageTrace: [],
              failure: { kind: "error", message: event.message, retryable: event.retryable },
            });
            void refresh();
            return;
        }
      },
      onLost: (reason) => {
        if (!current()) return;
        clearPendingStream();
        playSfx("error");
        finish("lost", reason);
        set({
          phase: "idle",
          stopping: false,
          turnId: null,
          boost: null,
          stage: null,
          stageTrace: [],
          failure: { kind: "lost", message: reason, retryable: true },
        });
        void refresh();
      },
    });
  };

  const requestStop = async (
    saveId: string,
    turnId: string,
    activeGeneration: number,
  ): Promise<void> => {
    try {
      await api.stop(saveId, turnId);
    } catch (error) {
      if (generation !== activeGeneration || get().turnId !== turnId) return;
      // 回合刚好自然结束或已过期时，不再把 404/409 误报给玩家
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) return;
      set({
        stopping: false,
        failure: {
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
      });
    }
  };

  return {
    phase: "idle",
    stopping: false,
    saveId: null,
    turnId: null,
    text: "",
    thought: "",
    boost: null,
    stage: null,
    stageTrace: [],
    pending: null,
    failure: null,
    spend: null,
    draft: EMPTY_DRAFT,
    setDraft: (draft) =>
      set((s) => {
        const next = mergeDraft(s.draft, draft);
        persistDraft(s.saveId, next);
        return { draft: next };
      }),
    restoreDraft: (saveId, draft) =>
      set((s) => {
        if (s.saveId !== saveId) return s;
        const next = mergeDraft(EMPTY_DRAFT, draft);
        persistDraft(saveId, next);
        return { draft: next };
      }),
    dismiss: () => set({ failure: null }),
    cancelSpend: () => set({ spend: null }),
    enter: (saveId) => {
      if (get().saveId === saveId) return;
      generation += 1;
      clearPendingStream();
      unsubscribe?.();
      unsubscribe = null;
      // 换了存档：上一个存档没收尾的这一轮算被顶掉
      finish("aborted");
      set({
        saveId,
        phase: "idle",
        stopping: false,
        turnId: null,
        text: "",
        thought: "",
        boost: null,
        stage: null,
        stageTrace: [],
        pending: null,
        failure: null,
        spend: null,
        draft: loadSavedDraft(saveId),
      });
    },
    async submit(saveId, baseVersion, pending, refresh) {
      if (get().phase !== "idle" || get().saveId !== saveId) return;
      const activeGeneration = ++generation;
      const current = () => generation === activeGeneration && get().saveId === saveId;
      clearPendingStream();
      // 只清理本次实际发送且此后未编辑的草稿；选项、重连和下一步草稿都应保留。
      const draft = get().draft;
      const submittedDraft =
        pending.input.text === draft.text.trim() &&
        pending.input.replyTo === draft.replyTo &&
        Boolean(pending.input.sandevistan) === Boolean(draft.sandevistan)
          ? draft
          : null;
      set({
        phase: "submitting",
        stopping: false,
        pending,
        failure: null,
        spend: null,
        text: "",
        thought: "",
        stage: {
          type: "stage",
          stage: "judge",
          label: "提交行动",
          detail: "等待后端建立回合",
          startedAt: Date.now(),
          local: true,
        },
        stageTrace: [],
        boost:
          pending.input.sandevistan === true
            ? { type: "boost", id: "pending", name: "斯安威斯坦" }
            : null,
      });
      // 上一次没收尾的（照理不会有）先算被顶掉，再开这一次
      finish("aborted");
      playSfx(pending.input.sandevistan === true ? "sandevistan" : "turnSubmit");
      progress = beginProgress("turn");
      const body = { requestId: newRequestId(), baseVersion, input: pending.input };
      try {
        const result = await api.submit(saveId, body);
        if (!current()) return;
        if (result.kind === "started") {
          const shouldStop = get().stopping;
          follow(saveId, result.turnId, refresh, current, submittedDraft);
          if (shouldStop) await requestStop(saveId, result.turnId, activeGeneration);
          return;
        }
        await refresh();
        if (!current()) return;
        set({ phase: "idle", stopping: false, pending: null, stage: null, stageTrace: [] });
        finish("ok");
      } catch (error) {
        if (!current()) return;
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          typeof error.body.turnId === "string"
        ) {
          // 接管旧回合必须恢复它自己的输入；当前草稿尚未提交，不能用于旧回合的重试或花费确认。
          const original = TurnInputSchema.safeParse(error.body.input);
          if (!original.success) {
            finish("rejected", "未能恢复上一轮的输入");
            set({
              phase: "idle",
              stopping: false,
              pending: null,
              boost: null,
              stage: null,
              stageTrace: [],
              failure: {
                kind: "rejected",
                message: "未能恢复上一轮的输入，请等待该轮结束后刷新。当前草稿已保留。",
                retryable: false,
              },
            });
            await refresh();
            return;
          }
          const shouldStop = get().stopping;
          set({ pending: { kind: "input", input: original.data }, boost: null });
          follow(saveId, error.body.turnId, refresh, current, null);
          if (shouldStop) await requestStop(saveId, error.body.turnId, activeGeneration);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        const kind: FailureKind =
          error instanceof ApiError && error.status === 503
            ? "unavailable"
            : error instanceof ApiError && error.status === 409
              ? "rejected"
              : "error";
        finish(kind, message);
        set({
          phase: "idle",
          stopping: false,
          stage: null,
          stageTrace: [],
          failure: { kind, message, retryable: kind === "error" },
        });
        if (kind === "rejected") await refresh();
      }
    },
    async stop() {
      const { phase, saveId, turnId, stopping } = get();
      if (phase === "idle" || stopping || !saveId) return;
      clearPendingStream();
      set({ stopping: true });
      if (!turnId) return;
      await requestStop(saveId, turnId, generation);
    },
  };
});
