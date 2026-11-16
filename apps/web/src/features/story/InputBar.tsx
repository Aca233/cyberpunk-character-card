import type { TurnInput } from "@cp/core";
import { useEffect, useRef } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Button } from "../../ui/Button";
import styles from "./story.module.css";

const MAX = 2000;

/** 只有一个输入框；Enter 发送，Shift+Enter 换行；生成时变成“停止生成” */
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
  const tooLong = text.length > MAX;
  const canSend = !busy && !disabled && text !== "" && !tooLong;
  // 只提示输入框不能用的原因；斯安威斯坦由模型按文本与局势自动判断开启
  const hint = disabled && reason ? reason : null;

  // 改写检定文字或点选「回复」时，把焦点放进输入框
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

  return (
    <form
      className={styles.inputBar}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {reply && (
        <p className={styles.replyChip}>
          <span className={styles.replyText}>
            回复 {reply.name}：{reply.text}
          </span>
          {onCancelReply && <ActionButton onClick={onCancelReply}>取消</ActionButton>}
        </p>
      )}
      <div className={styles.inputRow}>
        <textarea
          ref={area}
          className={styles.textarea}
          rows={2}
          value={draft.text}
          disabled={disabled}
          placeholder={
            reply ? `回消息给 ${reply.name}（可直接答应接活、谈条件或回绝…）` : undefined
          }
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
        {streaming ? (
          <Button onClick={onStop}>停止生成</Button>
        ) : (
          <Button
            type="submit"
            primary
            keyId="key.enter"
            disabled={!canSend}
            reason={busy ? "正在提交" : tooLong ? `超过 ${MAX} 字` : undefined}
          >
            发送
          </Button>
        )}
      </div>
      {tooLong ? (
        <p className={styles.warn}>
          {text.length}/{MAX} 字，太长了
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
