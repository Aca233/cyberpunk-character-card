import type { TurnEvent, TurnInput } from "@cp/core";
import { create } from "zustand";
import { ApiError, api, newRequestId } from "../../api/client";
import { followTurn } from "../../api/events";
import { beginProgress, type EndCategory, type ProgressHandle } from "../../progress";

/**
 * 一轮生成的进度：提交 → 事件流（掷骰、正文逐字）→ 终止事件 → 刷新存档状态。
 * 出错、被拦截、停止时玩家的输入留在输入框里，可以原样重试
 */

export type Pending =
  | { readonly kind: "input"; readonly input: TurnInput }
  | {
      readonly kind: "confirm";
      readonly checkId: string;
      readonly label: string;
      /** 掷骰前玩了矩阵小游戏：解开了几段 */
      readonly matrix?: number;
    };

export type FailureKind =
  /** 被安全过滤拦截 */
  | "blocked"
  /** 模型或网络出错 */
  | "error"
  /** 玩家停止了生成 */
  | "stopped"
  /** 模型没配好（503），要去设置里改 */
  | "unavailable"
  /** 后端拒绝：版本过期、已掷过骰、检定失效 */
  | "rejected"
  /** 事件流断了，这一轮在后端找不到 */
  | "lost";

export interface Failure {
  readonly kind: FailureKind;
  readonly message: string;
  readonly retryable: boolean;
}

export type Rolled = Extract<TurnEvent, { type: "rolled" }>;
export type LiveBoost = Extract<TurnEvent, { type: "boost" }>;

/** 提交前确认：这一轮要一次花掉一大笔钱；确认后带 spendOk 原样重发 */
export interface Spend {
  readonly label: string;
  readonly price: number;
  readonly eddies: number;
  readonly input: TurnInput;
}

