import type { TurnInput } from "@cp/core";
import { useEffect, useRef } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Button } from "../../ui/Button";
import styles from "./story.module.css";

const MAX = 2000;
const WARN_AT = 1600;

/** 神经终端输入条：Enter 发送，Shift+Enter 换行；生成中支持一键中断 */
export function InputBar({
  busy,
  streaming,
  disabled,
  reason,
  draft,
  onDraft,
  onSend,
  onStop,
  reply,
  onCancelReply,
}: {
  readonly busy: boolean;
  readonly streaming: boolean;
  readonly disabled: boolean;
  readonly reason?: string | undefined;
  readonly draft: TurnInput;
  readonly onDraft: (draft: Partial<TurnInput>) => void;
  readonly onSend: (input: TurnInput) => void;
  readonly onStop: () => void;
  /** 正在回复的消息 */
  readonly reply?: { readonly name: string; readonly text: string } | undefined;
  readonly onCancelReply?: (() => void) | undefined;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const text = draft.text.trim();
  const len = text.length;
  const tooLong = len > MAX;
  const nearLimit = !tooLong && len >= WARN_AT;
  const canSend = !busy && !disabled && text !== "" && !tooLong;
  const hint = disabled && reason ? reason : null;

  // 点选「回复」或外部写入草稿时，把焦点放进输入框
  const last = useRef(draft.text);
  const lastReplyTo = useRef(draft.replyTo);
  useEffect(() => {
    const textInjected =
      draft.text !== last.current && document.activeElement !== area.current && draft.text !== "";
    const replySelected = draft.replyTo !== undefined && draft.replyTo !== lastReplyTo.current;
    if (textInjected || replySelected) {
      area.current?.focus();
    }
    last.current = draft.text;
    lastReplyTo.current = draft.replyTo;
  }, [draft.text, draft.replyTo]);

  const send = () => {
    if (!canSend) return;
    onSend({
      text,
      ...(reply && draft.replyTo !== undefined ? { replyTo: draft.replyTo } : {}),
    });
  };

  const placeholder = reply
    ? `回复 ${reply.name}（可直接答应接活、谈条件或回绝…）`
    : busy
      ? "正在推演本轮剧情，可提前输入下一步行动…"
      : "写下你的行动或对白…（Enter 发送 · Shift+Enter 换行）";

  return (
    <form
      className={styles.inputBar}
      data-busy={busy || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {reply && (
        <p className={styles.replyChip}>
          <span className={styles.replyText}>
            回复 <b>{reply.name}</b>：{reply.text}
          </span>
          {onCancelReply && <ActionButton onClick={onCancelReply}>取消</ActionButton>}
        </p>
      )}
      <div className={styles.inputRow}>
        <div className={styles.inputBox} data-invalid={tooLong || undefined}>
          <textarea
            ref={area}
            className={styles.textarea}
            rows={2}
            value={draft.text}
            disabled={disabled}
            placeholder={placeholder}
            aria-label="你的行动"
            aria-describedby={hint ? "story-input-hint" : undefined}
            onChange={(e) => onDraft({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          {(nearLimit || tooLong) && (
            <span className={styles.charCount} data-over={tooLong || undefined}>
              {len}/{MAX}
            </span>
          )}
        </div>
        {streaming ? (
          <Button onClick={onStop}>停止生成</Button>
        ) : (
          <Button
            type="submit"
            primary
            keyId="key.enter"
            disabled={!canSend}
            reason={busy ? "正在建立回合，请稍候" : tooLong ? `超过 ${MAX} 字上限` : undefined}
          >
            {busy ? "推演中…" : "发送"}
          </Button>
        )}
      </div>
      {tooLong ? (
        <p className={styles.warn}>
          已超出上限（{len}/{MAX} 字），精简后再发送
        </p>
      ) : (
        hint && (
          <span id="story-input-hint" className={styles.hint}>
            {hint}
          </span>
        )
      )}
    </form>
  );
}
