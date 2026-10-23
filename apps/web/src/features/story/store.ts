import type { TurnEvent, TurnInput } from "@cp/core";
import { create } from "zustand";
import { ApiError, api, newRequestId } from "../../api/client";
import { followTurn } from "../../api/events";

/**
 * 一轮生成的进度：提交 → 事件流（掷骰、正文逐字）→ 终止事件 → 刷新存档状态。
 * 出错、被拦截、停止时玩家的输入留在输入框里，可以原样重试
 */

export type Pending =
  | { readonly kind: "input"; readonly input: TurnInput }
  | { readonly kind: "confirm"; readonly checkId: string; readonly label: string };

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

interface StoryState {
  readonly phase: "idle" | "submitting" | "streaming";
  readonly saveId: string | null;
  readonly turnId: string | null;
  /** 正在生成的正文；指令块已经被后端拆掉 */
  readonly text: string;
  readonly rolled: Rolled | null;
  readonly pending: Pending | null;
  readonly failure: Failure | null;
  /** 输入框：方式和文字；发送成功、这一轮写进存档后才清空 */
  readonly draft: TurnInput;
  setDraft(draft: Partial<TurnInput>): void;
  dismiss(): void;
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

const EMPTY_DRAFT: TurnInput = { mode: "do", text: "" };

export const useStory = create<StoryState>()((set, get) => {
  const follow = (saveId: string, turnId: string, refresh: () => Promise<unknown>) => {
    unsubscribe?.();
    set({ phase: "streaming", turnId });
    unsubscribe = followTurn(saveId, turnId, {
      onEvent: (event) => {
        switch (event.type) {
          case "started":
            return;
          case "rolled":
            set({ rolled: event });
            return;
          case "text":
            set((s) => ({ text: s.text + event.text }));
            return;
          case "done": {
            const wasInput = get().pending?.kind === "input";
            void refresh().finally(() =>
              set((s) => ({
                phase: "idle",
                turnId: null,
                text: "",
                rolled: null,
                pending: null,
                draft: wasInput ? { ...EMPTY_DRAFT, mode: s.draft.mode } : s.draft,
              })),
            );
            return;
          }
          case "blocked":
            set({
              phase: "idle",
              turnId: null,
              failure: { kind: "blocked", message: event.reason, retryable: true },
            });
            return;
          case "stopped":
            set({
              phase: "idle",
              turnId: null,
              failure: {
                kind: "stopped",
                message: "已停止生成，这一轮没有写进存档",
                retryable: true,
              },
            });
            return;
          case "error":
            set({
              phase: "idle",
              turnId: null,
              failure: { kind: "error", message: event.message, retryable: event.retryable },
            });
            void refresh();
            return;
        }
      },
      onLost: (reason) => {
        set({
          phase: "idle",
          turnId: null,
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
    pending: null,
    failure: null,
    draft: EMPTY_DRAFT,
    setDraft: (draft) => set((s) => ({ draft: { ...s.draft, ...draft } })),
    dismiss: () => set({ failure: null }),
    enter: (saveId) => {
      if (get().saveId === saveId) return;
      unsubscribe?.();
      unsubscribe = null;
      set({
        saveId,
        phase: "idle",
        turnId: null,
        text: "",
        rolled: null,
        pending: null,
        failure: null,
        draft: EMPTY_DRAFT,
      });
    },
    async submit(saveId, baseVersion, pending, refresh) {
      if (get().phase !== "idle") return;
      set({ phase: "submitting", pending, failure: null, text: "", rolled: null });
      const body =
        pending.kind === "input"
          ? { requestId: newRequestId(), baseVersion, input: pending.input }
          : { requestId: newRequestId(), baseVersion, confirm: pending.checkId };
      try {
        const result = await api.submit(saveId, body);
        if (result.kind === "started") {
          follow(saveId, result.turnId, refresh);
          return;
        }
        await refresh();
        set({ phase: "idle", pending: null });
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          typeof error.body.turnId === "string"
        ) {
          // 上一轮还在生成（例如刷新了页面）：接着收它的事件
          follow(saveId, error.body.turnId, refresh);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        const kind: FailureKind =
          error instanceof ApiError && error.status === 503
            ? "unavailable"
            : error instanceof ApiError && error.status === 409
              ? "rejected"
              : "error";
        set({ phase: "idle", failure: { kind, message, retryable: kind === "error" } });
        if (kind === "rejected") await refresh();
      }
    },
    async stop() {
      const { saveId, turnId } = get();
      if (!saveId || !turnId) return;
      try {
        await api.stop(saveId, turnId);
      } catch (error) {
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