interface StoryState {
  readonly phase: "idle" | "submitting" | "streaming";
  readonly saveId: string | null;
  readonly turnId: string | null;
  /** 正在生成的正文；记账在正文之后由后端另外抽 */
  readonly text: string;
  readonly rolled: Rolled | null;
  readonly boost: LiveBoost | null;
  readonly pending: Pending | null;
  readonly failure: Failure | null;
  readonly spend: Spend | null;
  /** 输入框：方式和文字；发送成功、这一轮写进存档后才清空 */
  readonly draft: TurnInput;
  setDraft(draft: Partial<TurnInput>): void;
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

export const useStory = create<StoryState>()((set, get) => {
  let generation = 0;
  const follow = (
    saveId: string,
    turnId: string,
    refresh: () => Promise<unknown>,
    current: () => boolean,
    submittedDraft: TurnInput | null,
  ) => {
    unsubscribe?.();
    set({ phase: "streaming", turnId });
    unsubscribe = followTurn(saveId, turnId, {
      onEvent: (event) => {
        if (!current()) return;
        switch (event.type) {
          case "started":
            return;
          case "rolled":
            set({ rolled: event });
            return;
          case "boost":
            set({ boost: event });
            return;
          case "text":
            set((s) => ({ text: s.text + event.text }));
            return;
          case "done": {
            const complete = () => {
              if (!current()) return;
              set((s) => ({
                phase: "idle",
                turnId: null,
                text: "",
                rolled: null,
                boost: null,
                pending: null,
                draft: s.draft === submittedDraft ? EMPTY_DRAFT : s.draft,
              }));
              finish("ok");
            };
            void refresh().then(complete, complete);
            return;
          }
          case "confirmSpend": {
            const pending = get().pending;
            finish("confirmSpend");
            set({
              phase: "idle",
              turnId: null,
              text: "",
              boost: null,
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
            finish("blocked", event.reason);
            set({
              phase: "idle",
              turnId: null,
              boost: null,
              failure: { kind: "blocked", message: event.reason, retryable: true },
            });
            return;
          case "stopped":
            finish("stopped");
            set({
              phase: "idle",
              turnId: null,
              boost: null,
              failure: {
                kind: "stopped",
                message: "已停止生成，这一轮没有写进存档",
                retryable: true,
              },
            });
            return;
          case "error":
            finish("error", event.message);
            set({
              phase: "idle",
              turnId: null,
              boost: null,
              failure: { kind: "error", message: event.message, retryable: event.retryable },
            });
            void refresh();
            return;
        }
      },
      onLost: (reason) => {
        if (!current()) return;
        finish("lost", reason);
        set({
          phase: "idle",
          turnId: null,
          boost: null,
          failure: { kind: "lost", message: reason, retryable: true },
        });
        void refresh();
      },
    });
  };

  return {
    phase: "idle",
    saveId: null,
    turnId: null,
    text: "",
    rolled: null,
    boost: null,
    pending: null,
    failure: null,
    spend: null,
    draft: EMPTY_DRAFT,
    setDraft: (draft) => set((s) => ({ draft: { ...s.draft, ...draft } })),
    dismiss: () => set({ failure: null }),
    cancelSpend: () => set({ spend: null }),
    enter: (saveId) => {
      if (get().saveId === saveId) return;
      generation += 1;
      unsubscribe?.();
      unsubscribe = null;
      // 换了存档：上一个存档没收尾的这一轮算被顶掉
      finish("aborted");
      set({
        saveId,
        phase: "idle",
        turnId: null,
        text: "",
        rolled: null,
        boost: null,
        pending: null,
        failure: null,
        spend: null,
        draft: EMPTY_DRAFT,
      });
    },
    async submit(saveId, baseVersion, pending, refresh) {
      if (get().phase !== "idle" || get().saveId !== saveId) return;
      const activeGeneration = ++generation;
      const current = () => generation === activeGeneration && get().saveId === saveId;
      // 只清理本次实际发送且此后未编辑的草稿；选项、重连和下一步草稿都应保留。
      const draft = get().draft;
      const submittedDraft =
        pending.kind === "input" &&
        pending.input.text === draft.text.trim() &&
        pending.input.replyTo === draft.replyTo
          ? draft
          : null;
      set({
        phase: "submitting",
        pending,
        failure: null,
        spend: null,
        text: "",
        rolled: null,
        boost:
          pending.kind === "input" && pending.input.sandevistan === true
            ? { type: "boost", id: "pending", name: "斯安威斯坦" }
            : null,
      });
      // 上一次没收尾的（照理不会有）先算被顶掉，再开这一次
      finish("aborted");
      progress = beginProgress("turn");
      const body =
        pending.kind === "input"
          ? { requestId: newRequestId(), baseVersion, input: pending.input }
          : {
              requestId: newRequestId(),
              baseVersion,
              confirm: pending.checkId,
              ...(pending.matrix === undefined ? {} : { matrix: pending.matrix }),
            };
      try {
        const result = await api.submit(saveId, body);
        if (!current()) return;
        if (result.kind === "started") {
          follow(saveId, result.turnId, refresh, current, submittedDraft);
          return;
        }
        await refresh();
        if (!current()) return;
        set({ phase: "idle", pending: null });
        finish("ok");
      } catch (error) {
        if (!current()) return;
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          typeof error.body.turnId === "string"
        ) {
          // 上一轮还在生成（例如刷新了页面）：接着收它的事件
          set({ pending: null });
          follow(saveId, error.body.turnId, refresh, current, null);
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
        set({ phase: "idle", failure: { kind, message, retryable: kind === "error" } });
        if (kind === "rejected") await refresh();
      }
    },
    async stop() {
      const { saveId, turnId } = get();
      if (!saveId || !turnId) return;
      const activeGeneration = generation;
      try {
        await api.stop(saveId, turnId);
      } catch (error) {
        if (generation !== activeGeneration || get().turnId !== turnId) return;
        set({
          failure: {
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
          },
        });
      }
    },
  };
});
